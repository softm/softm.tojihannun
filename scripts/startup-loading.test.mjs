import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = relativePath => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("첫 페인트에 경량 시작 화면과 진행 상태를 즉시 제공한다", () => {
  const html = read("index.html");
  const criticalStyle = html.indexOf('id="startupCriticalStyle"');
  const firstExternalStyle = html.indexOf('<link rel="preload" as="style"');
  const screen = html.indexOf('id="startupScreen"');
  const app = html.indexOf('id="main"');

  assert.ok(criticalStyle > 0 && criticalStyle < firstExternalStyle);
  assert.ok(screen > 0 && screen < app);
  assert.match(html, /id="startupStatus">화면을 준비하고 있어요/);
  assert.match(html, /id="startupProgress"/);
  assert.match(html, /window\.TojihannunStartup = \{[\s\S]*?update\(message,[\s\S]*?finish/);
  assert.match(html, /window\.setTimeout\(finish, 12000\)/);
});

test("외부 스타일과 대형 스크립트는 첫 화면 렌더링을 막지 않는다", () => {
  const html = read("index.html");

  assert.match(html, /rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com/);
  assert.match(html, /rel="preload" as="style" href="https:\/\/cdn\.jsdelivr\.net\/npm\/ol@10\.6\.1\/ol\.css/);
  assert.match(html, /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/ol@10\.6\.1\/dist\/ol\.js"><\/script>/);
  assert.match(html, /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/html2canvas@1\.4\.1/);
  assert.match(html, /<script defer src="\.\/app\.js\?v=20261120\.3"><\/script>/);
});

test("앱은 전체 load를 기다리지 않고 지도 결과에 맞춰 시작 화면을 종료한다", () => {
  const app = read("app.js");

  assert.match(app, /TojihannunStartup\?\.update\?\.\("지도를 연결하고 있어요", 76\)/);
  assert.match(app, /map\.once\("rendercomplete"[\s\S]*?TojihannunStartup\?\.finish\?\.\(\)/);
  assert.match(app, /source\.on\("tileloadend"[\s\S]*?TojihannunStartup\?\.finish\?\.\(\)/);
  assert.match(app, /function showMapError\(message\) \{[\s\S]*?TojihannunStartup\?\.finish\?\.\(\)/);
  assert.match(app, /document\.addEventListener\("DOMContentLoaded", initMap/);
  assert.doesNotMatch(app, /window\.addEventListener\("load", initMap/);
});
