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
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}
 let body=fs.readFileSync(file);
 res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');
 if(file.endsWith('/index.html'))body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>','<script src="./transaction-price-context.js"></script><script src="./transaction-ui.js"></script></body>');
 res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
fs.mkdirSync('test-results/single-trade',{recursive:true});
const proof={source:'UI reproduction fixture copied from user screenshot, not independently verified property data',checks:[]};
const row={amount:29500,area:80.47,date:'2024-03-09',month:'202403',floor:'2',buildingName:'온수동아파트',dealType:'중개거래',umdNm:'온수동',jibun:'83',exact:true,unitPrice:29500/80.47};
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[],apiCalls=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(/apis\.data\.go\.kr|api\.vworld\.kr/.test(url))apiCalls.push(url);
  return url.startsWith(origin)?route.continue():route.abort();
 });
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>{
  const sheet=document.getElementById('detailSheet');sheet.hidden=false;sheet.classList.add('open');
  document.querySelectorAll('[data-detail-panel]').forEach(el=>el.hidden=el.id!=='detailPanelTransactions');
  // This test isolates the transaction renderer; map/app shell is not executed.
  document.getElementById('transactionType').value='apartment';
  document.querySelectorAll('.detail-tabs').forEach(el=>{el.style.display='none';});
  const panel=document.getElementById('detailPanelTransactions');
  for(const id of ['transactionScopeSwitch','transactionDisclosure','transactionPaging']){
   if(!document.getElementById(id)){const el=document.createElement('div');el.id=id;document.getElementById('transactionStatus').before(el);}
  }
  window.reviewRender=items=>{
   const months=Array.from({length:36},(_,i)=>{const d=new Date(2023,11+i,1);return String(d.getFullYear())+String(d.getMonth()+1).padStart(2,'0');});
   window.TojiTransactionUI.render({group:{scope:'온수동 83',items,comparable:[],loading:false,coveredMonthKeys:months},type:'apartment',definition:{label:'아파트',areaKind:'전용면적'},view:'parcel',period:'36',onView:()=>{},onReload:()=>{},onStop:()=>{}});
  };
 });
 await page.evaluate(row=>window.reviewRender([row]),row);
 const assertSingle=async()=>{
  assert.equal(await page.locator('#transactionStats .market-stat').count(),1);
  assert.equal(await page.locator('#transactionChartToggle').isVisible(),false);
  assert.equal(await page.locator('#transactionChart svg').count(),0);
  assert.equal(await page.locator('#transactionListSection').isVisible(),false);
  assert.equal(await page.locator('#transactionSortRow').isVisible(),false);
  assert.equal(await page.locator('#transactionPagination').isVisible(),false);
  assert.equal(await page.locator('#transactionAreaFilters').isVisible(),false);
  assert.match(await page.locator('#transactionInsight').textContent(),/1건.*판단할 수 없습니다/);
  assert.doesNotMatch(await page.locator('#transactionStats').textContent(),/대표 거래|중앙값|최저|최고/);
  assert.equal(await page.locator('#transactionScopeSwitch button').first().getAttribute('aria-pressed'),'true');
 };
 await assertSingle();
 assert.equal(await page.locator('#transactionStats strong').textContent(),'2억 9,500만원');
 assert.match(await page.locator('#transactionStats small').textContent(),/2024\.03\.09.*80\.47㎡.*2층.*중개거래/);
 assert.equal(await page.locator('#transactionRange').inputValue(),'36');
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(70);
  await assertSingle();
  const box=await page.locator('#detailPanelTransactions').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
  assert.ok(box.width>0&&box.scroll<=box.width+1,`overflow ${width}: ${JSON.stringify(box)}`);
  if(width===390)await page.locator('#detailPanelTransactions').screenshot({path:'test-results/single-trade/single-390.png'});
 }
 proof.checks.push('single contract: one card, real contract facts preserved, no trend/min-max/median/duplicate list; responsive 320/390/768/1280');
 for(const metric of ['sqm','area33']){
  await page.locator('#transactionPriceMetric').selectOption(metric);await assertSingle();
  assert.match(await page.locator('#transactionStats small').textContent(),/매매총액 2억 9,500만원/);
 }
 await page.locator('#transactionPriceMetric').selectOption('total');
 await page.evaluate(row=>window.reviewRender([row,{...row,date:'2024-02-01',month:'202402',amount:30000}]),row);
 assert.equal(await page.locator('#transactionStats .market-stat').count(),4);
 assert.equal(await page.locator('#transactionChartToggle').isVisible(),true);
 assert.equal(await page.locator('#transactionListSection').isVisible(),true);
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(70);
  const bounds=await page.locator('#transactionChart').evaluate(host=>{
   const frame=host.getBoundingClientRect();const dot=[...host.querySelectorAll('.market-chart-dot')].at(-1).getBoundingClientRect();
   return {left:frame.left,right:frame.right,point:(dot.left+dot.right)/2};
  });
  assert.ok(bounds.point>=bounds.left&&bounds.point<=bounds.right,'last observed trade must be visible: '+JSON.stringify(bounds));
 }
 proof.checks.push('multiple old trades: chart restores and initial viewport contains the last real trade, not empty recent months');
 await page.evaluate(row=>window.reviewRender([row]),row);await assertSingle();
 await page.setViewportSize({width:390,height:900});await page.waitForTimeout(70);await assertSingle();
 await page.evaluate(()=>window.reviewRender([]));
 assert.equal(await page.locator('#transactionStats .market-stat').count(),0);
 assert.equal(await page.locator('#transactionEmpty').isVisible(),true);
 assert.match(await page.locator('#transactionEmpty').textContent(),/아직 확인하지 못했습니다/);
 assert.equal(await page.locator('#transactionChartToggle').isVisible(),false);
 const many=Array.from({length:62},(_,i)=>({...row,date:'2024-03-'+String(i%28+1).padStart(2,'0'),amount:29500+i}));
 await page.evaluate(rows=>window.reviewRender(rows),many);
 assert.equal(await page.locator('.trade-row:visible').count(),10);
 assert.deepEqual(await page.locator('#transactionPagination button').allTextContents(),['이전','1','2','3','4','5','다음']);
 await page.locator('#transactionPagination button').filter({hasText:/^2$/}).click();
 assert.equal(await page.locator('.trade-row:visible').count(),10);
 assert.equal(await page.locator('#transactionStats').getAttribute('data-cohort-count'),'62');
 proof.checks.push('single -> multiple -> single -> zero -> 62 rows preserves empty/retry semantics, 36-month default, and 10-row/five-button paging');
 assert.deepEqual(errors,[]);assert.equal(apiCalls.length,0);
 proof.status='passed';fs.writeFileSync('test-results/single-trade/proof.json',JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
