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
test('successful transaction lookup has no redundant status summary or empty card',()=>{
  const status=source.match(/status\.textContent=([^\n]+)/)?.[1];
  assert.ok(status);
  assert.doesNotMatch(status,/number\(items\.length\)|공개 지번 일치|비교 거래|취소 제외/);
  assert.match(status,/items\.length\?'':'조회 조건에 맞는 거래 내역을 찾지 못했습니다\.'/);
  assert.match(status,/거래 정보를 불러오지 못했습니다/);
  assert.match(status,/거래 내역을 불러오는 중입니다/);
  const css=fs.readFileSync(new URL('../transaction-ui.css',import.meta.url),'utf8');
  assert.match(css,/#transactionStatus:empty\s*\{\s*display:\s*none/);
});
test('status transitions preserve loading, failure and empty-result guidance',()=>{
  const assignment=source.match(/status\.textContent=[^\n]+/)[0];
  const context={status:{},failed:false,group:{loading:false},items:Array(36).fill({})};
  const render=()=>{vm.runInNewContext(assignment,context);return context.status.textContent;};
  assert.equal(render(),'');
  context.group.loading=true;assert.match(render(),/불러오는 중/);
  context.group.loading=false;context.failed=true;assert.match(render(),/불러오지 못/);
  context.failed=false;assert.equal(render(),'');
  context.items=[];assert.match(render(),/조회 조건에 맞는 거래 내역을 찾지 못/);
  context.items=[{}];assert.equal(render(),'');
});
