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
const GOV_LAND_REGISTER_URL = "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000026&HighCtgCD=A09005";
const GOV_CADASTRAL_MAP_URL = "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000027&HighCtgCD=A09005&tp_seq=0";
const IROS_URL = "https://www.iros.go.kr/";
const FAVORITES_KEY = "tojihannun-vworld-favorites-v1";
const RECENT_PARCELS_KEY = "tojihannun-recent-parcels-v1";
const MAX_RECENT_PARCELS = 50;
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
  detailTab: "basic",
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
let locatingUser = false;
let sharedParcelOpened = false;

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
  restoreRecentParcels();
  restoreFavorites();
  render();
  void openSharedParcelFromUrl();

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
  const targets = [
    ...categories.map((category) => ({type: "address", category})),
    ...(mode === "all" ? [{type: "place", category: ""}] : [])
  ];
  const requests = targets.map(async ({type, category}) => {
    const url = apiUrl("search", {
      service: "search",
      request: "search",
      version: "2.0",
      crs: "EPSG:4326",
      size: 10,
      page: 1,
      query,
      type,
      category,
      format: "json",
      errorformat: "json"
    });
    const data = await fetchJson(url);
    const response = data?.response;
    if (response?.status && response.status !== "OK" && response.status !== "NOT_FOUND") {
      throw new Error(response?.error?.text || response.status);
    }
    return (response?.result?.items || []).map((item, index) => normalizeSearchItem(item, type === "place" ? "place" : category, index));
  });
  const settled = await Promise.allSettled(requests);
  const failures = settled.filter((result) => result.status === "rejected");
  const items = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!items.length && failures.length === settled.length) throw failures[0].reason;

  const normalizedQuery = query.replace(/\s+/g, "").toLowerCase();
  const ranked = items.sort((a, b) => searchResultRank(b, normalizedQuery) - searchResultRank(a, normalizedQuery));
  const seen = new Set();
  return ranked.filter((item) => {
    const key = (item.parcel || item.road || item.address || `${item.lon},${item.lat}`).replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function searchResultRank(item, normalizedQuery) {
  if (item.category !== "place") return 100;
  const title = item.title.replace(/\s+/g, "").toLowerCase();
  const placeCategory = item.placeCategory || "";
  let rank = /아파트단지|건물|주거용공동주택/.test(placeCategory) ? 40 : 0;
  if (/버스터미널|정류장/.test(placeCategory)) rank -= 20;
  if (title === normalizedQuery) rank += 20;
  else if (title.startsWith(normalizedQuery)) rank += 10;
  else if (title.includes(normalizedQuery) || normalizedQuery.includes(title)) rank += 5;
  return rank;
}

function normalizeSearchItem(item, category, index) {
  const lon = Number(item?.point?.x);
  const lat = Number(item?.point?.y);
  const road = cleanText(item?.address?.road || "");
  const parcel = cleanText(item?.address?.parcel || "");
  const title = cleanText(item?.title || "");
  const address = category === "parcel" || category === "place" ? parcel || road || title : road || parcel || title;
  return {
    id: `search-${category}-${lon}-${lat}-${index}`,
    pnu: /^\d{19}$/.test(String(item?.id || "")) ? String(item.id) : "",
    category,
    title: title || address,
    address,
    road,
    parcel,
    placeCategory: category === "place" ? cleanText(item?.category || "") : "",
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
    return false;
  }
  setSearchLoading(true);
  try {
    const results = await searchVWorld(value, state.searchMode);
    state.searchResults = results.filter((item) => Number.isFinite(item.lon) && Number.isFinite(item.lat));
    renderSuggestions(state.searchResults);
    if (!state.searchResults.length) showToast("검색 결과가 없어요. 주소·지번·건물명을 다시 확인해 주세요.");
    return state.searchResults.length > 0;
  } catch (error) {
    console.error("VWorld search failed", error);
    renderSuggestions([]);
    showToast("검색에 실패했어요. 인증키와 네트워크를 확인해 주세요.");
    return false;
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
    box.innerHTML = `<div class="empty-suggestion">일치하는 주소나 명칭을 찾지 못했어요.<br><small>주소·지번 또는 아파트·건물명을 입력해 보세요.</small></div>`;
    box.classList.add("show");
    return;
  }
  box.innerHTML = results.map((item, index) => `
    <button class="suggestion" type="button" role="option" data-result-index="${index}">
      <span>${item.category === "place" ? "명" : item.category === "parcel" ? "지" : "길"}</span>
      <span><strong>${escapeHtml(item.category === "place" ? item.title : item.address)}</strong><small>${escapeHtml(item.category === "place" ? [item.address, item.placeCategory].filter(Boolean).join(" · ") : item.category === "parcel" ? item.road || "지번 주소" : item.parcel || "도로명 주소")}</small></span>
    </button>`).join("");
  box.classList.add("show");
  $$("[data-result-index]").forEach((button) => button.addEventListener("click", () => selectSearchResult(state.searchResults[Number(button.dataset.resultIndex)])));
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"})[character]);
}

async function selectSearchResult(result) {
  if (!result) return;
  $("#searchInput").value = result.category === "place" ? result.title : result.address;
  $("#searchSuggestions").classList.remove("show");
  setMapMode("cadastral", false);
  mainSheetCollapse(true);
  map.getView().animate({center: fromLonLat([result.lon, result.lat]), zoom: 18, duration: 550});
  $("#mapStatus").textContent = result.category === "place" ? `${result.title} · ${result.address}` : result.address;
  await inspectParcel([result.lon, result.lat], result);
}

function sharedParcelResultFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("share") !== "parcel") return null;
  const lon = Number(params.get("lon"));
  const lat = Number(params.get("lat"));
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  const address = cleanText(params.get("address") || "공유된 필지");
  return {
    category: "parcel",
    address,
    parcel: address,
    road: cleanText(params.get("road") || ""),
    pnu: String(params.get("pnu") || "").replace(/\D/g, "").slice(0, 19),
    lon,
    lat
  };
}

