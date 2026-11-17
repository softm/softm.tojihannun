import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');const file=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}
 let content=fs.readFileSync(file);res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');
 if(file.endsWith('/index.html'))content=content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>','<script src="./transaction-price-context.js"></script><script src="./transaction-ui.js"></script></body>');
 res.end(content);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
fs.mkdirSync('test-results/price-context',{recursive:true});
const proof={source:'Synthetic presentation fixtures, not live property prices',checks:[],screenshots:[]};
const fixture=[];
function add(amount,area,date){fixture.push({date,month:date.slice(0,7).replace('-',''),amount,area,unitPrice:amount/area,buildingName:'UI 검증용 단지',umdNm:'검증동',jibun:'1-1',floor:'9',exact:true});}
for(let i=0;i<7;i++)add(68500+i*1000,59.91,`2026-09-${String(i+1).padStart(2,'0')}`);
[80000,81000,82000,84000,90000,92000,94000].forEach((amount,i)=>add(amount,i%2?84.99:84.97,['2026-06-01','2026-06-16','2026-07-02','2026-08-04','2026-09-02','2026-10-05','2026-10-26'][i]));
[95000,98000,100000].forEach((amount,i)=>add(amount,121.1,`2026-08-${String(i+1).padStart(2,'0')}`));
add(90000,103.1,'2026-06-02');add(95000,103.1,'2026-08-02');
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[],remote=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin))return route.continue();if(/apis\.data\.go\.kr|api\.vworld\.kr/.test(url))remote.push(url);return route.abort();});
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.evaluate(items=>{
   const sheet=document.getElementById('detailSheet');sheet.classList.add('open');sheet.hidden=false;
   document.querySelectorAll('[data-detail-panel]').forEach(el=>el.hidden=el.id!=='detailPanelTransactions');
   const panel=document.getElementById('detailPanelTransactions');
   if(!document.getElementById('transactionScopeSwitch')){const nav=document.createElement('div');nav.id='transactionScopeSwitch';panel.querySelector('.market-panel-head').after(nav);}
   window.TojiTransactionUI.render({group:{scope:'검증동 1-1',items,comparable:[],loading:false,staticError:false,error:'',degraded:false,coveredMonthKeys:['202606','202607','202608','202609','202610','202611']},definition:{label:'아파트',areaKind:'전용면적'},view:'parcel',type:'apartment',period:'saved',onView:()=>{},onReload:()=>{},onStop:()=>{}});
 },fixture);
 assert.equal(await page.locator('#transactionPriceMetric').inputValue(),'total');
 assert.equal(await page.locator('#transactionAreaFilters [aria-pressed="true"]').getAttribute('data-area-key'),'84');
 assert.match(await page.locator('#transactionPriceContext').textContent(),/84㎡대.*84\.97~84\.99㎡.*매매총액.*7건/);
 assert.equal(await page.locator('#transactionStats').getAttribute('data-cohort-count'),'7');
 assert.equal(await page.locator('#transactionChartCard').getAttribute('data-cohort-count'),'7');
 assert.equal(await page.locator('.trade-row').count(),7);
 assert.equal(await page.locator('#transactionStats .market-stat').nth(0).locator('strong').textContent(),'9억 4,000만원');
 assert.equal(await page.locator('#transactionStats .market-stat').nth(1).locator('strong').textContent(),'8억 4,000만원');
 assert.equal(await page.locator('#transactionChartToggle').getAttribute('open'),'');
 assert.equal(await page.evaluate(()=>!!(document.getElementById('transactionStats').compareDocumentPosition(document.getElementById('transactionChartToggle'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
 assert.match(await page.locator('#transactionChartTitle').textContent(),/매매금액/);
 assert.match(await page.locator('#transactionMonthReadout').textContent(),/2026\.10.*2건.*표본 적음/);
 assert.match(await page.locator('#transactionChart svg').textContent(),/미확인/);
 proof.checks.push('19 mixed records -> default 84-square-metre band with 7 identical card/chart/list records; summary before open chart');
 for(const width of [320,360,390,768,1280]){
   await page.setViewportSize({width,height:950});await page.waitForTimeout(80);
   const box=await page.locator('#detailPanelTransactions').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
   assert.ok(box.client>0&&box.scroll<=box.client+1,`Horizontal overflow ${width}: ${JSON.stringify(box)}`);
   assert.equal(await page.locator('#transactionPriceMetric').inputValue(),'total');
   if([390,1280].includes(width)){
     await page.locator('#transactionPricingControls').scrollIntoViewIfNeeded();
     const name=`test-results/price-context/summary-chart-${width}.png`;
     await page.locator('#detailPanelTransactions').screenshot({path:name});proof.screenshots.push(name);
   }
   proof.checks.push(`No horizontal overflow at ${width}px`);
 }
 for(const mode of ['sqm','area33']){
   await page.locator('#transactionPriceMetric').selectOption(mode);
   assert.equal(await page.locator('#transactionStats').getAttribute('data-metric'),mode);
   assert.equal(await page.locator('#transactionChartCard').getAttribute('data-metric'),mode);
   const suffix=mode==='sqm'?'만원/㎡':'만원/3.3㎡';
   assert.ok((await page.locator('#transactionStats .market-stat').first().locator('strong').textContent()).includes(suffix));
   assert.ok((await page.locator('.trade-row-top > strong').first().textContent()).includes(suffix));
   assert.match(await page.locator('.trade-row').first().textContent(),/매매총액/);
   assert.match(await page.locator('#transactionInsight').textContent(),/공급면적 기준 평당가와 다릅니다/);
   assert.equal(await page.locator('#transactionChartCard').getAttribute('data-cohort-count'),'7');
 }
 proof.checks.push('Metric switches update all primary prices together; original total stays explicitly labelled in rows');
 await page.locator('#transactionPriceMetric').selectOption('total');
 await page.locator('#transactionAreaFilters [data-area-key="all"]').click();
 assert.equal(await page.locator('#transactionStats').getAttribute('data-cohort-count'),'19');
 assert.equal(await page.locator('#transactionChartCard').getAttribute('data-cohort-count'),'19');
 assert.equal(await page.locator('#transactionChart .market-chart-line').count(),0);
 assert.match(await page.locator('#transactionInsight').textContent(),/서로 다른 면적/);
 assert.equal(await page.locator('.trade-row').count(),10);
 await page.locator('#transactionPagination button').filter({hasText:/^2$/}).click();
 assert.equal(await page.locator('.trade-row').count(),9);
 assert.equal(await page.locator('#transactionChartCard').getAttribute('data-cohort-count'),'19');
 proof.checks.push('Explicit mixed-area view removes misleading median trend line; page 2 preserves chart/summary sample count');
 await page.locator('#transactionAreaFilters [data-area-key="103"]').click();
 assert.equal(await page.locator('.trade-row').count(),2);
 assert.match(await page.locator('#transactionInsight').textContent(),/거래가 적어/);
 assert.equal(await page.locator('#transactionChart path.market-chart-line').getAttribute('d').then(d=>(d.match(/M/g)||[]).length),2,'missing July must break June-August line');
 await page.locator('#transactionChart [data-month-index]').first().focus();
 assert.match(await page.locator('#transactionMonthReadout').textContent(),/2026\.06/);
 proof.checks.push('Sparse observations and missing month are explicit; keyboard and touch readout is available');
 assert.deepEqual(errors,[]);assert.equal(remote.length,0);proof.status='passed';
 fs.writeFileSync('test-results/price-context/proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
