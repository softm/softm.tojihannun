import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("function parcelAddressKey(");
const end = source.indexOf("function showSelectedParcel(", start);
assert.ok(start >= 0 && end > start, "parcel address helpers must exist");

function setup({searchResults = [], searchItems = [], reverse = []} = {}) {
  const state = {
    records: [],
    selectedId: "test-parcel",
    searchResults,
    favorites: new Set()
  };
  const detailRoad = {textContent: ""};
  const copyRoadAddress = {disabled: true};
  let queries = 0;
  let persists = 0;
  const context = {
    cleanText: (v) => String(v || "").trim(),
    state,
    $: (selector) => selector === "#detailRoad" ? detailRoad : selector === "#copyRoadAddress" ? copyRoadAddress : assert.fail(`unexpected selector: ${selector}`),
    searchVWorld: async (query, mode) => {
      queries++;
      assert.equal(mode, "lot");
      return searchItems;
    },
    reverseGeocode: async () => reverse,
    persistRecentParcels: () => {persists++;},
    persistFavorites: () => {},
    render: () => {},
    console
  };
  const handlers = runInNewContext(
    `${source.slice(start, end)}\n({parcelAddressKey, isSameParcelAddress, applyVerifiedRoadAddress, resolveParcelRoadAddress, addOrUpdateRecord})`,
    context
  );
  return {state, detailRoad, copyRoadAddress, handlers, getQueries: () => queries, getPersists: () => persists};
}

function parcel() {
  return {
    id: "test-parcel",
    pnu: "4119410600107420001",
    address: "경기도 부천시 소사구 옥길동 742-1",
    road: "",
    lon: 126.825,
    lat: 37.466
  };
}

const matching = {
  pnu: "4119410600107420001",
  parcel: "경기도 부천시 옥길동 742-1",
  road: "경기도 부천시 소사구 양지로 234-10",
  lon: 126.825,
  lat: 37.466
};

test("road address is matched to the exact PNU or compatible parcel/city, not just nearby buildings", () => {
  const {handlers} = setup();
  const p = parcel();
  assert.equal(handlers.isSameParcelAddress(p, matching), true);
  assert.equal(handlers.isSameParcelAddress(p, {...matching, pnu: "4119410600107420002"}), false);
  assert.equal(handlers.isSameParcelAddress(p, {parcel: "경기도 부천시 옥길동 742-1"}), true);
  assert.equal(handlers.isSameParcelAddress(p, {parcel: "경기도 성남시 옥길동 742-1"}), false);
  assert.equal(handlers.isSameParcelAddress(p, {parcel: "경기도 부천시 옥길동 743-1"}), false);
});

test("uses a verified existing search result before issuing any additional request", async () => {
  const h = setup({searchResults: [matching]});
  const p = parcel();
  h.state.records.push(p);
  await h.handlers.resolveParcelRoadAddress(p);
  assert.equal(p.road, matching.road);
  assert.equal(h.detailRoad.textContent, matching.road);
  assert.equal(h.copyRoadAddress.disabled, false);
  assert.equal(h.getQueries(), 0);
});

test("forward parcel lookup ignores addresses of different parcels", async () => {
  const h = setup({searchItems: [
    {...matching, pnu: "4119410600107420002", road: "다른 필지의 도로명주소"},
    matching
  ]});
  const p = parcel();
  h.state.records.push(p);
  await h.handlers.resolveParcelRoadAddress(p);
  assert.equal(p.road, matching.road);
  assert.equal(h.getQueries(), 1);
  assert.ok(h.getPersists() > 0);
});

test("missing lookup results are not misrepresented as a parcel without a road address", async () => {
  const h = setup({searchItems: []});
  const p = parcel();
  h.state.records.push(p);
  await h.handlers.resolveParcelRoadAddress(p);
  assert.equal(p.road, "");
  assert.equal(h.detailRoad.textContent, "도로명주소를 조회하지 못했습니다.");
  assert.equal(h.copyRoadAddress.disabled, true);
});

test("reselecting a parcel does not erase a previously verified road address", () => {
  const h = setup();
  h.state.records.push({...parcel(), road: matching.road});
  const merged = h.handlers.addOrUpdateRecord(parcel());
  assert.equal(merged.road, matching.road);
  assert.equal(h.state.records[0].road, matching.road);
});
