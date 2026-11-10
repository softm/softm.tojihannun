import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../transaction-ui.js',import.meta.url),'utf8');
const presentation=source.slice(source.indexOf('  function mount()'));
test('transaction presentation has no collection card, operational link or progress notices',()=>{
  assert.doesNotMatch(presentation,/data-status\.html|trade-collection-head|trade-month-details|자료 갱신|전체 이력 아님|수집 현황|수집 자료|계약월 확보|미수집/);
  assert.doesNotMatch(presentation,/section\.id\s*=\s*['"]transactionCollection/);
  assert.match(presentation,/전체 기간/);
});
test('removing diagnostics preserves retry, transaction scope and local pagination',()=>{
  for(const value of ['다시 불러오기','조회 중단','같은 법정동 비교','공개 지번 일치','limit+=20'])assert.ok(presentation.includes(value));
  assert.match(presentation,/paging\.style\.display=paging\.hidden\?'none':''/);
  assert.doesNotMatch(presentation,/\bfetch\s*\(/);
});
test('coverage remains internal and incomplete history is never promoted to complete',()=>{
  const context={window:{},document:{}};vm.runInNewContext(source,context);
  const coverage=context.window.TojiTransactionUI.coverage({savedOnly:true,coveredMonthKeys:['202510','202611']});
  assert.equal(coverage.partial,true);assert.equal(coverage.expected,null);assert.equal(coverage.count,2);
});
