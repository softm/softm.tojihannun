const {Map: OLMap, View, Feature} = ol;
const TileLayer = ol.layer.Tile;
const VectorLayer = ol.layer.Vector;
const XYZ = ol.source.XYZ;
const TileWMS = ol.source.TileWMS;
const VectorSource = ol.source.Vector;
const Point = ol.geom.Point;
const GeoJSON = ol.format.GeoJSON;
const {fromLonLat, toLonLat} = ol.proj;
const defaultControls = ol.control.defaults.defaults;
const Style = ol.style.Style;
const Stroke = ol.style.Stroke;
const Fill = ol.style.Fill;
const CircleStyle = ol.style.Circle;
const Text = ol.style.Text;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const API_BASE = "/api/vworld";
// VWorld 브라우저 키는 등록 도메인에서만 동작하는 공개 클라이언트 식별자다.
const VWORLD_BROWSER_KEY = "BC222DE5-514C-4E8A-A143-73DD322834D1";
const USE_VWORLD_JSONP = window.location.hostname === "tojihannun.designboard.net" || window.location.hostname.endsWith(".github.io");
const EUM_DETAIL_URL = "https://www.eum.go.kr/web/ar/lu/luLandDet.jsp";
const FAVORITES_KEY = "tojihannun-vworld-favorites-v1";
const FIELD_RECORDS_KEY = "tojihannun-field-records-v1";
const FIELD_ITEMS = [
  ["vehicleAccess", "차량 진입"],
  ["drainage", "배수"],
  ["waterSupply", "급수"],
  ["actualUse", "실제 이용 상태"]
];
const FIELD_STATUSES = [
  ["unknown", "미확인"],
  ["confirmed", "확인"],
  ["needs_review", "추가 확인 필요"]
];

const state = {
  mapMode: "normal",
  detailTab: "register",
  filter: "all",
  view: "map",
  searchMode: "all",
  selectedId: null,
  records: [],
  favorites: new Set(),
  compareIds: new Set(),
  searchResults: [],
  loadingParcel: false
};

let map;
let baseLayer;
let satelliteLayer;
let hybridLayer;
let cadastralLayer;
let markerLayer;
let selectionLayer;
let baseSource;
let satelliteSource;
let hybridSource;
let cadastralSource;
let mapErrorCount = 0;
let toastTimer;

const markerSource = new VectorSource();
const selectionSource = new VectorSource();
const geoJson = new GeoJSON();
const parcelFeatureCache = new Map();

function markerStyle(feature) {
  const label = feature.get("label") || "";
  const onImagery = state.mapMode !== "normal";
  return new Style({
    image: new CircleStyle({
      radius: 17,
      fill: new Fill({color: onImagery ? "#f51d76" : "#176b54"}),
      stroke: new Stroke({color: "#ffffff", width: 4})
    }),
    text: new Text({
      text: label.length > 6 ? "●" : label,
      font: "700 10px 'Noto Sans KR', sans-serif",
      fill: new Fill({color: "#ffffff"})
    })
  });
}

const normalSelectionStyle = new Style({
  fill: new Fill({color: "rgba(30, 133, 98, 0.20)"}),
  stroke: new Stroke({color: "#0b7555", width: 4})
});

const imagerySelectionStyle = [
  new Style({
    stroke: new Stroke({color: "rgba(255, 255, 255, 0.96)", width: 9})
  }),
  new Style({
    fill: new Fill({color: "rgba(245, 29, 118, 0.22)"}),
    stroke: new Stroke({color: "#f51d76", width: 5})
  })
];

function selectionStyleForMode() {
  return state.mapMode === "normal" ? normalSelectionStyle : imagerySelectionStyle;
}

function initMap() {
  if (map) map.setTarget(undefined);
  $("#mapLoading").hidden = false;
  $("#mapError").hidden = true;
  mapErrorCount = 0;

  baseSource = new XYZ({
    url: "https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png",
    maxZoom: 19,
    transition: 0,
    attributions: "© VWorld"
  });
  satelliteSource = new XYZ({
    url: "https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg",
    maxZoom: 19,
    transition: 0,
    attributions: "© VWorld"
  });
  hybridSource = new XYZ({
    url: "https://xdworld.vworld.kr/2d/Hybrid/service/{z}/{x}/{y}.png",
    maxZoom: 19,
    transition: 0,
    attributions: "© VWorld"
  });

  const wmsParams = {
    LAYERS: "lp_pa_cbnd_bonbun,lp_pa_cbnd_bubun",
    STYLES: "lp_pa_cbnd_bonbun,lp_pa_cbnd_bubun",
    FORMAT: "image/png",
    TRANSPARENT: true,
    VERSION: "1.3.0"
  };
  const cadastralOptions = {
    url: USE_VWORLD_JSONP
      ? `https://api.vworld.kr/req/wms?key=${encodeURIComponent(VWORLD_BROWSER_KEY)}&domain=${encodeURIComponent(window.location.hostname)}`
      : `${API_BASE}/wms`,
    params: wmsParams,
    transition: 0
  };
  if (!USE_VWORLD_JSONP) cadastralOptions.crossOrigin = "anonymous";
  cadastralSource = new TileWMS(cadastralOptions);

  baseLayer = new TileLayer({source: baseSource, visible: true, preload: 0, useInterimTilesOnError: false});
  satelliteLayer = new TileLayer({source: satelliteSource, visible: false, preload: 0, useInterimTilesOnError: false});
  hybridLayer = new TileLayer({source: hybridSource, visible: false, preload: 0, useInterimTilesOnError: false});
  cadastralLayer = new TileLayer({source: cadastralSource, visible: false, opacity: 0.88, preload: 0, useInterimTilesOnError: false});
  markerLayer = new VectorLayer({source: markerSource, style: markerStyle, zIndex: 20});
  selectionLayer = new VectorLayer({source: selectionSource, style: selectionStyleForMode, zIndex: 18});

  map = new OLMap({
    target: "vworldMap",
    controls: defaultControls({zoom: false, rotate: false}),
    layers: [baseLayer, satelliteLayer, hybridLayer, cadastralLayer, selectionLayer, markerLayer],
    view: new View({
      center: fromLonLat([126.978, 37.5665]),
      zoom: 12,
      minZoom: 6,
      maxZoom: 19,
      constrainResolution: true
    })
  });

  map.once("rendercomplete", () => {
    $("#mapLoading").hidden = true;
  });
  [baseSource, satelliteSource].forEach((source) => {
    source.on("tileloadend", () => { $("#mapLoading").hidden = true; });
    source.on("tileloaderror", () => {
      mapErrorCount += 1;
      if (mapErrorCount >= 6) showMapError("VWorld 배경지도 연결을 확인해 주세요.");
    });
  });
  cadastralSource.on("tileloaderror", () => {
    if (state.mapMode === "cadastral") {
      showToast("지적도 레이어를 불러오지 못했어요. 인증키와 등록 도메인을 확인해 주세요.");
    }
  });
  map.on("singleclick", handleMapClick);

  window.setTimeout(() => { $("#mapLoading").hidden = true; }, 7000);
  setMapMode(state.mapMode, false);
  restoreFavorites();
  render();

}

function showMapError(message) {
  $("#mapLoading").hidden = true;
  $("#mapErrorMessage").textContent = message;
  $("#mapError").hidden = false;
}

function setMapMode(mode, announce = true) {
  state.mapMode = mode;
  if (!map) return;
  baseLayer.setVisible(mode === "normal");
  satelliteLayer.setVisible(mode !== "normal");
  hybridLayer.setVisible(mode === "satellite");
  cadastralLayer.setVisible(mode === "cadastral");
  selectionLayer.changed();
  markerLayer.changed();
  $$("[data-map-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mapMode === mode));
  $("#vworldMap").classList.add("parcel-pick-mode");
  if (announce) {
    const labels = {normal: "일반지도로 전환했어요.", satellite: "위성지도로 전환했어요.", cadastral: "위성지도에 연속지적도를 표시했어요."};
    showToast(labels[mode]);
  }
}

async function handleMapClick(event) {
  const hit = map.forEachFeatureAtPixel(event.pixel, (feature) => feature, {hitTolerance: 8});
  if (hit?.get("recordId")) {
    const record = state.records.find((item) => item.id === hit.get("recordId"));
    if (record) openDetail(record);
    return;
  }
  if (state.loadingParcel) return;
  const lonLat = toLonLat(event.coordinate);
  await inspectParcel(lonLat, null);
}

function apiUrl(path, params) {
  const url = new URL(`${API_BASE}/${path}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url;
}

async function fetchJson(url, timeout = 12000) {
  if (USE_VWORLD_JSONP && url.pathname.startsWith(`${API_BASE}/`)) return fetchVWorldJsonp(url, timeout);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {signal: controller.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

let jsonpSequence = 0;

function directVWorldUrl(proxyUrl) {
  const relativePath = proxyUrl.pathname.slice(`${API_BASE}/`.length);
  const nedMatch = relativePath.match(/^ned\/([A-Za-z]+)$/);
  const target = new URL(nedMatch
    ? `https://api.vworld.kr/ned/data/${nedMatch[1]}`
    : `https://api.vworld.kr/req/${relativePath}`);
  proxyUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));
  if (nedMatch) target.searchParams.set("format", "json");
  target.searchParams.set("key", VWORLD_BROWSER_KEY);
  target.searchParams.set("domain", window.location.hostname);
  return target;
}

function fetchVWorldJsonp(proxyUrl, timeout) {
  return new Promise((resolve, reject) => {
    const callbackName = `tojihannunVWorld${Date.now()}${jsonpSequence += 1}`;
    const target = directVWorldUrl(proxyUrl);
    target.searchParams.set("callback", callbackName);
    const script = document.createElement("script");
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      script.remove();
      delete window[callbackName];
    };
    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("VWorld JSONP 연결에 실패했습니다."));
    };
    timer = window.setTimeout(() => {
      cleanup();
      reject(new DOMException("VWorld 요청 시간이 초과되었습니다.", "TimeoutError"));
    }, timeout);
    script.src = target.toString();
    document.head.append(script);
  });
}

function buildEumLandUseParams(pnu) {
  if (!/^\d{19}$/.test(String(pnu || ""))) throw new Error("19자리 PNU가 필요합니다.");
  return new URLSearchParams({
    selGbn: "umd",
    isNoScr: "script",
    s_type: "1",
    viewType: "",
    p_location: "",
    p_type: "",
    p_type1: "",
    p_type2: "",
    p_type3: "",
    p_type4: "",
    p_type5: "",
    p_type6: "",
    p_type7: "",
    mode: "search",
    sggcd: "",
    pnu,
    ucodes: "",
    markUcodes: "",
    adzoom: "",
    scale: "",
    scaleFlag: "",
    hash: "",
    mobile_yn: "",
    add: "land",
    selSido: pnu.slice(0, 2),
    selSgg: pnu.slice(2, 5),
    selUmd: pnu.slice(4, 8),
    selRi: pnu.slice(8, 10),
    landGbn: pnu.slice(10, 11),
    bobn: String(Number(pnu.slice(11, 15))),
    bubn: String(Number(pnu.slice(15, 19)))
  });
}

