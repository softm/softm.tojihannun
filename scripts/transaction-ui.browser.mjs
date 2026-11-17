// PRICE_CONTEXT_BROWSER_DEPENDENCY
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=process.cwd();
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const index=read('data/transactions/published/41210/index.json');
const files=index.groups['rowHouse-sale']['광명동'];
const actual=files.flatMap(f=>read('data/transactions/published/'+f.path).rows).filter(r=>!r.cancelled&&r.exactLotPublic&&r.type==='rowHouse'&&r.deal==='sale');
const sample=actual.find(r=>r.lot==='94-9') || actual[0];
assert.ok(sample,'Published Gwangmyeong parcel fixture is required; do not invent a record');
const [main,sub='0']=sample.lot.split('-');
const parcel={id:'collection-ui-published-test',pnu:'41210101001'+main.padStart(4,'0')+sub.padStart(4,'0'),address:'경기도 광명시 광명동 '+sample.lot,number:sample.lot,buildings:[{use:'연립주택'}]};
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json'};
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/runtime-config.js'){res.setHeader('content-type','text/javascript');res.end('window.__TOJI_RUNTIME_CONFIG__={};');return;}
  const file=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;res.end();return;}
  res.setHeader('content-type',mime[path.extname(file)] || 'application/octet-stream');
  let body=fs.readFileSync(file);
  if(file.endsWith('/index.html')){
    // Use the production DOM/styles, isolating transactions from maps/ads/other providers.
    body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
    body=body.replace('</body>','<script src="./static-transactions.js"></script><script src="./vendor/echarts-toji.min.js"></script><script src="./transaction-price-context.js"></script><script src="./transaction-ui.js"></script><script src="./market-data.js"></script></body>');
  }
  res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
