import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../market-data.js', import.meta.url),'utf8');
const snapshot = JSON.parse(fs.readFileSync(new URL('../rtms-verified-snapshots.json',import.meta.url),'utf8'));
const rows = snapshot.entries[0].rows;
const parcel = {id:'4121010100101580216',pnu:'4121010100101580216',address:'경기도 광명시 광명동 158-216',number:'158-216대',buildings:[{name:'선영빌라',use:'다세대주택'}]};
function element(){return {value:'',textContent:'',innerHTML:'',hidden:false,dataset:{},events:{},remove(){},classList:{add(){},remove(){}},addEventListener(name,listener){this.events[name]=listener;}};}
function harness({snap=snapshot,respond=async()=>new Response(JSON.stringify({response:{header:{resultCode:'000'},body:{items:{item:[]},totalCount:0}}})),key='test-not-real'}={}){
  const elements=new Map();
  const get=sel=>{if(!elements.has(sel))elements.set(sel,element());return elements.get(sel);};
  get('#transactionRange').value='saved';
  const calls=[]; const store=new Map();
  class Clock extends Date {constructor(...a){super(...(a.length?a:['2026-11-08T12:00:00Z']));} static now(){return new Date('2026-11-08T12:00:00Z').getTime();}}
  const context={console,URL,URLSearchParams,AbortController,AbortSignal,DOMException,Date:Clock,setTimeout,clearTimeout,Response,
    document:{querySelector:get,querySelectorAll:()=>[]},
    sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
    localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
    navigator:{},window:{location:{href:'https://tojihannun.designboard.net/',origin:'https://tojihannun.designboard.net'},__TOJI_RUNTIME_CONFIG__:{molitApiKey:key}},
    fetch:async (url,options)=>{if(String(url).startsWith('./rtms-verified'))return {ok:true,json:async()=>snap};calls.push(String(url));return respond(url,options,calls.length);}};
  const instrumented=source.replace('  bindEvents();',`  renderTransactionView = () => {state.transactionItems = state.transactionView === 'nearby' ? state.transactionGroups.comparable : state.transactionGroups.items;};
  waitForRtms = async (ms,signal) => {if(signal?.aborted) throw abortError();};
  window.testApi = {state, parseParcelArea, normalizeLot, parcelLot, parcelComplexNames, classifyBuildingTransactionType, recommendTransactionType, parseRtmsResponse, normalizeRtmsNodes, scopeTransactionItems, transactionMonths, loadTransactions: (force=false, allowInactive=false, options={}) => loadTransactions(force, allowInactive, {collectedOnly:false, ...options}), loadCollectedTransactions: loadTransactions, setParcel, refreshParcel, activate, fetchRtmsMonth, readMonthCache, saveMonthCache};
  bindEvents();`);
  vm.runInNewContext(instrumented,context);
  const api=context.window.testApi;
  api.setParcel(parcel);api.state.activeTab='transactions';
  // Legacy source-mode regressions explicitly exercise saved evidence.
  get('#transactionRange').value='saved';
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
test('a verified road-address complex name links another cadastral lot without claiming an exact-lot match',()=>{
  const {api}=harness();
  const selected={id:'1153010900102130027',pnu:'1153010900102130027',address:'서울특별시 구로구 궁동 213-27',road:'서울특별시 구로구 오리로 1265 (궁동,우신빌라)',number:'213-27'};
  api.setParcel(selected);
  assert.equal(api.classifyBuildingTransactionType(selected),'rowHouse');
  assert.equal(api.recommendTransactionType(selected),'rowHouse');
  const deals=[{date:'2026-09-29',month:'202609',amount:54800,area:46.51,floor:'2',umdNm:'궁동',jibun:'213-21',buildingName:'우신빌라'}];
  const scoped=api.scopeTransactionItems(deals,api.parseParcelArea(selected),'rowHouse');
  assert.equal(scoped.exact,false);assert.equal(scoped.complexCount,1);assert.equal(scoped.items.length,1);
  assert.equal(scoped.items[0].sameComplex,true);assert.equal(scoped.items[0].exact,false);
  assert.deepEqual(clean(scoped.complexLots),['213-21']);assert.equal(scoped.comparable.length,0);
});
test('saved and legacy all never schedule 251 months; explicit years remain available',()=>{
  const {api}=harness(); assert.equal(api.transactionMonths('all').length,0);assert.equal(api.transactionMonths('saved').length,0);
  assert.deepEqual(clean(api.transactionMonths('3')),['202611','202610','202609']);
  assert.equal(api.transactionMonths('year-2020').length,12);assert.equal(api.transactionMonths('year-2026').length,11);assert.equal(api.transactionMonths('year-2030').length,0);
});
test('verified three rows appear with ZERO external API requests, also without a key',async()=>{
  const {api,calls}=harness({key:''});await api.loadTransactions();assert.equal(calls.length,0);assert.equal(api.state.transactionItems.length,3);assert.equal(api.state.transactionGroups.coveredMonths,3);assert.equal(api.state.transactionGroups.savedOnly,true);assert.equal(api.state.transactionGroups.totalMonths,3);assert.equal(api.state.transactionGroups.loading,false);
});
test('first request 429 stops immediately; refresh honors cooldown rather than repeating 251 requests',async()=>{
  const {api,calls,get}=harness({snap:{entries:[]},respond:async()=>new Response('',{status:429,headers:{'Retry-After':'60'}})});get('#transactionRange').value='3';
  await api.loadTransactions();assert.equal(calls.length,1);assert.equal(api.state.transactionSession.failures.size,1);assert.equal(api.state.transactionGroups.coveredMonths,0);assert.equal(api.state.transactionGroups.loading,false);
  await api.loadTransactions(true);assert.equal(calls.length,1);assert.match(api.state.transactionGroups.error,/요청 제한/);
});
test('429 on explicit refresh preserves the three previously verified rows',async()=>{
  const {api,calls}=harness({respond:async()=>new Response('',{status:429})});await api.loadTransactions();await api.loadTransactions(true);assert.equal(calls.length,1);assert.equal(api.state.transactionItems.length,3);assert.ok(api.state.transactionGroups.error);
});
test('uncached saved-only lookup makes zero calls; explicit period stops after 3 months',async()=>{
  const {api,calls,get}=harness({snap:{entries:[]}});await api.loadTransactions();assert.equal(calls.length,0);
  get('#transactionRange').value='year-2020';await api.loadTransactions();assert.equal(calls.length,3);assert.equal(api.state.transactionGroups.coveredMonths,3);
  await api.loadTransactions();assert.equal(calls.length,3);
  api.refreshParcel({...parcel,buildingName:'선영빌라'});assert.equal(calls.length,3);
  await api.loadTransactions(false,false,{more:true});assert.equal(calls.length,6);assert.equal(api.state.transactionGroups.coveredMonths,6);
});
test('selecting 2019 infers the masked Ungdo-ri trade only after parcel facts match',async()=>{
  const masked={dealYear:'2019',dealMonth:'10',dealDay:'24',dealAmount:'10,500',dealArea:'1269',umdNm:'대산읍 웅도리',jibun:'6*',jimok:'임야',landUse:'자연녹지지역'};
  const {api,calls,get,context}=harness({snap:{entries:[]},respond:async url=>{
    const month=new URL(String(url)).searchParams.get('DEAL_YMD');
    return new Response(JSON.stringify({response:{header:{resultCode:'000'},body:{items:{item:month==='201910'?[masked]:[]},totalCount:month==='201910'?1:0}}}));
  }});
  let releaseApartmentLookup;
  context.window.TojiStaticTrades={lookup:async(_area,type)=>type==='apartment'
    ? new Promise(resolve=>{releaseApartmentLookup=resolve;})
    : {rows:[],completeMonths:[],verifiedAt:'2026-11-01T00:00:00Z',degraded:true,distributedError:'synthetic shard failure'}};
  const ungdo={id:'ungdo-63-1',pnu:'4421010100100630001',address:'충청남도 서산시 대산읍 웅도리 63-1',number:'63-1'};
  api.setParcel(ungdo);
  api.state.activeTab='transactions';
  const staleDefaultLookup=api.loadCollectedTransactions();
  await Promise.resolve();
  get('#transactionRange').value='year-2019';
  const selectedYearLookup=get('#transactionRange').events.change();
  releaseApartmentLookup({rows:[],completeMonths:[]});
  await Promise.all([staleDefaultLookup,selectedYearLookup]);
  assert.deepEqual(calls.map(url=>new URL(url).searchParams.get('DEAL_YMD')),['201912','201911','201910']);
  assert.equal(api.state.transactionGroups.degraded,true);assert.equal(api.state.transactionGroups.officialCovered,true);
  assert.equal(api.state.transactionView,'nearby');assert.equal(api.state.transactionGroups.items.length,0);assert.equal(api.state.transactionGroups.comparable.length,1);
  assert.equal(api.state.transactionGroups.comparable[0].amount,10500);assert.equal(api.state.transactionGroups.comparable[0].area,1269);assert.equal(api.state.transactionGroups.undisclosedCount,1);
  api.refreshParcel({...ungdo,landRegister:{base:{lndpclAr:1269,lndcgrCodeNm:'임야'},characteristic:{prposArea1Nm:'자연녹지지역'}}});
  assert.equal(api.state.transactionView,'parcel');assert.equal(api.state.transactionGroups.items.length,1);assert.equal(api.state.transactionGroups.comparable.length,0);
  assert.equal(api.state.transactionGroups.items[0].exact,false);assert.equal(api.state.transactionGroups.items[0].inferred,true);assert.equal(api.state.transactionGroups.inferredCount,1);
  assert.deepEqual(clean(api.state.transactionGroups.items[0].inferredEvidence),['마스킹 지번 6* ↔ 63-1','면적 1,269㎡ 일치','지목 임야 일치','용도지역 자연녹지지역 일치']);
});
test('MOLIT quota code 22 also stops after one request',async()=>{
  const {api,calls,get}=harness({snap:{entries:[]},respond:async()=>new Response(JSON.stringify({response:{header:{resultCode:'22',resultMsg:'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR'}}}))});get('#transactionRange').value='3';await api.loadTransactions();assert.equal(calls.length,1);assert.equal(api.state.transactionGroups.loading,false);assert.equal(api.state.transactionSession.failures.size,1);
});
test('snapshot rows never leak into another lot or another legal dong',async()=>{
  const {api,calls,get}=harness();api.setParcel({...parcel,pnu:'4121010100101580217',id:'other',number:'158-217대',address:'경기도 광명시 광명동 158-217'});get('#transactionRange').value='saved';await api.loadTransactions();assert.equal(api.state.transactionItems.length,0);assert.equal(api.state.transactionSession.snapshots.size,0);assert.equal(calls.length,0);
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

test('actual commercial masked lots are counted as unidentifiable, not exact matches',()=>{
 const {api}=harness();const sample={dealYear:'2026',dealMonth:'10',dealDay:'28',dealAmount:'224,000',buildingAr:'230.38',jibun:'1**',buildingType:'일반',buildingUse:'제1종근린생활',umdNm:'광명동'};
 const rows=api.normalizeRtmsNodes([sample,{...sample,jibun:'52-5',buildingType:'집합'}],'commercial');
 const result=api.scopeTransactionItems(rows,{emd:'광명동',lot:'158-217'},'commercial');
 assert.equal(result.items.length,0);assert.equal(result.undisclosedCount,1);assert.equal(result.comparable.length,2);assert.equal(rows[0].lotDisclosed,false);
});
test('regional monthly cache is shared across lots and can be restored without credentials',async()=>{
 const {api,calls,get,context}=harness({snap:{entries:[]}});get('#transactionRange').value='3';await api.loadTransactions();assert.equal(calls.length,3);
 api.setParcel({...parcel,id:'other',pnu:'4121010100101580217',address:'경기도 광명시 광명동 158-217'});get('#transactionRange').value='3';await api.loadTransactions();assert.equal(calls.length,3);
 api.state.rtmsCache.clear();api.readMonthCache();assert.equal(api.state.rtmsCache.size,3);
 assert.ok(!context.localStorage.getItem('toji-rtms-month-cache-v1').includes('test-not-real'));
});
test('saved snapshot-only view never reports full history coverage',async()=>{
 const {api}=harness();await api.loadTransactions();assert.equal(api.state.transactionGroups.savedOnly,true);assert.match(api.state.transactionGroups.periodLabel,/전체 이력 아님/);
});

test('configured PNU endpoint is called once with no government monthly fallback',async()=>{
 const item={pnu:parcel.pnu,type:'rowHouse',date:'2020-08-15',month:'202008',jibun:'158-216',amount:31000,area:59.7,unitPrice:519.26,floor:'3'};
 const {api,context,calls}=harness({snap:{entries:[]},respond:async()=>Response.json({pnu:parcel.pnu,source:'Test provider',items:[item,{...item,pnu:'4121010100101580217'}]})});
 context.window.__TOJI_RUNTIME_CONFIG__.parcelHistoryEndpoint='https://provider.example/parcel';
 await api.loadTransactions();assert.equal(calls.length,1);assert.equal(api.state.transactionItems.length,1);assert.equal(api.state.transactionGroups.directAnswered,true);assert.equal(api.state.transactionGroups.totalMonths,0);
});
test('PNU endpoint failure keeps verified rows and never causes 251-month fallback',async()=>{
 const {api,context,calls}=harness({respond:async()=>new Response('',{status:503})});context.window.__TOJI_RUNTIME_CONFIG__.parcelHistoryEndpoint='https://provider.example/parcel';
 await api.loadTransactions();assert.equal(calls.length,1);assert.equal(api.state.transactionItems.length,3);assert.match(api.state.transactionGroups.error,/공급처/);
});

// Collection UI defaults have their own tests; the existing source-mode guards above remain unchanged.
test('collection-default period and refresh never initiate government requests',async()=>{
  const {api,calls,get}=harness({snap:{entries:[]}});get('#transactionRange').value='year-2020';
  await api.loadCollectedTransactions();assert.equal(calls.length,0);assert.equal(api.state.transactionGroups.coveredMonths,0);assert.equal(api.state.transactionGroups.loading,false);
  await api.loadCollectedTransactions(true);assert.equal(calls.length,0);
});
test('collection-default ignores optional PNU provider and retains verified saved evidence',async()=>{
  const {api,calls,context}=harness();context.window.__TOJI_RUNTIME_CONFIG__.parcelHistoryEndpoint='https://provider.example/parcel';
  await api.loadCollectedTransactions();assert.equal(calls.length,0);assert.equal(api.state.transactionItems.length,3);
});

const okgilParcel = {id:'4119410600107470001',pnu:'4119410600107470001',address:'경기도 부천시 소사구 옥길동 747-1',number:'747-1대',buildings:[]};
const okgilApartment = {dealYear:'2026',dealMonth:'10',dealDay:'31',dealAmount:'54000',excluUseAr:'59.6',umdNm:'옥길동',jibun:'747-1',buildingNm:'옥길데시앙'};

test('apartment detail use takes precedence over a generic residential building use',()=>{
  const {api,get}=harness();
  api.setParcel({...okgilParcel,buildings:[{use:'공동주택',detailUse:'아파트'}]});
  assert.equal(get('#transactionType').value,'apartment');
});

test('an exact recent apartment row selects apartment and loads normal history without a live API call',async()=>{
  const {api,context,calls,get}=harness();
  const lookups=[];
  context.window.TojiStaticTrades={lookup:async(area,type,options)=>{
    lookups.push({area,type,options});
    return {rows:[okgilApartment],completeMonths:['202610']};
  }};
  api.setParcel(okgilParcel);
  await api.loadCollectedTransactions();
  assert.equal(get('#transactionType').value,'apartment');
  assert.equal(api.state.transactionItems.length,1);
  assert.deepEqual(lookups.map(entry=>[entry.area.lot,entry.type]),[['747-1','land'],['747-1','apartment'],['747-1','apartment']]);
  assert.equal(clean(lookups[0].options.months).length,60);
  assert.deepEqual(clean(lookups[1].options.months),['202611','202610','202609']);
  assert.equal(lookups[2].options.includeNearby,true);
  api.refreshParcel({...okgilParcel,buildingError:true});
  assert.equal(get('#transactionType').value,'apartment');
  assert.equal(calls.length,0);
});

test('nearby, masked, other legal dong and older apartment rows do not promote the parcel',async()=>{
  const {api,context,get}=harness();
  context.window.TojiStaticTrades={lookup:async(_area,type)=>type==='apartment'?{rows:[
    {...okgilApartment,jibun:'747'},
    {...okgilApartment,jibun:'747-*'},
    {...okgilApartment,umdNm:'다른동'},
    {...okgilApartment,dealMonth:'08'}
  ]}:null};
  api.setParcel(okgilParcel);
  await api.loadCollectedTransactions();
  assert.equal(get('#transactionType').value,'land');
});

test('an in-flight apartment match preserves a manual selection and cannot leak to a new parcel',async()=>{
  const {api,context,get}=harness();
  let resolveEvidence;
  const evidence=new Promise(resolve=>{resolveEvidence=resolve;});
  context.window.TojiStaticTrades={lookup:async(area,type,options)=>
    area.lot==='747-1'&&type==='apartment'&&options.months?evidence:null};
  api.setParcel(okgilParcel);
  const pending=api.loadCollectedTransactions();
  get('#transactionType').events.change({target:{value:'land'}});
  resolveEvidence({rows:[okgilApartment]});
  await pending;
  assert.equal(get('#transactionType').value,'land');
  assert.equal(api.state.transactionTypeManuallySelected,true);

  api.setParcel(okgilParcel);
  const previous=api.loadCollectedTransactions();
  api.setParcel({...okgilParcel,id:'4119410600107470002',pnu:'4119410600107470002',address:'경기도 부천시 소사구 옥길동 747-2'});
  await previous;
  await api.loadCollectedTransactions();
  assert.equal(get('#transactionType').value,'land');
});

// FULL_HISTORY_STATIC_TEST_V1: private fixtures, not claims of actual contracts.
test('explicit all-period selection reads historical months and recent filters remain available',async()=>{
 const {api,context,calls,get}=harness({snap:{entries:[]},key:''});
 const seen=[];
 context.window.TojiStaticTrades={lookup:async(area,type,options)=>{
   seen.push(options);
   const base={dealYear:'2016',dealMonth:'07',dealDay:'23',dealAmount:'20500',
     excluUseAr:'59.7',floor:'3',umdNm:'광명동',jibun:'158-216'};
   const all=[base,{...base,dealYear:'2026',dealMonth:'10',dealDay:'21',dealAmount:'51500'}];
   const included=all.filter(r=>!options.months||options.months.includes(r.dealYear+r.dealMonth));
   return {rows:included,completeMonths:included.map(r=>r.dealYear+r.dealMonth),verifiedAt:'2026-11-08T10:00:00Z'};
 }};
 await api.loadCollectedTransactions();
 assert.equal(seen[0].months,undefined);
 assert.deepEqual(clean(api.state.transactionItems.map(r=>r.date)),['2026-10-21','2016-07-23']);
 assert.equal(api.state.transactionGroups.savedOnly,true);
 assert.match(api.state.transactionGroups.periodLabel,/전체 기간/);
 assert.equal(calls.length,0);
 get('#transactionRange').value='6';await api.loadCollectedTransactions(true);
 assert.equal(seen.at(-1).months.length,6);
 assert.equal(api.state.transactionItems.length,1);
 get('#transactionRange').value='saved';await api.loadCollectedTransactions(true);
 assert.equal(seen.at(-1).months,undefined);
 assert.equal(api.state.transactionItems.length,2);
 assert.equal(calls.length,0);
});

// DEFAULT_60_MONTHS_TEST_V1: all values below are synthetic regression fixtures.
test('initial range defaults to five years and the user selection survives parcel changes',async()=>{
 const {api,context,calls,get}=harness({snap:{entries:[]},key:''});
 const seen=[];
 const base={dealYear:'2023',dealMonth:'11',dealDay:'02',dealAmount:'20500',excluUseAr:'59.7',floor:'3',umdNm:'광명동',jibun:'158-216'};
 const source=[base,{...base,dealMonth:'12'},{...base,dealYear:'2026',dealMonth:'10'},{...base,dealYear:'2026',dealMonth:'11'}];
 context.window.TojiStaticTrades={lookup:async(_area,_type,options)=>{
  seen.push(options);
  const rows=source.filter(row=>!options.months||options.months.includes(row.dealYear+row.dealMonth));
  return {rows,completeMonths:options.months||source.map(row=>row.dealYear+row.dealMonth),verifiedAt:'2026-11-08T10:00:00Z'};
 }};
 get('#transactionRange').value='60';api.setParcel(parcel);
 assert.equal(get('#transactionRange').value,'60');
 assert.equal(api.transactionMonths().length,60);
 await api.loadCollectedTransactions();
 assert.equal(seen.at(-1).months.length,60);
 assert.equal(seen.at(-1).months[0],'202611');
 assert.equal(seen.at(-1).months.at(-1),'202112');
 assert.equal(api.state.transactionItems.length,4);
 assert.ok(api.state.transactionItems.every(row=>row.month>='202112'));
 assert.equal(api.state.transactionGroups.totalMonths,60);
 assert.equal(api.state.transactionGroups.savedOnly,false);
 get('#transactionRange').value='saved';await api.loadCollectedTransactions(true);
 assert.equal(seen.at(-1).months,undefined);
 assert.equal(api.state.transactionItems.length,4);
 api.setParcel({...parcel,id:'default-range-second-parcel'});
 assert.equal(get('#transactionRange').value,'saved');
 assert.equal(calls.length,0,'range changes must use saved JSON, not upstream API scans');
});
