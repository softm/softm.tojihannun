import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve('dist'),out=path.resolve('test-results/collection');await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!p.startsWith(root+path.sep)){res.writeHead(403);return res.end();}const data=await fs.readFile(p);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.json':'application/json'})[path.extname(p)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});const proofs=[];
try{
 const manifest=JSON.parse(await fs.readFile('dist/data/transactions/status-manifest.json','utf8'));
 for(const [name,width,height]of[['desktop',1440,1100],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/data-status.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelectorAll('#regions .province').length>0);
  assert.equal(await page.locator('#regions .province').count(),manifest.regions.length);
  const first=manifest.regions.find(r=>r.records!=null);if(first){await page.locator('summary').filter({hasText:first.name}).first().click();await page.getByRole('button').filter({hasText:first.districts.find(d=>d.records!=null).name}).first().click();await page.waitForFunction(()=>document.querySelectorAll('#detail table').length>0);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'mobile must not overflow');
  await page.screenshot({path:path.join(out,'data-status-'+name+'.png'),fullPage:true});assert.deepEqual(errors,[]);proofs.push({viewport:name,manifestRows:manifest.summary.records,provinceCount:manifest.regions.length,pageErrors:errors});await page.close();
 }
 const page=await browser.newPage();await page.goto(base+'/data-status.html');await page.addScriptTag({url:base+'/static-transactions.js'});
 const index=JSON.parse(await fs.readFile('dist/data/transactions/published/index.json','utf8'));let sample=null;
 for(const [district,meta]of Object.entries(index.districts)){const di=JSON.parse(await fs.readFile('dist/data/transactions/published/'+meta.index,'utf8'));for(const [stream,groups]of Object.entries(di.groups)){if(!stream.endsWith('-sale'))continue;for(const [emd,parts]of Object.entries(groups)){for(const file of parts){const data=JSON.parse(await fs.readFile('dist/data/transactions/published/'+file.path,'utf8'));const r=data.rows.find(r=>r.exactLotPublic&&!r.cancelled);if(r){sample={district,emd,type:r.type,lot:r.lot};break;}}if(sample)break;}if(sample)break;}if(sample)break;}
 if(sample){let upstream=0;page.on('request',r=>{if(r.url().includes('apis.data.go.kr'))upstream++;});const result=await page.evaluate(s=>window.TojiStaticTrades.lookup({lawdCode:s.district,emd:s.emd,lot:s.lot},s.type),sample);assert.ok(result.rows.length>0);assert.ok(result.rows.every(r=>r.jibun===sample.lot));assert.equal(upstream,0);proofs.push({staticLookup:sample,returnedRows:result.rows.length,governmentRequests:upstream});}
 await fs.writeFile(path.join(out,'proof.json'),JSON.stringify(proofs,null,2));console.log(JSON.stringify(proofs));
}finally{await browser.close();await new Promise(r=>server.close(r));}
