import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>fs.writeFileSync(p,s);
function once(s,a,b,label){if(s.split(a).length!==2)throw Error('Source changed: '+label);return s.replace(a,b);}

let price=read('transaction-price-context.js');
if(!price.includes('SINGLE_TRADE_PRESENTATION_V1')){
 price=once(price,'    return [\n      [`최근 계약',`    // SINGLE_TRADE_PRESENTATION_V1: one observed price is not four statistics.
    if(data.count===1){
      const facts=[latest.buildingName,lastNote,latest.dealType,latest.jimok,latest.landUse,latest.buildingUse];
      if(data.metric!=='total')facts.push('매매총액 '+formatPrice(Number(latest.amount),'total'));
      return [[data.metric==='total'?'확인된 계약 1건':'확인된 계약 1건 · '+data.label,
        formatPrice(data.values[0],data.metric),facts.filter(Boolean).join(' · ')]];
    }
    return [
      [\x60최근 계약`,'single contract card');
 price=once(price,"    const context=$('transactionPriceContext');",`    if(stats){stats.dataset.sampleState=data.count===1?'single':data.count?'multiple':'empty';stats.hidden=!data.count;}
    const context=$('transactionPriceContext');`,'summary layout state');
 price=once(price,"      if(data.mixed)messages.push(","      if(data.count===1)messages.push('선택한 조건에서 확인된 거래가 1건입니다. 한 건의 신고가격만으로 현재 시세나 가격 흐름을 판단할 수 없습니다.');\n      else if(data.mixed)messages.push(",'one-record guidance');
 price=once(price,"      if(data.smallSample)messages.push(","      if(data.smallSample&&data.count!==1)messages.push(",'no repeated single-sample warning');
 price=once(price,`    card.hidden=!points.length;
    if(details)details.hidden=!points.length;
    if(!points.length){host.replaceChildren();return;}
    card.dataset.metric=data.metric;card.dataset.cohortCount=String(data.count);`, `    const showChart=data.count>1&&points.length>0;
    card.dataset.metric=data.metric;card.dataset.cohortCount=String(data.count);
    card.hidden=!showChart;
    if(details)details.hidden=!showChart;
    if(!showChart){
      host.replaceChildren();host.scrollLeft=0;
      host.dataset.historyScroll='false';delete host.dataset.historyKey;
      host.style.removeProperty('--history-chart-width');
      $('transactionMonthReadout')?.remove();
      $('transactionPriceCaveat')?.remove();
      if($('transactionChartMeta'))$('transactionChartMeta').textContent='';
      return;
    }`,'do not render empty time axis for one price');
 price=once(price,'    host.scrollLeft=scrollable?(changed?host.scrollWidth:previousScroll):0;',`    // Focus the last OBSERVED trade, not an empty recent coverage month.
    const lastObservedIndex=data.months.findLastIndex(point=>point.count>0);
    const lastObservedOffset=Math.max(0,x(lastObservedIndex)-(host.clientWidth||viewportWidth)/2);
    host.scrollLeft=scrollable?(changed?lastObservedOffset:previousScroll):0;`,'actual-trade viewport');
 write('transaction-price-context.js',price);
}
let ui=read('transaction-ui.js');
if(!ui.includes('SINGLE_TRADE_PRESENTATION_V1')){
 ui=once(ui,"  const filters=$('transactionAreaFilters');filters.replaceChildren();filters.hidden=!options.length;\n  controls.querySelector('.price-control-heading').hidden=!options.length;",`  // SINGLE_TRADE_PRESENTATION_V1: no competing area choices for one available row.
  const singleAvailableTrade=allItems.length===1;
  const filters=$('transactionAreaFilters');filters.replaceChildren();filters.hidden=!options.length||singleAvailableTrade;
  controls.querySelector('.price-control-heading').hidden=!options.length||singleAvailableTrade;`,'single area controls');
 ui=once(ui,"    $('transactionListSection').hidden=!items.length;",`    // The sole contract is already shown in full in the summary card.
    $('transactionListSection').hidden=items.length<=1;
    if($('transactionSortRow'))$('transactionSortRow').hidden=items.length<=1;`,'remove duplicate single list');
 ui=once(ui,"    $('transactionChartToggle').hidden=!items.length;","    $('transactionChartToggle').hidden=priceModel.count<=1;",'honor single-trade chart suppression');
 write('transaction-ui.js',ui);
}
let css=read('transaction-ui.css');
if(!css.includes('SINGLE_TRADE_PRESENTATION_V1')){
 css+=`
/* SINGLE_TRADE_PRESENTATION_V1: one contract, one summary, no empty statistics. */
#detailPanelTransactions.collection-trades #transactionStats[data-sample-state="single"] {
  grid-template-columns:minmax(0,1fr);margin:12px 0;
}
#detailPanelTransactions.collection-trades #transactionStats[data-sample-state="single"] .market-stat {
  display:block;grid-column:1/-1;padding:16px;
}
#detailPanelTransactions.collection-trades #transactionStats[data-sample-state="single"] .market-stat strong {
  font-size:24px;line-height:1.4;margin-top:5px;
}
#detailPanelTransactions.collection-trades #transactionStats[data-sample-state="single"] .market-stat small {
  font-size:12px;line-height:1.8;margin-top:7px;overflow-wrap:anywhere;
}
`;
 write('transaction-ui.css',css);
}
// Invalidate only changed UI assets and keep existing installer versions aligned.
const version='20261117.10';
for(const path of ['index.html','scripts/transaction-ui-layout.mjs','scripts/install-transaction-ui.mjs','scripts/install-unified-price-context.mjs','scripts/install-full-collected-history.mjs','scripts/install-default-36-months.mjs']){
 if(!fs.existsSync(path))continue;
 let source=read(path);
 source=source.replace(/transaction-ui\.(js|css)\?v=[\w.-]+/g,'transaction-ui.$1?v='+version);
 source=source.replace(/transaction-ui\.\$1\?v=[\w.-]+/g,'transaction-ui.$1?v='+version);
 source=source.replace(/transaction-price-context\.js\?v=[\w.-]+/g,'transaction-price-context.js?v='+version);
 write(path,source);
}
console.log('Single-contract summary and last-observed-month viewport installed; query/data/pagination rules unchanged.');
