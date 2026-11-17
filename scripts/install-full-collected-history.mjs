import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>fs.writeFileSync(p,s);
function once(s,a,b,label){
  if(s.split(a).length!==2)throw Error('Source changed: '+label);
  return s.replace(a,b);
}
let market=read('market-data.js');
if(!market.includes('FULL_COLLECTED_HISTORY_V1')){
  market=once(market,
    '    if (raw === "3") return recentMonths(3);',
    '    if (raw === "3" || raw === "6") return recentMonths(Number(raw));','six-month filter');
  market=once(market,
    'months: period === "saved" ? recentMonths(6) : months',
    'months: period === "saved" ? undefined : months','remove six-month data cutoff');
  market=once(market,
    '            // A parcel selection must not download every historical district\n            // chunk. Show recent evidence first, with year filters for history.',
    '            // FULL_COLLECTED_HISTORY_V1: read all published months for this\n            // legal dong and type. Never backfill government APIs on a map click.', 'static only');
  market=market.replace('최근 6개월 우선 수집자료 (전체 이력 아님)','확보된 전체 기간 (전체 이력 아님)');
  market=market.replace('최근 수집 기간에 해당 필지 거래를 확인하지 못했습니다. 전체 거래이력의 거래 없음이 아닙니다.',
    '확보된 전체 기간에서 해당 필지 거래를 확인하지 못했습니다. 실제 거래가 없다는 뜻은 아닙니다.');
  write('market-data.js',market);
}
// Retain the saved value for backwards compatibility; it means collected JSON,
// not a government-API scan. Keep an explicit six-month option for users.
for(const file of ['index.html','transaction-ui.js','scripts/transaction-ui-layout.mjs',
  'scripts/transaction-ui.browser.mjs','scripts/mobile-detail-market-config.test.mjs']){
  write(file,read(file).replaceAll('최근 6개월 우선','전체 기간'));
}
let html=read('index.html');
if(!html.includes('<option value="6">'))html=once(html,
  '<option value="3">최근 3개월</option>',
  '<option value="3">최근 3개월</option>\n                <option value="6">최근 6개월</option>', 'six-month option');
write('index.html',html);
let presentation=read('scripts/transaction-presentation.test.mjs').replace('/최근 6개월/','/전체 기간/');
write('scripts/transaction-presentation.test.mjs',presentation);

