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

test("모바일 검색 키보드가 열리면 메인 패널을 화면 아래로 완전히 숨긴다", () => {
  const html = read("index.html");
  const css = read("styles.css");
  const app = read("app.js");

  assert.match(html, /styles\.css\?v=20261120\.8/);
  assert.match(html, /app\.js\?v=20261120\.3/);
  assert.match(css, /\.sheet\.keyboard-hidden \{ --sheet-drag-offset: calc\(100% \+ env\(safe-area-inset-bottom\) \+ 12px\);[^}]*pointer-events: none/);
  assert.match(app, /function setSearchKeyboardSheetHidden\(hidden\)/);
  assert.match(app, /mainSheetElement\.classList\.toggle\("keyboard-hidden", shouldHide\)/);
  assert.match(app, /searchInputElement\.addEventListener\("focus"[\s\S]*?setSearchKeyboardSheetHidden\(true\)/);
  assert.match(app, /searchInputElement\.addEventListener\("blur"[\s\S]*?setSearchKeyboardSheetHidden\(false\)/);
  assert.match(app, /window\.visualViewport\?\.addEventListener\("resize", syncSearchKeyboardSheet\)/);
});

test("모바일 상세 제목은 전체 폭을 확보하고 외부 액션은 다음 줄에 배치된다", () => {
  const html = read("index.html");
  const css = read("styles.css");
  const app = read("app.js");
  const districts = read("districts.css");

  assert.match(html, /styles\.css\?v=20261120\.8/);
  assert.match(html, /districts\.css\?v=20261120\.3/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.detail-title-row \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.detail-title-row h2 \{ width: 100%;[\s\S]*?word-break: keep-all/);
  assert.match(css, /\.detail-title-actions \{ width: 100%;[\s\S]*?flex-wrap: nowrap/);
  assert.match(css, /\.detail-title-actions \.district-parcel-link \{[^}]*min-height: 44px/);
  assert.match(css, /\.directions-toggle \{ min-height: 44px/);
  assert.match(css, /\.copy-address-link\.detail-copy-address \{ width: 44px; min-height: 44px/);
  assert.match(html, /id="copyParcelAddress"[^>]*aria-label="지번주소 복사"/);
  assert.match(html, /id="copyRoadAddress"[^>]*aria-label="도로명주소 복사"/);
  assert.match(app, /#copyParcelAddress[\s\S]*?copyToClipboard\(record\.address\)/);
  assert.match(app, /#copyRoadAddress[\s\S]*?copyToClipboard\(record\.road\)/);
  assert.match(districts, /\.detail-title-actions\{flex-wrap:nowrap\}/);
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

test("실거래는 용도별 API와 필지 우선·유사면적 비교 기준을 사용한다", () => {
  const html = read("index.html");
  const market = read("market-data.js");
  const app = read("app.js");

  assert.match(html, /id="transactionType"[\s\S]*?value="land"[\s\S]*?value="apartment"[\s\S]*?value="factory"/);
  assert.match(html, /<option value="48">최근 4년<\/option>/);
  assert.match(html, /<option value="60" selected>최근 5년<\/option>/);
  assert.match(html, /transaction-ui\.css\?v=20261118\.3/);
  assert.match(html, /vendor\/echarts-toji\.min\.js\?v=20261117\.2/);
  assert.match(html, /transaction-price-context\.js\?v=20261117\.13/);
  assert.match(html, /market-data\.js\?v=20261120\.6/);
  assert.match(read("transaction-ui.js"), /saved\.textContent = '전체 기간'/);
  assert.match(market, /RTMSDataSvcLandTrade[\s\S]*?RTMSDataSvcAptTrade[\s\S]*?RTMSDataSvcInduTrade/);
  assert.match(market, /const exact = unique\.filter\(\(item\) => item\.exact\)/);
  assert.match(market, /item\.area >= parcelArea \* \.5 && item\.area <= parcelArea \* 2/);
  assert.match(market, /Math\.min\(pageCount, 5\)/);
  assert.match(market, /!item\.cancellationDate/);
  assert.match(market, /parcel\?\.buildingName/);
  assert.match(app, /buildingName: searchResult\?\.category === "place" \? searchResult\.title : ""/);
  assert.match(app, /TojihannunMarketData\?\.refreshParcel\(record\)/);
});

test("같은 법정동 비교 거래는 공개 지번만 정확한 필지 검색으로 연결한다", () => {
  const html = read("index.html");
  const ui = read("transaction-ui.js");
  const market = read("market-data.js");
  const app = read("app.js");

  assert.match(html, /app\.js\?v=20261120\.3/);
  assert.match(ui, /data-open-parcel-index/);
  assert.match(ui, /role="button" tabindex="0"/);
  assert.match(market, /tojihannun:select-parcel-address/);
  assert.match(app, /addEventListener\("tojihannun:select-parcel-address"/);
  assert.match(app, /parcelAddressKey\(candidateAddress\) === expectedKey[\s\S]*?parcelRegionKey\(candidateAddress\) === expectedRegion/);
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
  assert.match(css, /\.detail-ledger-action \{[^}]*min-height: 34px;[^}]*border: 1px solid #c8d9d2;[^}]*border-radius: 10px;/);
  assert.match(css, /@media \(min-width: 721px\)[\s\S]*?\.detail-ledger-action \{ min-height: 36px;/);
  assert.doesNotMatch(css, /\.detail-ledger-action \+ \.detail-ledger-action/);
});


test("내 위치 정보와 기존 현위치·확대축소 컨트롤은 독립적으로 표시한다", () => {
  const html = read("index.html");
  const css = read("styles.css");
  const app = read("app.js");
  const districtCss = read("districts.css");

  // The new action is above search, not in the map-control rail.
  assert.match(html, /class="search-wrap"[\s\S]*?id="onSiteInfoButton"[\s\S]*?id="searchForm"/);
  assert.match(css, /\.search-wrap > \.on-site-action-row \{ position: static;/);

  // Original location button and +/- are in one ordered button group.
  assert.match(html, /class="zoom-controls"[\s\S]*?id="locateButton"[\s\S]*?id="zoomIn"[\s\S]*?id="zoomOut"/);
  assert.match(css, /\.zoom-controls #locateButton \{ display: grid;/);
  assert.match(css, /\.map-controls \{ position: fixed; top: 510px; bottom: auto; right: 13px;/);

  // The two GPS handlers must remain independent.
  assert.match(app, /\$\("#locateButton"\)\.addEventListener\("click"/);
  assert.match(app, /\$\("#onSiteInfoButton"\)\.addEventListener\("click"/);
  assert.match(districtCss, /\.district-controls \{ top: 452px; right: 13px; \}/);
});
