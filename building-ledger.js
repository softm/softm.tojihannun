const params = new URLSearchParams(window.location.search);
const pnuCode = String(params.get("pnuCode") || "").replace(/\D/g, "");
const frame = document.querySelector("#ledgerFrame");
const status = document.querySelector("#viewerStatus");
const error = document.querySelector("#viewerError");
const overview = document.querySelector("#buildingOverview");
const buildingList = document.querySelector("#buildingList");
const buildingPicker = document.querySelector("#buildingPicker");
const buildingSelector = document.querySelector("#buildingSelector");
const externalButton = document.querySelector("#externalLink");
const errorExternalButton = document.querySelector("#errorExternalLink");

const DOCUMENTS = {
  building: {label: "건축물대장", requiresBuilding: true},
  "land-register": {label: "토지대장"},
  "land-use": {label: "토지이용계획확인원"},
  eum: {label: "토지이음"},
  "district-plan": {label: "지구단위계획"},
  lifecycle: {label: "건축물 생애이력", requiresBuilding: true}
};

function readViewerPayload() {
  const key = params.get("viewerKey");
  if (!key || !key.startsWith("tojihannun-document-viewer-v1:")) return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && parsed.version === 1 && parsed.pnu === pnuCode ? parsed : {};
  } catch {
    return {};
  }
}

const payload = readViewerPayload();
const fallbackBuilding = {
  id: String(params.get("mgmBldrgstPk") || "").replace(/\D/g, ""),
  ledgerKind: String(params.get("regstrKindCd") || "").replace(/\D/g, ""),
  ledgerKindName: params.get("ledgerKindName") || "건축물대장",
  name: params.get("buildingName") || "",
  dongName: params.get("buildingDongName") || "",
  lotAddress: params.get("address") || ""
};

const buildingMap = new Map();
for (const item of Array.isArray(payload.buildings) ? payload.buildings : []) {
  const id = String(item?.id || "").replace(/\D/g, "");
  if (id) buildingMap.set(id, {...item, id});
}
if (fallbackBuilding.id && !buildingMap.has(fallbackBuilding.id)) buildingMap.set(fallbackBuilding.id, fallbackBuilding);
const buildings = [...buildingMap.values()];

const parcelAddress = String(payload.address || params.get("address") || "").trim();
const districtPlanAvailable = pnuCode.startsWith("11") && (payload.hasDistrictPlan === true || params.get("districtPlan") === "1");
let activeDocument = DOCUMENTS[params.get("tab")] ? params.get("tab") : "building";
if (activeDocument === "district-plan" && !districtPlanAvailable) activeDocument = "building";
let selectedBuildingId = params.get("selectedBuilding") || fallbackBuilding.id || buildings[0]?.id || "all";
if (selectedBuildingId !== "all" && !buildingMap.has(selectedBuildingId)) selectedBuildingId = buildings[0]?.id || "all";
let currentRequest = null;
let frameLoadHandler = null;
let loadSequence = 0;

function toRegistryPnu(pnu) {
  if (!/^\d{19}$/.test(pnu)) return "";
  const cadastralType = pnu.charAt(10);
  const registryType = cadastralType === "1" ? "0" : cadastralType === "2" ? "1" : cadastralType;
  return `${pnu.slice(0, 10)}${registryType}${pnu.slice(11)}`;
}

function getLotNumbers(pnu) {
  return {
    main: String(Number(pnu.slice(11, 15)) || 0),
    sub: pnu.slice(15, 19)
  };
}

function buildEumUrl(pnu) {
  const url = new URL("https://www.eum.go.kr/web/ar/lu/luLandDet.jsp");
  url.search = new URLSearchParams({
    selSido: pnu.slice(0, 2),
    selSgg: pnu.slice(2, 5),
    selUmd: `0${pnu.slice(5, 8)}`,
    selRi: pnu.slice(8, 10),
    landGbn: pnu.slice(10, 11),
    bobn: pnu.slice(11, 15),
    bubn: pnu.slice(15, 19),
    pnu,
    scale: "",
    isNoScr: "script",
    chk: "0",
    mode: "search",
    selGbn: "umd"
  }).toString();
  return url.toString();
}

function buildLifecycleUrl(pnu, buildingId) {
  const registryPnu = toRegistryPnu(pnu);
  if (!registryPnu || !/^\d{6,20}$/.test(buildingId)) return "";
  const url = new URL("https://blcm.go.kr/lim/bldSumInfo/BldSumInfoView.do");
  url.search = new URLSearchParams({
    bldrgstPk: `${pnu.slice(0, 5)}-${buildingId.slice(5)}`,
    searchPnu: registryPnu,
    searchType: "B"
  }).toString();
  return url.toString();
}

function shortLotAddress(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join(" ") : parts.join(" ");
}

