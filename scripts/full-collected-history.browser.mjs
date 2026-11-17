import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd();
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 const file=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');
 let body=fs.readFileSync(file);
 if(file.endsWith('/index.html')){
  body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  body=body.replace('</body>','<script src="./transaction-price-context.js"></script><script src="./transaction-ui.js"></script><script src="./market-data.js"></script></body>');
 }
 res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
fs.mkdirSync('test-results/full-history',{recursive:true});
const proof={kind:'synthetic 72-contract fixture, not real transactions',checks:[]};
try{
 const page=await browser.newPage({viewport:{width:390,height:900}});
 const errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  if(route.request().url().startsWith(origin))return route.continue();
  if(/apis\.data\.go\.kr|api\.vworld\.kr/.test(route.request().url()))external.push(route.request().url());
  return route.abort();
 });
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>{
  const rows=[];
  // Synthetic data: 36 complete months ending in the previous month.
  const now=new Date();
  for(let back=36;back>=1;back--){
   const d=new Date(now.getFullYear(),now.getMonth()-back,1);
   for(const day of ['01','02'])rows.push({dealYear:String(d.getFullYear()),dealMonth:String(d.getMonth()+1).padStart(2,'0'),dealDay:day,
    dealAmount:'80000',excluUseAr:'84.98',floor:'9',umdNm:'광명동',jibun:'1-1',aptNm:'가상 검증단지'});
  }
  window.historyTestLookups=[];
  window.TojiStaticTrades={lookup:async(area,type,options)=>{
   window.historyTestLookups.push(options.months===undefined?'all':options.months);
   const filtered=rows.filter(r=>!options.months||options.months.includes(r.dealYear+r.dealMonth));
   return{rows:filtered,completeMonths:[...new Set(filtered.map(r=>r.dealYear+r.dealMonth))],verifiedAt:new Date().toISOString()};
  }};
  const sheet=document.getElementById('detailSheet');sheet.classList.add('open');sheet.hidden=false;
  document.querySelectorAll('[data-detail-panel]').forEach(e=>e.hidden=e.id!=='detailPanelTransactions');
  window.TojihannunMarketData.setParcel({id:'full-history-fixture',pnu:'4121010100100010001',address:'경기도 광명시 광명동 1-1',number:'1-1',buildings:[{use:'아파트'}]});
  window.TojihannunMarketData.activate('transactions');
 });
 await page.waitForFunction(()=>document.getElementById('detailPanelTransactions').getAttribute('aria-busy')==='false'&&document.getElementById('transactionStats').dataset.cohortCount==='72');
 assert.equal(await page.locator('#transactionRange').inputValue(),'saved');
 assert.equal(await page.locator('#transactionRange option:checked').textContent(),'전체 기간');
 assert.equal(await page.locator('.trade-row').count(),10);
 assert.equal(await page.locator('#transactionChart').getAttribute('data-history-scroll'),'true');
 assert.equal(await page.evaluate(()=>window.historyTestLookups[0]),'all');
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:900});
  await page.waitForTimeout(80);
  const m=await page.locator('#detailPanelTransactions').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
  assert.ok(m.scroll<=m.width+1,`page must not overflow at ${width}: ${JSON.stringify(m)}`);
  const scroll=await page.locator('#transactionChart').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
  assert.ok(scroll.scroll>scroll.width,'long history scroll must be local to chart');
 }
 await page.setViewportSize({width:390,height:900});
 await page.locator('#transactionChart').evaluate(el=>{el.scrollLeft=0;});
 await page.locator('#transactionChart [data-month-index]').first().click();
 assert.match(await page.locator('#transactionMonthReadout').textContent(),/2건/);
 proof.checks.push('all 72 contracts across 36 months loaded; 10 visible rows; historical chart month selectable');
 await page.locator('#transactionRange').selectOption('6');
 await page.waitForFunction(()=>document.getElementById('detailPanelTransactions').getAttribute('aria-busy')==='false'&&document.getElementById('transactionStats').dataset.cohortCount==='10');
 assert.equal(await page.evaluate(()=>window.historyTestLookups.at(-1).length),6);
 proof.checks.push('six-month selection remains explicit and filters actual records');
 await page.locator('#transactionRange').selectOption('saved');
 await page.waitForFunction(()=>document.getElementById('transactionStats').dataset.cohortCount==='72');
 assert.equal(await page.evaluate(()=>window.historyTestLookups.at(-1)),'all');
 await page.locator('#transactionPriceMetric').selectOption('sqm');
 assert.equal(await page.locator('#transactionStats').getAttribute('data-metric'),'sqm');
 assert.equal(await page.locator('#transactionChartCard').getAttribute('data-cohort-count'),'72');
 assert.equal(await page.locator('.trade-row').count(),10);
 await page.locator('#transactionPriceMetric').selectOption('total');
 await page.locator('#detailPanelTransactions').screenshot({path:'test-results/full-history/full-period-390.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 proof.checks.push('all-period restored; shared cohort and metric preserved; no government API requests');
 proof.status='passed';
 fs.writeFileSync('test-results/full-history/browser.json',JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
