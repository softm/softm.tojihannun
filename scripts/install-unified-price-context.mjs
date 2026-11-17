import fs from 'node:fs';
const read = path => fs.readFileSync(path,'utf8');
const write = (path,value) => fs.writeFileSync(path,value);
function once(source,before,after,label){
  if(source.split(before).length!==2)throw Error('Source changed; reconcile '+label);
  return source.replace(before,after);
}
function between(source,start,end,replacement,label){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  if(a<0||b<a||source.indexOf(start,a+1)>=0)throw Error('Source changed; reconcile '+label);
  return source.slice(0,a)+replacement+source.slice(b);
}

// These helpers are inserted into the existing UI closure, not executed by this installer.
function mountPriceControls(){
  if(!$('transactionPricingControls')){
    const controls=document.createElement('section');controls.id='transactionPricingControls';controls.className='trade-pricing-controls';
    controls.setAttribute('aria-label','실거래 비교 기준');
    controls.innerHTML='<div class="price-control-heading"><strong>비교할 전용면적</strong><small id="transactionAreaSelectionNote"></small></div><label class="price-metric-label" for="transactionPriceMetric">가격 표시 기준<select id="transactionPriceMetric"><option value="total">매매총액 · 억/만원</option><option value="sqm">면적 ㎡당 가격</option><option value="area33">면적 3.3㎡당 가격</option></select></label>';
    $('transactionStats').before(controls);
    controls.querySelector('.price-metric-label').before($('transactionAreaFilters'));
    const context=document.createElement('p');context.id='transactionPriceContext';context.className='trade-price-context';
    controls.after(context);
    $('transactionPriceMetric').onchange=event=>{priceMode=event.target.value;currentPage=1;render(current);};
  }
}
function renderPriceControls(allItems,options,definition){
  const controls=$('transactionPricingControls');
  controls.hidden=!allItems.length;
  const filters=$('transactionAreaFilters');filters.replaceChildren();filters.hidden=!options.length;
  controls.querySelector('.price-control-heading').hidden=!options.length;
  $('transactionAreaSelectionNote').textContent=areaSelectionManual?'선택한 면적 기준':'거래가 많은 면적 자동 선택';
  const choose=key=>{selectedArea=key;areaSelectionManual=true;currentPage=1;render(current);};
  const makeButton=(key,label,title)=>{
    const button=document.createElement('button');button.type='button';button.className='trade-area-chip';button.textContent=label;
    button.title=title||label;button.dataset.areaKey=key;button.setAttribute('aria-pressed',String(selectedArea===key));
    button.onclick=()=>{choose(key);$('transactionAreaFilters').querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});};
    filters.append(button);
  };
  if(options.length){
    makeButton('all',`전체 면적 · ${number(allItems.length)}건`,'혼합 면적의 분포입니다. 하나의 면적 시세로 해석하지 마세요.');
    const frequent=[...options].sort((a,b)=>b.count-a.count||b.latest.localeCompare(a.latest)).slice(0,4);
    const selected=options.find(option=>option.key===selectedArea);
    if(selected&&!frequent.some(option=>option.key===selected.key))frequent.splice(3,1,selected);
    frequent.sort((a,b)=>Number(a.key)-Number(b.key)).forEach(option=>makeButton(option.key,option.label,option.title));
    if(options.length>4){
      const label=document.createElement('label');label.className='price-all-areas';label.textContent='다른 전용면적 ';
      const select=document.createElement('select');select.setAttribute('aria-label','모든 전용면적대');
      select.innerHTML='<option value="all">전체 면적 (혼합)</option>'+options.map(option=>`<option value="${esc(option.key)}">${esc(option.label+' · '+option.title.split(' · ')[0])}</option>`).join('');
      select.value=selectedArea;select.onchange=event=>choose(event.target.value);label.append(select);filters.append(label);
    }
  }
  const selector=$('transactionPriceMetric');selector.value=priceMode;
  selector.querySelector('[value="sqm"]').textContent=`${definition.areaKind} ㎡당 가격`;
  selector.querySelector('[value="area33"]').textContent=`${definition.areaKind} 3.3㎡당 가격`;
}