function buildingName(building, index = 0) {
  const names = [building?.name, building?.dongName].map((value) => String(value || "").trim()).filter(Boolean);
  const uniqueNames = names.filter((value, nameIndex) => names.indexOf(value) === nameIndex);
  return uniqueNames.join(" ") || `건축물 ${index + 1}`;
}

function buildingOptionLabel(building, index) {
  const kind = String(building?.ledgerKindName || "건축물대장").trim();
  const lot = shortLotAddress(building?.lotAddress || parcelAddress);
  return `[${kind}] ${buildingName(building, index)}${lot ? ` (${lot})` : ""}`;
}

function selectedBuilding() {
  return selectedBuildingId === "all" ? null : buildingMap.get(selectedBuildingId) || null;
}

function populateBuildingSelector() {
  buildingSelector.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = `전체 건축물 보기 (${buildings.length}개)`;
  buildingSelector.append(allOption);
  buildings.forEach((building, index) => {
    const option = document.createElement("option");
    option.value = building.id;
    option.textContent = buildingOptionLabel(building, index);
    buildingSelector.append(option);
  });
  buildingSelector.value = selectedBuildingId;
}

function setExternalState(request) {
  currentRequest = request;
  externalButton.disabled = !request;
  errorExternalButton.hidden = !request;
}

function hideAllContent() {
  status.hidden = true;
  frame.hidden = true;
  overview.hidden = true;
  error.hidden = true;
}

function showError(title, message, request = null) {
  hideAllContent();
  document.querySelector("#viewerErrorTitle").textContent = title;
  document.querySelector("#viewerErrorMessage").textContent = message;
  error.hidden = false;
  setExternalState(request);
}

function requestFor(documentId) {
  if (!/^\d{19}$/.test(pnuCode)) return null;
  const building = selectedBuilding();
  const lot = getLotNumbers(pnuCode);
  const registryPnu = toRegistryPnu(pnuCode);

  if (documentId === "building") {
    if (!building?.id) return null;
    return {
      method: "POST",
      url: "https://irts.molit.go.kr/usr/estate/cntc/kab/RtecsBildRegstrInfoPreview.do",
      fields: {
        mgmBldrgstPk: building.id,
        regstrKindCd: String(building.ledgerKind || "1"),
        pnuCode: registryPnu
      },
      status: "국토교통부 건축물대장을 불러오고 있어요.",
      title: `${buildingName(building)} 건축물대장`
    };
  }

  if (documentId === "land-register") {
    return {
      method: "POST",
      url: "https://irts.molit.go.kr/usr/estate/cntc/kab/RtecsTBookOfLandRegstrPreview.do",
      fields: {pnuCode: registryPnu, jibunBonbun: lot.main, jibunBubun: lot.sub},
      status: "국토교통부 토지대장을 불러오고 있어요.",
      title: "토지대장"
    };
  }

  if (documentId === "land-use") {
    return {
      method: "POST",
      url: "https://irts.molit.go.kr/usr/estate/cntc/kab/RtecsLandUseOfLandRegstrPreview.do",
      fields: {pnuCode, jibunBonbun: lot.main, jibunBubun: lot.sub},
      status: "국토교통부 토지이용계획확인원을 불러오고 있어요.",
      title: "토지이용계획확인원"
    };
  }

  if (documentId === "eum") {
    return {method: "GET", url: buildEumUrl(pnuCode), status: "토지이음 상세정보를 불러오고 있어요.", title: "토지이음"};
  }

  if (documentId === "district-plan" && districtPlanAvailable) {
    return {
      method: "GET",
      url: `https://urban.seoul.go.kr/view/map/mapRegInfo.pop?pnu=${encodeURIComponent(pnuCode)}`,
      status: "서울도시공간포털 지구단위계획을 불러오고 있어요.",
      title: "지구단위계획"
    };
  }

  if (documentId === "lifecycle") {
    const url = building ? buildLifecycleUrl(pnuCode, building.id) : "";
    return url ? {method: "GET", url, status: "건축물 생애이력을 불러오고 있어요.", title: `${buildingName(building)} 건축물 생애이력`} : null;
  }

  return null;
}

function appendHiddenInputs(form, fields) {
  Object.entries(fields || {}).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value ?? "");
    form.append(input);
  });
}

function submitPostRequest(request, target) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = request.url;
  form.target = target;
  form.hidden = true;
  appendHiddenInputs(form, request.fields);
  document.body.append(form);
  form.submit();
  form.remove();
}

function openExternal(request) {
  if (!request) return;
  if (request.method === "POST") {
    submitPostRequest(request, "_blank");
  } else {
    window.open(request.url, "_blank", "noopener,noreferrer");
  }
}

function loadRequest(request) {
  hideAllContent();
  setExternalState(request);
  status.textContent = request.status;
  status.hidden = false;
  frame.hidden = false;
  frame.title = `${request.title} 공식 미리보기`;

  const sequence = ++loadSequence;
  if (frameLoadHandler) frame.removeEventListener("load", frameLoadHandler);
  frameLoadHandler = () => {
    if (sequence === loadSequence) status.hidden = true;
  };
  frame.addEventListener("load", frameLoadHandler, {once: true});

  if (request.method === "POST") {
    submitPostRequest(request, frame.name);
  } else {
    frame.src = request.url;
  }
}

