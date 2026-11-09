import fs from 'node:fs';
// Match the existing ID-scoped mobile rules without affecting other detail tabs.
const cssPath='transaction-ui.css';
let css=fs.readFileSync(cssPath,'utf8').replace(/(?<!#detailPanelTransactions)\.collection-trades/g,'#detailPanelTransactions.collection-trades');
const reset='#detailPanelTransactions.collection-trades .market-panel-head > div:first-child { flex:0 1 auto;width:auto; }';
if(!css.includes(reset))css+='\n'+reset+'\n';
fs.writeFileSync(cssPath,css);
const html=fs.readFileSync('index.html','utf8').replace(/transaction-ui\.(js|css)\?v=[^"']+/g,'transaction-ui.$1?v=20261110.2');
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
console.log('Mobile selector width and desktop header height corrected; regression assertions retained.');
