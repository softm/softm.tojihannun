import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../transaction-price-context.js',import.meta.url),'utf8');
const env={window:{},document:{}};vm.runInNewContext(source,env);const p=env.window.TojiPriceContext;
// Synthetic fixtures, never presented as real reported contracts.
const row=(amount,area,date='2026-10-01',more={})=>({amount,area,date,month:date.slice(0,7).replace('-',''),floor:'9',...more});
test('area bands use disclosed exclusive area, not rounding 84.97 into 85',()=>{
  assert.equal(p.areaKey(row(94000,84.97)),'84');assert.equal(p.areaKey(row(68500,59.91)),'59');
  const options=p.areaOptions([row(94000,84.97),row(84000,84.99)],'apartment');
  assert.equal(options.length,1);assert.equal(options[0].min,84.97);assert.equal(options[0].max,84.99);
  assert.match(options[0].title,/같은 평면을 의미하지/);
});
test('default area uses record count, then latest contract for ties',()=>{
  const rows=[row(68000,59.9,'2026-09-01'),row(69000,59.9,'2026-09-10'),row(84000,84.97,'2026-10-01'),row(94000,84.99,'2026-10-26')];
  assert.equal(p.defaultArea(rows,'apartment'),'84');assert.equal(p.filterArea(rows,'84').length,2);
  assert.equal(p.defaultArea(rows,'land'),'all');assert.equal(rows.length,4);
});
test('three price modes derive from the same contract amount and denominator',()=>{
  const r=row(94000,84.97);
  assert.equal(p.valueOf(r,'total'),94000);assert.equal(p.valueOf(r,'sqm'),94000/84.97);
  assert.equal(p.valueOf(r,'area33'),94000/84.97*3.3);
  assert.match(p.formatPrice(p.valueOf(r,'area33'),'area33'),/만원\/3\.3㎡/);
  assert.equal(p.valueOf(row(94000,0),'sqm'),null);assert.equal(p.valueOf(row(94000,null),'area33'),null);
  assert.equal(p.valueOf(row(null,84),'total'),null);
});
test('median of unit prices cannot be replaced with median price divided by median area',()=>{
  const m=p.model([row(100,1),row(200,100),row(300,3)],{metric:'sqm'});
  assert.equal(m.median,100);assert.notEqual(m.median,200/3);
});
test('chart and cards use one common 84-square-metre cohort',()=>{
  const rows=[row(68000,59.9,'2026-06-02'),row(80000,84.97,'2026-06-04'),row(90000,84.99,'2026-06-20'),row(100000,121.1,'2026-06-23')];
  const m=p.model(p.filterArea(rows,'84'),{metric:'total',selectedArea:'84',options:p.areaOptions(rows,'apartment')});
  assert.equal(m.count,2);assert.equal(m.median,85000);assert.equal(m.months[0].value,85000);
  assert.equal(m.months[0].count,2);assert.equal(m.low,80000);assert.equal(m.high,90000);
  assert.equal(p.summaryRows(m)[1][1],'8억 5,000만원');assert.match(m.areaDescription,/84\.97~84\.99㎡/);
});
test('missing months are not zero and one-record months remain sparse observations',()=>{
  const m=p.model([row(80000,84.97,'2026-06-03'),row(90000,84.97,'2026-08-04')]);
  assert.equal(m.months.length,3);assert.equal(m.months[1].count,0);assert.equal(m.months[1].value,null);
  assert.equal(m.months[0].count,1);assert.equal(m.months[0].value,80000);
  assert.equal(p.model([row(80000,84.97)]).smallSample,true);
});
test('mixed areas are marked and cancelled contracts cannot become comparables',()=>{
  const m=p.model([row(68000,59.9),row(94000,84.97),row(100000,121,'2026-10-01',{cancelled:true})],{type:'apartment',selectedArea:'all'});
  assert.equal(m.count,2);assert.equal(m.mixed,true);assert.equal(m.median,81000);
});
test('same-day latest contracts are a range, not an arbitrary selected row',()=>{
  const m=p.model([row(80000,84.97,'2026-10-26'),row(94000,84.99,'2026-10-26')]);
  assert.equal(m.latestRows.length,2);assert.match(p.summaryRows(m)[0][1],/8억원 ~ 9억 4,000만원/);
  assert.match(p.summaryRows(m)[0][2],/같은 날 2건/);
});
test('invalid areas cannot become zero-priced unit transactions',()=>{
  const m=p.model([row(80000,84.97),row(90000,null)],{metric:'sqm'});
  assert.equal(m.count,1);assert.equal(m.excluded,1);assert.ok(m.values.every(v=>v>0));
});
test('rendering makes no upstream requests or market-index claims',()=>{
  assert.doesNotMatch(source,/\bfetch\s*\(/);assert.match(source,/시세지수가 아닙니다/);
  assert.match(source,/세로축 0부터/);assert.match(source,/혼합 거래 중앙값/);
  assert.match(source,/previous=false/);assert.match(source,/공급면적 기준 평당가와 다릅니다/);
});

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