async function openSharedParcelFromUrl() {
  if (!map || sharedParcelOpened) return;
  const result = sharedParcelResultFromUrl();
  if (!result) return;
  sharedParcelOpened = true;
  $("#searchInput").value = result.address;
  setMapMode("cadastral", false);
  mainSheetCollapse(true);
  map.getView().setCenter(fromLonLat([result.lon, result.lat]));
  map.getView().setZoom(18);
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
    ledgerKind: String(item.buldKndCode || item.agbldgSeCode || ""),
    ledgerKindName: cleanText(item.buldKndCodeNm || "건축물대장"),
    buildingTypeCode: String(item.agbldgSeCode || ""),
    buildingTypeName: cleanText(item.agbldgSeCodeNm || ""),
    name: cleanText(item.buldNm || ""),
    dongName: cleanText(item.buldDongNm || ""),
    lotAddress: cleanText([item.ldCodeNm, item.mnnmSlno].filter(Boolean).join(" ")),
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

function buildingDisplayName(building, index = 0) {
  const names = [building?.name, building?.dongName].map((value) => cleanText(value)).filter(Boolean);
  const uniqueNames = names.filter((value, nameIndex) => names.indexOf(value) === nameIndex);
  return uniqueNames.join(" ") || `건축물 ${index + 1}`;
}

function hasDistrictPlanInformation(record) {
  if (!String(record?.pnu || "").startsWith("11")) return false;
  const eum = record?.eumLandUse || {};
  const designations = [
    ...(eum.nationalPlan || []),
    ...(eum.otherLaws || []),
    ...(eum.decree || []),
    ...(eum.zones || [])
  ];
  return designations.some((item) => /지구단위계획/.test(cleanText(typeof item === "string" ? item : item?.name)));
}

function openBuildingDocumentViewer(record, building = null, tab = "building") {
  const selectedBuilding = building || (Array.isArray(record.buildings) ? record.buildings[0] : null) || null;
  const initialTab = selectedBuilding || !["building", "lifecycle"].includes(tab) ? tab : "land-register";
  const viewerKey = `tojihannun-document-viewer-v1:${record.pnu}`;
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    pnu: record.pnu,
    address: record.address || "",
    hasDistrictPlan: hasDistrictPlanInformation(record),
    buildings: (record.buildings || []).map((item) => ({
      id: item.id,
      ledgerKind: item.ledgerKind,
      ledgerKindName: item.ledgerKindName,
      buildingTypeName: item.buildingTypeName,
      name: item.name,
      dongName: item.dongName,
      lotAddress: item.lotAddress,
      use: item.use,
      isMain: item.isMain
    }))
  };
  try {
    localStorage.setItem(viewerKey, JSON.stringify(payload));
  } catch {
    // 저장 공간이 차단된 경우에도 현재 건축물은 URL 매개변수로 조회한다.
  }
  const params = new URLSearchParams({
    pnuCode: record.pnu,
    mgmBldrgstPk: selectedBuilding?.id || "",
    regstrKindCd: selectedBuilding?.ledgerKind || "1",
    ledgerKindName: selectedBuilding?.ledgerKindName || "건축물대장",
    buildingName: selectedBuilding?.name || "",
    buildingDongName: selectedBuilding?.dongName || "",
    address: record.address || selectedBuilding?.lotAddress || "",
    viewerKey,
    selectedBuilding: selectedBuilding?.id || "all",
    tab: initialTab
  });
  if (payload.hasDistrictPlan) params.set("districtPlan", "1");
  window.open(`./building-ledger.html?${params}`, "_blank", "noopener,noreferrer");
}

function integratedLedgerActionMarkup() {
  return `<button class="building-integrated-button" id="openIntegratedLedger" type="button">
    <span class="building-integrated-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 3.5h10l4 4V20.5H5Z"/><path d="M15 3.5v4h4M8.5 11h7M8.5 14.5h7M8.5 18h4.5"/></svg></span>
    <span class="building-integrated-copy"><strong>대장 통합 보기</strong><small>토지대장 · 토지이용계획 · 건축물대장 · 생애이력</small></span>
    <span class="building-integrated-arrow" aria-hidden="true">›</span>
  </button>`;
}

