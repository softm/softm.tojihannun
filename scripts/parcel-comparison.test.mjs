import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../market-data.js',import.meta.url),'utf8');
const parcel={id:'regression-parcel',pnu:'4121010100101590042',address:'광명동 159-42',road:'경기도 광명시 오리로 1034-1 (광명동)',number:'159-42대',buildings:[{use:'다세대주택'}]};
const row={dealYear:'2026',dealMonth:'10',dealDay:'05',dealAmount:'31000',excluUseAr:'59.7',umdNm:'광명동',jibun:'159-42',mhouseNm:'회귀검증용 건물',floor:'3'};
function harness(rows=[row]){
  const elements=new Map(),calls=[];
  const get=key=>{if(!elements.has(key))elements.set(key,{value:'',textContent:'',innerHTML:'',hidden:false,dataset:{},remove(){},classList:{add(){},remove(){}},addEventListener(){}});return elements.get(key);};
  class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-11-17T00:00:00Z']));}static now(){return new Date('2026-11-17T00:00:00Z').getTime();}}
  const context={console,Date:Clock,URL,URLSearchParams,AbortController,AbortSignal,DOMException,setTimeout,clearTimeout,
    document:{querySelector:get,querySelectorAll:()=>[]},navigator:{},
    localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}},
    fetch:async url=>{assert.match(String(url),/^\.\/rtms-verified/,'no government API requests');return {ok:true,json:async()=>({entries:[]})};},
    window:{location:{href:'https://tojihannun.designboard.net/'},__TOJI_RUNTIME_CONFIG__:{},TojiStaticTrades:{lookup:async(area,type,options)=>{calls.push({area,type,options});return {rows,completeMonths:['202610'],verifiedAt:'2026-11-17T00:00:00Z'};}}}};
  const injected=source.replace('  bindEvents();',`  renderTransactionView=()=>{state.transactionItems=state.transactionView==='nearby'?state.transactionGroups.comparable:state.transactionGroups.items;};
  window.testApi={state,parseParcelArea,normalizeLot,scopeTransactionItems,loadTransactions,setParcel,selectTransactionView,renderTransactionSession};
  bindEvents();`);
  vm.runInNewContext(injected,context);
  const api=context.window.testApi;assert.ok(api,'test seam');api.setParcel(parcel);api.state.activeTab='transactions';get('#transactionRange').value='36';
  return {api,get,calls,context};
}
test('short cadastral label keeps legal dong, region and PNU lot',()=>{
  const {api}=harness();const a=api.parseParcelArea(parcel);assert.equal(a.emd,'광명동');assert.equal(a.lawdCode,'41210');assert.equal(a.lot,'159-42');assert.equal(a.sido,'경기도');assert.equal(a.sgg,'광명시');
  for(const address of ['광명동 159-42대','경기도 광명시 광명동 159-42','광명동 159-42'])assert.equal(api.parseParcelArea({...parcel,address}).emd,'광명동');
});
test('road number is never mistaken for cadastral lot',()=>{
  const {api}=harness();const a=api.parseParcelArea({...parcel,pnu:'4121010100',number:'',address:'',road:parcel.road});assert.equal(a.emd,'광명동');assert.equal(a.lawdCode,'41210');assert.equal(a.lot,'');
  assert.equal(api.parseParcelArea({...parcel,pnu:'4121010100',number:'',address:parcel.road}).lot,'');
  assert.equal(api.parseParcelArea({...parcel,pnu:'',number:'',address:'광명동 산 15-2'}).lot,'산15-2');
});
test('short and full addresses load the same exact and comparison data',async()=>{
  for(const address of ['광명동 159-42','경기도 광명시 광명동 159-42']){
    const {api,calls}=harness([row,{...row,jibun:'159-43'},{...row,umdNm:'철산동'}]);api.setParcel({...parcel,address});await api.loadTransactions();
    assert.equal(api.state.transactionGroups.items.length,1);assert.equal(api.state.transactionGroups.comparable.length,1);assert.equal(api.state.transactionView,'parcel');assert.equal(calls.length,1);assert.equal(calls[0].options.includeNearby,true);
  }
});
test('no exact row automatically exposes same-dong analytics, not fabricated parcel records',async()=>{
  const {api}=harness([{...row,jibun:'159-43'},{...row,jibun:'159-**'},{...row,umdNm:'철산동'}]);await api.loadTransactions();
  assert.equal(api.state.transactionView,'nearby');assert.equal(api.state.transactionGroups.items.length,0);assert.equal(api.state.transactionItems.length,2);assert.ok(api.state.transactionItems.every(item=>!item.exact));
  api.selectTransactionView('parcel');assert.equal(api.state.transactionView,'parcel');assert.equal(api.state.transactionItems.length,0);api.renderTransactionSession(api.state.transactionSession);assert.equal(api.state.transactionView,'parcel','do not override explicit selection');
});
test('known legal region without an exact lot still loads comparison only',async()=>{
  const {api,calls}=harness();api.setParcel({...parcel,pnu:'4121010100',address:'광명동',number:''});await api.loadTransactions();
  assert.equal(calls.length,1);assert.equal(calls[0].area.lot,'');assert.equal(api.state.transactionView,'nearby');assert.equal(api.state.transactionGroups.parcelIdentified,false);assert.equal(api.state.transactionGroups.items.length,0);assert.equal(api.state.transactionGroups.comparable.length,1);
  api.selectTransactionView('parcel');assert.equal(api.state.transactionView,'nearby');
});
test('unknown legal region renders an identity error with neither fabricated zero nor stale rows',async()=>{
  const {api,calls}=harness();await api.loadTransactions();api.setParcel({...parcel,pnu:'',address:'',road:'',number:''});await api.loadTransactions();
  assert.equal(calls.length,1);assert.equal(api.state.transactionGroups.regionIdentified,false);assert.equal(api.state.transactionGroups.identityError,true);assert.equal(api.state.transactionItems.length,0);assert.match(api.state.transactionGroups.error,/지번주소/);
});
test('masked public lots still cannot become exact matches',()=>{
  const {api}=harness();for(const lot of ['159-*','159-**','159-42대','159-42 외 1필지'])assert.equal(api.normalizeLot(lot),'');
});
test('central static reader allows missing lot only for an explicit regional comparison',async()=>{
  const calls=[];const files={
    'index.json':{schemaVersion:2,districts:{41210:{index:'41210/index.json'}}},
    '41210/index.json':{schemaVersion:2,district:'41210',coverage:{'rowHouse-sale':['202610']},groups:{'rowHouse-sale':{'광명동':[{path:'41210/rows.json',rows:1}]}}},
    '41210/rows.json':{schemaVersion:2,district:'41210',stream:'rowHouse-sale',emd:'광명동',rows:[{type:'rowHouse',deal:'sale',exactLotPublic:true,lot:'159-42',umdNm:'광명동',date:'2026-10-05',amount:31000,exclusiveArea:59.7}]}
  };
  const context={URL,AbortSignal,window:{},document:{baseURI:'https://test.example/'},fetch:async url=>{const key=String(url).split('/published/')[1];calls.push(key);assert.ok(files[key],key);return {ok:true,json:async()=>files[key]};}};
  vm.runInNewContext(fs.readFileSync(new URL('../static-transactions.js',import.meta.url),'utf8'),context);
  const area={lawdCode:'41210',emd:'광명동',lot:''};assert.equal(await context.window.TojiStaticTrades.lookup(area,'rowHouse'),null);assert.equal(calls.length,0);
  const result=await context.window.TojiStaticTrades.lookup(area,'rowHouse',{includeNearby:true,months:['202610']});assert.equal(result.rows.length,1);assert.equal(result.rows[0].umdNm,'광명동');
});
test('distributed reader likewise preserves exact-only guard while permitting regional reads',async()=>{
  let calls=0;const context={URL,AbortSignal,TextEncoder,window:{},document:{baseURI:'https://test.example/'},fetch:async()=>{calls++;return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({schemaVersion:3,shards:[]})};}};
  vm.runInNewContext(fs.readFileSync(new URL('../distributed-transactions.js',import.meta.url),'utf8'),context);
  const area={lawdCode:'41210',emd:'광명동',lot:''};await context.window.TojiDistributedTrades.lookup(area,'rowHouse');assert.equal(calls,0);await context.window.TojiDistributedTrades.lookup(area,'rowHouse',{includeNearby:true});assert.equal(calls,1);
});
