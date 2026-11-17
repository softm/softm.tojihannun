import fs from 'node:fs';
const read = path => fs.readFileSync(path, 'utf8');
const write = (path, value) => fs.writeFileSync(path, value);
function once(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error('Source changed; reconcile ' + label);
  return source.replace(before, after);
}

// The all-period option is retained. Only the initial/new-parcel default changes.
let html = read('index.html');
if (!html.includes('<option value="36" selected>')) {
  html = once(html, '<option value="saved" selected>전체 기간</option>', '<option value="saved">전체 기간</option>', 'keep optional full history');
  html = once(html, '<option value="36">최근 36개월</option>', '<option value="36" selected>최근 36개월</option>', 'default selection');
  write('index.html', html);
}
let market = read('market-data.js');
if (!market.includes('const DEFAULT_TRANSACTION_RANGE = "36";')) {
  market = once(market, '  function transactionMonths(value) {', '  // Initial and newly selected parcels use 36 calendar months including this month.\n  const DEFAULT_TRANSACTION_RANGE = "36";\n  function transactionMonths(value) {', 'shared default');
  market = once(market, 'const raw = String(value || "saved");', 'const raw = String(value || DEFAULT_TRANSACTION_RANGE);', 'month fallback');
  market = once(market, 'const selectedPeriod = String($("#transactionRange")?.value || "saved");', 'const selectedPeriod = String($("#transactionRange")?.value || DEFAULT_TRANSACTION_RANGE);', 'query fallback');
  market = once(market, 'period:state.transactionSession?.period || "saved",', 'period:state.transactionSession?.period || DEFAULT_TRANSACTION_RANGE,', 'presentation fallback');
  market = once(market, 'if ($("#transactionRange")) $("#transactionRange").value = "saved";', 'if ($("#transactionRange")) $("#transactionRange").value = DEFAULT_TRANSACTION_RANGE;', 'new parcel default');
  write('market-data.js', market);
}

// Existing all-period tests remain explicit all-period tests, not implicit defaults.
for (const path of ['scripts/full-history-default.test.mjs', 'scripts/mobile-detail-market-config.test.mjs']) {
  let source = read(path).replaceAll('value="saved" selected', 'value="36" selected');
  source = source.replace('default is saved evidence, never an exhaustive historical scan', 'default is 36 months of collected evidence, never a government historical scan');
  write(path, source);
}
let behavior = read('scripts/rtms-behavior.test.mjs');
if (!behavior.includes('DEFAULT_36_MONTHS_TEST_V1')) {
  behavior = once(behavior,
    "api.setParcel(parcel);api.state.activeTab='transactions';",
    "api.setParcel(parcel);api.state.activeTab='transactions';\n  // Legacy source-mode regressions explicitly exercise saved evidence.\n  get('#transactionRange').value='saved';", 'explicit source-test period');
  const start = behavior.indexOf("test('snapshot rows never leak");
  const end = behavior.indexOf("\ntest(", start + 1);
  if (start < 0 || end < 0) throw new Error('Missing snapshot isolation regression');
  let block = behavior.slice(start, end);
  block = block.replace('const {api,calls}=harness();', 'const {api,calls,get}=harness();');
  block = once(block, 'await api.loadTransactions();', "get('#transactionRange').value='saved';await api.loadTransactions();", 'explicit snapshot-only lookup');
  behavior = behavior.slice(0,start) + block + behavior.slice(end);
  behavior = behavior.replace('default reads all published historical months and recent filters remain explicit', 'explicit all-period selection reads historical months and recent filters remain available');
  behavior += `
// DEFAULT_36_MONTHS_TEST_V1: all values below are synthetic regression fixtures.
test('initial and new parcel defaults are 36 months; all-period option remains available',async()=>{
 const {api,context,calls,get}=harness({snap:{entries:[]},key:''});
 const seen=[];
 const base={dealYear:'2023',dealMonth:'11',dealDay:'02',dealAmount:'20500',excluUseAr:'59.7',floor:'3',umdNm:'광명동',jibun:'158-216'};
 const source=[base,{...base,dealMonth:'12'},{...base,dealYear:'2026',dealMonth:'10'},{...base,dealYear:'2026',dealMonth:'11'}];
 context.window.TojiStaticTrades={lookup:async(_area,_type,options)=>{
  seen.push(options);
  const rows=source.filter(row=>!options.months||options.months.includes(row.dealYear+row.dealMonth));
  return {rows,completeMonths:options.months||source.map(row=>row.dealYear+row.dealMonth),verifiedAt:'2026-11-08T10:00:00Z'};
 }};
 api.setParcel(parcel);
 assert.equal(get('#transactionRange').value,'36');
 assert.equal(api.transactionMonths().length,36);
 await api.loadCollectedTransactions();
 assert.equal(seen.at(-1).months.length,36);
 assert.equal(seen.at(-1).months[0],'202611');
 assert.equal(seen.at(-1).months.at(-1),'202312');
 assert.equal(api.state.transactionItems.length,3);
 assert.ok(api.state.transactionItems.every(row=>row.month>='202312'));
 assert.equal(api.state.transactionGroups.totalMonths,36);
 assert.equal(api.state.transactionGroups.savedOnly,false);
 get('#transactionRange').value='saved';await api.loadCollectedTransactions(true);
 assert.equal(seen.at(-1).months,undefined);
 assert.equal(api.state.transactionItems.length,4);
 api.setParcel({...parcel,id:'default-range-second-parcel'});
 assert.equal(get('#transactionRange').value,'36');
 assert.equal(calls.length,0,'range changes must use saved JSON, not upstream API scans');
});
`;
  write('scripts/rtms-behavior.test.mjs', behavior);
}

