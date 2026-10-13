import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const runtime = fs.readFileSync(new URL("../adfit.js", import.meta.url), "utf8");

function setup({userAgent = "Browser/1", searchUnit = "DAN-searchPanel1", detailUnit = "DAN-parcelDetail1"} = {}) {
  class Element {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.hidden = true;
      this.clientWidth = 340;
    }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    querySelector(selector) {
      if (selector === "[data-adfit-host]") return this.host || null;
      if (selector === "iframe") return this.children.find(child => child.tagName === "IFRAME") || null;
      return null;
    }
  }

  const searchHost = new Element();
  const detailHost = new Element();
  const searchZone = new Element("aside");
  const detailZone = new Element("aside");
  searchZone.host = searchHost;
  detailZone.host = detailHost;
  const elements = new Map([["searchPanelAd", searchZone], ["parcelDetailAd", detailZone]]);
  const head = new Element("head");
  const document = {
    hidden: false,
    head,
    getElementById: id => elements.get(id) || null,
    createElement: tagName => new Element(tagName),
    addEventListener() {}
  };
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback([{isIntersecting: true}]); }
    disconnect() {}
  }
  const scope = {
    console,
    document,
    navigator: {userAgent},
    IntersectionObserver,
    Map,
    Object,
    clearTimeout() {},
    setTimeout() { return 1; },
    requestAnimationFrame(callback) { callback(); },
    TOJIHANNUN_AD_CONFIG: {
      enabled: true,
      script: "https://example.test/adfit.js",
      placements: {
        searchPanel: {unit: searchUnit, width: 320, height: 100},
        parcelDetail: {unit: detailUnit, width: 320, height: 100}
      }
    }
  };
  scope.window = scope;
  scope.globalThis = scope;
  vm.runInContext(runtime, vm.createContext(scope));
  return {scope, head, searchZone, searchHost, detailZone, detailHost};
}

test("검색과 상세 지면은 서로 다른 콜백과 광고 단위로 한 번씩 요청한다", () => {
  const state = setup();
  state.scope.TojihannunAds.init();
  assert.equal(state.searchZone.hidden, false);
  assert.equal(state.searchHost.children.length, 1);
  assert.equal(state.searchHost.children[0].dataset.adUnit, "DAN-searchPanel1");
  assert.equal(state.searchHost.children[0].dataset.adOnfail, "tojihannunSearchPanelAdFailed");
  assert.equal(state.head.children.length, 1);

  state.scope.TojihannunAds.showParcelDetail();
  assert.equal(state.detailZone.hidden, false);
  assert.equal(state.detailHost.children[0].dataset.adUnit, "DAN-parcelDetail1");
  assert.equal(state.detailHost.children[0].dataset.adOnfail, "tojihannunParcelDetailAdFailed");
  assert.equal(state.head.children.length, 2);

  state.scope.TojihannunAds.showParcelDetail();
  assert.equal(state.head.children.length, 2);
});

test("NO-AD 콜백은 해당 광고 지면만 제거한다", () => {
  const state = setup();
  state.scope.TojihannunAds.init();
  state.scope.TojihannunAds.showParcelDetail();
  state.scope.tojihannunSearchPanelAdFailed(state.searchHost.children[0]);
  assert.equal(state.searchZone.hidden, true);
  assert.equal(state.searchHost.children.length, 0);
  assert.equal(state.detailZone.hidden, false);
});

test("AdMob 앱 User-Agent와 잘못된 광고 ID에서는 Web 광고를 요청하지 않는다", () => {
  const app = setup({userAgent: "Browser/1 AdMobNative/1"});
  app.scope.TojihannunAds.init();
  app.scope.TojihannunAds.showParcelDetail();
  assert.equal(app.head.children.length, 0);
  assert.equal(app.searchZone.hidden, true);
  assert.equal(app.detailZone.hidden, true);

  const invalid = setup({searchUnit: "", detailUnit: "not-an-ad-unit"});
  invalid.scope.TojihannunAds.init();
  invalid.scope.TojihannunAds.showParcelDetail();
  assert.equal(invalid.head.children.length, 0);
});
