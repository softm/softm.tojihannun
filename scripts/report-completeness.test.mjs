import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = relativePath => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("보고서는 상세 조회와 시장 조회 전체 섹션을 공통 모델에 포함한다", () => {
  const app = read("app.js");
  const market = read("market-data.js");

  assert.match(app, /\["데이터 레이어", record\.dataset/);
  assert.match(app, /\["토지특성 기준연도"/);
  assert.match(app, /\["건축물 식별번호", building\.id/);
  assert.match(app, /TojihannunMarketData\?\.getReportSections/);
  assert.match(app, /title: "정보 출처 및 데이터 기준"/);
  assert.match(app, /await window\.TojihannunMarketData\?\.prepareReportData/);

  assert.match(market, /title: `\$\{transactionDefinition\.label\} 실거래 조회 요약`/);
  assert.match(market, /title: `\$\{transactionDefinition\.label\} 실거래 목록 전체/);
  assert.match(market, /title: "경매·공매 조회 요약"/);
  assert.match(market, /title: `온비드 공매 목록 전체/);
  assert.match(market, /prepareReportData, getReportSections/);
});

test("긴 전체 보고서는 이미지 캔버스 최대 높이에 맞춰 축소한다", () => {
  const exporter = read("report-export.js");

  assert.match(exporter, /Math\.min\(2, 30000 \/ Math\.max\(report\.scrollHeight, 1\)\)/);
  assert.match(exporter, /scale,/);
});
