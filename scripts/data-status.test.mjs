import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const html=fs.readFileSync(new URL("../data-status.html",import.meta.url),"utf8");
const build=fs.readFileSync(new URL("./build-pages.mjs",import.meta.url),"utf8");
const manifest=JSON.parse(fs.readFileSync(new URL("../data/transactions/status-manifest.json",import.meta.url),"utf8"));
test("nationwide status dashboard is published with actual manifest",()=>{assert.match(build,/"data-status.html"/);assert.match(build,/manifestSource/);assert.match(html,/status-manifest.json/);});
test("uncollected regions are not counted as zero records",()=>{assert.equal(manifest.regions.length,17);assert.ok(manifest.regions.every(x=>x.records===null&&x.status==="not_collected"));assert.match(html,/미수집/);});
test("collection timestamps and run history are exposed",()=>{assert.ok("lastSuccessAt" in manifest.collection);assert.ok("history" in manifest.collection);assert.match(html,/slice\(0,500\)/);});