let ui=read('transaction-ui.js');
if(!ui.includes('allPeriod:period===')){
  ui=once(ui,'coveredMonthKeys:group.coveredMonthKeys||[]});',
    "coveredMonthKeys:group.coveredMonthKeys||[],allPeriod:period==='saved'});",'history chart bounds');
  write('transaction-ui.js',ui);
}
let price=read('transaction-price-context.js');
if(!price.includes('FULL_HISTORY_CHART_V1')){
  price=once(price,'options=[],coveredMonthKeys=[]} = {}) {',
    'options=[],coveredMonthKeys=[],allPeriod=false} = {}) {','whole-history model');
  price=once(price,
    '    const keys=[...new Set([...byMonth.keys(),...coveredMonthKeys.filter(validMonth)])].sort();',
    `    // FULL_HISTORY_CHART_V1: full history includes every observed transaction.
    // Do not waste the chart on years before the first known trade. Interior
    // missing months remain explicit gaps, never fabricated zero prices.
    const observed=[...byMonth.keys()].sort();
    const coverage=allPeriod&&observed.length
      ? coveredMonthKeys.filter(key=>key>=observed[0]&&key<=observed.at(-1))
      : coveredMonthKeys;
    const keys=[...new Set([...byMonth.keys(),...coverage.filter(validMonth)])].sort();`, 'actual contract bounds');
  price=once(price,
    '    const width=Math.max(270,Math.min(760,host.clientWidth||520)), height=238;',
    `    const viewportWidth=Math.max(270,Math.min(760,host.clientWidth||520));
    const scrollable=data.months.length>24;
    const width=scrollable?Math.max(viewportWidth,(data.months.length-1)*30+80):viewportWidth,height=238;
    const previousScroll=host.scrollLeft;
    const chartKey=[data.scope,data.selectedArea,data.metric,data.months[0]?.month,data.months.at(-1)?.month].join('|');
    const changed=host.dataset.historyKey!==chartKey;
    host.dataset.historyScroll=String(scrollable);
    host.dataset.historyKey=chartKey;
    host.style.setProperty('--history-chart-width',width+'px');`, 'readable long timeline');
  price=once(price,
    '    const labelStep=Math.max(1,Math.ceil(data.months.length/(width<380?4:6)));',
    '    const labelStep=scrollable?6:Math.max(1,Math.ceil(data.months.length/(width<380?4:6)));', 'long timeline labels');
  price=once(price,"    let readout=$('transactionMonthReadout');",
    "    host.scrollLeft=scrollable?(changed?host.scrollWidth:previousScroll):0;\n    let readout=$('transactionMonthReadout');",'initial latest-month viewport');
  price=once(price,"    let caveat=$('transactionPriceCaveat');",
    "    if(meta&&scrollable)meta.textContent+=' · 전체 기간 차트: 좌우로 이동해 과거 월 확인';\n    let caveat=$('transactionPriceCaveat');",'scroll hint');
  write('transaction-price-context.js',price);
}
let css=read('transaction-ui.css');
if(!css.includes('FULL_HISTORY_CHART_V1'))css+=`
/* FULL_HISTORY_CHART_V1: overflow belongs to the chart, never the page. */
#detailPanelTransactions.collection-trades #transactionChart[data-history-scroll="true"] {
  overflow-x:auto;overflow-y:hidden;max-width:100%;min-width:0;
  overscroll-behavior-x:contain;scrollbar-width:thin;
}
#detailPanelTransactions.collection-trades #transactionChart[data-history-scroll="true"] svg {
  width:var(--history-chart-width);max-width:none;height:238px;
}
`;
write('transaction-ui.css',css);
// Keep template/installer versions coherent so future integration runs cannot
// silently restore the previous six-month-only assets.
for(const file of ['index.html','scripts/transaction-ui-layout.mjs','scripts/install-transaction-ui.mjs',
 'scripts/install-unified-price-context.mjs']){
 let s=read(file);
 s=s.replace(/transaction-ui\.(js|css)\?v=[\d.]+/g,'transaction-ui.$1?v=20261117.5');
 s=s.replace(/transaction-ui\.\$1\?v=[\d.]+/g,'transaction-ui.$1?v=20261117.5');
 s=s.replace(/transaction-price-context\.js\?v=[\d.]+/g,'transaction-price-context.js?v=20261117.5');
 s=s.replace(/market-data\.js\?v=[\d.]+/g,'market-data.js?v=20261117.5');
 if(file==='scripts/install-transaction-ui.mjs')s=s.replace(/'\$1\?v=[\d.]+'/g,"'$1?v=20261117.5'");
 write(file,s);
}
let behavior=read('scripts/rtms-behavior.test.mjs');
if(!behavior.includes('FULL_HISTORY_STATIC_TEST_V1'))behavior+=`
// FULL_HISTORY_STATIC_TEST_V1: private fixtures, not claims of actual contracts.
test('default reads all published historical months and recent filters remain explicit',async()=>{
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
`;
write('scripts/rtms-behavior.test.mjs',behavior);
let tests=read('scripts/transaction-price-context.test.mjs');
if(!tests.includes('FULL_HISTORY_MODEL_TEST_V1'))tests+=`
// FULL_HISTORY_MODEL_TEST_V1
 test('full-history view keeps old records and interior gaps without pre-contract empty years',()=>{
   const rows=[{date:'2016-07-23',month:'201607',amount:20500,area:59.7},
     {date:'2026-10-21',month:'202610',amount:51500,area:59.7}];
   const m=p.model(rows,{metric:'total',allPeriod:true,coveredMonthKeys:['200601','201607','202610','202611']});
   assert.equal(m.count,2);assert.equal(m.months[0].month,'201607');
   assert.equal(m.months.at(-1).month,'202610');
   assert.equal(m.months.length,124);
   assert.equal(m.months.find(x=>x.month==='201608').value,null);
   assert.equal(m.months.reduce((n,x)=>n+x.count,0),m.count);
 });
`;
write('scripts/transaction-price-context.test.mjs',tests);
console.log('All collected periods enabled; government API safeguards, price cohort, and 10-row pagination unchanged.');