let ui=read('transaction-ui.js');
if(!ui.includes('UNIFIED_PRICE_CONTEXT_V1')){
  ui=once(ui,"  // UI-only filters: they never change the underlying official-source rows.","  // UNIFIED_PRICE_CONTEXT_V1: one price basis and one cohort for all visible analytics.\n  const pricing=window.TojiPriceContext;\n  let priceMode='total',areaSelectionManual=false;\n  // UI-only filters: they never change the underlying official-source rows.",'pricing dependency');
  ui=once(ui,"  const areaKey = item => Number(item?.area) > 0 ? String(Math.round(Number(item.area))) : '';","  const areaKey = item => pricing.areaKey(item);",'area band key');
  ui=between(ui,'  function areaOptions(items, type) {','  function mount() {',
    '  function areaOptions(items,type){return pricing.areaOptions(items,type);}\n  function filteredItems(items,options=[],area=selectedArea){return pricing.filterArea(items,area);}\n  '+mountPriceControls.toString()+'\n  '+renderPriceControls.toString()+'\n','area controls');
  ui=once(ui,"$('transactionStats').before(details);details.append($('transactionChartCard'));","$('transactionStats').after(details);details.append($('transactionChartCard'));",'summary before chart');
  ui=once(ui,"    panel.dataset.chartInitialized='true';","    mountPriceControls();\n    panel.dataset.chartInitialized='true';",'mount controls');
  ui=once(ui,"current=null;lastKey='';currentPage=1;order='date-desc';selectedArea='all';","current=null;lastKey='';currentPage=1;order='date-desc';selectedArea='all';areaSelectionManual=false;priceMode='total';",'reset selection');
  ui=once(ui,"if(key!==lastKey){lastKey=key;currentPage=1;order='date-desc';selectedArea='all';}","if(key!==lastKey){lastKey=key;currentPage=1;order='date-desc';selectedArea='all';areaSelectionManual=false;priceMode=type==='land'?'sqm':'total';}",'new scope');
  ui=once(ui,"    if (selectedArea!=='all' && !options.some(option=>option.key===selectedArea)) selectedArea='all';","    if(!areaSelectionManual)selectedArea=pricing.defaultArea(allItems,type);\n    if(selectedArea!=='all'&&!options.some(option=>option.key===selectedArea)&&!areaSelectionManual)selectedArea='all';",'automatic comparable area');
  ui=once(ui,'    const items=filteredItems(allItems,options);','    const items=filteredItems(allItems,options).filter(item=>pricing.valueOf(item,priceMode)!==null);','shared cohort');
  ui=once(ui,'    const items=sorted(filteredItems(raw,areaOptions(raw,current.type)),order);','    const items=sorted(filteredItems(raw,areaOptions(raw,current.type)).filter(item=>pricing.valueOf(item,priceMode)!==null),order);','list same cohort');
  ui=once(ui,'<strong>${esc(money(item.amount))}</strong></div>','<strong>${esc(pricing.formatPrice(pricing.valueOf(item,priceMode),priceMode))}</strong></div>','row primary price');
  ui=once(ui,'${Number(item.unitPrice)>0 ? `<span class="trade-row-fact">${esc(number(item.unitPrice,1))}만원/㎡</span>` : \'\'}','${priceMode!==\'total\' ? `<span class="trade-row-fact">매매총액 ${esc(money(item.amount))}</span>` : \'\'}','row secondary total');
  ui=between(ui,'    const newest=sorted(items)[0];',"    let empty=$('transactionEmpty');",
    "    const priceModel=pricing.model(items,{metric:priceMode,type,areaKind:definition.areaKind,scope:group.scope,selectedArea,options,coveredMonthKeys:group.coveredMonthKeys||[]});\n    renderPriceControls(allItems,options,definition);\n    pricing.renderSummary(priceModel);\n    pricing.renderChart(priceModel);\n",'unified summary and chart');
  ui=once(ui,"    $('transactionSort').value=order;","    $('transactionSort').value=order;\n    $('transactionSort').querySelector('[value=\"unit-desc\"]').textContent='면적당 가격 높은순';\n    $('transactionListTitle').textContent=priceMode==='total'?'매매 거래목록':'면적당 가격 비교 목록';",'list basis title');
  write('transaction-ui.js',ui);
}

