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
  assert.doesNotMatch(presentation,/분산 수집본|분산 저장소|중앙 일부/);
  assert.match(presentation,/저장된 일부 기간의 자료만 확인했습니다/);
});
test('removing diagnostics preserves retry, transaction scope and local pagination',()=>{
  for(const value of ['다시 불러오기','조회 중단','같은 법정동 비교','공개 지번 일치','trade-pagination'])assert.ok(presentation.includes(value));
  for(const value of ['const PAGE_SIZE = 10','function paginationWindow'])assert.ok(source.includes(value));
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
  assert.match(status,/확보한 수집 범위에서 해당 거래를 확인하지 못했습니다/);
  assert.match(status,/거래 정보를 불러오지 못했습니다/);
  assert.match(status,/거래 내역을 불러오는 중입니다/);
  const css=fs.readFileSync(new URL('../transaction-ui.css',import.meta.url),'utf8');
  assert.match(css,/#transactionStatus:empty\s*\{\s*display:\s*none/);
});
test('status transitions preserve loading, failure and empty-result guidance',()=>{
  const assignment=source.match(/status\.textContent=[^\n]+/)[0];
  const context={status:{},failed:false,partialStored:false,group:{loading:false},items:Array(36).fill({})};
  const render=()=>{vm.runInNewContext(assignment,context);return context.status.textContent;};
  assert.equal(render(),'');
  context.group.loading=true;assert.match(render(),/불러오는 중/);
  context.group.loading=false;context.failed=true;assert.match(render(),/불러오지 못/);
  context.failed=false;assert.equal(render(),'');
  context.items=[];assert.match(render(),/확보한 수집 범위에서 해당 거래를 확인하지 못/);
  context.partialStored=true;assert.match(render(),/저장된 일부 기간/);
  context.partialStored=false;
  context.items=[{}];assert.equal(render(),'');
});
test('UI integration preserves the current transaction asset cache version',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const layout=fs.readFileSync(new URL('./transaction-ui-layout.mjs',import.meta.url),'utf8');
  const version=html.match(/transaction-ui\.js\?v=([\d.]+)/)[1];
  assert.ok(layout.includes('transaction-ui.$1?v='+version));
  assert.ok(html.includes('transaction-ui.css?v='+version));
});
test('mobile transaction filters share one row and retain a full touch refresh target',()=>{
  const css=fs.readFileSync(new URL('../transaction-ui.css',import.meta.url),'utf8');
  assert.match(css,/@media\(max-width:420px\)\{[\s\S]*?transaction-market-controls \{ grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.08fr\) 44px/);
  assert.match(css,/trade-filter:first-child \{ grid-column:1;grid-row:1/);
  assert.match(css,/trade-filter:nth-child\(2\) \{ grid-column:2;grid-row:1/);
  assert.match(css,/#refreshTransactions \{ padding:0;grid-row:1;grid-column:3/);
  assert.match(css,/transaction-scope-switch \{[^}]*padding:4px[^}]*background:#eff5f2/);
  assert.match(css,/transaction-disclosure::before \{[^}]*content:"i"/);
});
