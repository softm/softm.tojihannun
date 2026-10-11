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
const FAVORITES_KEY = "tojihannun-vworld-favorites-v1";

const state = {
  mapMode: "normal",
  filter: "all",
  view: "map",
  searchMode: "all",
  selectedId: null,
  records: [],
  favorites: new Set(),
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

function markerStyle(feature) {
  const label = feature.get("label") || "";
  return new Style({
    image: new CircleStyle({
      radius: 17,
      fill: new Fill({color: "#176b54"}),
      stroke: new Stroke({color: "#ffffff", width: 4})
    }),
    text: new Text({
      text: label.length > 6 ? "●" : label,
      font: "700 10px 'Noto Sans KR', sans-serif",
      fill: new Fill({color: "#ffffff"})
    })
  });
}

const selectionStyle = new Style({
  fill: new Fill({color: "rgba(30, 133, 98, 0.20)"}),
  stroke: new Stroke({color: "#0b7555", width: 4})
});

function initMap() {
  if (map) map.setTarget(undefined);
  $("#mapLoading").hidden = false;
  $("#mapError").hidden = true;
  mapErrorCount = 0;

  baseSource = new XYZ({
    url: "https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png",
    maxZoom: 19,
    attributions: "© VWorld"
  });
  satelliteSource = new XYZ({
    url: "https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg",
    maxZoom: 19,
    attributions: "© VWorld"
  });
  hybridSource = new XYZ({
    url: "https://xdworld.vworld.kr/2d/Hybrid/service/{z}/{x}/{y}.png",
    maxZoom: 19,
    attributions: "© VWorld"
  });

  const wmsParams = {
    LAYERS: "lp_pa_cbnd_bonbun,lp_pa_cbnd_bubun",
    STYLES: "lp_pa_cbnd_bonbun,lp_pa_cbnd_bubun",
    FORMAT: "image/png",
    TRANSPARENT: true,
    VERSION: "1.3.0"
  };
  cadastralSource = new TileWMS({
    url: `${API_BASE}/wms`,
    params: wmsParams,
    crossOrigin: "anonymous",
    transition: 0
  });

  baseLayer = new TileLayer({source: baseSource, visible: true});
  satelliteLayer = new TileLayer({source: satelliteSource, visible: false});
  hybridLayer = new TileLayer({source: hybridSource, visible: false});
  cadastralLayer = new TileLayer({source: cadastralSource, visible: false, opacity: 0.88});
  markerLayer = new VectorLayer({source: markerSource, style: markerStyle, zIndex: 20});
  selectionLayer = new VectorLayer({source: selectionSource, style: selectionStyle, zIndex: 18});

  map = new OLMap({
    target: "vworldMap",
    controls: defaultControls({zoom: false, rotate: false}),
    layers: [baseLayer, satelliteLayer, hybridLayer, cadastralLayer, selectionLayer, markerLayer],
    view: new View({
      center: fromLonLat([126.978, 37.5665]),
      zoom: 12,
      minZoom: 6,
      maxZoom: 19
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
  $$("[data-map-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mapMode === mode));
  $("#vworldMap").classList.toggle("parcel-pick-mode", mode === "cadastral");
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
  if (state.mapMode !== "cadastral") {
    showToast("‘위성+지적’을 선택하면 필지를 눌러 조회할 수 있어요.");
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
  settled.forEach((result, index) => {
    const [key, , rootName] = operations[index];
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

  return {version: 2, base, ownership, ownerships, characteristic, price, uses, movements, availableSources, partial: settled.some((result) => result.status === "rejected")};
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
  const pnu = String(lower.pnu || "");
  const reverseParcel = (reverseResults || []).find((item) => String(item?.type || "").toLowerCase().includes("parcel"));
  const reverseRoad = (reverseResults || []).find((item) => String(item?.type || "").toLowerCase().includes("road"));
  const address = searchResult?.parcel || searchResult?.address || cleanText(reverseParcel?.text || reverseRoad?.text || "선택한 필지");
  const road = searchResult?.road || cleanText(reverseRoad?.text || "");
  const number = String(lower.jibun || lower.jibun_bonbun || address.split(" ").at(-1) || "");
  const isForest = pnu.length > 10 ? pnu.charAt(10) === "2" : /(^|\s)산\s*\d/.test(address);
  const id = pnu || `parcel-${lon.toFixed(7)}-${lat.toFixed(7)}`;
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
    properties
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
      map.getView().fit(feature.getGeometry().getExtent(), {padding: [140, 70, 260, 70], maxZoom: 19, duration: 450});
    } catch (error) {
      console.warn("Parcel geometry could not be rendered", error);
    }
  }
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
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${Number(match[2])}.${Number(match[3])}` : "-";
}

function formatLandPrice(price) {
  const amount = Number(price?.pblntfPclnd || 0);
  if (!amount) return "-";
  const year = price?.stdrYear ? `${price.stdrYear}년 ` : "";
  return `${year}${new Intl.NumberFormat("ko-KR").format(amount)}원/㎡`;
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
    ["공시지가", formatLandPrice(price)],
    ["전체면적 공시지가 단순환산액", formatEstimatedValue(price, area)],
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
    source: "VWorld 공간정보 오픈플랫폼 · 국토교통부 국가공간정보센터 공개 API",
    notice: "이 보고서는 공개 API 조회정보를 정리한 참고자료이며 법적 증명 효력이 없습니다. 필지 경계와 면적은 측량 성과와 다를 수 있고, 전체면적 공시지가 환산액은 면적과 공시지가를 곱한 단순 계산값입니다. 소유자 성명, 주소, 등록번호, 지분 등 개인정보는 포함하지 않습니다."
  };
}

function renderLandRegisterSection(record) {
  const content = $("#landRegisterContent");
  const badge = $("#landRegisterBadge");
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
    ["공시지가", formatLandPrice(price)],
    ["전체면적 환산가", formatEstimatedValue(price, area)],
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
    <p class="land-value-note">전체면적 환산가는 면적 × 공시지가의 단순 계산값이며 실거래가·감정가가 아닙니다.</p>
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
  try {
    record.landRegister = await fetchLandRegisterDetails(record.pnu);
  } catch (error) {
    console.error("VWorld land register lookup failed", error);
    record.landRegisterError = true;
  } finally {
    record.landRegisterLoading = false;
    if (state.selectedId === record.id && $("#detailSheet").classList.contains("open")) renderLandRegisterSection(record);
    if (state.favorites.has(record.id)) persistFavorites();
  }
}

function renderBuildingSection(record, selectedIndex = 0) {
  const content = $("#buildingContent");
  const count = $("#buildingCount");
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
  try {
    record.buildings = await fetchBuildingRecords(record.pnu);
    record.buildingError = false;
  } catch (error) {
    console.error("VWorld building lookup failed", error);
    record.buildings = [];
    record.buildingError = true;
  } finally {
    record.buildingLoading = false;
    if (state.selectedId === record.id && $("#detailSheet").classList.contains("open")) renderBuildingSection(record);
    if (state.favorites.has(record.id)) persistFavorites();
  }
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
  renderLandRegisterSection(record);
  void loadLandRegisterDetails(record);
  renderBuildingSection(record);
  void loadBuildingDetails(record);
  updateDetailFavorite(record.id);
  detailSheet.classList.add("open");
  detailSheet.setAttribute("aria-hidden", "false");
  $("#mapStatus").textContent = record.address || "선택한 필지";
  render();
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
    <button class="land-card" type="button" data-record-id="${escapeHtml(record.id)}">
      <span>${escapeHtml(record.typeLabel)}</span>
      <strong>${escapeHtml(record.address || "선택한 필지")}</strong>
      <small>${escapeHtml(record.number || "지번 확인 중")} · ${state.favorites.has(record.id) ? "★ 관심 토지" : record.pnu ? "PNU 확인됨" : "주소 검색 결과"}</small>
      <em>›</em>
    </button>`).join("") : `<div class="empty-result">${state.filter === "favorite" ? "아직 저장한 관심 토지가 없어요." : "주소를 검색하거나 ‘위성+지적’ 지도에서 필지를 선택해 보세요."}</div>`;
  $$("[data-record-id]").forEach((button) => button.addEventListener("click", async () => {
    const record = state.records.find((item) => item.id === button.dataset.recordId);
    if (!record) return;
    setMapMode("cadastral", false);
    map.getView().animate({center: fromLonLat([record.lon, record.lat]), zoom: 18, duration: 450});
    showSelectedParcel(record, null);
    openDetail(record);
  }));
  updateFavoriteCount();
}

function toggleFavorite(id = state.selectedId) {
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
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
  const records = state.records.filter((record) => state.favorites.has(record.id)).map(({properties, ...record}) => record);
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

$$('.related-service-link').forEach((link) => link.addEventListener("click", async () => {
  const record = state.records.find((item) => item.id === state.selectedId);
  const address = record?.address || record?.road;
  const label = link.dataset.serviceLabel || "유관 기관";
  if (!address) return showToast(`${label} 공식 사이트를 새 창에서 열었어요.`);
  try {
    await navigator.clipboard.writeText(address);
    showToast(`${label} 검색용 지번을 복사했어요.`);
  } catch {
    showToast(`${label} 공식 사이트를 새 창에서 열었어요.`);
  }
}));

const exportDialog = $("#exportDialog");
const exportLabels = {pdf: "PDF", docx: "DOCX", hwpx: "HWPX", pptx: "PPTX", png: "PNG", jpg: "JPG"};

function setExportBusy(busy, format = "") {
  exportDialog.setAttribute("aria-busy", String(busy));
  $("#exportProgress").hidden = !busy;
  $("#exportProgressText").textContent = `${exportLabels[format] || "보고서"} 파일을 만들고 있어요.`;
  $$("[data-export-format]").forEach((button) => { button.disabled = busy; });
  $("#exportClose").disabled = busy;
}

$("#openExport").addEventListener("click", () => {
  const record = state.records.find((item) => item.id === state.selectedId);
  if (!record) return;
  if (record.landRegisterLoading || record.buildingLoading) {
    showToast("토지·건축물 정보 조회가 끝난 뒤 다운로드할 수 있어요.");
    return;
  }
  $("#exportAddress").textContent = record.address || "선택한 필지";
  setExportBusy(false);
  exportDialog.showModal();
});

$("#exportClose").addEventListener("click", () => exportDialog.close());
exportDialog.addEventListener("click", (event) => {
  if (event.target === exportDialog && exportDialog.getAttribute("aria-busy") !== "true") exportDialog.close();
});

$$(`[data-export-format]`).forEach((button) => button.addEventListener("click", async () => {
  const record = state.records.find((item) => item.id === state.selectedId);
  if (!record || !window.ReportExporter) return showToast("보고서 생성 기능을 불러오지 못했어요.");
  const format = button.dataset.exportFormat;
  setExportBusy(true, format);
  try {
    await window.ReportExporter.exportReport(buildReportModel(record), format);
    exportDialog.close();
    showToast(`${exportLabels[format]} 보고서를 다운로드했어요.`);
  } catch (error) {
    console.error(`${format} report export failed`, error);
    showToast(`${exportLabels[format]} 파일을 만들지 못했어요. 다시 시도해 주세요.`);
  } finally {
    setExportBusy(false);
  }
}));

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