async function decodeHtmlResponse(response) {
  const bytes = await response.arrayBuffer();
  const charset = /euc-kr/i.test(response.headers.get("content-type") || "") ? "euc-kr" : "utf-8";
  return new TextDecoder(charset).decode(bytes);
}

async function fetchEumLandUseHtml(pnu) {
  const proxyUrl = new URL("/api/eum/land-use", window.location.origin);
  proxyUrl.searchParams.set("pnu", pnu);
  try {
    const response = await fetch(proxyUrl, {signal: AbortSignal.timeout(22000)});
    if (response.ok && /text\/html/i.test(response.headers.get("content-type") || "")) return await decodeHtmlResponse(response);
  } catch {
    // 정적 호스팅에서는 서버 프록시가 없으므로 토지이음의 CORS 허용 응답을 직접 조회한다.
  }
  const response = await fetch(EUM_DETAIL_URL, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: buildEumLandUseParams(pnu),
    signal: AbortSignal.timeout(22000)
  });
  if (!response.ok) throw new Error(`토지이음 HTTP ${response.status}`);
  return await decodeHtmlResponse(response);
}

function cleanNodeText(node) {
  return String(node?.textContent || "").replace(/\s+/g, " ").trim();
}

function parseEumZoneGroup(documentNode, id, category) {
  const container = documentNode.querySelector(`#${id}`);
  if (!container) return [];
  const linkedZones = [...container.children].filter((node) => node.matches?.("a.link")).map((link) => {
    let layer = link.nextElementSibling;
    while (layer && !layer.classList.contains("layer_pop")) layer = layer.nextElementSibling;
    const code = link.getAttribute("onclick")?.match(/live_layer_([A-Z0-9]+)/)?.[1] || "";
    return {
      category,
      code,
      name: cleanNodeText(link),
      description: cleanNodeText(layer?.querySelector(".layer_body strong"))
    };
  }).filter((item) => item.name);
  const visibleClone = container.cloneNode(true);
  visibleClone.querySelectorAll(".layer_pop, input").forEach((node) => node.remove());
  const plainZones = cleanNodeText(visibleClone).split(/\s*,\s*/).map((name) => name.trim()).filter(Boolean)
    .filter((name) => !linkedZones.some((item) => item.name === name))
    .map((name) => ({category, code: "", name, description: ""}));
  return [...linkedZones, ...plainZones].filter((item, index, items) => items.findIndex((candidate) => candidate.name === item.name) === index);
}

function parseEumLandUseHtml(html, pnu) {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const responsePnu = documentNode.querySelector("#pnu")?.value || "";
  if (responsePnu !== pnu) throw new Error("토지이음 조회 결과의 PNU가 일치하지 않습니다.");
  const nationalPlan = parseEumZoneGroup(documentNode, "present_mark1", "국토계획법");
  const otherLaws = parseEumZoneGroup(documentNode, "present_mark2", "다른 법령");
  const decreeText = cleanNodeText(documentNode.querySelector("#present_mark3"));
  const decree = decreeText ? [{category: "토지이용규제법 시행령", code: "", name: decreeText, description: ""}] : [];
  const restrictions = [...documentNode.querySelectorAll("#act_content .act_contxt")].map((group) => ({
    zone: cleanNodeText(group.querySelector(":scope > .title")),
    rules: [...group.querySelectorAll(":scope > p")].map((row) => ({
      law: cleanNodeText(row.querySelector("strong")),
      article: cleanNodeText(row.querySelector("a.link"))
        .replace(/근거법령 접기펴기.*$/, "")
        .replace(cleanNodeText(row.querySelector("strong")), "")
        .trim(),
      subject: cleanNodeText(row.querySelector(".mblock")).replace(/^\(|\)$/g, "")
    })).filter((item) => item.law || item.article || item.subject)
  })).filter((group) => group.zone && group.rules.length);
  return {
    version: 1,
    pnu,
    address: cleanNodeText(documentNode.querySelector("#present_addr")?.parentElement).replace(/\s+번지$/, "번지"),
    landCategory: documentNode.querySelector("#present_class_val")?.value || cleanNodeText(documentNode.querySelector("#present_class")),
    area: cleanNodeText(documentNode.querySelector("#present_area")),
    nationalPlan,
    otherLaws,
    decree,
    zones: [...nationalPlan, ...otherLaws, ...decree],
    restrictions
  };
}

async function fetchEumLandUse(pnu) {
  return parseEumLandUseHtml(await fetchEumLandUseHtml(pnu), pnu);
}

function openEumLandUse(record) {
  if (!record?.pnu || !/^\d{19}$/.test(record.pnu)) {
    showToast("토지이음 조회에 필요한 PNU가 없어요.");
    return;
  }
  const targetName = `eum-land-use-${Date.now()}`;
  const popup = window.open("about:blank", targetName);
  if (!popup) {
    showToast("팝업 차단을 해제하면 토지이음 상세정보를 열 수 있어요.");
    return;
  }
  try {
    popup.opener = null;
    popup.document.title = "토지이음 연결 중";
    popup.document.body.textContent = "토지이음 토지이용계획을 여는 중입니다…";
  } catch {
    // 새 창 준비 문구를 표시할 수 없어도 폼 전송은 계속한다.
  }
  const form = document.createElement("form");
  form.method = "post";
  form.action = EUM_DETAIL_URL;
  form.target = targetName;
  form.hidden = true;
  buildEumLandUseParams(record.pnu).forEach((value, name) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  });
  document.body.append(form);
  form.submit();
  form.remove();
}

