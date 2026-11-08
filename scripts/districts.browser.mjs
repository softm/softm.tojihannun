// Isolated browser integration test: synthetic fixtures, NOT production district data.
import {chromium} from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root=process.cwd(), artifact=path.join(root,"test-results");
fs.mkdirSync(artifact,{recursive:true});
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,"http://localhost").pathname;
  const file=path.resolve(root,"."+(pathname==="/"?"/index.html":pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html; charset=utf-8");
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  const poly={type:"Feature",id:"fixture-planning",properties:{dgm_nm:"테스트 지구단위구역",project_stage:"시험 자료"},geometry:{type:"Polygon",coordinates:[[[126.850,37.476],[126.860,37.476],[126.860,37.484],[126.850,37.484],[126.850,37.476]]]}};
  let fail=false;
  await page.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==="127.0.0.1") {
      if(url.pathname==="/runtime-config.js") return route.fulfill({contentType:"text/javascript",body:"globalThis.__TOJI_RUNTIME_CONFIG__={};"});
      if(url.pathname.startsWith("/api/vworld/")) {
        if(fail) return route.fulfill({status:503,contentType:"application/json",body:'{"error":"fixture unavailable"}'});
        if(url.pathname.includes("getCtySpceWFS")) return route.fulfill({json:{type:"FeatureCollection",features:[],totalFeatures:0}});
        const features=url.searchParams.get("data")==="LT_C_UPISUQ161"?[poly]:[];
        return route.fulfill({json:{response:{status:features.length?"OK":"NOT_FOUND",record:{total:String(features.length)},result:{featureCollection:{type:"FeatureCollection",features}}}}});
      }
      return route.continue();
    }
    if(url.hostname==="cdn.jsdelivr.net" && /ol@/.test(url.pathname) && url.pathname.endsWith(".js")) {
      return route.fulfill({contentType:"text/javascript",body:fs.readFileSync("node_modules/ol/dist/ol.js","utf8")});
    }
    return route.abort();
  });
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.TojiDistricts && typeof map!=="undefined");
  await page.evaluate(()=>{map.getView().setCenter(ol.proj.fromLonLat([126.855,37.480]));map.getView().setZoom(16);});
  await page.locator('[aria-controls="districtPanel"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-district-list]')?.textContent.includes("테스트 지구단위구역"));
  assert.equal(await page.locator('[data-district-list] button').count(),1);
  await page.locator('[data-district-list] button').first().click();
  assert.match(await page.locator('[data-district-detail]').innerText(),/테스트 지구단위구역/);
  assert.match(await page.locator('[data-district-naver]').getAttribute("href"),/37\.4800000%2C126\.8550000/);
  await page.locator('#districtToggle').click();
  assert.equal(await page.evaluate(()=>map.getLayers().getArray().find(l=>l.get("name")==="district-boundaries").getVisible()),false);
  await page.locator('#districtToggle').click();
  await page.waitForFunction(()=>document.querySelector('[data-district-list] button'));
  await page.screenshot({path:path.join(artifact,"districts-desktop-fixture.png")});
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('[data-district-list] button') && document.querySelector('[data-sources]')?.textContent.includes("1개 도형"));
  await page.waitForTimeout(600);
  await page.screenshot({path:path.join(artifact,"districts-mobile-fixture.png")});
  const box=await page.locator('#districtPanel').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=391);
  const toolbar=await page.locator('.district-toolbar').boundingBox();assert.ok(toolbar.y>=190,"mobile district controls must stay below the search bar");
  const listButton=await page.locator('[data-district-list] button').first().boundingBox();
  if(listButton) assert.equal(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('.district-controls'),{x:listButton.x+10,y:listButton.y+10}),true,"district panel must remain above parcel sheet");
  fail=true; await page.evaluate(()=>window.TojiDistricts.refresh());
  await page.waitForFunction(()=>document.querySelector('[data-district-status]')?.textContent.includes("확인하지 못했습니다"));
  assert.equal(await page.locator('[data-district-list] button').count(),0);
  assert.equal(errors.filter(e=>/TojiDistrict|districts|Invalid URL|is not a function/.test(e)).length,0,JSON.stringify(errors));
  console.log("Browser PASS: viewport polygons, details, Naver coordinates, visibility, mobile bounds and stacking, provider failures (SYNTHETIC FIXTURES)");
} finally {await browser.close();server.close();}
