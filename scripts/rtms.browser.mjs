// UI integration uses actual public records retrieved on 2026-11-08, not screenshot-generated prices.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=process.cwd();fs.mkdirSync('test-results',{recursive:true});
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html; charset=utf-8');fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const parcel={id:'4121010100101580216',pnu:'4121010100101580216',address:'경기도 광명시 광명동 158-216',number:'158-216대',buildings:[{name:'선영빌라',use:'다세대주택'}]};
const snapshots=JSON.parse(fs.readFileSync('rtms-verified-snapshots.json','utf8'));
const raw=snapshots.entries[0].rows;
const commercialEvidence=JSON.parse(fs.readFileSync('docs/RTMS_COMMERCIAL_DISCLOSURE_20261108.json','utf8'));
const commercialParcel={id:'4121010100101580217',pnu:'4121010100101580217',address:'경기도 광명시 광명동 158-217',number:'158-217대',buildings:[{use:'제2종근린생활시설'}]};
async function run({snapshotsEnabled=true,responseStatus=429,xml=false,commercial=false}={}){
  const context=await browser.newContext({viewport:{width:1440,height:1050}});const page=await context.newPage();
  const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='apis.data.go.kr'){
      calls.push(url.searchParams.get('DEAL_YMD'));
      if(responseStatus===429)return route.fulfill({status:429,headers:{'Retry-After':'60'},body:''});
      const row={...raw[0],dealYear:url.searchParams.get('DEAL_YMD').slice(0,4),dealMonth:String(Number(url.searchParams.get('DEAL_YMD').slice(4)))};
      if(commercial) {const evidence=commercialEvidence.requests.find(r=>r.month===url.searchParams.get('DEAL_YMD'));return route.fulfill({json:{response:{header:{resultCode:'000'},body:{items:{item:evidence?.lotDisclosure||[]},totalCount:evidence?.lotDisclosure.length||0}}}});}
      const body=xml?'<response><header><resultCode>000</resultCode></header><body><items><item>'+Object.entries(row).map(([key,value])=>`<${key}>${value}</${key}>`).join('')+'</item></items><totalCount>1</totalCount></body></response>':JSON.stringify({response:{header:{resultCode:'000'},body:{items:{item:[row]},totalCount:1}}});
      return route.fulfill({contentType:xml?'application/xml':'application/json',body});
    }
    if(url.origin===base){
      if(url.pathname==='/runtime-config.js')return route.fulfill({contentType:'text/javascript',body:'globalThis.__TOJI_RUNTIME_CONFIG__={molitApiKey:"fixture-not-real"};'});
      if(['app.js','districts.js','districts-core.js','adfit.js','report-export.js'].some(name=>url.pathname==='/'+name))return route.fulfill({contentType:'text/javascript',body:''});
      if(!snapshotsEnabled && url.pathname==='/rtms-verified-snapshots.json')return route.fulfill({json:{entries:[]}});
      return route.continue();
    }
    return route.abort();
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.evaluate(p=>{
    document.querySelector('#mapLoading').hidden=true;
    document.querySelector('#detailSheet').classList.add('open');document.querySelector('#detailSheet').setAttribute('aria-hidden','false');
    document.querySelector('#detailTitle').textContent=p.address;
    document.querySelector('#detailRoad').textContent='공식 원본 검증 · 선영빌라';
    document.querySelector('#mainSheet').style.display='none';
    document.querySelectorAll('[data-detail-panel]').forEach(e=>e.hidden=e.dataset.detailPanel!=='transactions');
    document.querySelectorAll('[data-detail-tab]').forEach(e=>e.classList.toggle('active',e.dataset.detailTab==='transactions'));
    window.TojihannunMarketData.setParcel(p);window.TojihannunMarketData.activate('transactions');
  },commercial?commercialParcel:parcel);
  if(commercial) {
    await page.waitForFunction(()=>document.querySelector('#transactionStatus').dataset.tone!=='loading');
    assert.equal(calls.length,0,'opening a commercial parcel must not start 251 requests');
    assert.doesNotMatch(await page.locator('#transactionScopeSwitch').innerText(),/0건/);
    assert.doesNotMatch(await page.locator('#transactionPaging').innerText(),/251/);
    assert.match(await page.locator('#transactionDisclosure').innerText(),/일부만 공개/);
    await page.selectOption('#transactionRange','year-2026');
    await page.waitForFunction(()=>document.querySelector('#transactionStatus').dataset.tone!=='loading');
    assert.equal(calls.length,3);assert.doesNotMatch(await page.locator('#transactionScopeSwitch').innerText(),/0건/);
    assert.match(await page.locator('#transactionStatus').innerText(),/필지 여부 미확인/);
    assert.match(await page.locator('#transactionDisclosure').innerText(),/확정할 수 없/);
    const before=calls.length;
    await page.locator('#transactionScopeSwitch button').nth(1).click();
    assert.equal(calls.length,before,'switching scope reuses received data');
    assert.ok(await page.locator('.transaction-item').count()>0);
    assert.match(await page.locator('#transactionList').innerText(),/지번 일부공개 · 필지 미확정/);
    await page.locator('#transactionScopeSwitch button').first().click();
    await page.locator('#transactionScopeSwitch').scrollIntoViewIfNeeded();
    await page.screenshot({path:'test-results/rtms-commercial-scope-desktop.png'});
    await page.setViewportSize({width:430,height:1000});
    await page.locator('#transactionDisclosure').scrollIntoViewIfNeeded();
    await page.screenshot({path:'test-results/rtms-commercial-scope-mobile.png'});
    const width=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);assert.ok(width,'no horizontal overflow');
    await page.selectOption('#transactionRange','3');
    await page.waitForFunction(()=>document.querySelector('#transactionStatus').dataset.tone!=='loading');assert.equal(calls.length,before,'same regional months are cached across period changes');
  } else if(snapshotsEnabled){
    await page.waitForFunction(()=>document.querySelectorAll('.transaction-item').length===3);
    assert.equal(calls.length,0,'verified parcel must render with zero API requests');
    const text=await page.locator('#transactionList').innerText();
    for(const value of ['2020.08.15','2019.12.13','2016.07.23','3억 1,000만원','2억 7,000만원','2억 500만원','59.7㎡'])assert.ok(text.includes(value),value);
    assert.match(await page.locator('#transactionPaging').innerText(),/확인 3개월/);
    assert.doesNotMatch(await page.locator('#transactionAreaLabel').innerText(),/158-216대/);
    await page.locator('#transactionList').scrollIntoViewIfNeeded();
    await page.screenshot({path:'test-results/rtms-three-verified-trades-desktop.png'});
    await page.setViewportSize({width:430,height:1000});
    await page.locator('#transactionList').scrollIntoViewIfNeeded();
    await page.screenshot({path:'test-results/rtms-three-verified-trades-mobile.png'});
    await page.click('#refreshTransactions');await page.waitForFunction(()=>document.querySelector('#transactionStatus').dataset.tone==='error');
    assert.equal(calls.length,1);assert.equal(await page.locator('.transaction-item').count(),3);
    await page.click('#refreshTransactions');await page.waitForTimeout(150);assert.equal(calls.length,1,'cooldown blocks repeat fetch');
  } else if(responseStatus===429){
    await page.waitForFunction(()=>document.querySelector('#transactionStatus').dataset.tone!=='loading');assert.equal(calls.length,0);
    await page.selectOption('#transactionRange','3');
    await page.waitForFunction(()=>document.querySelector('#transactionStatus').dataset.tone==='error');
    assert.equal(calls.length,1,'first failed month must stop scan');assert.equal(await page.locator('#transactionStats strong').innerText(),'미확인');
  } else {
    await page.selectOption('#transactionRange','3');
    await page.waitForFunction(()=>document.querySelectorAll('.transaction-item').length===3 && !document.querySelector('#transactionPaging').textContent.includes('조회 중단'));
    assert.equal(calls.length,3,'initial query must stop at three months');
    assert.match(await page.locator('#transactionList').innerText(),/59.7㎡/);
  }
  assert.equal(errors.length,0,JSON.stringify(errors));await context.close();
  return {snapshotsEnabled,xml,commercial,apiRequests:calls.length,pageErrors:errors.length};
}
try {
  const result=[];result.push(await run());result.push(await run({snapshotsEnabled:false}));result.push(await run({snapshotsEnabled:false,responseStatus:200,xml:true}));result.push(await run({snapshotsEnabled:false,responseStatus:200,xml:false}));result.push(await run({snapshotsEnabled:false,responseStatus:200,commercial:true}));
  fs.writeFileSync('test-results/rtms-browser-results.json',JSON.stringify(result,null,2));console.log('RTMS browser PASS',JSON.stringify(result));
} finally {await browser.close();server.close();}