// Expand the existing browser test to verify the changed default before testing
// that all-period viewing and the six-month filter are still available.
let browser = read('scripts/full-collected-history.browser.mjs');
if (!browser.includes('DEFAULT_36_MONTHS_BROWSER_V1')) {
  const anchor = " await page.waitForFunction(()=>document.getElementById('detailPanelTransactions').getAttribute('aria-busy')==='false'&&document.getElementById('transactionStats').dataset.cohortCount==='72');";
  const insert = ` // DEFAULT_36_MONTHS_BROWSER_V1: fixture ends last month, so 35 populated months are inside this 36-month window.
 await page.waitForFunction(()=>document.getElementById('detailPanelTransactions').getAttribute('aria-busy')==='false'&&document.getElementById('transactionStats').dataset.cohortCount==='70');
 assert.equal(await page.locator('#transactionRange').inputValue(),'36');
 assert.equal(await page.locator('#transactionRange option:checked').textContent(),'최근 36개월');
 assert.equal(await page.evaluate(()=>window.historyTestLookups[0].length),36);
 assert.equal(await page.locator('.trade-row').count(),10);
 await page.locator('#detailPanelTransactions').screenshot({path:'test-results/full-history/default-36-months-390.png'});
 proof.checks.push('default 36 months: 70 synthetic records, same summary/chart cohort, no live API requests');
 await page.locator('#transactionRange').selectOption('saved');
`;
  browser = once(browser, anchor, insert + anchor, '36-month browser default');
  browser = once(browser, "assert.equal(await page.evaluate(()=>window.historyTestLookups[0]),'all');", "assert.equal(await page.evaluate(()=>window.historyTestLookups.at(-1)),'all');", 'all history is explicit');
  write('scripts/full-collected-history.browser.mjs', browser);
}

// Keep scripts used by the existing main-branch UI workflow from restoring stale asset URLs.
for (const path of ['index.html','scripts/transaction-ui-layout.mjs','scripts/install-transaction-ui.mjs','scripts/install-unified-price-context.mjs','scripts/install-full-collected-history.mjs']) {
  let source = read(path);
  source = source.replace(/transaction-ui\.(js|css)\?v=[\d.]+/g,'transaction-ui.$1?v=20261117.6');
  source = source.replace(/transaction-ui\.\$1\?v=[\d.]+/g,'transaction-ui.$1?v=20261117.6');
  source = source.replace(/transaction-price-context\.js\?v=[\d.]+/g,'transaction-price-context.js?v=20261117.6');
  source = source.replace(/market-data\.js\?v=[\d.]+/g,'market-data.js?v=20261117.6');
  if (path==='scripts/install-transaction-ui.mjs') source = source.replace(/'\$1\?v=[\d.]+'/g,"'$1?v=20261117.6'");
  write(path,source);
}
console.log('Default range changed to 36 months; full-history selection, unified pricing, and pagination preserved.');