async function searchVWorld(query, mode = "all") {
  const categories = mode === "road" ? ["road"] : mode === "lot" ? ["parcel"] : ["road", "parcel"];
  const requests = categories.map(async (category) => {
    const url = apiUrl("search", {
      service: "search",
      request: "search",
      version: "2.0",
      crs: "EPSG:4326",
      size: 10,
      page: 1,
      query,
      type: "address",
      category,
      format: "json",
      errorformat: "json"
    });
    const data = await fetchJson(url);
    const response = data?.response;
    if (response?.status && response.status !== "OK" && response.status !== "NOT_FOUND") {
      throw new Error(response?.error?.text || response.status);
    }
    return (response?.result?.items || []).map((item, index) => normalizeSearchItem(item, category, index));
  });
  const settled = await Promise.allSettled(requests);
  const failures = settled.filter((result) => result.status === "rejected");
  const items = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!items.length && failures.length === settled.length) throw failures[0].reason;

  const seen = new Set();
  return items.filter((item) => {
    const key = item.address.replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function normalizeSearchItem(item, category, index) {
  const lon = Number(item?.point?.x);
  const lat = Number(item?.point?.y);
  const road = cleanText(item?.address?.road || "");
  const parcel = cleanText(item?.address?.parcel || "");
  const title = cleanText(item?.title || "");
  const address = category === "parcel" ? parcel || road || title : road || parcel || title;
  return {
    id: `search-${category}-${lon}-${lat}-${index}`,
    pnu: /^\d{19}$/.test(String(item?.id || "")) ? String(item.id) : "",
    category,
    title: title || address,
    address,
    road,
    parcel,
    lon,
    lat
  };
}

function cleanText(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  return (template.content.textContent || "").trim();
}

async function performSearch(query) {
  const value = query.trim();
  if (value.length < 2) {
    showToast("주소나 지번을 두 글자 이상 입력해 주세요.");
    return;
  }
  setSearchLoading(true);
  try {
    const results = await searchVWorld(value, state.searchMode);
    state.searchResults = results.filter((item) => Number.isFinite(item.lon) && Number.isFinite(item.lat));
    renderSuggestions(state.searchResults);
    if (!state.searchResults.length) showToast("검색 결과가 없어요. 주소나 지번을 다시 확인해 주세요.");
  } catch (error) {
    console.error("VWorld search failed", error);
    renderSuggestions([]);
    showToast("주소 검색에 실패했어요. 인증키와 네트워크를 확인해 주세요.");
  } finally {
    setSearchLoading(false);
  }
}

function setSearchLoading(loading) {
  const button = $(".search-submit");
  button.disabled = loading;
  button.textContent = loading ? "검색 중" : "검색";
}

function renderSuggestions(results) {
  const box = $("#searchSuggestions");
  if (!results.length) {
    box.innerHTML = `<div class="empty-suggestion">일치하는 주소를 찾지 못했어요.<br><small>시·군·구와 읍면동, 지번을 함께 입력해 보세요.</small></div>`;
    box.classList.add("show");
    return;
  }
  box.innerHTML = results.map((item, index) => `
    <button class="suggestion" type="button" role="option" data-result-index="${index}">
      <span>${item.category === "parcel" ? "지" : "길"}</span>
      <span><strong>${escapeHtml(item.address)}</strong><small>${escapeHtml(item.category === "parcel" ? item.road || "지번 주소" : item.parcel || "도로명 주소")}</small></span>
    </button>`).join("");
  box.classList.add("show");
  $$("[data-result-index]").forEach((button) => button.addEventListener("click", () => selectSearchResult(state.searchResults[Number(button.dataset.resultIndex)])));
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"})[character]);
}

async function selectSearchResult(result) {
  if (!result) return;
  $("#searchInput").value = result.address;
  $("#searchSuggestions").classList.remove("show");
  setMapMode("cadastral", false);
  mainSheetCollapse(true);
  map.getView().animate({center: fromLonLat([result.lon, result.lat]), zoom: 18, duration: 550});
  $("#mapStatus").textContent = result.address;
  await inspectParcel([result.lon, result.lat], result);
}

async function inspectParcel(lonLat, searchResult) {
  state.loadingParcel = true;
  showToast("필지 정보를 확인하고 있어요.");
  try {
    const [parcelFeature, reverseAddress] = await Promise.all([
      fetchParcelFeature(lonLat),
      searchResult ? Promise.resolve(null) : reverseGeocode(lonLat)
    ]);
    const record = buildRecord(lonLat, searchResult, parcelFeature, reverseAddress);
    addOrUpdateRecord(record);
    if (parcelFeature?.feature) parcelFeatureCache.set(record.id, parcelFeature.feature);
    showSelectedParcel(record, parcelFeature?.feature || null);
    openDetail(record);
  } catch (error) {
    console.error("VWorld parcel lookup failed", error);
    if (searchResult) {
      const record = buildRecord(lonLat, searchResult, null, null);
      addOrUpdateRecord(record);
      showSelectedParcel(record, null);
      openDetail(record);
      showToast("주소 위치는 찾았지만 필지 속성은 확인하지 못했어요.");
    } else {
      showToast("이 위치의 필지 정보를 찾지 못했어요. 다른 필지를 눌러 보세요.");
    }
  } finally {
    state.loadingParcel = false;
  }
}

async function fetchParcelFeature([lon, lat]) {
  const datasets = ["LP_PA_CBND_BUBUN", "LP_PA_CBND_BONBUN"];
  const requests = datasets.map(async (dataset) => {
    const url = apiUrl("data", {
      service: "data",
      request: "GetFeature",
      data: dataset,
      size: 10,
      page: 1,
      format: "json",
      geometry: true,
      attribute: true,
      crs: "EPSG:4326",
      geomFilter: `POINT(${lon} ${lat})`
    });
    const data = await fetchJson(url);
    const collection = data?.response?.result?.featureCollection;
    const feature = collection?.features?.[0];
    return feature ? {dataset, feature} : null;
  });
  const settled = await Promise.allSettled(requests);
  return settled.find((result) => result.status === "fulfilled" && result.value)?.value || null;
}

async function fetchBuildingRecords(pnu) {
  const url = apiUrl("ned/getBuildingUse", {
    pnu,
    pageNo: 1,
    numOfRows: 100
  });
  const data = await fetchJson(url);
  const root = data?.buildingUses || data?.response || {};
  const fields = Array.isArray(root.field) ? root.field : root.field ? [root.field] : [];
  return fields.map((item) => ({
    id: String(item.buldIdntfcNo || ""),
    ledgerKind: String(item.agbldgSeCode || ""),
    name: cleanText(item.buldNm || item.buldDongNm || ""),
    use: cleanText(item.mainPrposCodeNm || item.detailPrposCodeNm || ""),
    groundFloors: Number(item.groundFloorCo || 0),
    undergroundFloors: Number(item.undgrndFloorCo || 0),
    buildingArea: Number(item.buldBildngAr || 0),
    totalArea: Number(item.buldTotar || 0),
    buildingCoverage: Number(item.btlRt || 0),
    floorAreaRatio: Number(item.measrmtRt || 0),
    approvalDate: String(item.useConfmDe || ""),
    lastUpdated: String(item.lastUpdtDt || ""),
    isMain: String(item.buldMainAtachSeCode || "") === "0"
  })).filter((item) => item.id).sort((a, b) => Number(b.isMain) - Number(a.isMain) || b.totalArea - a.totalArea);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function getNedRows(data, rootName) {
  const root = data?.[rootName];
  if (rootName === "ladfrlVOList") return toArray(root?.ladfrlVOList || root?.field);
  return toArray(root?.field);
}

function latestBy(rows, ...keys) {
  return [...rows].sort((a, b) => {
    const aValue = keys.map((key) => String(a?.[key] || "")).join("");
    const bValue = keys.map((key) => String(b?.[key] || "")).join("");
    return bValue.localeCompare(aValue);
  })[0] || null;
}

async function fetchLandRegisterDetails(pnu) {
  const operations = [
    ["base", "ladfrlList", "ladfrlVOList"],
    ["ownership", "getPossessionAttr", "possessions"],
    ["movements", "getLandMoveAttr", "landMoves"],
    ["characteristics", "getLandCharacteristics", "landCharacteristicss"],
    ["prices", "getIndvdLandPriceAttr", "indvdLandPrices"],
    ["uses", "getLandUseAttr", "landUses"]
  ];
  const settled = await Promise.allSettled(operations.map(([, operation]) => fetchJson(apiUrl(`ned/${operation}`, {
    pnu,
    pageNo: 1,
    numOfRows: 100
  }))));
  const rows = {};
  const sourceStatus = {};
  settled.forEach((result, index) => {
    const [key, , rootName] = operations[index];
    sourceStatus[key] = result.status === "fulfilled" ? "success" : "error";
    rows[key] = result.status === "fulfilled" ? getNedRows(result.value, rootName) : [];
  });
  const availableSources = Object.values(rows).filter((items) => items.length).length;
  if (!availableSources && settled.every((result) => result.status === "rejected")) throw settled[0].reason;

  const base = rows.base[0] || null;
  const ownerships = [...rows.ownership].sort((a, b) => {
    const dateOrder = String(b.ownshipChgDe || "").localeCompare(String(a.ownshipChgDe || ""));
    return dateOrder || String(b.lastUpdtDt || "").localeCompare(String(a.lastUpdtDt || ""));
  });
  const ownership = ownerships[0] || null;
  const characteristic = latestBy(rows.characteristics, "stdrYear", "stdrMt", "lastUpdtDt");
  const price = latestBy(rows.prices, "stdrYear", "stdrMt", "lastUpdtDt");
  const seenUses = new Set();
  const uses = rows.uses.filter((item) => {
    const name = cleanText(item.prposAreaDstrcCodeNm);
    if (!name || seenUses.has(name)) return false;
    seenUses.add(name);
    return true;
  }).map((item) => ({
    name: cleanText(item.prposAreaDstrcCodeNm),
    conflict: cleanText(item.cnflcAtNm || "")
  }));
  const movements = [...rows.movements].sort((a, b) => String(b.ladMvmnDe || "").localeCompare(String(a.ladMvmnDe || "")));

  return {version: 2, base, ownership, ownerships, characteristic, price, uses, movements, availableSources, sourceStatus, partial: settled.some((result) => result.status === "rejected")};
}

async function reverseGeocode([lon, lat]) {
  try {
    const url = apiUrl("address", {
      service: "address",
      request: "getaddress",
      version: "2.0",
      crs: "EPSG:4326",
      point: `${lon},${lat}`,
      format: "json",
      type: "both",
      zipcode: true,
      simple: false
    });
    const data = await fetchJson(url);
    const results = data?.response?.result || [];
    return Array.isArray(results) ? results : [results];
  } catch {
    return [];
  }
}

function buildRecord([lon, lat], searchResult, parcelFeature, reverseResults) {
  const properties = parcelFeature?.feature?.properties || {};
  const lower = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key.toLowerCase(), value]));
  const pnu = String(lower.pnu || searchResult?.pnu || "");
  const reverseParcel = (reverseResults || []).find((item) => String(item?.type || "").toLowerCase().includes("parcel"));
  const reverseRoad = (reverseResults || []).find((item) => String(item?.type || "").toLowerCase().includes("road"));
  const address = searchResult?.parcel || searchResult?.address || cleanText(reverseParcel?.text || reverseRoad?.text || "선택한 필지");
  const road = searchResult?.road || cleanText(reverseRoad?.text || "");
  const number = String(lower.jibun || lower.jibun_bonbun || address.split(" ").at(-1) || "");
  const isForest = pnu.length > 10 ? pnu.charAt(10) === "2" : /(^|\s)산\s*\d/.test(address);
  const id = pnu || `parcel-${lon.toFixed(7)}-${lat.toFixed(7)}`;
  const fetchedAt = new Date().toISOString();
  return {
    id,
    pnu,
    address,
    road,
    number,
    type: isForest ? "forest" : "land",
    typeLabel: isForest ? "임야대장" : "토지대장",
    lon,
    lat,
    dataset: parcelFeature?.dataset || "",
    properties,
    sourceMeta: {
      parcel: {source: "VWorld 공간정보 오픈플랫폼", asOf: "", fetchedAt, status: parcelFeature ? "success" : "missing"}
    }
  };
}

function addOrUpdateRecord(record) {
  const existingIndex = state.records.findIndex((item) => item.id === record.id);
  if (existingIndex >= 0) state.records.splice(existingIndex, 1, {...state.records[existingIndex], ...record});
  else state.records.unshift(record);
  state.selectedId = record.id;
  render();
}

function showSelectedParcel(record, rawFeature) {
  markerSource.clear();
  const marker = new Feature({
    geometry: new Point(fromLonLat([record.lon, record.lat])),
    label: record.number || "필지",
    recordId: record.id
  });
  markerSource.addFeature(marker);
  selectionSource.clear();

  if (rawFeature?.geometry) {
    try {
      const feature = geoJson.readFeature(rawFeature, {dataProjection: "EPSG:4326", featureProjection: "EPSG:3857"});
      feature.set("recordId", record.id);
      selectionSource.addFeature(feature);
      map.getView().cancelAnimations();
      map.getView().fit(feature.getGeometry().getExtent(), {padding: [140, 70, 260, 70], maxZoom: 19, duration: 450});
    } catch (error) {
      console.warn("Parcel geometry could not be rendered", error);
    }
  }
}

async function selectRecordFromList(record) {
  setMapMode("cadastral", false);
  map.getView().animate({center: fromLonLat([record.lon, record.lat]), zoom: 18, duration: 450});
  const cachedFeature = parcelFeatureCache.get(record.id) || null;
  showSelectedParcel(record, cachedFeature);
  openDetail(record);
  if (cachedFeature) return;

  const parcelFeature = await fetchParcelFeature([record.lon, record.lat]);
  if (!parcelFeature?.feature || state.selectedId !== record.id) return;
  parcelFeatureCache.set(record.id, parcelFeature.feature);
  showSelectedParcel(record, parcelFeature.feature);
}

function waitForMapRender(targetMap, timeout = 5000) {
  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, timeout);
    targetMap.once("rendercomplete", done);
    targetMap.renderSync();
  });
}