fs.mkdirSync('test-results',{recursive:true});
const proof={source:'repository published files; production DOM/CSS; no live government requests',sample:{lot:sample.lot,date:sample.date},checks:[]};
try{
  const page=await browser.newPage({viewport:{width:360,height:800},isMobile:true,hasTouch:true});
  const errors=[],apiCalls=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(/apis\.data\.go\.kr|api\.vworld\.kr/.test(url))apiCalls.push(url);
    return url.startsWith(origin)?route.continue():route.abort();
  });
  const assertCleanPanel=async()=>{
    const panel=page.locator('#detailPanelTransactions');
    assert.equal(await panel.locator('#transactionCollection').count(),0,'collection card must not be rendered');
    assert.equal(await panel.locator('a[href*="data-status"]').count(),0,'no collection-status link in transaction panel');
    assert.doesNotMatch(await panel.innerText(),/수집 현황|데이터\s*수집|수집중|수집 중|수집 자료|일부 기간 확보|계약월 확보|자료 갱신|전체 이력 아님|확보한 계약월|미수집 기간/);
    const status=page.locator('#transactionStatus');
    if(await status.getAttribute('data-tone')==='success'){
      assert.equal(await status.textContent(),'','successful lookup has no count/matching/cancellation summary');
      assert.equal(await status.isVisible(),false,'successful lookup leaves no blank status card');
    }
  };
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  // PARCEL_COMPARISON_20261117: real collected rows; user-reported short address.
  for(const candidate of [
    {id:'short-address-regression',pnu:'4121010100101590042',address:'광명동 159-42',road:'경기도 광명시 오리로 1034-1 (광명동)',number:'159-42대',buildings:[{use:'다세대주택'}]},
    {id:'regional-only-regression',pnu:'4121010100',address:'광명동',number:'',buildings:[{use:'다세대주택'}]}
  ]){
    await page.evaluate(p=>{
      const sheet=document.getElementById('detailSheet');sheet.classList.add('open');sheet.hidden=false;
      document.querySelectorAll('[data-detail-panel]').forEach(e=>e.hidden=e.id!=='detailPanelTransactions');
      window.TojihannunMarketData.setParcel(p);window.TojihannunMarketData.activate('transactions');
    },candidate);
    await page.waitForFunction(()=>document.getElementById('detailPanelTransactions').getAttribute('aria-busy')==='false'&&document.querySelector('#transactionScopeSwitch button'));
    assert.doesNotMatch(await page.locator('#transactionStatus').textContent(),/식별정보|법정동을 확인하지 못/);
    assert.equal(await page.locator('#transactionScopeSwitch button').count(),2);
    await page.locator('#transactionScopeSwitch button').nth(1).click();
    assert.ok(await page.locator('.trade-row').count()>0,'published same-dong comparison rows must render');
    assert.ok(await page.locator('#transactionAreaFilters button').count()>0,'comparison area filters remain available');
    assert.equal(await page.locator('#transactionChartToggle').isVisible(),true);
    assert.equal(await page.locator('#transactionChartToggle').getAttribute('open'),'');
    assert.match(await page.locator('#transactionAreaLabel').textContent(),/^광명동 · 같은 법정동 비교$/);
    assert.doesNotMatch(await page.locator('#transactionPriceContext').textContent(),/159-42/,'comparison prices must not be labeled as the selected parcel price');
    if(candidate.id==='regional-only-regression')assert.equal(await page.locator('#transactionScopeSwitch button').first().isDisabled(),true);
    await page.setViewportSize({width:1280,height:850});
    assert.equal(await page.locator('#transactionChartToggle').isVisible(),true);
    await page.setViewportSize({width:360,height:800});
    proof.checks.push(candidate.id+': scope tabs, real legal-dong rows, area filters and expanded chart at mobile/desktop widths');
  }

  await page.evaluate(p=>{
    const sheet=document.getElementById('detailSheet');sheet.classList.add('open');sheet.hidden=false;
    document.querySelectorAll('[data-detail-panel]').forEach(e=>e.hidden=e.id!=='detailPanelTransactions');
    window.TojihannunMarketData.setParcel(p);window.TojihannunMarketData.activate('transactions');
  },parcel);
  await page.waitForFunction(()=>document.getElementById('detailPanelTransactions').getAttribute('aria-busy')==='false'&&document.querySelector('.trade-row'));
  const expected=await page.evaluate(()=>Number(document.getElementById('transactionStats').dataset.cohortCount));
  assert.match(await page.locator('#transactionListCount').textContent(),new RegExp(expected.toLocaleString('ko-KR')+'건'));
  assert.equal(await page.locator('#transactionChartToggle').getAttribute('open'),'','monthly chart should open by default');
  assert.equal(await page.evaluate(()=>{
    const chart=document.querySelector('#transactionChartToggle');
    const stats=document.querySelector('#transactionStats');
    return !!(stats.compareDocumentPosition(chart)&Node.DOCUMENT_POSITION_FOLLOWING);
  }),true,'pricing summary should appear before the monthly chart');
  // SINGLE_TRADE_BROWSER_POLICY_V1: published exact-lot sample may contain only one contract.
  if(expected>1){
    assert.match(await page.locator('#transactionChartMeta').textContent(),/월 거래 건수|가격축/);
    assert.equal(await page.locator('#transactionChart').getAttribute('data-renderer'),'echarts-svg');
  }
  else {
    assert.equal(await page.locator('#transactionChartToggle').isVisible(),false);
    assert.equal(await page.locator('#transactionStats .market-stat').count(),1);
    assert.equal(await page.locator('#transactionListSection').isVisible(),false);
  }
  await assertCleanPanel();
  assert.equal(await page.locator('#transactionPaging').isVisible(),false,'no empty diagnostics gap');
  assert.equal(await page.locator('#transactionRange option[value="saved"]').textContent(),'전체 기간');
  proof.checks.push('published exact-lot records rendered without collection card or operational links; chart expanded by default');
  for(const width of [320,360,390,768,1280]){
    await page.setViewportSize({width,height:850});
    const dimensions=await page.locator('#detailPanelTransactions').evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));
    assert.ok(dimensions.client>0 && dimensions.scroll<=dimensions.client+1,`horizontal overflow at ${width}: ${JSON.stringify(dimensions)}`);
    if(width<=390){
      const period=await page.locator('#transactionRange').boundingBox();
      const refresh=await page.locator('#refreshTransactions').boundingBox();
      assert.ok(period && period.width>=145,`period selector too narrow at ${width}: ${JSON.stringify(period)}`);
      assert.ok(refresh && refresh.width<=60,`refresh steals period width at ${width}: ${JSON.stringify(refresh)}`);
    }
    const cards=await page.locator('.trade-row--compact').evaluateAll(elements=>elements.slice(0,20).map(e=>({height:e.getBoundingClientRect().height,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,detailLines:e.querySelectorAll('.trade-row-inline .trade-row-fact').length,oldGrid:e.querySelectorAll('dl').length})));
    assert.ok(cards.length>0,'compact trade cards should be rendered');
    const maxCardHeight=width<=390?120:92;
    assert.ok(cards.every(c=>c.height<=maxCardHeight),`compact card too tall at ${width}px: ${JSON.stringify(cards)}`);
    assert.ok(cards.every(c=>c.oldGrid===0&&c.scrollWidth<=c.clientWidth+1),'no 3-column fact grids or horizontal clipping');
    proof.checks.push(`compact transaction cards at ${width}px, max ${Math.max(...cards.map(c=>Math.round(c.height)))}px`);
    proof.checks.push(`no transaction-panel horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({width:360,height:800});
  await page.locator('#detailPanelTransactions .market-panel-head').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/transaction-ui-mobile.png'});
  await page.locator('#transactionScopeSwitch button').nth(1).click();
  assert.match(await page.locator('#transactionDisclosure').textContent(),/선택 필지의 거래/);
  await page.locator('#transactionSort').selectOption('amount-desc');
  assert.equal(await page.locator('#transactionSort').inputValue(),'amount-desc');
  // The default shows only recent collected months, not every historical fixture.
  // Pagination thresholds must use the number of rows actually loaded for this period.
  const total=Number((await page.locator('#transactionListCount').textContent()).replace(/,/g,'').match(/(\d+)건/)?.[1] || 0);
  assert.ok(await page.locator('.trade-row').count()<=10,'no more than 10 deals may render per page');
  if(total>10){
    assert.equal(await page.locator('.trade-row').count(),10);
    assert.equal(await page.locator('#transactionPagination button[aria-current="page"]').textContent(),'1');
    await page.locator('#transactionPagination button').filter({hasText:/^2$/}).click();
    assert.equal(await page.locator('#transactionPagination button[aria-current="page"]').textContent(),'2');
  } else assert.equal(await page.locator('#transactionPagination').isVisible(),false);
  await page.locator('.trade-row').last().scrollIntoViewIfNeeded();
  const last=await page.locator('.trade-row').last().boundingBox();assert.ok(last&&last.y<800&&last.y+last.height>0,'last record can be scrolled into view');
  await assertCleanPanel();
  proof.checks.push('comparison separated; local sorting; ten-deal pages; last row reachable');
  await page.locator('#transactionRange').selectOption('12');
  await page.waitForFunction(()=>document.getElementById('detailPanelTransactions').getAttribute('aria-busy')==='false');
  assert.equal(apiCalls.length,0,'filtering must not initiate government requests');
  await assertCleanPanel();
  proof.checks.push('period filter reads collected files only, without progress notices');
  let releaseFailure;
  const failureGate=new Promise(resolve=>{releaseFailure=resolve;});
  await page.route('**/data/transactions/published/index.json',async r=>{await failureGate;await r.fulfill({status:503,body:'unavailable'});});
  await page.locator('#refreshTransactions').click();
  await page.waitForFunction(()=>document.getElementById('transactionStatus').dataset.tone==='loading');
  assert.equal(await page.locator('#transactionStatus').isVisible(),true,'loading remains visible after a successful lookup');
  assert.match(await page.locator('#transactionStatus').textContent(),/불러오는 중/);
  releaseFailure();
  await page.waitForFunction(()=>document.getElementById('transactionStatus').textContent.includes('불러오지 못'));
  assert.equal(await page.locator('#transactionStatus').isVisible(),true,'error remains visible after a successful lookup');
  assert.match(await page.locator('#transactionEmpty').textContent(),/읽지 못/);
  assert.doesNotMatch(await page.locator('#transactionEmpty').textContent(),/거래가 없습니다/);
  await assertCleanPanel();
  assert.equal(await page.locator('#transactionPaging button').textContent(),'다시 불러오기');
  proof.checks.push('failed file has a concise retry state, not zero transactions');
  await page.unroute('**/data/transactions/published/index.json');
  await page.locator('#transactionPaging button').click();
  await page.waitForFunction(()=>document.getElementById('detailPanelTransactions').getAttribute('aria-busy')==='false'&&document.querySelector('.trade-row'));
  await assertCleanPanel();
  proof.checks.push('success hides only the redundant status card; loading, failure and retry restore the correct state');
  await page.evaluate(()=>{
    window.TojihannunMarketData.setParcel({id:'uncollected-fixture',pnu:'9999910100100010001',address:'검증시 검증동 1-1',number:'1-1',buildings:[{use:'연립주택'}]});
    window.TojihannunMarketData.activate('transactions');
  });
  await page.waitForFunction(()=>document.getElementById('detailPanelTransactions').getAttribute('aria-busy')==='false');
  assert.match(await page.locator('#transactionEmpty').textContent(),/거래 자료를 아직 확인하지 못했습니다/);
  assert.equal(await page.locator('#transactionStatus').isVisible(),true,'empty-result guidance stays visible');
  assert.doesNotMatch(await page.locator('#transactionEmpty').textContent(),/읽지 못|거래가 없습니다/);
  await assertCleanPanel();
  proof.checks.push('empty lookup shows filter guidance without collection diagnostics or complete-history claims');
  await page.evaluate(()=>{
    window.__openedComparisonParcel=null;
    window.TojiTransactionUI.render({
      group:{scope:'궁동 213-27',regionScope:'궁동',items:[],comparable:[
        {date:'2026-08-22',amount:31800,area:46.51,umdNm:'궁동',jibun:'213-21',buildingName:'우신빌라'},
        {date:'2026-08-21',amount:31000,area:46.51,umdNm:'궁동',jibun:'',buildingName:'지번 비공개'}
      ],loading:false,staticError:false,error:'',degraded:false},
      definition:{label:'연립·다세대',areaKind:'전용면적'},view:'nearby',type:'rowHouse',period:'60',
      onView:()=>{},onReload:()=>{},onStop:()=>{},onSelectParcel:item=>{window.__openedComparisonParcel=item;}
    });
  });
  assert.equal(await page.locator('.trade-row[role="button"]').count(),1,'only the disclosed comparison lot is actionable');
  await page.locator('.trade-row[role="button"]').press('Enter');
  assert.equal(await page.evaluate(()=>window.__openedComparisonParcel?.jibun),'213-21');
  proof.checks.push('disclosed same-dong row opens its parcel by keyboard; masked lot stays inert');
  // Presentation-only fixture: verify >5 numbered pages without any remote API call.
  const pagedDeals=Array.from({length:62},(_,i)=>({
    date:'2026-11-'+String(i%28+1).padStart(2,'0'),
    month:'202611',amount:50000+i*300,area:i<45?84.98:97.97,unitPrice:700+i,
    buildingName:'페이지 검증 단지',umdNm:'옥길동',jibun:'742-1',floor:String(i%20+1),exact:true
  }));
  await page.evaluate(records=>{
    window.TojiTransactionUI.render({
      group:{scope:'옥길동 742-1',items:records,comparable:[],loading:false,staticError:false,error:'',degraded:false},
      definition:{label:'아파트',areaKind:'전용면적'},view:'parcel',type:'apartment',
      period:'saved',onView:()=>{},onReload:()=>{},onStop:()=>{}
    });
  },pagedDeals);
  await page.locator('#transactionAreaFilters button').first().click();
  assert.equal(await page.locator('.trade-row').count(),10,'page size must be ten');
  assert.deepEqual(await page.locator('#transactionPagination button').allTextContents(),['이전','1','2','3','4','5','다음']);
  await page.locator('#transactionPagination button').filter({hasText:/^5$/}).click();
  assert.equal(await page.locator('#transactionPagination button[aria-current="page"]').textContent(),'5');
  assert.deepEqual(await page.locator('#transactionPagination button').allTextContents(),['이전','3','4','5','6','7','다음']);
  await page.locator('#transactionPagination button').last().click();
  await page.locator('#transactionPagination button').last().click();
  assert.equal(await page.locator('.trade-row').count(),2,'final page must show remaining two deals');
  assert.equal(await page.locator('#transactionPagination button[aria-current="page"]').textContent(),'7');
  await page.locator('#transactionSort').selectOption('amount-asc');
  assert.equal(await page.locator('#transactionPagination button[aria-current="page"]').textContent(),'1','sorting resets paging');
  assert.equal(await page.locator('.trade-row').count(),10);
  await page.locator('#transactionAreaFilters button').last().click();
  assert.equal(await page.locator('#transactionPagination button[aria-current="page"]').textContent(),'1','area filter resets paging');
  assert.ok(await page.locator('.trade-row').count()<=10);
  assert.equal(apiCalls.length,0,'local pagination must never call public APIs');
  proof.checks.push('62-row fixture: five visible page numbers, last page, sorting and area-filter resets');
  assert.deepEqual(errors,[]);assert.equal(apiCalls.length,0);
  proof.status='passed';fs.writeFileSync('test-results/transaction-ui-browser.json',JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
