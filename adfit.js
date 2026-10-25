/** SOFTM-ADFIT-RUNTIME START 날짜:20261012 : 돌봄한눈과 같은 검증·지연요청·실패정리 기준으로 패널 광고를 안전하게 관리 */
(function (root) {
  "use strict";

  const states = new Map();
  const appWithNativeAds = /\bAdMobNative\/\d+\b/.test(root.navigator?.userAgent || "");
  const callbackNames = Object.freeze({
    searchPanel: {failed: "tojihannunSearchPanelAdFailed", loaded: "tojihannunSearchPanelAdLoaded"},
    list1: {failed: "tojihannunList1AdFailed", loaded: "tojihannunList1AdLoaded"},
    list2: {failed: "tojihannunList2AdFailed", loaded: "tojihannunList2AdLoaded"},
    parcelDetail: {failed: "tojihannunParcelDetailAdFailed", loaded: "tojihannunParcelDetailAdLoaded"}
  });

  function config() {
    return root.TOJIHANNUN_AD_CONFIG || {};
  }

  function validSlot(slot) {
    return /^DAN-[A-Za-z0-9]+$/.test(String(slot?.unit || "").trim())
      && Number(slot?.width) === 320
      && Number(slot?.height) === 100;
  }

  function hide(state) {
    root.clearTimeout(state.timeout);
    state.failed = true;
    state.zone.hidden = true;
    state.host.replaceChildren();
  }

  function load(state) {
    if (state.requested || state.failed || root.document.hidden) return;
    const settings = config();
    const slot = settings.placements?.[state.placement];
    if (!settings.enabled || appWithNativeAds || !validSlot(slot) || state.host.clientWidth < slot.width) {
      hide(state);
      return;
    }

    state.requested = true;
    state.zone.hidden = false;
    state.zone.dataset.state = "loading";

    const ad = root.document.createElement("ins");
    ad.className = "kakao_ad_area";
    ad.style.display = "none";
    ad.style.width = "100%";
    ad.dataset.adUnit = slot.unit;
    ad.dataset.adWidth = String(slot.width);
    ad.dataset.adHeight = String(slot.height);
    ad.dataset.adOnfail = callbackNames[state.placement].failed;
    ad.dataset.adOnload = callbackNames[state.placement].loaded;
    state.ad = ad;
    state.host.appendChild(ad);

    const script = root.document.createElement("script");
    script.async = true;
    script.charset = "utf-8";
    script.src = settings.script || "https://t1.kakaocdn.net/kas/static/ba.min.js";
    script.onerror = () => hide(state);
    script.onload = () => {
      state.timeout = root.setTimeout(() => {
        if (!state.host.querySelector("iframe")) hide(state);
      }, 30000);
    };
    root.document.head.appendChild(script);
  }

  function observe(state) {
    if (!root.IntersectionObserver) {
      load(state);
      return;
    }
    state.observer = new root.IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      state.observer.disconnect();
      load(state);
    }, {rootMargin: "200px 0px"});
    state.observer.observe(state.zone);
  }

  function register(id, placement, immediate = false) {
    const zone = root.document.getElementById(id);
    const host = zone?.querySelector("[data-adfit-host]");
    if (!zone || !host || states.has(placement)) return;
    const state = {zone, host, placement, requested: false, failed: false, ad: null, timeout: 0, observer: null};
    states.set(placement, state);
    if (!config().enabled || appWithNativeAds || !validSlot(config().placements?.[placement])) {
      hide(state);
      return;
    }
    if (placement.startsWith("list")) {
      observe(state);
      return;
    }
    zone.hidden = false;
    if (immediate) root.requestAnimationFrame(() => load(state));
    else observe(state);
  }

  function showParcelDetail() {
    const state = states.get("parcelDetail");
    if (state) {
      if (!state.requested && !state.failed) root.requestAnimationFrame(() => load(state));
      return;
    }
    register("parcelDetailAd", "parcelDetail", true);
  }

  for (const [placement, names] of Object.entries(callbackNames)) {
    root[names.failed] = ad => {
      const state = states.get(placement);
      if (state?.ad === ad) hide(state);
    };
    root[names.loaded] = ad => {
      const state = states.get(placement);
      if (state?.ad !== ad || state.failed) return;
      root.clearTimeout(state.timeout);
      state.zone.dataset.state = "loaded";
    };
  }

  function init() {
    register("searchPanelAd", "searchPanel");
    register("listAd1", "list1");
    register("listAd2", "list2");
    root.document.addEventListener("visibilitychange", () => {
      if (root.document.hidden) return;
      for (const state of states.values()) if (state.requested === false && state.failed === false) load(state);
    });
  }

  root.TojihannunAds = Object.freeze({init, showParcelDetail});
})(typeof window === "undefined" ? globalThis : window);
/** SOFTM-ADFIT-RUNTIME END */