async function captureParcelMapImage(record) {
  let rawFeature = parcelFeatureCache.get(record.id) || null;
  if (!rawFeature) {
    const parcelFeature = await fetchParcelFeature([record.lon, record.lat]);
    rawFeature = parcelFeature?.feature || null;
    if (rawFeature) parcelFeatureCache.set(record.id, rawFeature);
  }

  const target = document.createElement("div");
  target.className = "report-map-capture";
  Object.assign(target.style, {
    position: "fixed",
    left: "-12000px",
    top: "0",
    width: "1200px",
    height: "675px",
    background: "#e8eee9"
  });
  document.body.appendChild(target);

  const reportSelectionSource = new VectorSource();
  if (rawFeature?.geometry) {
    try {
      reportSelectionSource.addFeature(geoJson.readFeature(rawFeature, {dataProjection: "EPSG:4326", featureProjection: "EPSG:3857"}));
    } catch (error) {
      console.warn("Report parcel geometry could not be rendered", error);
    }
  }
  const reportMarkerSource = new VectorSource({features: [new Feature({
    geometry: new Point(fromLonLat([record.lon, record.lat])),
    label: record.number || "필지"
  })]});
  const sourceOptions = {crossOrigin: "anonymous", maxZoom: 19, transition: 0};
  const reportLayers = state.mapMode === "normal"
    ? [new TileLayer({source: new XYZ({...sourceOptions, url: "https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png"})})]
    : [
        new TileLayer({source: new XYZ({...sourceOptions, url: "https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg"})}),
        new TileLayer({source: new XYZ({...sourceOptions, url: "https://xdworld.vworld.kr/2d/Hybrid/service/{z}/{x}/{y}.png"})})
      ];
  reportLayers.push(
    new VectorLayer({source: reportSelectionSource, style: selectionStyleForMode, zIndex: 18}),
    new VectorLayer({source: reportMarkerSource, style: markerStyle, zIndex: 20})
  );
  const reportMap = new OLMap({
    target,
    controls: [],
    interactions: [],
    pixelRatio: 1,
    layers: reportLayers,
    view: new View({center: fromLonLat([record.lon, record.lat]), zoom: 17, minZoom: 6, maxZoom: 19})
  });

  try {
    reportMap.updateSize();
    const selectedFeature = reportSelectionSource.getFeatures()[0];
    if (selectedFeature) reportMap.getView().fit(selectedFeature.getGeometry().getExtent(), {padding: [80, 110, 80, 110], maxZoom: 18, duration: 0});
    await waitForMapRender(reportMap);

    const output = document.createElement("canvas");
    output.width = 1200;
    output.height = 675;
    const context = output.getContext("2d");
    context.fillStyle = "#e8eee9";
    context.fillRect(0, 0, output.width, output.height);
    [...target.querySelectorAll("canvas")].forEach((canvas) => {
      if (!canvas.width || !canvas.height) return;
      const opacity = Number(canvas.parentElement?.style.opacity || canvas.style.opacity || 1);
      const transform = canvas.style.transform?.match(/^matrix\(([^)]+)\)$/)?.[1]?.split(",").map(Number)
        || [canvas.width / output.width, 0, 0, canvas.height / output.height, 0, 0];
      context.globalAlpha = Number.isFinite(opacity) ? opacity : 1;
      context.setTransform(...transform);
      context.drawImage(canvas, 0, 0);
    });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 0.9;
    context.fillStyle = "#163d32";
    context.fillRect(0, output.height - 48, output.width, 48);
    context.globalAlpha = 1;
    context.fillStyle = "#ffffff";
    context.font = "700 20px 'Noto Sans KR', sans-serif";
    context.fillText(record.address || "선택한 필지", 24, output.height - 17);
    context.font = "500 14px 'Noto Sans KR', sans-serif";
    context.textAlign = "right";
    context.fillText("VWorld · 선택 필지 경계 강조", output.width - 24, output.height - 18);
    return output.toDataURL("image/jpeg", 0.9);
  } finally {
    reportMap.setTarget(undefined);
    target.remove();
  }
}

function ensureSourceMeta(record) {
  if (!record.sourceMeta || typeof record.sourceMeta !== "object") record.sourceMeta = {};
  const now = new Date().toISOString();
  if (!record.sourceMeta.parcel) {
    record.sourceMeta.parcel = {
      source: "VWorld 공간정보 오픈플랫폼",
      asOf: "",
      fetchedAt: now,
      status: record.pnu ? "success" : "missing"
    };
  }
  if (!record.sourceMeta.landRegister && record.landRegister) {
    record.sourceMeta.landRegister = {
      source: "국토교통부 국가공간정보센터 공개 API",
      asOf: record.landRegister.base?.lastUpdtDt || record.landRegister.characteristic?.lastUpdtDt || "",
      fetchedAt: now,
      status: record.landRegister.partial ? "partial" : "success"
    };
  }
  if (!record.sourceMeta.eumLandUse && record.eumLandUse) {
    record.sourceMeta.eumLandUse = {source: "토지이음", asOf: "", fetchedAt: now, status: "success"};
  }
  if (!record.sourceMeta.building && Array.isArray(record.buildings)) {
    const asOf = [...record.buildings].sort((a, b) => String(b.lastUpdated || "").localeCompare(String(a.lastUpdated || "")))[0]?.lastUpdated || "";
    record.sourceMeta.building = {source: "VWorld 건축물 공개 API", asOf, fetchedAt: now, status: record.buildingError ? "error" : "success"};
  }
  return record.sourceMeta;
}

function setSourceMeta(record, key, values) {
  const meta = ensureSourceMeta(record);
  meta[key] = {...meta[key], ...values};
}

function getLandSnapshot(record) {
  const land = record.landRegister || {};
  const base = land.base || {};
  const ownership = land.ownership || {};
  const characteristic = land.characteristic || {};
  const price = land.price || {};
  const area = Number(base.lndpclAr || ownership.lndpclAr || characteristic.lndpclAr || 0);
  const regulations = [...(record.eumLandUse?.nationalPlan || []), ...(record.eumLandUse?.otherLaws || [])]
    .map((item) => cleanText(item?.name))
    .filter((name, index, items) => name && items.indexOf(name) === index);
  return {
    category: cleanText(base.lndcgrCodeNm || ownership.lndcgrCodeNm || characteristic.lndcgrCodeNm),
    area,
    price,
    priceYear: cleanText(price.stdrYear || characteristic.stdrYear),
    zone: cleanText(characteristic.prposArea1Nm || record.eumLandUse?.nationalPlan?.[0]?.name),
    regulations
  };
}

function displayDataValue(value, {loading = false, failed = false} = {}) {
  if (value && value !== "-") return value;
  if (loading) return "조회 중";
  if (failed) return "조회 실패";
  return "미제공";
}

function sourceMetaText(meta, fallbackSource) {
  const source = meta?.source || fallbackSource;
  const lookupDate = formatDate(meta?.fetchedAt);
  const basis = meta?.asOf ? `기준 ${formatDate(meta.asOf)}` : `기준일 미제공${lookupDate !== "-" ? ` · 조회 ${lookupDate}` : ""}`;
  return `${source} · ${basis}`;
}

function setCardMeta(selector, meta, fallbackSource) {
  const element = $(selector);
  if (!element) return;
  element.innerHTML = `<span>출처</span><strong>${escapeHtml(meta?.source || fallbackSource)}</strong><small>${escapeHtml(sourceMetaText(meta, fallbackSource).replace(`${meta?.source || fallbackSource} · `, ""))}</small>`;
}

function renderDetailHighlight(record) {
  const snapshot = getLandSnapshot(record);
  const sourceStatus = record.landRegister?.sourceStatus || {};
  const landLoading = record.landRegisterLoading || (!record.landRegister && !record.landRegisterError);
  const landFailed = Boolean(record.landRegisterError && !record.landRegister);
  const zoneLoading = landLoading || record.eumLandUseLoading || (!record.eumLandUse && !record.eumLandUseError && !snapshot.zone);
  const categoryFailed = landFailed || ["base", "ownership", "characteristics"].every((source) => sourceStatus[source] === "error");
  const priceFailed = landFailed || sourceStatus.prices === "error";
  const yearFailed = landFailed || ["prices", "characteristics"].every((source) => sourceStatus[source] === "error");
  const zoneFailed = Boolean((landFailed || sourceStatus.characteristics === "error") && record.eumLandUseError && !snapshot.zone);
  const priceValue = formatLandPrice(snapshot.price);
  const items = [
    ["지목", displayDataValue(snapshot.category, {loading: landLoading, failed: categoryFailed}), "green"],
    ["대장 면적", displayDataValue(snapshot.area ? `${formatMetric(snapshot.area, "㎡")} / ${formatPyeong(snapshot.area)}` : "", {loading: landLoading, failed: categoryFailed}), "blue"],
    ["개별공시지가", displayDataValue(priceValue, {loading: landLoading, failed: priceFailed}), "orange"],
    ["공시지가 기준연도", displayDataValue(snapshot.priceYear ? `${snapshot.priceYear}년` : "", {loading: landLoading, failed: yearFailed}), "gold"],
    ["주요 용도지역", displayDataValue(snapshot.zone, {loading: zoneLoading, failed: zoneFailed}), "purple"]
  ];
  $("#detailHighlight").innerHTML = items.map(([label, value, tone]) => `
    <div class="${tone}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
}

function formatMetric(value, suffix) {
  return Number.isFinite(value) && value > 0
    ? `${new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 2}).format(value)}${suffix}`
    : "-";
}

function formatApprovalYear(value) {
  const match = String(value || "").match(/^(\d{4})/);
  return match ? `${match[1]}년` : "-";
}

function formatDate(value) {
  if (String(value || "").includes("T")) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric"
    }).format(date).replace(/\s/g, "").replace(/\.$/, "");
  }
  const match = String(value || "").match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return match ? `${match[1]}.${Number(match[2])}.${Number(match[3])}` : "-";
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "아직 저장되지 않음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
}

function formatLandPrice(price) {
  const amount = Number(price?.pblntfPclnd || 0);
  if (!amount) return "-";
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원/㎡`;
}

function formatPyeong(area) {
  const value = Number(area || 0) / 3.305785;
  return value > 0 ? `${new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 1}).format(value)}평` : "-";
}

function formatEstimatedValue(price, area) {
  const amount = Number(price?.pblntfPclnd || 0) * Number(area || 0);
  return amount > 0 ? `${new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 0}).format(amount)}원` : "-";
}

