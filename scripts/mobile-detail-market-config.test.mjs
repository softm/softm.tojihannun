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

test("상세 탭은 직접 닫을 때만 기본 탭으로 초기화된다", () => {
  const app = read("app.js");

  assert.match(app, /function openDetail\([\s\S]*?setDetailTab\(state\.detailTab, false\)/);
  assert.match(app, /function closeDetail\(\{resetTab = false\} = \{\}\)[\s\S]*?if \(resetTab\) setDetailTab\("basic", false\)/);
  assert.match(app, /#detailClose[\s\S]*?closeDetail\(\{resetTab: true\}\)/);
  assert.match(app, /#brandButton[\s\S]*?closeDetail\(\);/);
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

test("공공데이터 인증키 운영 정보는 사용자 화면에 노출하지 않는다", () => {
  const html = read("index.html");
  const market = read("market-data.js");

  assert.doesNotMatch(html, /data-public-key-slot/);
  assert.doesNotMatch(market, /운영 인증키로 자동 연결되었습니다/);
  assert.doesNotMatch(market, /인증키는 배포 설정에서 주입/);
  assert.doesNotMatch(market, /data-public-key-form|data-public-key-clear/);
  assert.match(market, /현재 실거래 조회 서비스를 이용할 수 없습니다/);
});

test("대장 바로가기는 탭형 분할 버튼이 아닌 독립 액션으로 표시한다", () => {
  const css = read("styles.css");

  assert.match(css, /\.detail-ledger-actions \{[^}]*display: flex;[^}]*gap: 8px;/);
  assert.match(css, /\.detail-ledger-action \{[^}]*border: 1px solid #c8d9d2;[^}]*border-radius: 11px;/);
  assert.doesNotMatch(css, /\.detail-ledger-action \+ \.detail-ledger-action/);
});
