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
  // Scope guidance is rendered by the transaction UI, not the static footer.
  const ui=fs.readFileSync(new URL("../transaction-ui.js", import.meta.url), "utf8");
  assert.match(ui, /onView\(mode\)/);
  assert.match(ui, /같은 법정동 비교/);
  assert.match(ui, /지번 식별이 불가능해 해당 필지 거래에 포함하지 않았습니다/);
  assert.match(ui, /선택 필지의 거래나 거리순 주변 거래가 아닙니다/);
});