function buildReportModel(record) {
  const land = record.landRegister || {};
  const eum = record.eumLandUse || {};
  const base = land.base;
  const characteristic = land.characteristic;
  const price = land.price;
  const ownership = land.ownership;
  const ownerships = land.ownerships?.length ? land.ownerships : ownership ? [ownership] : [];
  const uses = land.uses || [];
  const movements = land.movements || [];
  const area = Number(base?.lndpclAr || ownership?.lndpclAr || characteristic?.lndpclAr || 0);
  const category = base?.lndcgrCodeNm || ownership?.lndcgrCodeNm || characteristic?.lndcgrCodeNm || "-";
  const registerType = base?.regstrSeCodeNm || ownership?.regstrSeCodeNm || characteristic?.regstrSeCodeNm || record.typeLabel;
  const basicRows = [
    ["지번주소", record.address || "-"],
    ["도로명주소", record.road || "-"],
    ["지번", base?.mnnmSlno || record.number || "-"],
    ["대장 구분", registerType || "-"],
    ["PNU", record.pnu || "-"],
    ["좌표", `${Number(record.lon).toFixed(6)}, ${Number(record.lat).toFixed(6)}`]
  ];
  const landRows = [
    ["지목", category],
    ["면적", formatMetric(area, "㎡")],
    ["면적 환산", formatPyeong(area)],
    ["용도지역", characteristic?.prposArea1Nm || "-"],
    ["제2용도지역", characteristic?.prposArea2Nm || "-"],
    ["토지이용상황", characteristic?.ladUseSittnNm || "-"],
    ["지형 높이", characteristic?.tpgrphHgCodeNm || "-"],
    ["지형 형상", characteristic?.tpgrphFrmCodeNm || "-"],
    ["도로 접면", characteristic?.roadSideCodeNm || "-"],
    ["개별공시지가", formatLandPrice(price)],
    ["공시지가 기준연도", price?.stdrYear ? `${price.stdrYear}년` : "-"],
    ["면적×공시지가 단순 계산 참고값", formatEstimatedValue(price, area)],
    ["소유구분", ownership?.posesnSeCodeNm || base?.posesnSeCodeNm || "-"],
    ["도면축척", base?.ladFrtlScNm || "-"],
    ["정보 기준일", formatDate(base?.lastUpdtDt || characteristic?.lastUpdtDt)]
  ];
  const sections = [
    {title: "필지 기본 정보", kind: "keyValue", rows: basicRows},
    {title: "토지대장 공개정보", kind: "keyValue", rows: landRows},
    {
      title: "토지이용계획",
      kind: "table",
      headers: ["용도지역·지구", "저촉 여부"],
      rows: uses.map((item) => [item.name || "-", item.conflict || "해당없음"])
    },
    {
      title: "소유 현황 개인정보 제외",
      kind: "table",
      headers: ["주소", "소유", "거주지", "공유인", "변동일자", "변동원인"],
      rows: ownerships.map((item) => [
        [item.ldCodeNm, item.mnnmSlno].filter(Boolean).join(" ") || record.address || "-",
        item.posesnSeCodeNm || "-",
        item.resdncSeCodeNm || "-",
        `${Number(item.cnrsPsnCo || 0)}명`,
        formatDate(item.ownshipChgDe),
        item.ownshipChgCauseCodeNm || "-"
      ])
    },
    {
      title: "토지이동 이력",
      kind: "table",
      headers: ["변동일자", "변동원인", "면적"],
      rows: movements.map((item) => [formatDate(item.ladMvmnDe), item.ladMvmnPrvonshCodeNm || "-", formatMetric(Number(item.lndpclAr || 0), "㎡")])
    }
  ];

  if (eum.zones?.length) {
    sections.splice(3, 0, {
      title: "토지이음 지역·지구 지정정보",
      kind: "table",
      headers: ["구분", "지역·지구", "설명"],
      rows: eum.zones.map((item) => [item.category || "-", item.name || "-", item.description || "-"])
    });
  }
  if (eum.restrictions?.length) {
    sections.splice(4, 0, {
      title: "토지이음 행위제한 근거",
      kind: "table",
      headers: ["지역·지구", "근거 법령", "조문·내용"],
      rows: eum.restrictions.flatMap((group) => group.rules.map((rule) => [
        group.zone || "-",
        rule.law || "-",
        [rule.article, rule.subject].filter(Boolean).join(" · ") || "-"
      ]))
    });
  }

  (record.buildings || []).forEach((building, index) => {
    const floors = [building.groundFloors ? `지상 ${building.groundFloors}층` : "", building.undergroundFloors ? `지하 ${building.undergroundFloors}층` : ""].filter(Boolean).join(" · ") || "-";
    sections.push({
      title: `건축물 정보 ${index + 1}${building.isMain ? " 주건축물" : ""}`,
      kind: "keyValue",
      rows: [
        ["건물명", building.name || "미제공"],
        ["주용도", building.use || "-"],
        ["층수", floors],
        ["건축면적", formatMetric(building.buildingArea, "㎡")],
        ["연면적", formatMetric(building.totalArea, "㎡")],
        ["건폐율", formatMetric(building.buildingCoverage, "%")],
        ["용적률", formatMetric(building.floorAreaRatio, "%")],
        ["사용승인연도", formatApprovalYear(building.approvalDate)]
      ]
    });
  });

  if (!Array.isArray(record.buildings) || !record.buildings.length) {
    sections.push({title: "건축물 정보", kind: "keyValue", rows: []});
  }

  const generatedAt = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date());
  return {
    title: "토지정보 조회 보고서",
    fileBase: `토지한눈_${record.number || record.pnu || "조회"}`,
    address: record.address || "선택한 토지",
    road: record.road || "미제공",
    pnu: record.pnu || "미제공",
    generatedAt,
    sections,
    source: `VWorld 공간정보 오픈플랫폼 · 국토교통부 국가공간정보센터 공개 API${eum.zones?.length ? " · 토지이음 토지이용계획 열람" : ""}`,
    notice: "이 보고서는 공개 API 조회정보를 정리한 참고자료이며 법적 증명 효력이 없습니다. 필지 경계와 면적은 측량 성과와 다를 수 있고, 면적×공시지가 단순 계산 참고값은 실거래가·매매가격·감정가가 아닙니다. 소유자 성명, 주소, 등록번호, 지분 등 개인정보는 포함하지 않습니다."
  };
}

function renderLandRegisterSection(record) {
  const content = $("#landRegisterContent");
  const badge = $("#landRegisterBadge");
  const meta = ensureSourceMeta(record).landRegister;
  setCardMeta("#landRegisterMeta", meta, "국토교통부 국가공간정보센터 공개 API");
  $("#landRegisterCardTitle").textContent = `${record.typeLabel || "토지대장"} 정보`;
  if (!record.landRegister) {
    badge.textContent = record.landRegisterError ? "조회 실패" : "조회 중";
    content.innerHTML = `<p class="building-empty">${record.landRegisterError ? "토지대장 공개정보를 불러오지 못했어요." : "토지대장 공개정보를 확인하고 있어요."}</p>`;
    return;
  }

  const {base, ownership, characteristic, price, uses, movements, availableSources, partial} = record.landRegister;
  const ownerships = record.landRegister.ownerships?.length ? record.landRegister.ownerships : ownership ? [ownership] : [];
  if (!availableSources) {
    badge.textContent = "정보 없음";
    content.innerHTML = `<p class="building-empty">이 필지에서 공개 API로 확인된 대장 정보가 없어요.</p>`;
    return;
  }
  badge.textContent = partial ? "일부 조회" : "조회 완료";
  const category = base?.lndcgrCodeNm || ownership?.lndcgrCodeNm || characteristic?.lndcgrCodeNm || "-";
  const area = Number(base?.lndpclAr || ownership?.lndpclAr || characteristic?.lndpclAr || 0);
  const registerType = base?.regstrSeCodeNm || ownership?.regstrSeCodeNm || characteristic?.regstrSeCodeNm || record.typeLabel;
  const summaryFacts = [
    ["지번", base?.mnnmSlno || record.number || "-"],
    ["지목", category],
    ["면적", formatMetric(area, "㎡")],
    ["면적(평)", formatPyeong(area)],
    ["용도지역", characteristic?.prposArea1Nm || "-"],
    ["제2용도지역", characteristic?.prposArea2Nm || "-"],
    ["토지이용상황", characteristic?.ladUseSittnNm || "-"],
    ["도로 접면", characteristic?.roadSideCodeNm || "-"],
    ["개별공시지가", formatLandPrice(price)],
    ["공시지가 기준연도", price?.stdrYear ? `${price.stdrYear}년` : "-"],
    ["면적×공시지가 단순 계산 참고값", formatEstimatedValue(price, area)],
    ["소유구분", ownership?.posesnSeCodeNm || base?.posesnSeCodeNm || "-"],
    ["대장구분", registerType],
    ["도면축척", base?.ladFrtlScNm || "-"],
    ["정보 기준일", formatDate(base?.lastUpdtDt || characteristic?.lastUpdtDt)]
  ];
  const characteristicFacts = [
    ["토지이용상황", characteristic?.ladUseSittnNm || "-"],
    ["지형 높이", characteristic?.tpgrphHgCodeNm || "-"],
    ["지형 형상", characteristic?.tpgrphFrmCodeNm || "-"],
    ["도로 접면", characteristic?.roadSideCodeNm || "-"],
    ["제2용도지역", characteristic?.prposArea2Nm || "-"],
    ["특성 기준연도", characteristic?.stdrYear ? `${characteristic.stdrYear}년` : "-"]
  ];
  const useDetails = uses.length ? `<details open><summary>토지이용계획 <span>${uses.length}건</span></summary><div class="land-use-tags">${uses.map((item) => `<span>${escapeHtml(item.name)}${item.conflict && item.conflict !== "해당없음" ? ` · ${escapeHtml(item.conflict)}` : ""}</span>`).join("")}</div></details>` : "";
  const movementDetails = movements.length ? `<details><summary>토지이동 이력 <span>${movements.length}건</span></summary><ol class="land-history">${movements.map((item) => `<li><time datetime="${escapeHtml(item.ladMvmnDe || "")}">${escapeHtml(formatDate(item.ladMvmnDe))}</time><span>${escapeHtml(item.ladMvmnPrvonshCodeNm || "사유 미제공")}${Number(item.lndpclAr) ? ` · ${escapeHtml(formatMetric(Number(item.lndpclAr), "㎡"))}` : ""}</span></li>`).join("")}</ol></details>` : "";
  const ownershipDetails = ownerships.length ? `<details><summary>소유 현황(개인정보 제외) <span>${ownerships.length}건</span></summary><div class="ownership-list">${ownerships.map((item, index) => {
    const address = [item.ldCodeNm, item.mnnmSlno].filter(Boolean).join(" ") || record.address || "주소 미제공";
    const fields = [
      ["소유", item.posesnSeCodeNm || "-"],
      ["거주지", item.resdncSeCodeNm || "-"],
      ["공유인 수", `${Number(item.cnrsPsnCo || 0)}명`],
      ["변동일자", formatDate(item.ownshipChgDe)],
      ["변동원인", item.ownshipChgCauseCodeNm || "-"]
    ];
    return `<article class="ownership-record"><strong><span>${index + 1}</span>${escapeHtml(address)}</strong><dl>${fields.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></article>`;
  }).join("")}</div><p class="land-register-note">공개 API는 소유자 성명·주소·등록번호·지분 등 개인정보를 제공하지 않습니다.</p></details>` : "";

  content.innerHTML = `
    <dl class="building-facts land-register-summary">${summaryFacts.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
    <p class="land-value-note">면적×공시지가 단순 계산 참고값은 실거래가·매매가격·감정가가 아닙니다.</p>
    <div class="land-register-details">
      <details open><summary>토지특성 상세</summary><dl class="building-facts">${characteristicFacts.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></details>
      ${useDetails}
      ${ownershipDetails}
      ${movementDetails}
    </div>`;
}

async function loadLandRegisterDetails(record) {
  if (!record?.pnu || record.landRegister?.version === 2 || record.landRegisterLoading) return;
  record.landRegisterLoading = true;
  record.landRegisterError = false;
  setSourceMeta(record, "landRegister", {source: "국토교통부 국가공간정보센터 공개 API", status: "loading"});
  try {
    record.landRegister = await fetchLandRegisterDetails(record.pnu);
    const asOf = record.landRegister?.base?.lastUpdtDt || record.landRegister?.characteristic?.lastUpdtDt || "";
    setSourceMeta(record, "landRegister", {asOf, fetchedAt: new Date().toISOString(), status: record.landRegister?.partial ? "partial" : "success"});
  } catch (error) {
    console.error("VWorld land register lookup failed", error);
    record.landRegisterError = true;
    setSourceMeta(record, "landRegister", {asOf: "", fetchedAt: new Date().toISOString(), status: "error"});
  } finally {
    record.landRegisterLoading = false;
    if (state.selectedId === record.id && $("#detailSheet").classList.contains("open")) {
      renderLandRegisterSection(record);
      renderDetailHighlight(record);
      if (record.eumLandUse) renderEumLandUseSection(record);
    }
    if (state.favorites.has(record.id)) persistFavorites();
  }
}

function renderEumLandUseSection(record) {
  const content = $("#eumLandUseContent");
  const badge = $("#eumLandUseBadge");
  const data = record.eumLandUse;
  setCardMeta("#eumLandUseMeta", ensureSourceMeta(record).eumLandUse, "토지이음");
  if (!data) {
    badge.textContent = record.eumLandUseError ? "조회 실패" : "조회 중";
    content.innerHTML = `<p class="building-empty">${record.eumLandUseError ? "토지이음 정보를 불러오지 못했어요. 아래 공식 상세보기에서 확인해 주세요." : "용도지역·지구와 행위제한 근거를 확인하고 있어요."}</p>
      <button class="building-ledger-button eum-open-button" type="button" data-open-eum>토지이음에서 상세보기</button>`;
    content.querySelector("[data-open-eum]")?.addEventListener("click", () => openEumLandUse(record));
    return;
  }
  const zoneCount = data.zones?.length || 0;
  badge.textContent = zoneCount ? `${zoneCount}개 지정` : "정보 없음";
  const summaryFacts = [
    ["소재지", data.address || record.address || "-"],
    ["지목", data.landCategory || "-"],
    ["면적", data.area || "-"],
    ["개별공시지가", formatLandPrice(record.landRegister?.price)]
  ];
  const zoneGroup = (title, items) => items?.length ? `
    <details open>
      <summary>${escapeHtml(title)} <span>${items.length}건</span></summary>
      <div class="eum-zone-list">${items.map((item) => `
        <article><strong>${escapeHtml(item.name)}</strong>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ""}</article>`).join("")}</div>
    </details>` : "";
  const restrictionGroups = (data.restrictions || []).map((group) => `
    <article class="eum-restriction-group">
      <strong>${escapeHtml(group.zone)}</strong>
      <ul>${group.rules.map((rule) => `<li><b>${escapeHtml(rule.law || "근거 법령")}</b><span>${escapeHtml([rule.article, rule.subject].filter(Boolean).join(" · ") || "상세 내용은 토지이음에서 확인")}</span></li>`).join("")}</ul>
    </article>`).join("");
  content.innerHTML = `
    <dl class="building-facts eum-summary">${summaryFacts.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
    <div class="land-register-details eum-details">
      ${zoneGroup("국토의 계획 및 이용에 관한 법률", data.nationalPlan)}
      ${zoneGroup("다른 법령 등에 따른 지역·지구", data.otherLaws)}
      ${zoneGroup("토지이용규제 기본법 시행령 사항", data.decree)}
      ${restrictionGroups ? `<details><summary>행위제한 근거 법령 <span>${data.restrictions.length}개 지역·지구</span></summary><div class="eum-restrictions">${restrictionGroups}</div></details>` : ""}
    </div>
    <p class="land-register-note">토지이음 열람정보는 참고자료이며 법적 효력이 없습니다. 중요한 사항은 토지이용계획확인서를 발급해 확인해 주세요.</p>
    <button class="building-ledger-button eum-open-button" type="button" data-open-eum>토지이음에서 상세보기</button>`;
  content.querySelector("[data-open-eum]")?.addEventListener("click", () => openEumLandUse(record));
}

