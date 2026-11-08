import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {patchFile} from "./install-districts.mjs";
const context = vm.createContext({URL});
vm.runInContext(fs.readFileSync(new URL("../districts-core.js", import.meta.url), "utf8"), context);
const C = context.TojiDistrictCore;
const planning = C.sources.find(s => s.id === "planning");
const plain = value => JSON.parse(JSON.stringify(value));
test("VWorld failure is never interpreted as zero districts", () => {
  assert.throws(() => C.unpack({response:{status:"ERROR",error:{code:"INVALID_KEY"}}}), /INVALID_KEY/);
  assert.throws(() => C.unpack({response:{status:"OK",result:{}}}));
  assert.throws(() => C.unpack({}));
});
test("successful empty query and unknown totals remain distinct", () => {
  assert.deepEqual(plain(C.unpack({response:{status:"NOT_FOUND"}})), {features:[],total:0});
  assert.equal(C.unpack({type:"FeatureCollection",features:[],totalFeatures:"unknown"}).total, null);
});
test("both Data API and WFS GeoJSON are supported", () => {
  const f={type:"Feature",geometry:{type:"Polygon",coordinates:[]},properties:{}};
  assert.equal(C.unpack({response:{status:"OK",record:{total:"21"},result:{featureCollection:{features:[f]}}}}).total,21);
  assert.equal(C.unpack({type:"FeatureCollection",features:[f],totalFeatures:4}).total,4);
});
test("polygon holes and multipolygons are preserved; point approximations are rejected", () => {
  const polygon={type:"Feature",geometry:{type:"Polygon",coordinates:[[[1,1],[5,1],[5,5],[1,1]],[[2,2],[3,2],[2,3],[2,2]]]}}, multi={type:"Feature",geometry:{type:"MultiPolygon",coordinates:[]}};
  assert.equal(C.polygonFeatures([polygon,multi,{type:"Feature",geometry:{type:"Point",coordinates:[1,2]}}]).length,2);
  assert.equal(C.polygonFeatures([polygon])[0].geometry.coordinates.length,2);
});
test("source properties are mapped case-insensitively; stages are not invented", () => {
  const m=C.metadata({DGM_NM:"시험 구역",status:"OK",ntfc_dt:"20260101"},planning);
  assert.equal(m.name,"시험 구역"); assert.equal(m.stage,"진행단계 미제공"); assert.equal(m.date,"원본 기준일 미제공");
  assert.match(C.metadata({},planning).name,/명칭 미제공/);
});
test("Naver link preserves latitude/longitude order and clamps zoom", () => {
  const url=new URL(C.naverUrl([126.855,37.48],30));
  assert.equal(url.searchParams.get("ms"),"37.4800000,126.8550000,19");
  assert.equal(new URL(C.naverUrl([NaN,0])).hostname,"fin.land.naver.com");
});
test("viewport keys depend on rectangle and selected layers, not a center point", () => {
  assert.equal(C.boundsKey([1,2,3,4],["b","a"]),C.boundsKey([1,2,3,4],["a","b"]));
  assert.notEqual(C.boundsKey([1,2,3,4],["a"]),C.boundsKey([0,1,4,5],["a"]));
  assert.throws(()=>C.boundsKey([4,2,1,3],["a"]));
});
test("integration patches are idempotent and preserve existing code", () => {
  const samples={"index.html":"<html><head></head><body>KEEP</body></html>","app.js":'map.on("singleclick", handleMapClick);\nasync function handleMapClick(event) {\nKEEP\n}',"server.mjs":'const allowedNedOperations = new Set([\n]);\nconst target = new URL(`https://api.vworld.kr/ned/data/${operation}`);',"scripts/build-pages.mjs":'const publicFiles = [\n"index.html"\n];'};
  for(const [name,text] of Object.entries(samples)){const once=patchFile(name,text);assert.equal(patchFile(name,once),once);assert.notEqual(once,text);}
});
test("integration fails safely when its expected source anchor changes", () => {
  assert.throws(()=>patchFile("app.js","different application"),/anchor not found/);
});
test("UI isolates district picking and guards stale responses", () => {
  const text=fs.readFileSync(new URL("../districts.js",import.meta.url),"utf8");
  assert.match(text,/if \(!enabled \|\| !pick/);
  assert.match(text,/signal\.aborted \|\| id !== revision/);
  assert.match(text,/intersectsExtent\(extent\)/);
  assert.doesNotMatch(text,/\.innerHTML\s*=/);
  assert.match(text,/MAX_PAGES = 5/);
});
