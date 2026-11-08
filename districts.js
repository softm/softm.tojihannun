/* Viewport overlays. No polygon files or third-party listings are copied into this repo. */
(() => {
  "use strict";
  const C = window.TojiDistrictCore;
  if (!C || !window.ol) return;
  const PAGE_SIZE = 100, MAX_PAGES = 5, MIN_ZOOM = 13;
  const keyName = "tojihannun-district-layers-v1";
  let activeMap, layer, source, hooks, panel, toggle, timer, currentController;
  let revision = 0, features = [], selected = null, pick = false;
  let enabled = true, selectedIds = new Set(C.sources.map(s => s.id));
  const statusById = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(keyName) || "null");
    if (saved && typeof saved.enabled === "boolean") enabled = saved.enabled;
    if (Array.isArray(saved?.ids)) selectedIds = new Set(saved.ids.filter(id => C.sources.some(s => s.id === id)));
  } catch { /* Private mode or corrupt preference: use defaults. */ }
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, callback) => {
    const b = el("button", text); b.type = "button"; b.addEventListener("click", callback); return b;
  };
  function save() {
    try {localStorage.setItem(keyName, JSON.stringify({enabled, ids: [...selectedIds]}));} catch { /* Optional preferences only. */ }
  }
  function setStatus(text, error = false) {
    const out = panel?.querySelector("[data-district-status]");
    if (out) {out.textContent = text; out.dataset.error = String(error);}
    if (toggle) {toggle.dataset.error = String(error); toggle.title = text; toggle.textContent = !enabled ? "구역계 꺼짐" : error ? "구역계 · 확인 필요" : features.length ? `구역계 ${features.length}` : "구역계 켜짐";}
  }
  function external(text, href) {
    const a = el("a", text); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; return a;
  }
  function mapLonLat() {return ol.proj.toLonLat(activeMap.getView().getCenter());}
  function updateLinks() {
    if (!activeMap) return;
    const url = C.naverUrl(mapLonLat(), activeMap.getView().getZoom());
    const mapLink = panel?.querySelector("[data-district-naver]");
    if (mapLink) mapLink.href = url;
    const link = document.querySelector("#parcelNaverLand");
    if (link) {
      const parcel = hooks?.getParcel?.();
      const geometry = parcel && typeof selectionSource !== "undefined" ? selectionSource.getFeatures()[0]?.getGeometry() : null;
      const coords = (geometry ? ol.proj.toLonLat(ol.extent.getCenter(geometry.getExtent())) : null) || parcel?.lonLat || (Number.isFinite(Number(parcel?.lon)) && Number.isFinite(Number(parcel?.lat)) ? [Number(parcel.lon), Number(parcel.lat)] : null);
      link.href = C.naverUrl(coords || mapLonLat(), 18);
      link.title = "네이버 부동산 외부 지도 · 해당 필지 실거래 이력 보장 아님";
    }
  }
  function makePanel() {
    if (panel) return;
    const host = document.querySelector(".map-stage");
    if (!host) return;
    const wrap = el("div", undefined, "district-controls");
    const toolbar = el("div", undefined, "district-toolbar");
    toggle = button(enabled ? "구역계 켜짐" : "구역계 꺼짐", () => {
      enabled = !enabled; save(); toggle.textContent = enabled ? "구역계 켜짐" : "구역계 꺼짐";
      toggle.setAttribute("aria-pressed", String(enabled)); layer?.setVisible(enabled); invalidate();
    });
    toggle.id = "districtToggle"; toggle.setAttribute("aria-pressed", String(enabled));
    const settings = button("구역 목록", () => {
      panel.hidden = !panel.hidden; settings.setAttribute("aria-expanded", String(!panel.hidden));
    });
    settings.setAttribute("aria-controls", "districtPanel"); settings.setAttribute("aria-expanded", "false");
    toolbar.append(toggle, settings); wrap.append(toolbar);
    panel = el("section", undefined, "district-panel"); panel.id = "districtPanel"; panel.hidden = true;
    panel.setAttribute("aria-label", "현재 지도 구역계");
    panel.append(el("h2", "현재 화면의 구역"));
    const filters = el("fieldset"); filters.append(el("legend", "구역 종류"));
    for (const spec of C.sources) {
      const label = el("label"); const input = el("input"); input.type = "checkbox"; input.checked = selectedIds.has(spec.id); input.value = spec.id;
      input.addEventListener("change", () => {input.checked ? selectedIds.add(spec.id) : selectedIds.delete(spec.id); save(); invalidate();});
      const dot = el("span", "●"); dot.style.color = spec.color;
      label.append(input, dot, document.createTextNode(spec.label)); filters.append(label);
    }
    panel.append(filters);
    const mode = el("label", undefined, "district-pick"); const check = el("input"); check.type = "checkbox";
    check.addEventListener("change", () => {pick = check.checked; activeMap?.getTargetElement()?.classList.toggle("district-pick-mode", pick);});
    mode.append(check, document.createTextNode("구역 선택 모드 (끄면 기존 필지 조회)")); panel.append(mode);
    const status = el("p", "지도 범위를 확인하는 중", "district-status"); status.dataset.districtStatus = ""; status.setAttribute("role", "status"); panel.append(status);
    const statuses = el("div", undefined, "district-source-status"); statuses.dataset.sources = ""; panel.append(statuses);
    const list = el("div", undefined, "district-list"); list.dataset.districtList = ""; panel.append(list);
    const detail = el("section", undefined, "district-detail"); detail.dataset.districtDetail = ""; detail.hidden = true; panel.append(detail);
    const actions = el("div", undefined, "district-links");
    actions.append(button("현재 범위 다시 조회", invalidate));
    const nav = external("현재 위치 네이버 부동산 ↗", "https://fin.land.naver.com/map"); nav.dataset.districtNaver = ""; actions.append(nav); panel.append(actions);
    panel.append(el("p", "출처: 국토교통부 공간정보 오픈플랫폼 VWorld. 후보지·공람안은 누락될 수 있습니다. 화면의 선은 편입·제척을 확정하는 자료가 아닙니다. 최신 고시 도면·조서를 확인하세요.", "district-disclaimer"));
    wrap.append(panel); document.body.append(wrap);
    const detailActions = document.querySelector(".detail-title-actions");
    if (detailActions && !document.getElementById("parcelNaverLand")) {
      const navParcel = external("네이버 부동산 ↗", "https://fin.land.naver.com/map"); navParcel.id = "parcelNaverLand"; navParcel.className = "district-parcel-link"; detailActions.prepend(navParcel);
      const title = document.getElementById("detailTitle");
      if (title) new MutationObserver(updateLinks).observe(title, {childList: true, characterData: true, subtree: true});
    }
  }
  function featureStyle(feature, resolution) {
    const spec = feature.get("districtSpec"); const meta = feature.get("districtMeta");
    const chosen = feature === selected;
    const styles = [new ol.style.Style({stroke: new ol.style.Stroke({color: spec.color, width: chosen ? 4 : 2}), fill: new ol.style.Fill({color: spec.color + (chosen ? "30" : "16")})})];
    if (resolution < 20 || chosen) {
      const geometry = feature.getGeometry();
      const labelGeometry = geometry.getType() === "MultiPolygon" ? geometry.getPolygons().sort((a,b) => b.getArea()-a.getArea())[0]?.getInteriorPoint() : geometry.getInteriorPoint();
      if (labelGeometry) styles.push(new ol.style.Style({geometry: labelGeometry, text: new ol.style.Text({text: meta.name + "\n" + meta.type, font: "600 12px 'Noto Sans KR', sans-serif", fill: new ol.style.Fill({color: spec.color}), stroke: new ol.style.Stroke({color: "#ffffff", width: 4}), backgroundFill: new ol.style.Fill({color: "rgba(255,255,255,.92)"}), padding: [4,6,4,6], overflow: true})}));
    }
    return styles;
  }
  function renderList() {
    const list = panel.querySelector("[data-district-list]"); list.replaceChildren();
    for (const feature of features.slice(0, 200)) {
      const meta = feature.get("districtMeta");
      const b = button(meta.name + " · " + meta.type, () => selectFeature(feature));
      b.style.borderLeftColor = feature.get("districtSpec").color; list.append(b);
    }
    if (features.length > 200) list.append(el("p", "목록은 200건까지 표시합니다. 지도를 확대해 주세요."));
    const reports = panel.querySelector("[data-sources]"); reports.replaceChildren();
    for (const spec of C.sources.filter(s => selectedIds.has(s.id))) {
      const report = statusById.get(spec.id);
      reports.append(el("p", `${spec.label}: ${report || "조회 대기"}`));
    }
  }
  function selectFeature(feature) {
    selected = feature; layer.changed(); panel.hidden = false;
    document.querySelector('[aria-controls="districtPanel"]')?.setAttribute("aria-expanded", "true");
    const detail = panel.querySelector("[data-district-detail]"); detail.hidden = false; detail.replaceChildren();
    const meta = feature.get("districtMeta"), spec = feature.get("districtSpec");
    detail.append(el("h3", meta.name));
    const dl = el("dl");
    for (const [title, text] of [["구역 유형", meta.type], ["진행단계", meta.stage], ["경계 기준", meta.boundary], ["원본 기준일", meta.date], ["고시번호", meta.notice], ["조회 시각", feature.get("fetchedAt")]]) dl.append(el("dt", title), el("dd", text));
    detail.append(dl);
    const raw = el("details"); raw.append(el("summary", "제공기관 원본 속성"));
    const pre = el("pre", JSON.stringify(feature.get("rawProperties"), null, 2)); raw.append(pre); detail.append(raw);
    detail.append(external("VWorld 출처 확인 ↗", spec.sourceUrl), external("토지이음 공식 확인 ↗", "https://www.eum.go.kr/"));
    detail.append(button("구역 전체 보기", () => activeMap.getView().fit(feature.getGeometry().getExtent(), {padding: [100, 80, 120, 80], maxZoom: 17, duration: 250})));
    detail.append(button("상세 닫기", () => {selected = null; detail.hidden = true; layer.changed();}));
  }
  function jsonp(url, signal) {
    return new Promise((resolve, reject) => {
      const name = "tojiDistrict" + Date.now() + Math.random().toString(36).slice(2);
      const script = document.createElement("script"); let timer;
      const cleanup = () => {clearTimeout(timer); script.remove(); signal.removeEventListener("abort", aborted); window[name] = () => {}; setTimeout(() => {delete window[name];}, 30000);};
      const aborted = () => {cleanup(); reject(new DOMException("Aborted", "AbortError"));};
      if (signal.aborted) {aborted(); return;}
      window[name] = data => {cleanup(); resolve(data);};
      script.onerror = () => {cleanup(); reject(new Error("구역 제공기관 연결 실패"));};
      timer = setTimeout(() => {cleanup(); reject(new Error("구역 조회 시간 초과"));}, 14000);
      signal.addEventListener("abort", aborted, {once: true});
      url.searchParams.set("callback", name); script.src = url.href; document.head.append(script);
    });
  }
  async function request(spec, extent, page, signal) {
    const geographic = ol.proj.transformExtent(extent, "EPSG:3857", "EPSG:4326");
    let url;
    if (spec.kind === "data") {
      url = new URL(hooks.useJsonp ? "https://api.vworld.kr/req/data" : "/api/vworld/data", location.origin);
      url.search = new URLSearchParams({service: "data", version: "2.0", request: "GetFeature", data: spec.layer, geomFilter: `BOX(${geographic.join(",")})`, crs: "EPSG:4326", format: "json", size: String(PAGE_SIZE), page: String(page), geometry: "true", attribute: "true"});
    } else {
      url = new URL(hooks.useJsonp ? `https://api.vworld.kr/ned/wfs/${spec.operation}` : `/api/vworld/ned/${spec.operation}`, location.origin);
      url.search = new URLSearchParams({typename: spec.layer, bbox: extent.join(",") + ",EPSG:3857", srsName: "EPSG:3857", maxFeatures: String(PAGE_SIZE), output: "application/json"});
    }
    if (hooks.useJsonp) {url.searchParams.set("key", hooks.key); url.searchParams.set("domain", location.hostname);}
    if (spec.kind === "data" && hooks.useJsonp) return jsonp(url, signal);
    // NED WFS is not assumed to support JSONP. Do not execute a JSON response as a script.
    const response = await fetch(url, {signal: AbortSignal.any([signal, AbortSignal.timeout(14000)])});
    if (!response.ok) throw new Error(`제공기관 HTTP ${response.status}`);
    return response.json();
  }
  async function loadSource(spec, extent, signal) {
    const result = [], seen = new Set(); let limited = false;
    for (let page = 1; page <= (spec.kind === "data" ? MAX_PAGES : 1); page++) {
      const answer = C.unpack(await request(spec, extent, page, signal));
      let added = 0;
      for (const f of C.polygonFeatures(answer.features)) {
        const id = String(f.id ?? JSON.stringify([f.properties, f.geometry]));
        if (!seen.has(id)) {seen.add(id); result.push(f); added++;}
      }
      if (spec.kind !== "data") {limited = answer.total !== null ? answer.total > result.length : answer.features.length >= PAGE_SIZE; break;}
      if (answer.total !== null && page * PAGE_SIZE >= answer.total) break;
      if (answer.features.length < PAGE_SIZE) break;
      if (added === 0 || page === MAX_PAGES) {limited = true; break;}
    }
    return {items: result, limited};
  }
  function invalidate() {
    revision++; currentController?.abort(); clearTimeout(timer);
    // Old polygons must not remain selectable after a viewport/filter change.
    source?.clear(); features = []; selected = null; statusById.clear();
    panel?.querySelector("[data-district-detail]")?.setAttribute("hidden", "");
    if (panel) renderList();
    timer = setTimeout(() => refresh(revision), 350);
  }
  async function refresh(id) {
    if (!activeMap || !panel || id !== revision) return;
    updateLinks();
    if (!enabled) {setStatus("구역계 표시가 꺼져 있습니다."); return;}
    if (!selectedIds.size) {setStatus("표시할 구역 종류를 선택하세요."); return;}
    const extent = activeMap.getView().calculateExtent(activeMap.getSize());
    if (activeMap.getView().getZoom() < MIN_ZOOM || extent[2]-extent[0] > 60000 || extent[3]-extent[1] > 60000) {setStatus("지도를 확대하면 현재 범위의 구역계를 조회합니다."); return;}
    C.boundsKey(extent, selectedIds); // Validate the full viewport rectangle.
    currentController = new AbortController(); const signal = currentController.signal;
    setStatus("현재 화면과 겹치는 구역을 조회하고 있습니다…");
    const specs = C.sources.filter(s => selectedIds.has(s.id));
    const answers = await Promise.allSettled(specs.map(s => loadSource(s, extent, signal)));
    if (signal.aborted || id !== revision) return;
    let failed = 0, limited = false;
    const formatter = new ol.format.GeoJSON();
    answers.forEach((answer, index) => {
      const spec = specs[index];
      if (answer.status === "rejected") {failed++; statusById.set(spec.id, "조회 실패 · 자료 미확인"); return;}
      limited ||= answer.value.limited;
      let count = 0;
      for (const item of answer.value.items) {
        try {
          const f = formatter.readFeature(item, {dataProjection: spec.projection, featureProjection: "EPSG:3857"});
          if (!f.getGeometry().intersectsExtent(extent)) continue;
          f.setProperties({districtSpec: spec, districtMeta: C.metadata(item.properties, spec), rawProperties: item.properties || {}, fetchedAt: new Date().toLocaleString("ko-KR")});
          features.push(f); count++;
        } catch {limited = true;}
      }
      statusById.set(spec.id, `${count}개 도형${answer.value.limited ? " · 일부만 수신, 확대 필요" : ""}`);
    });
    source.clear(); source.addFeatures(features); renderList();
    const message = failed === specs.length ? "구역 자료를 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 조회하세요." : `${features.length}개 구역 도형 표시${failed ? ` · ${failed}종 조회 실패` : ""}${limited ? " · 일부 결과, 확대 필요" : ""}${!features.length ? " · 미등록 후보지·구역이 있을 수 있습니다" : ""}`;
    setStatus(message, failed > 0 || limited);
  }
  function attach(mapObject, options) {
    if (activeMap === mapObject) return;
    if (activeMap) {activeMap.un("moveend", invalidate); currentController?.abort(); activeMap.removeLayer(layer);}
    activeMap = mapObject; hooks = options; source = new ol.source.Vector();
    layer = new ol.layer.Vector({source, style: featureStyle, declutter: true, zIndex: 12, visible: enabled});
    layer.set("name", "district-boundaries"); activeMap.addLayer(layer);
    makePanel(); activeMap.on("moveend", invalidate); invalidate();
  }
  function handleMapClick(event) {
    if (!enabled || !pick || !activeMap) return false;
    const hits = [];
    activeMap.forEachFeatureAtPixel(event.pixel, (feature, hitLayer) => {if (hitLayer === layer) hits.push(feature);}, {hitTolerance: 6, layerFilter: candidate => candidate === layer});
    if (!hits.length) return false;
    // Prefer the smallest overlapping district; all other hits remain reachable in the list.
    hits.sort((a,b) => a.getGeometry().getArea()-b.getGeometry().getArea()); selectFeature(hits[0]); return true;
  }
  window.TojiDistricts = Object.freeze({attach, handleMapClick, refresh: invalidate});
  if (typeof selectionSource !== "undefined") selectionSource.on("change", updateLinks);
  // app.js may have already initialized when deferred extension scripts finish loading.
  if (typeof map !== "undefined" && map && typeof VWORLD_BROWSER_KEY !== "undefined") {
    attach(map, {key: VWORLD_BROWSER_KEY, useJsonp: USE_VWORLD_JSONP, getParcel: () => state.records.find(item => item.id === state.selectedId)});
  }
})();