async function loadEumLandUse(record) {
  if (!record?.pnu || record.eumLandUse?.version === 1 || record.eumLandUseLoading) return;
  record.eumLandUseLoading = true;
  record.eumLandUseError = false;
  setSourceMeta(record, "eumLandUse", {source: "토지이음", status: "loading"});
  try {
    record.eumLandUse = await fetchEumLandUse(record.pnu);
    setSourceMeta(record, "eumLandUse", {asOf: "", fetchedAt: new Date().toISOString(), status: "success"});
  } catch (error) {
    console.error("토지이음 토지이용계획 조회 실패", error);
    record.eumLandUseError = true;
    setSourceMeta(record, "eumLandUse", {asOf: "", fetchedAt: new Date().toISOString(), status: "error"});
  } finally {
    record.eumLandUseLoading = false;
    if (state.selectedId === record.id && $("#detailSheet").classList.contains("open")) {
      renderEumLandUseSection(record);
      renderDetailHighlight(record);
    }
  }
}

function renderBuildingSection(record, selectedIndex = 0) {
  const content = $("#buildingContent");
  const count = $("#buildingCount");
  setCardMeta("#buildingMeta", ensureSourceMeta(record).building, "VWorld 건축물 공개 API");
  if (!Array.isArray(record.buildings)) {
    count.hidden = true;
    content.innerHTML = `<p class="building-empty">건축물 정보를 확인하고 있어요.</p>`;
    return;
  }
  if (!record.buildings.length) {
    count.hidden = true;
    content.innerHTML = `<p class="building-empty">${record.buildingError ? "건축물 정보를 불러오지 못했어요." : "이 필지에서 확인된 건축물 정보가 없어요."}</p>`;
    return;
  }
  const index = Math.min(Math.max(Number(selectedIndex) || 0, 0), record.buildings.length - 1);
  const building = record.buildings[index];
  count.hidden = false;
  count.textContent = `${record.buildings.length}개 동`;
  const selector = record.buildings.length > 1 ? `
    <select class="building-selector" id="buildingSelector" aria-label="건축물 선택">
      ${record.buildings.map((item, itemIndex) => `<option value="${itemIndex}"${itemIndex === index ? " selected" : ""}>${escapeHtml(item.name || `건축물 ${itemIndex + 1}`)}${item.isMain ? " · 주건축물" : ""}</option>`).join("")}
    </select>` : "";
  const floors = [building.groundFloors ? `지상 ${building.groundFloors}층` : "", building.undergroundFloors ? `지하 ${building.undergroundFloors}층` : ""].filter(Boolean).join(" · ") || "-";
  const facts = [
    ["용도", building.use || "-"],
    ["층수", floors],
    ["건축면적", formatMetric(building.buildingArea, "㎡")],
    ["연면적", formatMetric(building.totalArea, "㎡")],
    ["건폐율", formatMetric(building.buildingCoverage, "%")],
    ["용적률", formatMetric(building.floorAreaRatio, "%")],
    ["사용승인연도", formatApprovalYear(building.approvalDate)],
    ["건물명", building.name || "미제공"]
  ];
  content.innerHTML = `${selector}<dl class="building-facts">${facts.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
    <button class="building-ledger-button" id="openBuildingLedger" type="button">건축물대장 보기</button>`;
  $("#buildingSelector")?.addEventListener("change", (event) => renderBuildingSection(record, Number(event.target.value)));
  $("#openBuildingLedger").addEventListener("click", () => {
    const params = new URLSearchParams({
      mgmBldrgstPk: building.id,
      regstrKindCd: building.ledgerKind || "1",
      pnuCode: record.pnu
    });
    window.open(`./building-ledger.html?${params}`, "_blank", "noopener,noreferrer");
  });
}

async function loadBuildingDetails(record) {
  if (!record?.pnu || Array.isArray(record.buildings) || record.buildingLoading) return;
  record.buildingLoading = true;
  setSourceMeta(record, "building", {source: "VWorld 건축물 공개 API", status: "loading"});
  try {
    record.buildings = await fetchBuildingRecords(record.pnu);
    record.buildingError = false;
    const asOf = [...record.buildings].sort((a, b) => String(b.lastUpdated).localeCompare(String(a.lastUpdated)))[0]?.lastUpdated || "";
    setSourceMeta(record, "building", {asOf, fetchedAt: new Date().toISOString(), status: "success"});
  } catch (error) {
    console.error("VWorld building lookup failed", error);
    record.buildings = [];
    record.buildingError = true;
    setSourceMeta(record, "building", {asOf: "", fetchedAt: new Date().toISOString(), status: "error"});
  } finally {
    record.buildingLoading = false;
    if (state.selectedId === record.id && $("#detailSheet").classList.contains("open")) renderBuildingSection(record);
    if (state.favorites.has(record.id)) persistFavorites();
  }
}

function getFieldRecordKey(record) {
  return record?.pnu || record?.id || "";
}

function readFieldRecordStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FIELD_RECORDS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isValidFieldRecord(value) {
  const validStatuses = new Set(FIELD_STATUSES.map(([status]) => status));
  return value?.version === 1
    && typeof value.memo === "string"
    && typeof value.updatedAt === "string"
    && FIELD_ITEMS.every(([key]) => validStatuses.has(value.checklist?.[key]));
}

function getFieldRecord(record) {
  const key = getFieldRecordKey(record);
  const store = readFieldRecordStore();
  const saved = key ? store[key] : null;
  if (saved && !isValidFieldRecord(saved)) {
    delete store[key];
    localStorage.setItem(FIELD_RECORDS_KEY, JSON.stringify(store));
    return null;
  }
  return saved || null;
}

function renderFieldRecord(record) {
  const saved = getFieldRecord(record);
  const checklist = saved?.checklist || Object.fromEntries(FIELD_ITEMS.map(([key]) => [key, "unknown"]));
  $("#fieldChecklist").innerHTML = FIELD_ITEMS.map(([key, label]) => `
    <fieldset class="field-check-item">
      <legend>${escapeHtml(label)}</legend>
      <div class="field-status-options">
        ${FIELD_STATUSES.map(([status, statusLabel]) => `
          <label class="field-status field-status-${escapeHtml(status)}">
            <input type="radio" name="field-${escapeHtml(key)}" value="${escapeHtml(status)}"${checklist[key] === status ? " checked" : ""}>
            <span>${escapeHtml(statusLabel)}</span>
          </label>`).join("")}
      </div>
    </fieldset>`).join("");
  $("#fieldMemo").value = saved?.memo || "";
  $("#fieldRecordUpdated").textContent = saved ? `수정 ${formatDateTime(saved.updatedAt)}` : "아직 저장되지 않음";
  $("#deleteFieldRecord").disabled = !saved;
  $("#fieldRecordMeta").innerHTML = `<span>출처</span><strong>사용자 기록</strong><small>${escapeHtml(saved ? `수정 ${formatDateTime(saved.updatedAt)} · 이 브라우저에만 저장됨` : "아직 저장되지 않음 · 이 브라우저에만 저장됨")}</small>`;
}

function saveFieldRecord(record) {
  const key = getFieldRecordKey(record);
  if (!key) return showToast("현장기록을 저장할 필지 식별정보가 없습니다.");
  const checklist = Object.fromEntries(FIELD_ITEMS.map(([itemKey]) => [
    itemKey,
    $(`input[name="field-${itemKey}"]:checked`)?.value || "unknown"
  ]));
  const saved = {version: 1, checklist, memo: $("#fieldMemo").value.trim(), updatedAt: new Date().toISOString()};
  const store = readFieldRecordStore();
  store[key] = saved;
  localStorage.setItem(FIELD_RECORDS_KEY, JSON.stringify(store));
  renderFieldRecord(record);
  showToast("현장기록을 이 브라우저에 저장했어요.");
}

