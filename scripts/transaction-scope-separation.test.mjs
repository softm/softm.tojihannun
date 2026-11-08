import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source = fs.readFileSync(new URL("../market-data.js", import.meta.url), "utf8");
test("exact parcel transactions are never replaced by nearby comparables", () => {
  assert.match(source, /items: exact\.sort/);
  assert.match(source, /comparable: comparable\.filter\(item => !item\.exact\)/);
  assert.doesNotMatch(source, /const selected = exact\.length \? exact : comparable/);
});
test("user can explicitly switch transaction scope", () => {
  assert.match(source, /transactionScopeSwitch/);
  assert.match(source, /state\.transactionView = mode/);
  assert.match(source, /지번 비공개 거래는 일치 여부를 확인할 수 없습니다/);
});