function bindIntegratedLedgerAction(record, building = null) {
  $("#openIntegratedLedger")?.addEventListener("click", () => {
    openBuildingDocumentViewer(record, building, building ? "building" : "land-register");
  });
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
  const mergedRecord = existingIndex >= 0 ? {...state.records[existingIndex], ...record} : record;
  if (existingIndex >= 0) state.records.splice(existingIndex, 1);
  state.records.unshift(mergedRecord);
  state.selectedId = record.id;
  persistRecentParcels();
  if (state.favorites.has(record.id)) persistFavorites();
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

function renderOfficialDocumentAccess(record, landRegister = null) {
  const ownerships = landRegister?.ownerships?.length
    ? landRegister.ownerships
    : landRegister?.ownership
      ? [landRegister.ownership]
      : [];
  const hasLandData = Boolean(landRegister?.availableSources);
  const canShowBoundary = Boolean(record?.pnu && Number.isFinite(record?.lon) && Number.isFinite(record?.lat));
  const cards = [
    {
      tone: "land",
      mark: "대",
      title: "토지대장",
      status: hasLandData ? "공개정보 조회 완료" : "공식 열람·발급 제공",
      available: hasLandData,
      description: hasLandData
        ? "지목·면적·공시지가·토지특성·이동 이력을 아래에서 확인할 수 있습니다."
        : "공개 API 정보가 없거나 조회에 실패했습니다. 정부24에서 원문을 확인해 주세요.",
      localAction: hasLandData ? `<button type="button" data-document-action="land">내용 보기</button>` : "",
      officialUrl: GOV_LAND_REGISTER_URL,
      officialLabel: "정부24 원문"
    },
    {
      tone: "map",
      mark: "지",
      title: "지적도 등본",
      status: canShowBoundary ? "연속지적도 경계 표시 가능" : "공식 열람·발급 제공",
      available: canShowBoundary,
      description: canShowBoundary
        ? "앱 지도에서 VWorld 연속지적도 경계를 확인할 수 있습니다. 공식 등본과 측량 성과를 대신하지 않습니다."
        : "이 필지의 경계를 앱에서 표시할 수 없어 정부24 공식 민원을 연결합니다.",
      localAction: canShowBoundary ? `<button type="button" data-document-action="cadastral">지도에서 보기</button>` : "",
      officialUrl: GOV_CADASTRAL_MAP_URL,
      officialLabel: "등본 열람·발급"
    },
    {
      tone: "shared",
      mark: "공",
      title: "공유지연명부",
      status: ownerships.length ? `개인정보 제외 ${ownerships.length}건` : "공식 열람·발급 제공",
      available: Boolean(ownerships.length),
      description: ownerships.length
        ? "공개 API가 제공하는 소유구분·거주지 구분·공유인 수·변동 정보만 아래에 표시합니다."
        : "성명·주소·등록번호·지분 등 원문 정보는 공개 API로 제공되지 않습니다.",
      localAction: ownerships.length ? `<button type="button" data-document-action="ownership">공개정보 보기</button>` : "",
      officialUrl: GOV_LAND_REGISTER_URL,
      officialLabel: "정부24 확인"
    },
    {
      tone: "registry",
      mark: "등",
      title: "등기사항전부증명서",
      status: "공식 사이트에서 열람·발급",
      available: false,
      description: "소유권·근저당권 등 등기 원문은 공개 API로 가져오지 않으며 인터넷등기소에서 확인합니다.",
      localAction: `<button type="button" data-document-action="copy-address">주소 복사</button>`,
      officialUrl: IROS_URL,
      officialLabel: "인터넷등기소"
    }
  ];
  return `
    <section class="official-documents" aria-labelledby="officialDocumentsTitle">
      <div class="official-documents-heading">
        <div><span>필지별 공부서류</span><strong id="officialDocumentsTitle">조회 가능한 내용과 공식 원문</strong></div>
        <small>조회 필지 · ${escapeHtml(record?.number || record?.pnu || "지번 미제공")}</small>
      </div>
      <div class="official-document-grid">
        ${cards.map((card) => `<article class="official-document-card ${card.available ? "available" : "linked"}" data-tone="${card.tone}">
          <div class="official-document-title"><span class="official-document-icon" aria-hidden="true">${card.mark}</span><div><strong>${card.title}</strong><em>${escapeHtml(card.status)}</em></div></div>
          <p>${escapeHtml(card.description)}</p>
          <div class="official-document-actions">${card.localAction}<a href="${card.officialUrl}" target="_blank" rel="noopener noreferrer" aria-label="${card.title} ${card.officialLabel}, 새 창">${card.officialLabel}<span aria-hidden="true">↗</span></a></div>
        </article>`).join("")}
      </div>
      <p class="official-documents-note">화면 정보는 참고용입니다. 법적 증명, 소유자 개인정보 및 등기 권리관계는 공식 원문을 열람·발급해 확인하세요.</p>
    </section>`;
}

function buildReportModel(record) {
  const land = record.landRegister || {};
  const eum = record.eumLandUse || {};
  const sourceMeta = ensureSourceMeta(record);
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
    ["데이터 레이어", record.dataset || "주소 검색 결과"],
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
    ["토지특성 기준연도", characteristic?.stdrYear ? `${characteristic.stdrYear}년` : "-"],
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
        ["건축물 식별번호", building.id || "-"],
        ["대장 종류", [building.ledgerKindName, building.buildingTypeName].filter(Boolean).join(" · ") || "-"],
        ["건물명", building.name || "미제공"],
        ["동명", building.dongName || "미제공"],
        ["대지 위치", building.lotAddress || record.address || "-"],
        ["주용도", building.use || "-"],
        ["층수", floors],
        ["건축면적", formatMetric(building.buildingArea, "㎡")],
        ["연면적", formatMetric(building.totalArea, "㎡")],
        ["건폐율", formatMetric(building.buildingCoverage, "%")],
        ["용적률", formatMetric(building.floorAreaRatio, "%")],
        ["사용승인연도", formatApprovalYear(building.approvalDate)],
        ["정보 기준일", formatDate(building.lastUpdated)]
      ]
    });
  });

  if (!Array.isArray(record.buildings) || !record.buildings.length) {
    sections.push({title: "건축물 정보", kind: "keyValue", rows: []});
  }

  const marketSections = window.TojihannunMarketData?.getReportSections?.() || [];
  sections.push(...marketSections);
  sections.push({
    title: "정보 출처 및 데이터 기준",
    kind: "keyValue",
    rows: [
      ["필지 식별·경계", sourceMetaText(sourceMeta.parcel, "VWorld 공간정보 오픈플랫폼")],
      ["토지대장", sourceMetaText(sourceMeta.landRegister, "국토교통부 국가공간정보센터 공개 API")],
      ["토지이용계획", sourceMetaText(sourceMeta.eumLandUse, "토지이음")],
      ["건축물", sourceMetaText(sourceMeta.building, "VWorld 건축물 공개 API")],
      ["실거래", "국토교통부 실거래가 공개시스템 · 보고서 생성 시 조회"],
      ["경매·공매", "온비드 차세대 공개 API · 보고서 생성 시 조회"]
    ]
  });

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
    source: `VWorld 공간정보 오픈플랫폼 · 국토교통부 국가공간정보센터 공개 API${eum.zones?.length ? " · 토지이음 토지이용계획 열람" : ""} · 국토교통부 실거래가 공개시스템 · 온비드`,
    notice: "이 보고서는 공개 API 조회정보를 정리한 참고자료이며 법적 증명 효력이 없습니다. 필지 경계와 면적은 측량 성과와 다를 수 있고, 면적×공시지가 단순 계산 참고값은 실거래가·매매가격·감정가가 아닙니다. 실거래와 경매·공매 정보는 신고·공고 변경에 따라 달라질 수 있으므로 공식 시스템에서 다시 확인해야 합니다. 소유자 성명, 주소, 등록번호, 지분 등 개인정보는 포함하지 않습니다."
  };
}