let html=read('index.html');
if(!html.includes('src="./transaction-price-context.js'))html=once(html,'    <script src="./transaction-ui.js','    <script src="./transaction-price-context.js?v=20261117.4"></script>\n    <script src="./transaction-ui.js','price asset order');
html=html.replace(/transaction-ui\.(js|css)\?v=[^"']+/g,'transaction-ui.$1?v=20261117.4');write('index.html',html);
let build=read('scripts/build-pages.mjs');
if(!build.includes('"transaction-price-context.js"'))build=once(build,'const publicFiles = [','const publicFiles = [\n  "transaction-price-context.js",','published price module');write('scripts/build-pages.mjs',build);
let layout=read('scripts/transaction-ui-layout.mjs').replace(/transaction-ui\.\$1\?v=[\d.]+/g,'transaction-ui.$1?v=20261117.4');write('scripts/transaction-ui-layout.mjs',layout);
let installer=read('scripts/install-transaction-ui.mjs').replace(/transaction-ui\.(js|css)\?v=[\d.]+/g,'transaction-ui.$1?v=20261117.4');write('scripts/install-transaction-ui.mjs',installer);

let css=read('transaction-ui.css');
if(!css.includes('UNIFIED_PRICE_CONTEXT_V1'))css+=`
/* UNIFIED_PRICE_CONTEXT_V1 */
#detailPanelTransactions.collection-trades .trade-pricing-controls{margin:12px 0;padding:13px;border:1px solid #d2e3d8;border-radius:13px;background:#fff;min-width:0;}
#detailPanelTransactions.collection-trades .price-control-heading{display:flex;flex-wrap:wrap;justify-content:space-between;gap:5px;font-size:13px;}
#detailPanelTransactions.collection-trades .price-control-heading small{font-size:11px;color:#64796e;}
#detailPanelTransactions.collection-trades .trade-pricing-controls .trade-area-filters{padding:10px 0;}
#detailPanelTransactions.collection-trades .price-metric-label{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:#325b4a;}
#detailPanelTransactions.collection-trades .price-metric-label select{height:42px;max-width:100%;min-width:0;flex:1;padding:0 9px;border:1px solid #c6ddcf;border-radius:9px;background:#fff;color:inherit;font:inherit;}
#detailPanelTransactions.collection-trades .price-all-areas{display:flex;align-items:center;flex-wrap:wrap;gap:6px;max-width:100%;font-size:12px;}
#detailPanelTransactions.collection-trades .price-all-areas select{min-width:0;max-width:100%;height:42px;font:inherit;}
#detailPanelTransactions.collection-trades .trade-price-context{font-size:12px;font-weight:700;color:#225b45;line-height:1.6;margin:9px 0;overflow-wrap:anywhere;}
#detailPanelTransactions.collection-trades .price-month-readout{margin:10px 0 4px;padding:10px;border-radius:9px;background:#eff7f2;border:1px solid #d8e7dd;font-size:12px;line-height:1.7;color:#254f3e;}
#detailPanelTransactions.collection-trades .price-caveat{font-size:11px;line-height:1.65;color:#61756a;margin:7px 2px;}
#detailPanelTransactions.collection-trades .price-chart-range{stroke:#9cb9ab;stroke-width:2;}
#detailPanelTransactions.collection-trades .price-month-point{cursor:pointer;outline:none;}
#detailPanelTransactions.collection-trades .price-month-point:focus-visible .market-chart-dot{stroke-width:4;stroke:#133d30;}
#detailPanelTransactions.collection-trades .market-chart-dot.small-sample{stroke-dasharray:2 2;}
#detailPanelTransactions.collection-trades .market-chart-label{font-size:11px;}
#detailPanelTransactions.collection-trades .price-chart-count{font-size:10px;fill:#526c60;}
#detailPanelTransactions.collection-trades .trade-chart-toggle{margin-top:13px;}
#detailPanelTransactions.collection-trades #transactionStats .market-stat:nth-child(3) strong{font-size:15px;line-height:1.6;}
@media(max-width:420px){
 #detailPanelTransactions.collection-trades .trade-pricing-controls{padding:10px;}
 #detailPanelTransactions.collection-trades .price-metric-label select{font-size:14px;}
 #detailPanelTransactions.collection-trades .price-month-readout{font-size:11px;padding:8px;}
 #detailPanelTransactions.collection-trades #transactionStats .market-stat:nth-child(3) strong{font-size:13px;}
}
`;
write('transaction-ui.css',css);

// Preserve existing tests; update only product assertions that intentionally changed.
let unit=read('scripts/transaction-ui.test.mjs');
if(!unit.includes('PRICE_CONTEXT_TEST_DEPENDENCY')){
  unit=once(unit,'vm.createContext(sandbox);vm.runInContext(src,sandbox);',"vm.createContext(sandbox);/* PRICE_CONTEXT_TEST_DEPENDENCY */vm.runInContext(fs.readFileSync(new URL('transaction-price-context.js',root),'utf8'),sandbox);vm.runInContext(src,sandbox);",'unit dependency');
  unit=unit.replace("assert.equal(bands[0].key,'98');","assert.equal(bands.find(b=>b.key==='97').key,'97');").replace('assert.match(bands[0].label,/2건/);',"assert.match(bands.find(b=>b.key==='97').label,/2건/);").replace("ui.filteredItems(rows,bands,'98')","ui.filteredItems(rows,bands,'97')");
  unit=unit.replace('assert.equal(bands.length,5);','assert.equal(bands.length,6);').replace("assert.equal(ui.filteredItems(rows,bands,'other').length,2);","assert.equal(ui.filteredItems(rows,bands,'102').length,1);");
  unit=unit.replaceAll('assert.match(src,/renderChartForItems\\?\\.\\(items\\)/);','assert.match(src,/pricing\\.renderChart\\(priceModel\\)/);').replaceAll('assert.match(source,/renderChartForItems\\?\\.\\(items\\)/);','assert.match(source,/pricing\\.renderChart\\(priceModel\\)/);');
  unit=unit.replace('assert.match(source,/\\$\\(\'transactionStats\'\\)\\.before\\(details\\)/);','assert.match(source,/\\$\\(\'transactionStats\'\\)\\.after\\(details\\)/);');
  unit=unit.replace('monthly chart precedes pricing summary','pricing summary precedes monthly chart');
  write('scripts/transaction-ui.test.mjs',unit);
}
let browser=read('scripts/transaction-ui.browser.mjs');
if(!browser.includes('PRICE_CONTEXT_BROWSER_DEPENDENCY')){
  browser=once(browser,'<script src="./transaction-ui.js"></script>','<script src="./transaction-price-context.js"></script><script src="./transaction-ui.js"></script>','browser dependency');
  browser='// PRICE_CONTEXT_BROWSER_DEPENDENCY\n'+browser;
  browser=browser.replace('chart.compareDocumentPosition(stats)','stats.compareDocumentPosition(chart)').replace('monthly chart should appear before the pricing summary','pricing summary should appear before the monthly chart');
  browser=once(browser,"  const expected=actual.filter(r=>r.lot===sample.lot).length;","  const expected=await page.evaluate(()=>Number(document.getElementById('transactionStats').dataset.cohortCount));",'visible area count');
  browser=once(browser,"  assert.equal(await page.locator('.trade-row').count(),10,'page size must be ten');","  await page.locator('#transactionAreaFilters button').first().click();\n  assert.equal(await page.locator('.trade-row').count(),10,'page size must be ten');",'explicit mixed-area pagination fixture');
  write('scripts/transaction-ui.browser.mjs',browser);
}
console.log('Unified price context installed. Original transactions, collection APIs and pagination limits are unchanged.');
