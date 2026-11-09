import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code=fs.readFileSync(new URL('../static-transactions.js',import.meta.url),'utf8');
const row={date:'2020-08-15',type:'rowHouse',deal:'sale',lot:'158-216',jibun:'158-216',exactLotPublic:true,cancelled:false,amount:31000,exclusiveArea:59.7,umdNm:'광명동'};
function setup(){const calls=[];const payloads={
 'index.json':{schemaVersion:2,districts:{41210:{index:'41210/index.json'}}},
 '41210/index.json':{schemaVersion:2,district:'41210',updatedAt:'2026-11-09T00:00:00Z',coverage:{'rowHouse-sale':['202008']},groups:{'rowHouse-sale':{'광명동':[{path:'41210/test.json',rows:2}]}}},
 '41210/test.json':{schemaVersion:2,district:'41210',stream:'rowHouse-sale',emd:'광명동',rows:[row,{...row,jibun:'158-***',lot:'',exactLotPublic:false}]}};
 const context={window:{},document:{baseURI:'https://example.test/'},URL,AbortSignal,fetch:async url=>{calls.push(url);const key=url.split('/published/')[1];return {ok:Boolean(payloads[key]),json:async()=>payloads[key]};}};
 vm.runInNewContext(code,context);return {api:context.window.TojiStaticTrades,calls};}
test('static transaction lookup returns exact parcel only, with no government API request',async()=>{const {api,calls}=setup();const r=await api.lookup({lawdCode:'41210',emd:'광명동',lot:'158-216'},'rowHouse');assert.equal(r.rows.length,1);assert.equal(r.rows[0].dealAmount,31000);assert.ok(calls.every(x=>x.startsWith('https://example.test/data/transactions/published/')));assert.equal(r.fullHistoryComplete,false);});
test('other lot never inherits verified parcel records; loaded shard is reused',async()=>{const {api,calls}=setup();await api.lookup({lawdCode:'41210',emd:'광명동',lot:'158-216'},'rowHouse');const r=await api.lookup({lawdCode:'41210',emd:'광명동',lot:'158-217'},'rowHouse');assert.equal(r.rows.length,0);assert.equal(calls.length,3);});