function renderLandRegisterSection(record) {
  const content = $("#landRegisterContent");
  const badge = $("#landRegisterBadge");
  const meta = ensureSourceMeta(record).landRegister;
  setCardMeta("#landRegisterMeta", meta, "국토교통부 국가공간정보센터 공개 API");
  $("#landRegisterCardTitle").textContent = "토지·지적·등기 서류";
  if (!record.landRegister) {
    badge.textContent = record.landRegisterError ? "조회 실패" : "조회 중";
    content.innerHTML = `${renderOfficialDocumentAccess(record)}<p class="building-empty">${record.landRegisterError ? "토지대장 공개정보를 불러오지 못했어요. 공식 원문 링크를 이용해 주세요." : "토지대장 공개정보를 확인하고 있어요."}</p>`;
    return;
  }

  const {base, ownership, characteristic, price, uses, movements, availableSources, partial} = record.landRegister;
  const ownerships = record.landRegister.ownerships?.length ? record.landRegister.ownerships : ownership ? [ownership] : [];
  if (!availableSources) {
    badge.textContent = "정보 없음";
    content.innerHTML = `${renderOfficialDocumentAccess(record, record.landRegister)}<p class="building-empty">이 필지에서 공개 API로 확인된 대장 정보가 없어요. 위 공식 원문 링크를 이용해 주세요.</p>`;
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
    ${renderOfficialDocumentAccess(record, record.landRegister)}
    <dl class="building-facts land-register-summary">${summaryFacts.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
    <p class="land-value-note">면적×공시지가 단순 계산 참고값은 실거래가·매매가격·감정가가 아닙니다.</p>
    <div class="land-register-details">
      <details open><summary>토지특성 상세</summary><dl class="building-facts">${characteristicFacts.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></details>
      ${useDetails}
      ${ownershipDetails}
      ${movementDetails}
    </div>`;
}

async function showCadastralDocument(record) {
  if (!record) return;
  setMapMode("cadastral");
  let rawFeature = parcelFeatureCache.get(record.id) || null;
  if (!rawFeature) {
    showToast("필지 경계를 불러오고 있어요.");
    try {
      const parcelFeature = await fetchParcelFeature([record.lon, record.lat]);
      rawFeature = parcelFeature?.feature || null;
      if (rawFeature) parcelFeatureCache.set(record.id, rawFeature);
    } catch (error) {
      console.error("Cadastral boundary lookup failed", error);
    }
  }
  showSelectedParcel(record, rawFeature);
  if (window.matchMedia("(max-width: 720px)").matches) detailSheetCollapse(true);
  showToast(rawFeature ? "지도에 선택 필지의 연속지적도 경계를 표시했어요." : "지적 경계를 불러오지 못했어요. 정부24 공식 등본을 확인해 주세요.");
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
    content.innerHTML = `<p class="building-empty">건축물 정보를 확인하고 있어요.</p>${integratedLedgerActionMarkup()}`;
    bindIntegratedLedgerAction(record);
    return;
  }
  if (!record.buildings.length) {
    count.hidden = true;
    content.innerHTML = `<p class="building-empty">${record.buildingError ? "건축물 정보를 불러오지 못했어요." : "이 필지에서 확인된 건축물 정보가 없어요."}</p>${integratedLedgerActionMarkup()}`;
    bindIntegratedLedgerAction(record);
    return;
  }
  const index = Math.min(Math.max(Number(selectedIndex) || 0, 0), record.buildings.length - 1);
  const building = record.buildings[index];
  count.hidden = false;
  count.textContent = `${record.buildings.length}개 동`;
  const selector = record.buildings.length > 1 ? `
    <select class="building-selector" id="buildingSelector" aria-label="건축물 선택">
      ${record.buildings.map((item, itemIndex) => `<option value="${itemIndex}"${itemIndex === index ? " selected" : ""}>${escapeHtml(buildingDisplayName(item, itemIndex))}${item.ledgerKindName ? ` · ${escapeHtml(item.ledgerKindName)}` : ""}${item.isMain ? " · 주건축물" : ""}</option>`).join("")}
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
    ${integratedLedgerActionMarkup()}`;
  $("#buildingSelector")?.addEventListener("change", (event) => renderBuildingSection(record, Number(event.target.value)));
  bindIntegratedLedgerAction(record, building);
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

function setDirectionsMenuOpen(open, restoreFocus = false) {
  const menu = $("#directionsMenu");
  const toggle = $("#toggleDirections");
  const providers = $("#directionsProviders");
  if (!menu || !toggle || !providers) return;
  menu.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", String(open));
  providers.setAttribute("aria-hidden", String(!open));
  providers.toggleAttribute("inert", !open);
  if (!open && restoreFocus) toggle.focus({preventScroll: true});
}

function openDetail(record) {
  if (!record) return;
  const detailSheet = $("#detailSheet");
  detailSheetCollapse(false);
  detailSheet.scrollTop = 0;
  setDirectionsMenuOpen(false);
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
  window.TojihannunMarketData?.setParcel(record);
  updateDetailFavorite(record.id);
  detailSheet.classList.add("open");
  detailSheet.setAttribute("aria-hidden", "false");
  window.TojihannunAds?.showParcelDetail(); // SOFTM-ADFIT-DETAIL 날짜:20261012 : 상세를 실제로 연 뒤에만 상세 광고를 요청
  setDetailTab(state.detailTab, false);
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
  window.TojihannunMarketData?.activate(tab);
  if (focus) nextButton.focus({preventScroll: true});
}

function closeDetail({resetTab = false} = {}) {
  setDirectionsMenuOpen(false);
  const detailSheet = $("#detailSheet");
  detailSheet.classList.remove("open", "collapsed", "dragging");
  detailSheet.style.removeProperty("--detail-drag-offset");
  detailSheet.setAttribute("aria-hidden", "true");
  if (resetTab) setDetailTab("basic", false);
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

function storedParcelRecord(record) {
  if (!record || typeof record !== "object") return null;
  const lon = Number(record.lon);
  const lat = Number(record.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  const pnu = String(record.pnu || "").replace(/\D/g, "").slice(0, 19);
  const fallbackId = `parcel-${lon.toFixed(7)}-${lat.toFixed(7)}`;
  const id = pnu || cleanText(record.id || fallbackId).slice(0, 128) || fallbackId;
  const isForest = record.type === "forest" || (pnu.length > 10 && pnu.charAt(10) === "2");
  const fetchedAt = String(record.sourceMeta?.parcel?.fetchedAt || "");
  return {
    id,
    pnu,
    address: cleanText(record.address || "선택한 필지"),
    road: cleanText(record.road || ""),
    number: cleanText(record.number || ""),
    type: isForest ? "forest" : "land",
    typeLabel: isForest ? "임야대장" : "토지대장",
    lon,
    lat,
    dataset: String(record.dataset || "").replace(/[^A-Z0-9_]/gi, "").slice(0, 64),
    properties: {},
    sourceMeta: {
      parcel: {
        source: "VWorld 공간정보 오픈플랫폼",
        asOf: "",
        fetchedAt,
        status: pnu ? "success" : "missing"
      }
    }
  };
}

function mergeStoredParcel(record) {
  const stored = storedParcelRecord(record);
  if (!stored) return null;
  const existingIndex = state.records.findIndex((item) => item.id === stored.id);
  if (existingIndex >= 0) state.records.splice(existingIndex, 1, {...stored, ...state.records[existingIndex]});
  else state.records.push(stored);
  return stored;
}

function persistRecentParcels() {
  try {
    const records = state.records.slice(0, MAX_RECENT_PARCELS).map(storedParcelRecord).filter(Boolean);
    localStorage.setItem(RECENT_PARCELS_KEY, JSON.stringify({version: 1, records}));
  } catch (error) {
    console.warn("Recent parcel list could not be saved", error);
  }
}

function restoreRecentParcels() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_PARCELS_KEY) || "null");
    const records = Array.isArray(parsed) ? parsed : parsed?.version === 1 && Array.isArray(parsed.records) ? parsed.records : [];
    records.slice(0, MAX_RECENT_PARCELS).forEach(mergeStoredParcel);
  } catch {
    localStorage.removeItem(RECENT_PARCELS_KEY);
  }
}

function persistFavorites() {
  const records = state.records.filter((record) => state.favorites.has(record.id)).map(storedParcelRecord).filter(Boolean);
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(records));
  } catch (error) {
    console.warn("Favorite parcel list could not be saved", error);
  }
}

function restoreFavorites() {
  try {
    const records = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    if (!Array.isArray(records)) return;
    records.forEach((record) => {
      const stored = mergeStoredParcel(record);
      if (stored) state.favorites.add(stored.id);
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

function buildParcelShareUrl(record) {
  if (!record || !Number.isFinite(Number(record.lon)) || !Number.isFinite(Number(record.lat))) return "";
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set("share", "parcel");
  url.searchParams.set("v", "1");
  url.searchParams.set("lat", Number(record.lat).toFixed(7));
  url.searchParams.set("lon", Number(record.lon).toFixed(7));
  if (record.pnu) url.searchParams.set("pnu", record.pnu);
  if (record.address) url.searchParams.set("address", record.address);
  if (record.road) url.searchParams.set("road", record.road);
  return url.toString();
}

async function shareParcel(record) {
  const url = buildParcelShareUrl(record);
  if (!url) return showToast("공유할 필지 위치가 없습니다.");
  const data = {
    title: `${record.address || "선택한 필지"} | 토지한눈`,
    text: "토지 위치와 공개정보를 확인해 보세요.",
    url
  };
  try {
    if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(data))) {
      await navigator.share(data);
      showToast("필지 정보를 공유했어요.");
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
  }
  const copied = await copyToClipboard(url);
  showToast(copied ? "공유 링크를 복사했어요." : "공유 링크를 복사하지 못했어요.");
}

const mainSheetElement = $("#mainSheet");
const sheetDragHandle = $("#sheetDragHandle");
const detailSheetElement = $("#detailSheet");
const detailDragHandle = $("#detailDragHandle");
const mobileDetailMedia = window.matchMedia("(max-width: 720px)");
let sheetDragState = null;
let suppressSheetHandleClick = false;
let detailDragState = null;
let suppressDetailHandleClick = false;

function mainSheetCollapse(collapsed) {
  mainSheetElement.classList.toggle("collapsed", collapsed);
  mainSheetElement.classList.remove("dragging");
  mainSheetElement.style.removeProperty("--sheet-drag-offset");
  $("#sheetToggle").setAttribute("aria-expanded", String(!collapsed));
  $("#sheetToggle").setAttribute("aria-label", collapsed ? "검색 패널 펼치기" : "검색 패널 접기");
  sheetDragHandle.setAttribute("aria-expanded", String(!collapsed));
}

function startMainSheetDrag(event) {
  if (!event.isPrimary || event.button !== 0) return;
  const collapsed = mainSheetElement.classList.contains("collapsed");
  const maxOffset = Math.max(0, mainSheetElement.offsetHeight - 88);
  sheetDragState = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startOffset: collapsed ? maxOffset : 0,
    currentOffset: collapsed ? maxOffset : 0,
    maxOffset,
    collapsed
  };
  suppressSheetHandleClick = false;
  mainSheetElement.classList.add("dragging");
  sheetDragHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function moveMainSheetDrag(event) {
  if (!sheetDragState || event.pointerId !== sheetDragState.pointerId) return;
  const delta = event.clientY - sheetDragState.startY;
  sheetDragState.currentOffset = Math.min(sheetDragState.maxOffset, Math.max(0, sheetDragState.startOffset + delta));
  mainSheetElement.style.setProperty("--sheet-drag-offset", `${sheetDragState.currentOffset}px`);
  suppressSheetHandleClick ||= Math.abs(delta) > 6;
  event.preventDefault();
}

function finishMainSheetDrag(event, cancelled = false) {
  if (!sheetDragState || event.pointerId !== sheetDragState.pointerId) return;
  const drag = sheetDragState;
  const delta = event.clientY - drag.startY;
  let collapsed = drag.collapsed;
  if (!cancelled) {
    collapsed = Math.abs(delta) > 50 ? delta > 0 : drag.currentOffset > drag.maxOffset / 2;
  }
  if (sheetDragHandle.hasPointerCapture(event.pointerId)) sheetDragHandle.releasePointerCapture(event.pointerId);
  sheetDragState = null;
  mainSheetCollapse(collapsed);
  if (suppressSheetHandleClick) requestAnimationFrame(() => { suppressSheetHandleClick = false; });
}

function syncDetailHandleMode() {
  const mobile = mobileDetailMedia.matches;
  detailDragHandle.tabIndex = mobile ? 0 : -1;
  detailDragHandle.setAttribute("aria-hidden", String(!mobile));
  if (!mobile) detailSheetCollapse(false);
}

function detailSheetCollapse(collapsed) {
  const shouldCollapse = Boolean(collapsed && mobileDetailMedia.matches);
  detailSheetElement.classList.toggle("collapsed", shouldCollapse);
  detailSheetElement.classList.remove("dragging");
  detailSheetElement.style.removeProperty("--detail-drag-offset");
  detailDragHandle.setAttribute("aria-expanded", String(!shouldCollapse));
  detailDragHandle.setAttribute("aria-label", shouldCollapse ? "상세 팝업 펼치기" : "상세 팝업 축소");
}

function startDetailSheetDrag(event) {
  if (!mobileDetailMedia.matches || !event.isPrimary || event.button !== 0) return;
  const collapsed = detailSheetElement.classList.contains("collapsed");
  const maxOffset = Math.max(0, detailSheetElement.offsetHeight - 112);
  detailDragState = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startOffset: collapsed ? maxOffset : 0,
    currentOffset: collapsed ? maxOffset : 0,
    maxOffset,
    collapsed
  };
  suppressDetailHandleClick = false;
  detailSheetElement.classList.add("dragging");
  detailDragHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function moveDetailSheetDrag(event) {
  if (!detailDragState || event.pointerId !== detailDragState.pointerId) return;
  const delta = event.clientY - detailDragState.startY;
  detailDragState.currentOffset = Math.min(detailDragState.maxOffset, Math.max(0, detailDragState.startOffset + delta));
  detailSheetElement.style.setProperty("--detail-drag-offset", `${detailDragState.currentOffset}px`);
  suppressDetailHandleClick ||= Math.abs(delta) > 6;
  event.preventDefault();
}

function finishDetailSheetDrag(event, cancelled = false) {
  if (!detailDragState || event.pointerId !== detailDragState.pointerId) return;
  const drag = detailDragState;
  const delta = event.clientY - drag.startY;
  let collapsed = drag.collapsed;
  if (!cancelled) collapsed = Math.abs(delta) > 48 ? delta > 0 : drag.currentOffset > drag.maxOffset / 2;
  if (detailDragHandle.hasPointerCapture(event.pointerId)) detailDragHandle.releasePointerCapture(event.pointerId);
  detailDragState = null;
  detailSheetCollapse(collapsed);
  if (suppressDetailHandleClick) requestAnimationFrame(() => { suppressDetailHandleClick = false; });
}

$("#searchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const hasResults = await performSearch($("#searchInput").value);
  if (hasResults && window.matchMedia("(max-width: 720px)").matches) mainSheetCollapse(true);
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
sheetDragHandle.addEventListener("pointerdown", startMainSheetDrag);
sheetDragHandle.addEventListener("pointermove", moveMainSheetDrag);
sheetDragHandle.addEventListener("pointerup", (event) => finishMainSheetDrag(event));
sheetDragHandle.addEventListener("pointercancel", (event) => finishMainSheetDrag(event, true));
sheetDragHandle.addEventListener("click", () => {
  if (suppressSheetHandleClick) {
    suppressSheetHandleClick = false;
    return;
  }
  mainSheetCollapse(!mainSheetElement.classList.contains("collapsed"));
});
sheetDragHandle.addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  mainSheetCollapse(event.key === "ArrowDown" || event.key === "End");
});
detailDragHandle.addEventListener("pointerdown", startDetailSheetDrag);
detailDragHandle.addEventListener("pointermove", moveDetailSheetDrag);
detailDragHandle.addEventListener("pointerup", (event) => finishDetailSheetDrag(event));
detailDragHandle.addEventListener("pointercancel", (event) => finishDetailSheetDrag(event, true));
detailDragHandle.addEventListener("click", () => {
  if (!mobileDetailMedia.matches) return;
  if (suppressDetailHandleClick) {
    suppressDetailHandleClick = false;
    return;
  }
  detailSheetCollapse(!detailSheetElement.classList.contains("collapsed"));
});
detailDragHandle.addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || !mobileDetailMedia.matches) return;
  event.preventDefault();
  detailSheetCollapse(event.key === "ArrowDown" || event.key === "End");
});
mobileDetailMedia.addEventListener?.("change", syncDetailHandleMode);
syncDetailHandleMode();
$("#zoomIn").addEventListener("click", () => map?.getView().animate({zoom: Math.min(19, map.getView().getZoom() + 1), duration: 220}));
$("#zoomOut").addEventListener("click", () => map?.getView().animate({zoom: Math.max(6, map.getView().getZoom() - 1), duration: 220}));

$("#locateButton").addEventListener("click", () => {
  if (!navigator.geolocation) return showToast("현재 위치를 사용할 수 없는 환경입니다.");
  if (locatingUser) return;
  const button = $("#locateButton");
  const finish = () => {
    locatingUser = false;
    button.disabled = false;
    button.classList.remove("locating");
    button.setAttribute("aria-busy", "false");
    button.setAttribute("aria-label", "현재 위치의 필지 조회");
  };
  locatingUser = true;
  button.disabled = true;
  button.classList.add("locating");
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-label", "현재 위치 확인 중");
  showToast("현재 위치를 확인하고 있어요.");
  navigator.geolocation.getCurrentPosition(async ({coords}) => {
    const lonLat = [coords.longitude, coords.latitude];
    const accuracy = Math.round(Number(coords.accuracy) || 0);
    try {
      setMapMode("cadastral", false);
      mainSheetCollapse(true);
      map.getView().animate({center: fromLonLat(lonLat), zoom: 18, duration: 500});
      $("#mapStatus").textContent = accuracy ? `현재 위치 ±${accuracy}m · 필지 조회 중` : "현재 위치의 필지 조회 중";
      showToast("현재 위치의 필지 정보를 확인하고 있어요.");
      await inspectParcel(lonLat, null);
    } catch (error) {
      console.error("Current location parcel lookup failed", error);
      showToast("현재 위치의 필지를 조회하지 못했어요. 다시 시도해 주세요.");
    } finally {
      finish();
    }
  }, (error) => {
    const messages = {
      1: "위치 권한을 허용하면 현재 필지를 조회할 수 있어요.",
      2: "현재 위치를 확인할 수 없어요. GPS와 네트워크를 확인해 주세요.",
      3: "현재 위치 확인 시간이 초과됐어요. 다시 시도해 주세요."
    };
    showToast(messages[error?.code] || "현재 위치를 확인하지 못했어요.");
    finish();
  }, {enableHighAccuracy: true, maximumAge: 30000, timeout: 15000});
});

$("#favoritesButton").addEventListener("click", () => {
  state.filter = "favorite";
  $$(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.filter === "favorite"));
  mainSheetCollapse(false);
  render();
  showToast(state.favorites.size ? "관심 토지만 모아봤어요." : "아직 저장한 관심 토지가 없어요.");
});

$("#detailFavorite").addEventListener("click", () => toggleFavorite());
$("#detailClose").addEventListener("click", () => closeDetail({resetTab: true}));

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

$("#landRegisterContent").addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-document-action]");
  if (!actionButton) return;
  const record = state.records.find((item) => item.id === state.selectedId);
  if (!record) return;
  const action = actionButton.dataset.documentAction;
  if (action === "cadastral") {
    await showCadastralDocument(record);
    return;
  }
  if (action === "copy-address") {
    const copied = await copyToClipboard(record.address || record.road || record.pnu || "");
    showToast(copied ? "등기소 검색용 주소를 복사했어요." : "복사할 주소가 없습니다.");
    return;
  }
  const target = action === "ownership"
    ? $("#landRegisterContent .ownership-list")?.closest("details")
    : $("#landRegisterContent .land-register-summary");
  if (target?.tagName === "DETAILS") target.open = true;
  target?.scrollIntoView({behavior: "smooth", block: "nearest"});
});

$("#openBasicIntegratedLedger").addEventListener("click", () => {
  const record = state.records.find((item) => item.id === state.selectedId);
  if (record) openBuildingDocumentViewer(record, null, "land-register");
});

$("#shareParcel").addEventListener("click", () => {
  const record = state.records.find((item) => item.id === state.selectedId);
  if (record) void shareParcel(record);
});

$("#toggleDirections").addEventListener("click", () => {
  setDirectionsMenuOpen(!$("#directionsMenu").classList.contains("open"));
});

document.addEventListener("click", (event) => {
  if (!$("#directionsMenu").contains(event.target)) setDirectionsMenuOpen(false);
});

$("#openNaverDirections").addEventListener("click", () => {
  setDirectionsMenuOpen(false, true);
  const record = state.records.find((item) => item.id === state.selectedId);
  openNaverDirections(record);
});

$("#openGoogleDirections").addEventListener("click", () => {
  setDirectionsMenuOpen(false, true);
  const record = state.records.find((item) => item.id === state.selectedId);
  openGoogleDirections(record);
});

$("#openKakaoDirections").addEventListener("click", () => {
  setDirectionsMenuOpen(false, true);
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
  try {
    await window.TojihannunMarketData?.prepareReportData?.();
  } catch (error) {
    console.warn("Market data report preparation failed", error);
  }
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
exportDialog.addEventListener("cancel", (event) => {
  if (exportDialog.getAttribute("aria-busy") === "true") event.preventDefault();
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
  if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
  if ($("#directionsMenu").classList.contains("open")) {
    setDirectionsMenuOpen(false, true);
    return;
  }
  if ($("#detailSheet").classList.contains("open")) closeDetail();
});

window.TojihannunAds?.init(); // SOFTM-ADFIT-INIT 날짜:20261012 : 광고 설정 검증 후 화면 진입 지면만 지연 요청
if (document.readyState === "complete") initMap();
else window.addEventListener("load", initMap, {once: true});