function renderBuildingOverview(documentId) {
  hideAllContent();
  setExternalState(null);
  overview.hidden = false;
  const lifecycle = documentId === "lifecycle";
  document.querySelector("#overviewTitle").textContent = lifecycle ? "생애이력을 확인할 건축물을 선택해 주세요" : "전체 건축물 목록";
  document.querySelector("#overviewDescription").textContent = buildings.length
    ? `VWorld에서 확인된 ${buildings.length}개 건축물입니다. 건축물별 공식 ${lifecycle ? "생애이력" : "대장"}을 열 수 있습니다.`
    : "이 필지에서 선택할 수 있는 건축물 식별정보가 없습니다.";
  buildingList.replaceChildren();

  buildings.forEach((building, index) => {
    const card = document.createElement("article");
    card.className = "building-card";
    const kind = document.createElement("small");
    kind.textContent = building.ledgerKindName || "건축물대장";
    const name = document.createElement("strong");
    name.textContent = buildingName(building, index);
    const details = document.createElement("span");
    details.textContent = [building.use, shortLotAddress(building.lotAddress || parcelAddress)].filter(Boolean).join(" · ") || `관리번호 ${building.id}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = lifecycle ? "생애이력 보기" : "건축물대장 보기";
    button.addEventListener("click", () => {
      selectedBuildingId = building.id;
      buildingSelector.value = building.id;
      renderDocument();
    });
    card.append(kind, name, details, button);
    buildingList.append(card);
  });
}

function updateLocationState() {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("tab", activeDocument);
  nextUrl.searchParams.set("selectedBuilding", selectedBuildingId);
  history.replaceState(null, "", nextUrl);
}

function renderDocument() {
  const documentInfo = DOCUMENTS[activeDocument];
  document.querySelector("#viewerTitle").textContent = documentInfo.label;
  buildingPicker.hidden = !documentInfo.requiresBuilding;
  document.querySelectorAll("[data-document]").forEach((tab) => {
    const selected = tab.dataset.document === activeDocument;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  updateLocationState();

  if (!/^\d{19}$/.test(pnuCode)) {
    showError("필지 정보를 확인할 수 없습니다.", "19자리 PNU가 없어 공식 문서를 조회할 수 없습니다.");
    return;
  }

  if (documentInfo.requiresBuilding && selectedBuildingId === "all") {
    renderBuildingOverview(activeDocument);
    return;
  }

  const request = requestFor(activeDocument);
  if (!request) {
    const isBuildingDocument = activeDocument === "building" || activeDocument === "lifecycle";
    showError(
      isBuildingDocument ? "건축물을 선택할 수 없습니다." : "공식 문서를 표시할 수 없습니다.",
      isBuildingDocument ? "건축물 관리번호가 제공되지 않아 개별 문서를 열 수 없습니다." : "조회에 필요한 정보가 부족합니다."
    );
    return;
  }
  loadRequest(request);
}

function selectDocument(documentId, focusTab = false) {
  if (!DOCUMENTS[documentId] || (documentId === "district-plan" && !districtPlanAvailable)) return;
  activeDocument = documentId;
  renderDocument();
  if (focusTab) document.querySelector(`[data-document="${documentId}"]`)?.focus();
}

document.querySelector("#parcelAddress").textContent = parcelAddress || "주소 미제공";
document.querySelector("#parcelPnu").textContent = /^\d{19}$/.test(pnuCode) ? `PNU ${pnuCode}` : "PNU 미제공";
document.querySelector("#viewerAddress").textContent = parcelAddress || "선택 필지의 공식 열람 화면입니다.";
document.querySelector('[data-document="district-plan"]').hidden = !districtPlanAvailable;

populateBuildingSelector();
buildingSelector.addEventListener("change", (event) => {
  selectedBuildingId = event.target.value;
  renderDocument();
});

document.querySelector("#documentTabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-document]");
  if (tab) selectDocument(tab.dataset.document);
});

document.querySelector("#documentTabs").addEventListener("keydown", (event) => {
  if (!event.target.matches("[data-document]") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...document.querySelectorAll("[data-document]:not([hidden])")];
  const currentIndex = tabs.indexOf(event.target);
  let nextIndex = currentIndex;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  event.preventDefault();
  selectDocument(tabs[nextIndex].dataset.document, true);
});

externalButton.addEventListener("click", () => openExternal(currentRequest));
errorExternalButton.addEventListener("click", () => openExternal(currentRequest));
document.querySelector("#closeViewer").addEventListener("click", () => {
  window.close();
  window.setTimeout(() => {
    if (!window.closed) window.location.href = "./";
  }, 100);
});

renderDocument();
