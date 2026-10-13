import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("상세 탭은 대장·등기 서류의 조회 상태와 공식 링크를 함께 제공한다", () => {
  const html = read("index.html");
  const app = read("app.js");
  const css = read("styles.css");

  assert.match(html, /data-detail-tab="register">대장·등기<\/button>/);
  assert.match(app, /function renderOfficialDocumentAccess\(/);
  assert.match(app, /title: "토지대장"/);
  assert.match(app, /title: "지적도 등본"/);
  assert.match(app, /title: "공유지연명부"/);
  assert.match(app, /title: "등기사항전부증명서"/);
  assert.match(app, /CappBizCD=13100000026/);
  assert.match(app, /CappBizCD=13100000027/);
  assert.match(app, /https:\/\/www\.iros\.go\.kr\//);
  assert.match(css, /\.official-document-grid/);
});

test("지적도는 앱 경계를 표시하고 원문이 없는 서류는 주소 복사를 지원한다", () => {
  const app = read("app.js");

  assert.match(app, /data-document-action="cadastral"/);
  assert.match(app, /async function showCadastralDocument\([\s\S]*?setMapMode\("cadastral"\)/);
  assert.match(app, /fetchParcelFeature\(\[record\.lon, record\.lat\]\)/);
  assert.match(app, /data-document-action="copy-address"/);
  assert.match(app, /등기소 검색용 주소를 복사했어요/);
});

test("공유지연명부 화면 정보는 개인정보 제외 범위를 명확히 표시한다", () => {
  const app = read("app.js");

  assert.match(app, /개인정보 제외 \$\{ownerships\.length\}건/);
  assert.match(app, /소유구분·거주지 구분·공유인 수·변동 정보/);
  assert.match(app, /성명·주소·등록번호·지분 등 원문 정보는 공개 API로 제공되지 않습니다/);
});
