import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../distributed-transactions.js',import.meta.url),'utf8');

function responseJson(value){
  const text=JSON.stringify(value);
  return {ok:true,headers:{get:()=>String(Buffer.byteLength(text))},text:async()=>text};
}
function responseChunk(value){
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  return {ok:true,headers:{get:()=>String(bytes.byteLength)},arrayBuffer:async()=>bytes.buffer};
}
function setup({serving='pages',partPath='41210/rowHouse-sale/202008/a-0.json.gz'}={}){
  const calls=[];
  const shard={id:'realestate-data-003',repository:'softm/realestate-data-003',collectionOwner:'shard',serving,
    pagesBaseUrl:'https://softm.github.io/realestate-data-003/',districtCodes:['41210']};
  const row={date:'2020-08-15',type:'rowHouse',deal:'sale',lot:'158-216',exactLotPublic:true,cancelled:false,
    amount:31000,exclusiveArea:59.7,umdNm:'광명동',sourceId:'r1'};
  const payloads=new Map([
    ['https://example.test/data/transactions/storage-registry.json',{kind:'json',value:{schemaVersion:3,shards:[shard]}}],
    ['https://softm.github.io/realestate-data-003/published/index.json',{kind:'json',value:{schemaVersion:2,generatedAt:'2026-11-15T00:00:00Z',districts:{41210:{index:'41210/index.json',updatedAt:'2026-11-15T00:00:00Z'}}}}],
    ['https://softm.github.io/realestate-data-003/published/41210/index.json',{kind:'json',value:{schemaVersion:2,district:'41210',updatedAt:'2026-11-15T00:00:00Z',
      coverage:{'rowHouse-sale':['202008']},groups:{'rowHouse-sale':{'광명동':[{path:partPath,encoding:'gzip',rows:1,month:'202008'}]}}}}],
    ['https://softm.github.io/realestate-data-003/published/'+partPath,{kind:'chunk',value:{schemaVersion:2,district:'41210',stream:'rowHouse-sale',emd:'광명동',rows:[row]}}]
  ]);
  const context={window:{},document:{baseURI:'https://example.test/'},URL,AbortSignal,TextEncoder,TextDecoder,Blob,Response,DecompressionStream,
    fetch:async url=>{const href=String(url);calls.push(href);const payload=payloads.get(href);if(!payload)return {ok:false,status:404,headers:{get:()=>null}};
      return payload.kind==='chunk'?responseChunk(payload.value):responseJson(payload.value);}};
  vm.runInNewContext(source,context);
  return {api:context.window.TojiDistributedTrades,calls,shard};
}

test('only an explicitly handed-off Pages shard is selected',()=>{
  const active=setup();
  assert.equal(active.api.selectShard({schemaVersion:3,shards:[active.shard]},'41210').id,'realestate-data-003');
  const legacy={...active.shard,serving:'legacy'};
  assert.equal(active.api.selectShard({schemaVersion:3,shards:[legacy]},'41210'),null);
});

test('distributed lookup reads only the owning shard Pages and returns exact parcel rows',async()=>{
  const {api,calls}=setup();
  const result=await api.lookup({lawdCode:'41210',emd:'광명동',lot:'158-216'},'rowHouse');
  assert.equal(result.storageShard,'realestate-data-003');
  assert.equal(result.source,'국토부 분산 수집 자료');
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].dealAmount,31000);
  assert.deepEqual([...result.completeMonths],['202008']);
  assert.ok(calls.slice(1).every(url=>url.startsWith('https://softm.github.io/realestate-data-003/')));
});

test('a shard chunk cannot escape its assigned published scope',async()=>{
  const {api}=setup({partPath:'../other.json.gz'});
  await assert.rejects(()=>api.lookup({lawdCode:'41210',emd:'광명동',lot:'158-216'},'rowHouse'),/Invalid distributed chunk path/);
});
