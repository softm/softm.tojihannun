import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../transaction-price-context.js',import.meta.url),'utf8');
const env={window:{},document:{}};vm.runInNewContext(source,env);
const p=env.window.TojiPriceContext;
// Reproduction values from the user's screenshot; not newly verified RTMS data.
const row={amount:29500,area:80.47,date:'2024-03-09',month:'202403',floor:'2',buildingName:'온수동아파트',dealType:'중개거래'};
test('one contract has exactly one summary with original facts, never median/min/max cards',()=>{
 const data=p.model([row],{metric:'total',areaKind:'전용면적',scope:'온수동 83'});
 const summary=p.summaryRows(data);
 assert.equal(data.count,1);assert.equal(summary.length,1);
 assert.equal(summary[0][0],'확인된 계약 1건');
 assert.equal(summary[0][1],'2억 9,500만원');
 assert.match(summary[0][2],/2024\.03\.09.*80\.47㎡.*2층.*중개거래/);
 assert.doesNotMatch(summary.map(x=>x[0]).join(' '),/대표|최저|최고|중앙값/);
});
test('one-contract unit-price modes retain explicit original total',()=>{
 for(const metric of ['sqm','area33']){
  const summary=p.summaryRows(p.model([row],{metric}));
  assert.equal(summary.length,1);
  assert.equal(summary[0][1],p.formatPrice(p.valueOf(row,metric),metric));
  assert.match(summary[0][2],/매매총액 2억 9,500만원/);
 }
});
test('zero and multiple contract policies remain distinct',()=>{
 assert.equal(p.summaryRows(p.model([])).length,0);
 assert.equal(p.summaryRows(p.model([row,{...row,date:'2024-04-01',month:'202404',amount:30000}])).length,4);
 assert.equal(p.summaryRows(p.model([row,{...row,cancelled:true}])).length,1);
});
test('single guard clears stale chart state and UI cannot unhide it',()=>{
 const ui=fs.readFileSync(new URL('../transaction-ui.js',import.meta.url),'utf8');
 assert.match(source,/const showChart=data\.count>1/);
 assert.match(source,/if\(chart\)\{chart\.dispose\(\);chart=null;\}/);
 assert.match(source,/host\.replaceChildren\(\)/);
 assert.match(source,/startValue:Math\.max\(0,data\.months\.length-24\)/);
 assert.match(ui,/transactionChartToggle'\)\.hidden=priceModel\.count<=1/);
 assert.match(ui,/transactionListSection'\)\.hidden=items\.length<=1/);
 assert.match(ui,/const PAGE_SIZE = 10/);
 assert.match(ui,/const VISIBLE_PAGE_BUTTONS = 5/);
});