function deleteFieldRecord(record) {
  const key = getFieldRecordKey(record);
  if (!key || !getFieldRecord(record)) return;
  if (!window.confirm("이 필지의 현장 체크리스트와 메모를 삭제할까요?")) return;
  const store = readFieldRecordStore();
  delete store[key];
  localStorage.setItem(FIELD_RECORDS_KEY, JSON.stringify(store));
  renderFieldRecord(record);
  showToast("현장기록을 삭제했어요.");
}

function comparisonDatum(record, key) {
  const snapshot = getLandSnapshot(record);
  const sourceStatus = record.landRegister?.sourceStatus || {};
  const landLoading = record.landRegisterLoading || (!record.landRegister && !record.landRegisterError);
  const landFailed = Boolean(record.landRegisterError && !record.landRegister);
  const eumLoading = record.eumLandUseLoading || (!record.eumLandUse && !record.eumLandUseError);
  const eumFailed = Boolean(record.eumLandUseError && !record.eumLandUse);
  if (key === "address") return {value: record.address || record.road || "미제공", status: record.address || record.road ? "success" : "missing"};
  const values = {
    category: snapshot.category,
    area: snapshot.area ? `${formatMetric(snapshot.area, "㎡")} / ${formatPyeong(snapshot.area)}` : "",
    price: formatLandPrice(snapshot.price) === "-" ? "" : formatLandPrice(snapshot.price),
    year: snapshot.priceYear ? `${snapshot.priceYear}년` : "",
    regulations: snapshot.regulations
  };
  if (key === "regulations") {
    if (values.regulations.length) return {value: values.regulations, status: "success"};
    if (eumLoading) return {value: "조회 중", status: "loading"};
    if (eumFailed) return {value: "조회 실패", status: "error"};
    return {value: "미제공", status: "missing"};
  }
  if (values[key]) return {value: values[key], status: "success"};
  if (landLoading) return {value: "조회 중", status: "loading"};
  const failedDependencies = {
    category: ["base", "ownership", "characteristics"],
    area: ["base", "ownership", "characteristics"],
    price: ["prices"],
    year: ["prices", "characteristics"]
  }[key] || [];
  const dependencyFailed = failedDependencies.length && failedDependencies.every((source) => sourceStatus[source] === "error");
  if (landFailed || dependencyFailed) return {value: "조회 실패", status: "error"};
  return {value: "미제공", status: "missing"};
}

