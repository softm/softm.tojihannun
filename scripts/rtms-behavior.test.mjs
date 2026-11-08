import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../market-data.js', import.meta.url),'utf8');
const snapshot = JSON.parse(fs.readFileSync(new URL('../rtms-verified-snapshots.json',import.meta.url),'utf8'));
const rows = snapshot.entries[0].rows;
const parcel = {id:'4121010100101580216',pnu:'4121010100101580216',address:'경기도 광명시 광명동 158-216',number:'158-216대',buildings:[{name:'선영빌라',use:'다세대주택'}]};
function element(){return {value:'',textContent:'',innerHTML:'',hidden:false,dataset:{},remove(){},classList:{add(){},remove(){}},addEventListener(){}};}
function harness({snap=snapshot,respond=async()=>new Response(JSON.stringify({response:{header:{resultCode:'000'},body:{items:{item:[]},totalCount:0}}})),key='test-not-real'}={}){
  const elements=new Map();
  const get=sel=>{if(!elements.has(sel))elements.set(sel,element());return elements.get(sel);};
  get('#transactionRange').value='all';
  const calls=[]; const store=new Map();
  class Clock extends Date {constructor(...a){super(...(a.length?a:['2026-11-08T12:00:00Z']));} static now(){return new Date('2026-11-08T12:00:00Z').getTime();}}
  const context={console,URL,URLSearchParams,AbortController,AbortSignal,DOMException,Date:Clock,setTimeout,clearTimeout,Response,
    document:{querySelector:get,querySelectorAll:()=>[]},
    sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
    navigator:{},window:{__TOJI_RUNTIME_CONFIG__:{molitApiKey:key}},
    fetch:async (url,options)=>{if(String(url).startsWith('./rtms-verified'))return {ok:true,json:async()=>snap};calls.push(String(url));return respond(url,options,calls.length);}};
  const instrumented=source.replace('  bindEvents();',`  renderTransactionView = () => {state.transactionItems = state.transactionView === 'nearby' ? state.transactionGroups.comparable : state.transactionGroups.items;};
  waitForRtms = async (ms,signal) => {if(signal?.aborted) throw abortError();};
  window.testApi = {state, parseParcelArea, normalizeLot, parcelLot, parseRtmsResponse, normalizeRtmsNodes, scopeTransactionItems, transactionMonths, loadTransactions, setParcel, refreshParcel, activate, fetchRtmsMonth};`);
  vm.runInNewContext(instrumented,context);
  const api=context.window.testApi;
  api.setParcel(parcel);api.state.activeTab='transactions';
  return {api,calls,get,context};
}
const clean=v=>JSON.parse(JSON.stringify(v));
test('real VWorld cadastral label 158-216대 resolves from PNU instead of empty string',()=>{
  const {api}=harness(); assert.equal(api.parseParcelArea(parcel).lot,'158-216');assert.equal(api.parseParcelArea(parcel).emd,'광명동');
  assert.equal(api.parcelLot({...parcel,pnu:'',address:''}),'158-216');
  assert.equal(api.parcelLot({...parcel,pnu:'4121010100201580216'}),'산158-216');
  assert.equal(api.normalizeLot('00158-00216'),'158-216');assert.equal(api.normalizeLot('158-0'),'158');
});
test('masked, partial and unknown public lot values never become exact parcel matches',()=>{
  const {api}=harness();for(const input of ['158-***','158-*','158-21*','158-','158-216대','158-216 외 1필지'])assert.equal(api.normalizeLot(input),'',input);
});
test('actual official JSON rows keep exclusive area, prices and different floors',()=>{
  const {api}=harness();const parsed=api.parseRtmsResponse(JSON.stringify({response:{header:{resultCode:'000'},body:{items:{item:rows},totalCount:3}}}),'rowHouse');
  assert.equal(parsed.items.length,3);assert.deepEqual(clean(parsed.items.map(r=>[r.date,r.amount,r.area,r.floor])),[['2020-08-15',31000,59.7,'3'],['2019-12-13',27000,59.7,'1'],['2016-07-23',20500,59.7,'3']]);
  const scoped=api.scopeTransactionItems(parsed.items,api.parseParcelArea(parcel),'rowHouse');assert.equal(scoped.items.length,3);assert.equal(scoped.comparable.length,0);
});
test('same date, price and area on different floors are not deduplicated away',()=>{
  const {api}=harness();const items=api.normalizeRtmsNodes([{...rows[0],floor:'1'},{...rows[0],floor:'3'}],'rowHouse');assert.equal(api.scopeTransactionItems(items,api.parseParcelArea(parcel),'rowHouse').items.length,2);
});
test('whole-period month plan covers past years without future months',()=>{
  const {api}=harness();const months=api.transactionMonths('all');assert.equal(months.length,251);assert.equal(months[0],'202611');assert.equal(months.at(-1),'200601');for(const m of ['202008','201912','201607'])assert.ok(months.includes(m));
});
test('verified three rows appear with ZERO external API requests, also without a key',async()=>{
  const {api,calls}=harness({key:''});await api.loadTransactions();assert.equal(calls.length,0);assert.equal(api.state.transactionItems.length,3);assert.equal(api.state.transactionGroups.coveredMonths,3);assert.equal(api.state.transactionGroups.remainingMonths,248);assert.equal(api.state.transactionGroups.loading,false);
});
test('first request 429 stops immediately; refresh honors cooldown rather than repeating 251 requests',async()=>{
  const {api,calls}=harness({snap:{entries:[]},respond:async()=>new Response('',{status:429,headers:{'Retry-After':'60'}})});
  await api.loadTransactions();assert.equal(calls.length,1);assert.equal(api.state.transactionSession.failures.size,1);assert.equal(api.state.transactionGroups.coveredMonths,0);assert.equal(api.state.transactionGroups.loading,false);
  await api.loadTransactions(true);assert.equal(calls.length,1);assert.match(api.state.transactionGroups.error,/요청 제한/);
});
test('429 on explicit refresh preserves the three previously verified rows',async()=>{
  const {api,calls}=harness({respond:async()=>new Response('',{status:429})});await api.loadTransactions();await api.loadTransactions(true);assert.equal(calls.length,1);assert.equal(api.state.transactionItems.length,3);assert.ok(api.state.transactionGroups.error);
});
test('uncached parcel auto-loads at most 3 months; continuation is explicit and capped at 12',async()=>{
  const {api,calls}=harness({snap:{entries:[]}});await api.loadTransactions();assert.equal(calls.length,3);assert.equal(api.state.transactionGroups.coveredMonths,3);
  await api.loadTransactions();assert.equal(calls.length,3);
  api.refreshParcel({...parcel,buildingName:'선영빌라'});assert.equal(calls.length,3);
  await api.loadTransactions(false,false,{more:true});assert.equal(calls.length,15);assert.equal(api.state.transactionGroups.coveredMonths,15);
});
test('MOLIT quota code 22 also stops after one request',async()=>{
  const {api,calls}=harness({snap:{entries:[]},respond:async()=>new Response(JSON.stringify({response:{header:{resultCode:'22',resultMsg:'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR'}}}))});await api.loadTransactions();assert.equal(calls.length,1);assert.equal(api.state.transactionGroups.loading,false);assert.equal(api.state.transactionSession.failures.size,1);
});
test('snapshot rows never leak into another lot or another legal dong',async()=>{
  const {api,calls}=harness();api.setParcel({...parcel,pnu:'4121010100101580217',id:'other',number:'158-217대',address:'경기도 광명시 광명동 158-217'});await api.loadTransactions();assert.equal(api.state.transactionItems.length,0);assert.equal(api.state.transactionSession.snapshots.size,0);assert.equal(calls.length,3);
});
test('snapshot is parcel-only: nearby view is explicitly unqueried, not a fabricated zero',async()=>{
  const {api}=harness();await api.loadTransactions();assert.equal(api.state.transactionGroups.regionalCovered,false);assert.equal(api.state.transactionGroups.comparable.length,0);
});
test('JSON single item, cancelled row and cancelled-date sentinel are handled',()=>{
  const {api}=harness();const wrap=item=>JSON.stringify({response:{header:{resultCode:'000'},body:{items:{item},totalCount:1}}});
  assert.equal(api.parseRtmsResponse(wrap({...rows[0],cdealDay:'-'}),'rowHouse').items.length,1);
  assert.equal(api.parseRtmsResponse(wrap({...rows[0],cdealType:'O'}),'rowHouse').items.length,0);
  assert.equal(api.parseRtmsResponse(wrap({...rows[0],cdealDay:'2020-09-01'}),'rowHouse').items.length,0);
});
test('successful revalidation replaces snapshot month even when a contract is cancelled',async()=>{
  const {api,calls}=harness();await api.loadTransactions();await api.loadTransactions(true);assert.equal(calls.length,3);assert.equal(api.state.transactionItems.length,0);assert.equal(api.state.transactionGroups.coveredMonths,3);
});
