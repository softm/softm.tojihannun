import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = p => fs.readFileSync(new URL("../"+p, import.meta.url),"utf8");
const html=read("data-status.html"), js=read("data-status.js"), build=read("scripts/build-pages.mjs");
const manifest=JSON.parse(read("data/transactions/status-manifest.json"));
test("status page and dynamic manifest are included in published build",()=>{
 assert.match(build,/"data-status.html"/);assert.match(build,/manifestSource/);
 assert.match(html,/data-status.js/);assert.match(js,/status-manifest.json/);
});
test("regional registry is data driven; collected data is not required to remain zero",()=>{
 assert.ok(manifest.regions.length>0);assert.equal(new Set(manifest.regions.map(r=>r.code)).size,manifest.regions.length);
 for(const r of manifest.regions){if(r.status==="not_collected")assert.equal(r.records,null);else if(r.records!=null)assert.ok(Number.isSafeInteger(r.records)&&r.records>=0);}
 if(manifest.summary)assert.equal(manifest.regions.reduce((n,r)=>n+(r.records||0),0),manifest.summary.records||0);
});
test("timestamps, real run state and bounded history are distinct",()=>{
 assert.ok("lastSuccessAt" in manifest.collection);assert.ok(Array.isArray(manifest.collection.history));
 assert.match(js,/slice\(0,500\)/);assert.match(js,/in_progress/);assert.match(js,/실시간 실행 상태 미확인/);
});
