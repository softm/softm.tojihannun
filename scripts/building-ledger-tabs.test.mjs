import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = relativePath => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("대장 통합 보기 탭은 공식 서류 우선순서로 표시된다", () => {
  const html = read("building-ledger.html");
  const expectedOrder = [
    "building",
    "land-register",
    "land-use",
    "eum",
    "lifecycle",
    "cadastral",
    "registry",
    "ownership"
  ];
  const positions = expectedOrder.map(documentId => html.indexOf(`data-document="${documentId}"`));

  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
});

test("원문을 직접 제공할 수 없는 공부서류는 공식 사이트 링크를 제공한다", () => {
  const script = read("building-ledger.js");

  assert.match(script, /documentId === "cadastral"[\s\S]*?GOV_CADASTRAL_MAP_URL[\s\S]*?linkOnly: true/);
  assert.match(script, /documentId === "registry"[\s\S]*?IROS_URL[\s\S]*?linkOnly: true/);
  assert.match(script, /documentId === "ownership"[\s\S]*?GOV_LAND_REGISTER_URL[\s\S]*?linkOnly: true/);
  assert.match(script, /if \(request\.linkOnly\)[\s\S]*?showError\(request\.title, request\.message, request\)/);
});