function comparisonCellMarkup(datum) {
  if (Array.isArray(datum.value)) {
    const visible = datum.value.slice(0, 3);
    const remaining = datum.value.length - visible.length;
    if (!remaining) return `<ul class="compare-regulations">${visible.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    return `<details class="compare-regulation-details"><summary>${visible.map(escapeHtml).join(" · ")} <b>외 ${remaining}건</b></summary><ul>${datum.value.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>`;
  }
  return `<span class="compare-value ${escapeHtml(datum.status)}">${escapeHtml(datum.value)}</span>`;
}

function selectedCompareRecords() {
  return [...state.compareIds].map((id) => state.records.find((record) => record.id === id)).filter(Boolean);
}

function renderCompareDialog() {
  const records = selectedCompareRecords();
  const rows = [
    ["주소", "address"],
    ["지목", "category"],
    ["대장 면적", "area"],
    ["개별공시지가", "price"],
    ["공시지가 기준연도", "year"],
    ["주요 규제", "regulations"]
  ];
  $("#compareContent").innerHTML = records.length ? `
    <div class="compare-table-wrap">
      <table class="compare-table">
        <thead><tr><th scope="col">비교 항목</th>${records.map((record) => `<th scope="col">${escapeHtml(record.address || record.number || "선택 필지")}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map(([label, key]) => `<tr><th scope="row">${escapeHtml(label)}</th>${records.map((record) => `<td>${comparisonCellMarkup(comparisonDatum(record, key))}</td>`).join("")}</tr>`).join("")}
          <tr class="compare-source-row"><th scope="row">출처·기준일</th>${records.map((record) => {
            const meta = ensureSourceMeta(record);
            const landText = sourceMetaText(meta.landRegister, "국토교통부 공개 API");
            const eumText = sourceMetaText(meta.eumLandUse, "토지이음");
            return `<td><small>${escapeHtml(landText)}<br>${escapeHtml(eumText)}</small></td>`;
          }).join("")}</tr>
        </tbody>
      </table>
    </div>
    <p class="compare-note">개별공시지가는 원/㎡ 단가이며 실거래가·매매가격·감정가가 아닙니다.</p>` : `<p class="compare-empty">비교할 관심 토지를 선택해 주세요.</p>`;
  $("#retryCompare").hidden = !records.some((record) => (record.landRegisterError && !record.landRegister) || record.landRegister?.partial || (record.eumLandUseError && !record.eumLandUse));
}

async function loadCompareRecords() {
  const records = selectedCompareRecords();
  renderCompareDialog();
  await Promise.all(records.map((record) => Promise.all([loadLandRegisterDetails(record), loadEumLandUse(record)])));
  renderCompareDialog();
  persistFavorites();
}

async function retryCompareRecords() {
  selectedCompareRecords().forEach((record) => {
    if (record.landRegisterError || record.landRegister?.partial) {
      record.landRegister = null;
      record.landRegisterError = false;
    }
    if (record.eumLandUseError && !record.eumLandUse) record.eumLandUseError = false;
  });
  await loadCompareRecords();
}

function openNaverDirections(record) {
  if (!record || !Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return showToast("길찾기에 사용할 좌표가 없습니다.");
  const name = encodeURIComponent(record.address || "선택한 필지");
  const appName = encodeURIComponent("https://tojihannun.designboard.net");
  const query = `dlat=${record.lat}&dlng=${record.lon}&dname=${name}&appname=${appName}`;
  if (/Android/i.test(navigator.userAgent)) {
    window.location.href = `intent://navigation?${query}#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;end`;
  } else if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    window.location.href = `nmap://navigation?${query}`;
  } else {
    window.open(`https://map.naver.com/p/search/${name}`, "_blank", "noopener,noreferrer");
  }
}

function openGoogleDirections(record) {
  if (!record || !Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return showToast("길찾기에 사용할 좌표가 없습니다.");
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", `${record.lat},${record.lon}`);
  url.searchParams.set("dir_action", "navigate");
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function openKakaoDirections(record) {
  if (!record || !Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return showToast("길찾기에 사용할 좌표가 없습니다.");
  const name = encodeURIComponent(record.address || record.road || "선택한 필지");
  window.open(`https://map.kakao.com/link/to/${name},${record.lat},${record.lon}`, "_blank", "noopener,noreferrer");
}

function openDetail(record) {
  if (!record) return;
  const detailSheet = $("#detailSheet");
  detailSheet.scrollTop = 0;
  state.selectedId = record.id;
  $("#detailType").textContent = record.typeLabel;
  $("#detailType").classList.toggle("forest", record.type === "forest");
  $("#detailTitle").textContent = record.address || "선택한 토지";
  $("#detailRoad").textContent = record.road || "도로명 주소가 제공되지 않는 필지입니다.";
  $("#relatedParcelAddress").textContent = record.address || record.road || "선택한 지번";
  const facts = [
    ["지번", record.number || "확인되지 않음"],
    ["대장 구분", record.typeLabel],
    ["PNU", record.pnu || "API 미제공"],
    ["데이터 레이어", record.dataset || "주소 검색 결과"],
    ["경도", Number(record.lon).toFixed(6)],
    ["위도", Number(record.lat).toFixed(6)]
  ];
  $("#landFacts").innerHTML = facts.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  renderDetailHighlight(record);
  renderLandRegisterSection(record);
  void loadLandRegisterDetails(record);
  renderEumLandUseSection(record);
  void loadEumLandUse(record);
  renderBuildingSection(record);
  void loadBuildingDetails(record);
  renderFieldRecord(record);
  updateDetailFavorite(record.id);
  detailSheet.classList.add("open");
  detailSheet.setAttribute("aria-hidden", "false");
  setDetailTab("register", false);
  $("#mapStatus").textContent = record.address || "선택한 필지";
  render();
}

function setDetailTab(tab, focus = true) {
  const nextButton = $(`[data-detail-tab="${tab}"]`);
  if (!nextButton) return;
  state.detailTab = tab;
  $$('[data-detail-tab]').forEach((button) => {
    const active = button === nextButton;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $$('[data-detail-panel]').forEach((panel) => { panel.hidden = panel.dataset.detailPanel !== tab; });
  if (focus) nextButton.focus({preventScroll: true});
}

function closeDetail() {
  $("#detailSheet").classList.remove("open");
  $("#detailSheet").setAttribute("aria-hidden", "true");
}

function getFilteredRecords() {
  if (state.filter === "favorite") return state.records.filter((record) => state.favorites.has(record.id));
  if (state.filter === "all") return state.records;
  return state.records.filter((record) => record.type === state.filter);
}

function render() {
  const records = getFilteredRecords();
  $("#resultCount").textContent = records.length;
  $("#landList").classList.toggle("list-view", state.view === "list");
  $("#landList").innerHTML = records.length ? records.map((record) => `
    <article class="land-card-shell${state.compareIds.has(record.id) ? " compare-selected" : ""}">
      ${state.filter === "favorite" ? `<label class="compare-select"><input type="checkbox" data-compare-id="${escapeHtml(record.id)}"${state.compareIds.has(record.id) ? " checked" : ""}><span>비교</span></label>` : ""}
      <button class="land-card" type="button" data-record-id="${escapeHtml(record.id)}">
        <span>${escapeHtml(record.typeLabel)}</span>
        <strong>${escapeHtml(record.address || "선택한 필지")}</strong>
        <small>${escapeHtml(record.number || "지번 확인 중")} · ${state.favorites.has(record.id) ? "★ 관심 토지" : record.pnu ? "PNU 확인됨" : "주소 검색 결과"}</small>
        <em>›</em>
      </button>
    </article>`).join("") : `<div class="empty-result">${state.filter === "favorite" ? "아직 저장한 관심 토지가 없어요." : "주소를 검색하거나 지도에서 필지를 선택해 보세요."}</div>`;
  $$("[data-record-id]").forEach((button) => button.addEventListener("click", () => {
    const record = state.records.find((item) => item.id === button.dataset.recordId);
    if (!record) return;
    void selectRecordFromList(record);
  }));
  $$("[data-compare-id]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const id = checkbox.dataset.compareId;
    if (checkbox.checked && state.compareIds.size >= 4) {
      checkbox.checked = false;
      showToast("관심 토지는 최대 4개까지 비교할 수 있어요.");
      return;
    }
    if (checkbox.checked) state.compareIds.add(id);
    else state.compareIds.delete(id);
    render();
  }));
  updateCompareBar();
  updateFavoriteCount();
}

function updateCompareBar() {
  [...state.compareIds].forEach((id) => {
    if (!state.favorites.has(id) || !state.records.some((record) => record.id === id)) state.compareIds.delete(id);
  });
  const count = state.compareIds.size;
  $("#compareBar").hidden = state.filter !== "favorite";
  $("#compareCount").textContent = count;
  $("#openCompare").disabled = count < 2;
  $("#openCompare").textContent = count >= 2 ? `${count}개 비교하기` : "2개 이상 선택";
}

function toggleFavorite(id = state.selectedId) {
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
    state.compareIds.delete(id);
    showToast("관심 토지에서 삭제했어요.");
  } else {
    state.favorites.add(id);
    showToast("관심 토지에 저장했어요.");
  }
  persistFavorites();
  updateDetailFavorite(id);
  render();
}

function updateDetailFavorite(id) {
  const active = state.favorites.has(id);
  $("#detailFavorite").classList.toggle("active", active);
  $("#detailFavorite").setAttribute("aria-label", active ? "관심 토지에서 삭제" : "관심 토지에 추가");
}

function updateFavoriteCount() {
  $("#favoriteCount").textContent = state.favorites.size;
  $("#favoriteCount").classList.toggle("show", state.favorites.size > 0);
}

function persistFavorites() {
  const records = state.records.filter((record) => state.favorites.has(record.id)).map(({
    properties,
    eumLandUse,
    eumLandUseLoading,
    eumLandUseError,
    ...record
  }) => record);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(records));
}

function restoreFavorites() {
  try {
    const records = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    if (!Array.isArray(records)) return;
    records.filter((record) => record?.id && Number.isFinite(record?.lon) && Number.isFinite(record?.lat)).forEach((record) => {
      state.records.push(record);
      state.favorites.add(record.id);
    });
  } catch {
    localStorage.removeItem(FAVORITES_KEY);
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

async function copyToClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();
    return copied;
  }
}

function mainSheetCollapse(collapsed) {
  $("#mainSheet").classList.toggle("collapsed", collapsed);
  $("#sheetToggle").setAttribute("aria-expanded", String(!collapsed));
}

$("#searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  performSearch($("#searchInput").value);
});

$("#searchInput").addEventListener("input", () => {
  if (!$("#searchInput").value.trim()) $("#searchSuggestions").classList.remove("show");
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-wrap")) $("#searchSuggestions").classList.remove("show");
});

$$("[data-map-mode]").forEach((button) => button.addEventListener("click", () => setMapMode(button.dataset.mapMode)));

$$(".quick-card").forEach((button) => button.addEventListener("click", () => {
  const mode = button.dataset.mode;
  if (mode === "map") {
    setMapMode("cadastral");
    mainSheetCollapse(true);
    showToast("지적 경계 안쪽을 눌러 필지를 선택하세요.");
  } else {
    state.searchMode = mode;
    $("#searchInput").placeholder = mode === "road" ? "예: 세종대로 110" : "예: 신사동 501 또는 신림동 산74";
    $("#searchInput").focus();
    showToast(mode === "road" ? "도로명 주소를 입력해 주세요." : "읍면동과 지번을 입력해 주세요.");
  }
}));

$$(".filter-chip").forEach((button) => button.addEventListener("click", () => {
  state.filter = button.dataset.filter;
  $$(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
  render();
}));

$$(".view-switch button").forEach((button) => button.addEventListener("click", () => {
  state.view = button.dataset.view;
  $$(".view-switch button").forEach((item) => item.classList.toggle("active", item === button));
  render();
}));

$("#sheetToggle").addEventListener("click", () => mainSheetCollapse(!$("#mainSheet").classList.contains("collapsed")));
$("#zoomIn").addEventListener("click", () => map?.getView().animate({zoom: Math.min(19, map.getView().getZoom() + 1), duration: 220}));
$("#zoomOut").addEventListener("click", () => map?.getView().animate({zoom: Math.max(6, map.getView().getZoom() - 1), duration: 220}));

$("#locateButton").addEventListener("click", () => {
  if (!navigator.geolocation) return showToast("현재 위치를 사용할 수 없는 환경입니다.");
  navigator.geolocation.getCurrentPosition(({coords}) => {
    map.getView().animate({center: fromLonLat([coords.longitude, coords.latitude]), zoom: 17, duration: 500});
    showToast("현재 위치로 이동했어요.");
  }, () => showToast("위치 권한을 허용하면 내 주변을 찾을 수 있어요."), {enableHighAccuracy: true, timeout: 8000});
});

$("#favoritesButton").addEventListener("click", () => {
  state.filter = "favorite";
  $$(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.filter === "favorite"));
  mainSheetCollapse(false);
  render();
  showToast(state.favorites.size ? "관심 토지만 모아봤어요." : "아직 저장한 관심 토지가 없어요.");
});

$("#detailFavorite").addEventListener("click", () => toggleFavorite());
$("#detailClose").addEventListener("click", closeDetail);

$$('[data-detail-tab]').forEach((button) => {
  button.addEventListener("click", () => setDetailTab(button.dataset.detailTab));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = $$('[data-detail-tab]');
    const current = tabs.indexOf(button);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setDetailTab(tabs[nextIndex].dataset.detailTab);
  });
});

$("#copyParcelAddress").addEventListener("click", async () => {
  const record = state.records.find((item) => item.id === state.selectedId);
  const address = record?.address || record?.road;
  if (!address) return showToast("복사할 주소가 없습니다.");
  const copied = await copyToClipboard(address);
  showToast(copied ? "선택한 지번 주소를 복사했어요." : "주소를 복사하지 못했어요.");
});

$("#openNaverDirections").addEventListener("click", () => {
  const record = state.records.find((item) => item.id === state.selectedId);
  openNaverDirections(record);
});

$("#openGoogleDirections").addEventListener("click", () => {
  const record = state.records.find((item) => item.id === state.selectedId);
  openGoogleDirections(record);
});

$("#openKakaoDirections").addEventListener("click", () => {
  const record = state.records.find((item) => item.id === state.selectedId);
  openKakaoDirections(record);
});

$("#fieldRecordForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const record = state.records.find((item) => item.id === state.selectedId);
  if (record) saveFieldRecord(record);
});

$("#deleteFieldRecord").addEventListener("click", () => {
  const record = state.records.find((item) => item.id === state.selectedId);
  if (record) deleteFieldRecord(record);
});

$$('.related-service-link').forEach((link) => link.addEventListener("click", async (event) => {
  const record = state.records.find((item) => item.id === state.selectedId);
  if (link.hasAttribute("data-eum-land-use")) {
    event.preventDefault();
    openEumLandUse(record);
    return;
  }
  const address = record?.address || record?.road;
  const label = link.dataset.serviceLabel || "유관 기관";
  if (!address) return showToast(`${label} 공식 사이트를 새 창에서 열었어요.`);
  const copied = await copyToClipboard(address);
  showToast(copied ? `${label} 검색용 지번을 복사했어요.` : `${label} 공식 사이트를 새 창에서 열었어요.`);
}));

const exportDialog = $("#exportDialog");
const exportLabels = {pdf: "PDF", docx: "DOCX", hwpx: "HWPX", pptx: "PPTX", png: "PNG", jpg: "JPG"};
let currentReportModel = null;

function setExportBusy(busy, format = "") {
  exportDialog.setAttribute("aria-busy", String(busy));
  $("#exportProgress").hidden = !busy;
  $("#exportProgressText").textContent = format ? `${exportLabels[format]} 파일을 만들고 있어요.` : "필지 주변 지도와 보고서를 준비하고 있어요.";
  $$("[data-export-format]").forEach((button) => { button.disabled = busy; });
  $("#exportClose").disabled = busy;
}

$("#openExport").addEventListener("click", async () => {
  const record = state.records.find((item) => item.id === state.selectedId);
  if (!record) return;
  if (record.landRegisterLoading || record.eumLandUseLoading || record.buildingLoading) {
    showToast("토지·건축물 정보 조회가 끝난 뒤 다운로드할 수 있어요.");
    return;
  }
  $("#exportAddress").textContent = record.address || "선택한 필지";
  currentReportModel = null;
  $("#exportPreview").innerHTML = "<p>필지 주변 지도와 보고서를 준비하고 있어요.</p>";
  setExportBusy(true);
  exportDialog.showModal();
  const model = buildReportModel(record);
  try {
    model.mapImage = await captureParcelMapImage(record);
  } catch (error) {
    console.warn("Parcel map capture failed", error);
    model.mapImage = "";
    showToast("지도 캡처를 만들지 못해 정보 보고서만 표시합니다.");
  }
  currentReportModel = model;
  window.ReportExporter?.renderPreview(model, $("#exportPreview"));
  setExportBusy(false);
});

$("#exportClose").addEventListener("click", () => exportDialog.close());
exportDialog.addEventListener("click", (event) => {
  if (event.target === exportDialog && exportDialog.getAttribute("aria-busy") !== "true") exportDialog.close();
});

$$(`[data-export-format]`).forEach((button) => button.addEventListener("click", async () => {
  if (!currentReportModel || !window.ReportExporter) return showToast("보고서 미리보기가 준비될 때까지 기다려 주세요.");
  const format = button.dataset.exportFormat;
  setExportBusy(true, format);
  try {
    await window.ReportExporter.exportReport(currentReportModel, format);
    exportDialog.close();
    showToast(`${exportLabels[format]} 보고서를 다운로드했어요.`);
  } catch (error) {
    console.error(`${format} report export failed`, error);
    showToast(`${exportLabels[format]} 파일을 만들지 못했어요. 다시 시도해 주세요.`);
  } finally {
    setExportBusy(false);
  }
}));

const compareDialog = $("#compareDialog");
$("#openCompare").addEventListener("click", () => {
  if (state.compareIds.size < 2) return showToast("비교할 관심 토지를 2개 이상 선택해 주세요.");
  renderCompareDialog();
  compareDialog.showModal();
  void loadCompareRecords();
});
$("#compareClose").addEventListener("click", () => compareDialog.close());
$("#compareConfirm").addEventListener("click", () => compareDialog.close());
$("#retryCompare").addEventListener("click", () => void retryCompareRecords());
compareDialog.addEventListener("click", (event) => {
  if (event.target === compareDialog) compareDialog.close();
});

const infoDialog = $("#infoDialog");
$("#helpButton").addEventListener("click", () => infoDialog.showModal());
$("#dialogClose").addEventListener("click", () => infoDialog.close());
$("#dialogConfirm").addEventListener("click", () => infoDialog.close());
$("#mapRetry").addEventListener("click", initMap);

$("#brandButton").addEventListener("click", () => {
  closeDetail();
  state.filter = "all";
  state.searchMode = "all";
  $("#searchInput").value = "";
  $("#searchInput").placeholder = "도로명, 지번 또는 건물명 검색";
  $$(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.filter === "all"));
  mainSheetCollapse(false);
  setMapMode("normal", false);
  map?.getView().animate({center: fromLonLat([126.978, 37.5665]), zoom: 12, duration: 450});
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#detailSheet").classList.contains("open")) closeDetail();
});

if (document.readyState === "complete") initMap();
else window.addEventListener("load", initMap, {once: true});
