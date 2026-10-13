import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = relativePath => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("모바일 상세 팝업 핸들이 드래그·키보드 축소 확장에 연결된다", () => {
  const html = read("index.html");
  const css = read("styles.css");
  const app = read("app.js");

  assert.match(html, /id="detailDragHandle"[\s\S]*?aria-controls="detailSheet"/);
  assert.match(css, /\.detail-sheet\.open\.collapsed[\s\S]*?calc\(100% - 112px\)/);
  assert.match(app, /function detailSheetCollapse\(/);
  assert.match(app, /detailDragHandle\.addEventListener\("pointerdown"/);
  assert.match(app, /detailDragHandle\.addEventListener\("keydown"/);
});

test("실거래 API 키는 런타임 설정을 우선하고 Pages 빌드에서 생성된다", () => {
  const html = read("index.html");
  const market = read("market-data.js");
  const build = read("scripts/build-pages.mjs");
  const workflow = read(".github/workflows/deploy-pages.yml");

  assert.ok(html.indexOf("./runtime-config.js") < html.indexOf("./market-data.js"));
  assert.match(market, /__TOJI_RUNTIME_CONFIG__\?\.molitApiKey/);
  assert.match(build, /process\.env\.MOLIT_API_KEY/);
  assert.match(workflow, /MOLIT_API_KEY: \$\{\{ secrets\.MOLIT_API_KEY \}\}/);
});
