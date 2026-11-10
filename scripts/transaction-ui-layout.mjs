import fs from 'node:fs';
// Match the existing ID-scoped mobile rules without affecting other detail tabs.
const cssPath='transaction-ui.css';
let css=fs.readFileSync(cssPath,'utf8').replace(/(?<!#detailPanelTransactions)\.collection-trades/g,'#detailPanelTransactions.collection-trades');
const reset='#detailPanelTransactions.collection-trades .market-panel-head > div:first-child { flex:0 1 auto;width:auto; }';
if(!css.includes(reset))css+='\n'+reset+'\n';
fs.writeFileSync(cssPath,css);
let html=fs.readFileSync('index.html','utf8').replace(/transaction-ui\.(js|css)\?v=[^"']+/g,'transaction-ui.$1?v=20261110.3');
// Keep the initial markup consistent with the transaction renderer (no diagnostic flash).
html=html.replace(/(<section\b[^>]*\bid="detailPanelTransactions"[\s\S]*?)(?=<section\b[^>]*\bid="detailPanelAuctions")/, panel=>panel
  .replace('<option value="saved" selected>저장된 거래 (전체 이력 아님)</option>','<option value="saved" selected>전체 기간</option>')
  .replace(/<p class="market-disclaimer">[^<]*<\/p>/,'<p class="market-disclaimer">계약 신고 기준의 매매 내역입니다. 같은 지번의 여러 호실 거래가 포함될 수 있습니다.</p>'));
fs.writeFileSync('index.html',html);
const testPath='scripts/transaction-ui.browser.mjs';
let test=fs.readFileSync(testPath,'utf8');
if(!test.includes('period selector too narrow')){
  const anchor='    proof.checks.push(`no transaction-panel horizontal overflow at ${width}px`);';
  if(test.split(anchor).length!==2)throw Error('Browser test changed; reconcile layout assertions');
  test=test.replace(anchor,`    if(width<=390){
      const period=await page.locator('#transactionRange').boundingBox();
      const refresh=await page.locator('#refreshTransactions').boundingBox();
      assert.ok(period && period.width>=145,\`period selector too narrow at \${width}: \${JSON.stringify(period)}\`);
      assert.ok(refresh && refresh.width<=60,\`refresh steals period width at \${width}: \${JSON.stringify(refresh)}\`);
    }
`+anchor);
  fs.writeFileSync(testPath,test);
}
console.log('Transaction filters and cache version updated; collection diagnostics remain outside the detail panel.');
