(() => {
  "use strict";
  // RTMS_REPAIR_20261108: canonical parcel identity, verified snapshots and bounded requests.

  const TRANSACTION_TYPES = Object.freeze({
    land: {label: "토지", endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade", areaKind: "거래면적"},
    apartment: {label: "아파트", endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade", areaKind: "전용면적"},
    officetel: {label: "오피스텔", endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade", areaKind: "전용면적"},
    rowHouse: {label: "연립·다세대", endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade2/getRTMSDataSvcRHTrade2", areaKind: "전용면적"},
    detached: {label: "단독·다가구", endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade", areaKind: "연면적"},
    commercial: {label: "상업·업무", endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade", areaKind: "건물면적"},
    factory: {label: "공장·창고", endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcInduTrade/getRTMSDataSvcInduTrade", areaKind: "연면적"}
  });
  const ONBID_ENDPOINT = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2";
  const ONBID_SEARCH_URL = "https://www.onbid.co.kr/op/cltrpbancinf/cltr/cltrmapsrch/CltrMapSrchController/mvmnCltrMapSrchClg.do";
  const COURT_AUCTION_URL = "https://www.courtauction.go.kr/";
  const ONBID_PROPERTY_CODES = "0007,0010,0005,0002,0003,0006,0008,0011,0013";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    parcel: null,
    activeTab: "basic",
    serviceKey: runtimeServiceKey(),
    rtmsCache: new Map(),
    transactionController: null,
    auctionController: null,
    transactionRequest: 0,
    auctionRequest: 0,
    transactionCacheKey: "",
    transactionType: "land",
    transactionTypeManuallySelected: false,
    auctionCacheKey: "",
    transactionItems: [],
    transactionGroups: null,
    transactionSession: null,
    transactionView: "parcel",
    transactionShowAll: false,
    auctionItems: [],
    transactionMeta: {status: "idle", scope: "", requestedMonths: 0, failedMonths: 0, fetchedAt: "", error: ""},
    auctionMeta: {status: "idle", area: "", totalCount: 0, fetchedAt: "", error: ""}
  };

  let toastTimer = 0;
  let snapshotPromise;
  let nextRtmsRequestAt = 0;
  const MONTH_CACHE_KEY = "toji-rtms-month-cache-v1";
  const MONTH_CACHE_BYTES = 1500000;
  let rtmsCooldownUntil = 0;
  try { rtmsCooldownUntil = Number(sessionStorage.getItem("toji-rtms-cooldown") || 0); } catch {}
  const INITIAL_MONTH_LIMIT = 3;
  const MORE_MONTH_LIMIT = 3; // One explicit action never starts a multi-year scan.
  const SNAPSHOT_URL = "./rtms-verified-snapshots.json?v=20261108.8";

  function readMonthCache() {
    try {
      const entries = JSON.parse(localStorage.getItem(MONTH_CACHE_KEY) || "[]");
      if (!Array.isArray(entries)) return;
      for (const [key, entry] of entries.slice(-36)) {
        if (typeof key !== "string" || !/^[A-Za-z]+:\d{5}:\d{6}$/.test(key) || !entry || entry.expiresAt <= Date.now() || !Array.isArray(entry.value?.items)) continue;
        if (entry.value.items.length > 5000 || entry.value.items.some(item => !item || !Number.isFinite(item.amount) || !Number.isFinite(item.area) || typeof item.date !== "string")) continue;
        state.rtmsCache.set(key, entry);
      }
    } catch { /* Private mode, old cache and quota failures must not block the screen. */ }
  }

  function saveMonthCache() {
    const entries = [...state.rtmsCache].filter(([, value]) => value.expiresAt > Date.now()).slice(-36);
    try {
      let text = JSON.stringify(entries);
      while (entries.length && text.length * 2 > MONTH_CACHE_BYTES) { entries.shift(); text = JSON.stringify(entries); }
      localStorage.setItem(MONTH_CACHE_KEY, text);
    } catch { /* Only public transaction rows are cached; never credentials. */ }
  }

  function runtimeServiceKey() {
    return String(window.__TOJI_RUNTIME_CONFIG__?.molitApiKey || window.APP_CONFIG?.dataGoKrServiceKey || "").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
  }

  async function copyText(text) {
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

  function openOfficialSite(url, label) {
    const address = state.parcel?.address || state.parcel?.road || "";
    window.open(url, "_blank", "noopener,noreferrer");
    if (!address) {
      showToast(`${label} 공식 사이트를 열었어요.`);
      return;
    }
    void copyText(address).then((copied) => {
      showToast(copied ? `${label} 검색용 주소를 복사했어요.` : `${label} 공식 사이트를 열었어요.`);
    });
  }

  function setStatus(selector, message, tone = "") {
    const element = $(selector);
    if (!element) return;
    element.textContent = message;
    if (tone) element.dataset.tone = tone;
    else delete element.dataset.tone;
  }

  function appendServiceKey(url, key) {
    const text = String(key || "").trim();
    const encoded = /%[0-9a-f]{2}/i.test(text) ? text : encodeURIComponent(text);
    return `${url}${url.includes("?") ? "&" : "?"}serviceKey=${encoded}`;
  }

  function parseParcelArea(parcel) {
    const address = String(parcel?.address || parcel?.road || "").replace(/[(),]/g, " ").trim();
    const tokens = address.split(/\s+/).filter(Boolean);
    const lotIndex = tokens.findIndex((token) => /^(?:산\s*)?\d+(?:-\d+)?(?:번지)?$/.test(token));
    const boundary = lotIndex >= 0 ? lotIndex : tokens.length;
    let emdIndex = -1;
    for (let index = boundary - 1; index >= 1; index -= 1) {
      if (/(동|읍|면|리|가)$/.test(tokens[index])) {
        emdIndex = index;
        break;
      }
    }
    if (emdIndex < 0 && boundary > 1) emdIndex = boundary - 1;
    return {
      sido: tokens[0] || "",
      sgg: emdIndex > 1 ? tokens.slice(1, emdIndex).join(" ") : "",
      emd: emdIndex >= 0 ? tokens[emdIndex] : "",
      lawdCode: /^\d{5}/.test(String(parcel?.pnu || "")) ? String(parcel.pnu).slice(0, 5) : "",
      // Display labels may contain a cadastral suffix (e.g. 158-216대).
      // Prefer the 19-digit parcel identifier; never loosen the public API's masked-lot check.
      lot: parcelLot(parcel, lotIndex >= 0 ? tokens[lotIndex] : "")
    };
  }

  function normalizeLot(value) {
    const match = String(value || "").trim().replace(/번지$/, "").match(/^(산)?\s*0*(\d+)(?:-0*(\d+))?$/);
    if (!match) return "";
    return `${match[1] ? "산" : ""}${Number(match[2])}${Number(match[3]) ? `-${Number(match[3])}` : ""}`;
  }

  function parcelLot(parcel, addressLot = "") {
    const pnu = String(parcel?.pnu || "").trim();
    if (/^\d{10}[12]\d{8}$/.test(pnu) && Number(pnu.slice(11, 15)) > 0) {
      const main = Number(pnu.slice(11, 15));
      const sub = Number(pnu.slice(15, 19));
      return `${pnu[10] === "2" ? "산" : ""}${main}${sub ? `-${sub}` : ""}`;
    }
    return normalizeLot(addressLot) || normalizeLot(parcel?.number) ||
      normalizeLot(String(parcel?.number || "").replace(/\s*[전답과목임광염대장학차주창도철제천구유양수공체원종사묘잡]$/, ""));
  }

  function normalizeAreaName(value) {
    return String(value || "").replace(/\s+/g, "").trim();
  }

  function selectedParcelArea(parcel = state.parcel) {
    const register = parcel?.landRegister || {};
    return numberValue(register.base?.lndpclAr || register.ownership?.lndpclAr || register.characteristic?.lndpclAr || 0);
  }

  function recommendTransactionType(parcel = state.parcel) {
    const hasBuildingData = Array.isArray(parcel?.buildings);
    const buildings = hasBuildingData ? parcel.buildings : [];
    const description = [
      hasBuildingData && !buildings.length ? "" : parcel?.buildingName,
      ...buildings.flatMap((building) => [building?.name, building?.dongName, building?.use])
    ].filter(Boolean).join(" ");
    if (/공장|창고|제조소|산업시설/i.test(description)) return "factory";
    if (/오피스텔/i.test(description)) return "officetel";
    if (/연립|다세대|빌라|다세대주택|연립주택/i.test(description)) return "rowHouse";
    if (/단독|다가구|다중주택/i.test(description)) return "detached";
    if (/아파트/i.test(description)) return "apartment";
    if (/공동주택/i.test(description)) return "rowHouse"; // 공동주택만 확인된 경우 임시 권장; 유형 선택 가능
    if (/상가|근린생활|판매시설|업무시설|타워|플라자|센터|숙박시설|위락시설/i.test(description)) return "commercial";
    return "land"; // 건물 유형 미확인 시 아파트로 임의 추정하지 않음
  }

  function transactionArea(node, type) {
    const exclusive = numberValue(field(node, ["excluUseAr", "excluUseArea", "전용면적"]));
    const land = numberValue(field(node, ["dealArea", "landAr", "plottageAr", "plotAr", "대지면적", "토지면적", "거래면적"]));
    const building = numberValue(field(node, ["totalFloorAr", "buildArea", "buildingAr", "연면적", "건물면적"]));
    if (["apartment", "officetel", "rowHouse"].includes(type)) return exclusive || building || land;
    if (type === "land") return land || building || exclusive;
    return building || land || exclusive;
  }

  function applyTransactionType(type, {manual = false, reload = false} = {}) {
    if (!TRANSACTION_TYPES[type]) return;
    const changed = state.transactionType !== type;
    state.transactionType = type;
    if (manual) state.transactionTypeManuallySelected = true;
    if ($("#transactionType")) $("#transactionType").value = type;
    if ($("#transactionHeading")) $("#transactionHeading").textContent = `${TRANSACTION_TYPES[type].label} 매매 실거래`;
    if ($("#transactionChartCard .market-section-head > small")) $("#transactionChartCard .market-section-head > small").textContent = "만원/㎡";
    if (!changed) return;
    state.transactionCacheKey = "";
    state.transactionItems = [];
    state.transactionController?.abort();
    state.transactionSession = null;
    state.transactionGroups = null;
    state.transactionMeta = {status: "idle", scope: "", requestedMonths: 0, failedMonths: 0, fetchedAt: "", error: ""};
    if (reload && state.activeTab === "transactions") void loadTransactions(true);
  }

  function field(node, names) {
    if (!node) return "";
    for (const name of names) {
      if (node.getElementsByTagName) {
        const value = node.getElementsByTagName(name)[0]?.textContent?.trim();
        if (value) return value;
      } else {
        const key = Object.keys(node).find(key => key.toLowerCase() === name.toLowerCase());
        if (key !== undefined && node[key] != null && String(node[key]).trim()) return String(node[key]).trim();
      }
    }
    return "";
  }

  function numberValue(value) {
    const parsed = Number(String(value ?? "").replaceAll(",", "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatNumber(value, maximumFractionDigits = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("ko-KR", {maximumFractionDigits}) : "-";
  }

  function formatWon(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return "미공개";
    if (amount >= 100000000) {
      const eok = Math.floor(amount / 100000000);
      const remainder = Math.round((amount % 100000000) / 10000);
      return remainder ? `${formatNumber(eok)}억 ${formatNumber(remainder)}만원` : `${formatNumber(eok)}억원`;
    }
    if (amount >= 10000) return `${formatNumber(Math.round(amount / 10000))}만원`;
    return `${formatNumber(amount)}원`;
  }

  function formatDealAmount(manwon) {
    const value = Number(manwon);
    if (!Number.isFinite(value) || value <= 0) return "미제공";
    if (value >= 10000) {
      const eok = Math.floor(value / 10000);
      const remainder = Math.round(value % 10000);
      return remainder ? `${formatNumber(eok)}억 ${formatNumber(remainder)}만원` : `${formatNumber(eok)}억원`;
    }
    return `${formatNumber(value)}만원`;
  }

  function formatCompactDate(value, includeTime = false) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length < 8) return value || "미제공";
    const date = `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
    if (!includeTime || digits.length < 12) return date;
    return `${date} ${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function recentMonths(count) {
    const now = new Date();
    return Array.from({length: count}, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
    });
  }

  function transactionMonths(value) {
    const raw = String(value || "saved");
    if (raw === "saved" || raw === "all") return [];
    if (raw === "3") return recentMonths(3);
    if (/^year-(20\d{2})$/.test(raw)) {
      const year = Number(raw.slice(5));
      if (year < 2006 || year > new Date().getFullYear()) return [];
      return Array.from({length: year === new Date().getFullYear() ? new Date().getMonth() + 1 : 12}, (_, index) => String(year) + String(index + 1).padStart(2, "0")).reverse();
    }
    return recentMonths(Math.max(12, Math.min(36, Number(raw) || 24)));
  }

  async function mapConcurrent(values, limit, handler) {
    const results = new Array(values.length);
    let cursor = 0;
    const workers = Array.from({length: Math.min(limit, values.length)}, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = {status: "fulfilled", value: await handler(values[index], index)};
        } catch (reason) {
          results[index] = {status: "rejected", reason};
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  function publicApiError(message, code = "") {
    const error = new Error(message || "공공데이터를 조회하지 못했습니다.");
    error.code = String(code || "");
    return error;
  }

  function apiErrorMessage(error, serviceLabel) {
    if (error?.name === "AbortError") return "조회가 취소되었습니다.";
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    if (["20", "30", "31"].includes(code) || /SERVICE_KEY|등록되지 않은|인증키|ACCESS_DENIED/i.test(message)) {
      return `${serviceLabel} 정보를 현재 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.`;
    }
    if (code === "429" || ["22", "23"].includes(code) || /LIMITED_NUMBER|트래픽|429/i.test(message)) {
      return "공공데이터 API 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.";
    }
    if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(message)) {
      return "공공데이터 서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.";
    }
    return message || `${serviceLabel} 정보를 조회하지 못했습니다.`;
  }

  function parseApiEnvelope(text) {
    const trimmed = String(text || "").trim();
    if (trimmed.startsWith("{")) {
      const json = JSON.parse(trimmed);
      const response = json.response || json;
      const header = response.header || json.header || {};
      const body = response.body || json.body || {};
      const code = String(header.resultCode ?? response.resultCode ?? "");
      const message = String(header.resultMsg ?? response.resultMsg ?? "");
      if (code && !["00", "000", "0000"].includes(code)) throw publicApiError(message, code);
      return {kind: "json", body, header};
    }
    const xml = new DOMParser().parseFromString(trimmed, "application/xml");
    if (xml.querySelector("parsererror")) throw publicApiError("공공데이터 응답을 해석하지 못했습니다.");
    const code = field(xml, ["resultCode", "returnReasonCode"]);
    const message = field(xml, ["resultMsg", "returnAuthMsg", "errMsg"]);
    if (code && !["00", "000", "0000"].includes(code)) throw publicApiError(message, code);
    if (/SERVICE_KEY|ACCESS_DENIED|인증키/i.test(message)) throw publicApiError(message, code || "20");
    return {kind: "xml", xml};
  }

  function resetTransactionView() {
    const area = parseParcelArea(state.parcel);
    const definition = TRANSACTION_TYPES[state.transactionType] || TRANSACTION_TYPES.land;
    applyTransactionType(state.transactionType);
    if ($("#transactionAreaLabel")) {
      $("#transactionAreaLabel").textContent = area.emd ? `${area.sido} ${area.sgg} ${area.emd} ${area.lot} · ${state.transactionType === "land" ? "동일 필지" : "같은 지번 건물 거래 · 호실 통합"}`.replace(/\s+/g, " ").trim() : "선택 필지와 비교 가능한 거래를 확인합니다.";
    }
    $("#transactionStats").innerHTML = "";
    $("#transactionChart").innerHTML = "";
    $("#transactionChartCard").hidden = true;
    $("#transactionList").innerHTML = "";
    $("#transactionListSection").hidden = true;
    setStatus("#transactionStatus", state.serviceKey ? `${definition.label} 확인된 거래를 먼저 표시하고, 미조회 기간은 추가 조회합니다.` : "현재 실거래 조회 서비스를 이용할 수 없습니다.");
  }

  function resetAuctionView() {
    const area = parseParcelArea(state.parcel);
    if ($("#auctionAreaLabel")) {
      $("#auctionAreaLabel").textContent = area.emd ? `${area.sido} ${area.sgg} ${area.emd} · 선택 필지 ${state.parcel?.number || ""}`.replace(/\s+/g, " ").trim() : "온비드와 법원경매를 함께 확인합니다.";
    }
    $("#auctionStats").innerHTML = "";
    $("#auctionList").innerHTML = "";
    $("#auctionListSection").hidden = true;
    $("#auctionFetchedAt").textContent = "공식 사이트는 실시간 정보가 우선합니다.";
    setStatus("#auctionStatus", state.serviceKey ? "경매·공매 탭을 열면 온비드 진행 물건을 조회합니다." : "공식 조회 버튼은 바로 사용할 수 있으며, 온비드 목록 조회는 현재 이용할 수 없습니다.");
  }

  function normalizeRtmsNodes(nodes, type) {
    return nodes.map((node) => {
      const year = field(node, ["dealYear", "년"]);
      const monthValue = field(node, ["dealMonth", "월"]);
      const day = field(node, ["dealDay", "일"]);
      const amount = numberValue(field(node, ["dealAmount", "거래금액"]));
      const area = transactionArea(node, type);
      const cancel = field(node, ["cdealType", "해제여부"]);
      const cancellationDate = field(node, ["cdealDay", "해제사유발생일"]).replace(/^(?:-|null|0)$/i, "");
      return {
        type,
        date: `${year}-${String(monthValue).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        month: `${year}${String(monthValue).padStart(2, "0")}`,
        amount,
        area,
        unitPrice: amount > 0 && area > 0 ? amount / area : 0,
        umdNm: field(node, ["umdNm", "법정동"]),
        jibun: field(node, ["jibun", "지번"]),
        buildingName: field(node, ["aptNm", "offiNm", "mhouseNm", "buildingNm", "houseType", "아파트", "단지", "연립다세대", "주택유형", "건물명"]),
        floor: field(node, ["floor", "층"]),
        buildingType: field(node, ["buildingType", "건물구분"]),
        buildingUse: field(node, ["buildingUse", "건물용도"]),
        sggCd: field(node, ["sggCd", "지역코드"]),
        lotDisclosed: Boolean(normalizeLot(field(node, ["jibun", "지번"]))),
        jimok: field(node, ["jimok", "지목"]),
        landUse: field(node, ["landUse", "landCategory", "useArea", "지목", "용도지역"]),
        dealType: field(node, ["dealingGbn", "dealType", "거래유형"]),
        cancel,
        cancellationDate
      };
    }).filter((item) => item.amount > 0 && item.area > 0 && !item.cancellationDate && !/^(?:O|Y|1|해제)$/i.test(item.cancel));
  }

  function parseRtmsResponse(text, type) {
    const envelope = parseApiEnvelope(text);
    const raw = envelope.kind === "xml" ? [...envelope.xml.getElementsByTagName("item")]
      : (envelope.body?.items?.item ?? envelope.body?.items ?? []);
    const nodes = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
    const totalCount = envelope.kind === "xml" ? numberValue(field(envelope.xml, ["totalCount"])) : numberValue(envelope.body?.totalCount);
    return {items: normalizeRtmsNodes(nodes, type), rawCount: nodes.length, totalCount: totalCount || nodes.length};
  }

  function abortError() { return new DOMException("조회가 취소되었습니다.", "AbortError"); }

  function waitForRtms(ms, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(abortError()); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, Math.max(0, ms));
      signal?.addEventListener("abort", abort, {once: true});
    });
  }

  function markRateLimited(retryAfter = "") {
    const seconds = Number(retryAfter);
    const wait = retryAfter && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    // No automatic retry; absent Retry-After means a conservative local pause, not a claimed provider quota reset.
    rtmsCooldownUntil = Date.now() + Math.max(60000, Number.isFinite(wait) ? wait : 60000);
    try { sessionStorage.setItem("toji-rtms-cooldown", String(rtmsCooldownUntil)); } catch {}
  }

  async function fetchRtmsPage(type, lawdCode, month, pageNo, signal) {
    if (signal?.aborted) throw abortError();
    if (Date.now() < rtmsCooldownUntil) throw publicApiError("요청 제한으로 추가 호출을 중단했습니다. 받은 자료는 유지합니다.", "429");
    const definition = TRANSACTION_TYPES[type];
    if (!definition) throw publicApiError("지원하지 않는 실거래 유형입니다.");
    const startAt = Math.max(Date.now(), nextRtmsRequestAt);
    nextRtmsRequestAt = startAt + 1100;
    await waitForRtms(startAt - Date.now(), signal);
    if (Date.now() < rtmsCooldownUntil) throw publicApiError("요청 제한으로 추가 호출을 중단했습니다.", "429");
    const params = new URLSearchParams({LAWD_CD: lawdCode, DEAL_YMD: month, pageNo: String(pageNo), numOfRows: "1000"});
    const url = appendServiceKey(`${definition.endpoint}?${params}`, state.serviceKey);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, {once: true});
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {signal: controller.signal, headers: {Accept: "application/xml,text/xml,application/json"}});
      if (response.status === 429) { markRateLimited(response.headers.get("Retry-After")); throw publicApiError("실거래 API 요청 제한(429)", "429"); }
      if (!response.ok) throw publicApiError(`실거래 API 응답 오류(${response.status})`, [401, 403].includes(response.status) ? "30" : String(response.status));
      try { return parseRtmsResponse(await response.text(), type); }
      catch (error) { if (["22", "23", "429"].includes(String(error.code))) markRateLimited(); throw error; }
    } catch (error) {
      if (error.name === "AbortError" && !signal?.aborted) throw publicApiError("실거래 서버 응답 시간이 초과되었습니다. 받은 자료는 유지합니다.", "TIMEOUT");
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }

  async function fetchRtmsMonth(type, lawdCode, month, signal, force = false) {
    const cacheKey = `${type}:${lawdCode}:${month}`;
    const cached = state.rtmsCache.get(cacheKey);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
    const first = await fetchRtmsPage(type, lawdCode, month, 1, signal);
    const pageCount = Math.max(1, Math.ceil(first.totalCount / Math.max(1, first.rawCount)));
    const cappedPages = Math.min(pageCount, 5);
    const pages = [first];
    for (let pageNo = 2; pageNo <= cappedPages; pageNo += 1) {
      const page = await fetchRtmsPage(type, lawdCode, month, pageNo, signal);
      if (!page.rawCount) break;
      pages.push(page);
    }
    const result = {items: pages.flatMap(page => page.items), truncated: pages.reduce((n, page) => n + page.rawCount, 0) < first.totalCount};
    state.rtmsCache.set(cacheKey, {value: result, expiresAt: Date.now() + 3600000});
    while (state.rtmsCache.size > 36) state.rtmsCache.delete(state.rtmsCache.keys().next().value);
    saveMonthCache();
    return result;
  }


  function scopeTransactionItems(items, area, type) {
    const matchingArea = items.filter((item) => normalizeAreaName(item.umdNm) === normalizeAreaName(area.emd));
    const regional = area.emd ? matchingArea : [];
    const unique = regional.map((item) => ({...item,
      exact: Boolean(area.emd && area.lot && normalizeAreaName(item.umdNm) === normalizeAreaName(area.emd) && normalizeLot(item.jibun) && normalizeLot(item.jibun) === area.lot)
    }));
    const exact = unique.filter((item) => item.exact);
    const parcelArea = selectedParcelArea();
    const comparable = type === "land" && parcelArea > 0
      ? unique.filter((item) => item.area >= parcelArea * .5 && item.area <= parcelArea * 2)
      : unique;
    return {
      scope: `${area.emd || `${area.sido} ${area.sgg}`.trim()} ${area.lot}`,
      exact: exact.length > 0,
      undisclosedCount: unique.filter(item => !normalizeLot(item.jibun)).length,
      items: exact.sort((a,b) => b.date.localeCompare(a.date)),
      comparable: comparable.filter(item => !item.exact).sort((a,b) => b.date.localeCompare(a.date))
    };
  }

  function renderMarketStats(selector, stats) {
    $(selector).innerHTML = stats.map((item) => `
      <div class="market-stat">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
        <small>${escapeHtml(item.note || "")}</small>
      </div>`).join("");
  }

  function renderTransactionChart(items) {
    const groups = new Map();
    items.forEach((item) => {
      if (!groups.has(item.month)) groups.set(item.month, []);
      groups.get(item.month).push(item.unitPrice);
    });
    const points = [...groups.entries()]
      .map(([month, values]) => ({month, value: median(values)}))
      .filter((point) => point.value > 0)
      .sort((a, b) => a.month.localeCompare(b.month));
    if (!points.length) {
      $("#transactionChartCard").hidden = true;
      return;
    }
    const width = 520;
    const height = 190;
    const pad = {left: 42, right: 18, top: 25, bottom: 30};
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    const max = Math.max(...points.map((point) => point.value)) * 1.15 || 1;
    const x = (index) => points.length === 1 ? pad.left + chartWidth / 2 : pad.left + (index / (points.length - 1)) * chartWidth;
    const y = (value) => pad.top + chartHeight - (value / max) * chartHeight;
    const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
    const areaPath = `${line} L${x(points.length - 1).toFixed(1)},${(pad.top + chartHeight).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + chartHeight).toFixed(1)} Z`;
    const labelStep = Math.max(1, Math.ceil(points.length / 6));
    const grid = [0, .5, 1].map((ratio) => {
      const gridY = pad.top + chartHeight * ratio;
      const value = Math.round(max * (1 - ratio));
      return `<line class="market-chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${gridY}" y2="${gridY}"/><text class="market-chart-label" x="${pad.left - 5}" y="${gridY + 3}" text-anchor="end">${formatNumber(value)}</text>`;
    }).join("");
    const dots = points.map((point, index) => {
      const showLabel = index % labelStep === 0 || index === points.length - 1;
      return `<circle class="market-chart-dot" cx="${x(index)}" cy="${y(point.value)}" r="4"><title>${point.month.slice(0, 4)}.${point.month.slice(4)} ${formatNumber(point.value, 1)}만원/㎡</title></circle>${showLabel ? `<text class="market-chart-label" x="${x(index)}" y="${height - 9}" text-anchor="middle">${point.month.slice(2, 4)}.${point.month.slice(4)}</text>` : ""}${index === points.length - 1 ? `<text class="market-chart-value" x="${x(index) - 4}" y="${Math.max(12, y(point.value) - 9)}" text-anchor="end">${formatNumber(point.value, 1)}</text>` : ""}`;
    }).join("");
    const aria = `월별 중위 거래단가. ${points.map((point) => `${point.month.slice(0, 4)}년 ${point.month.slice(4)}월 ${formatNumber(point.value, 1)}만원`).join(", ")}`;
    $("#transactionChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(aria)}"><defs><linearGradient id="marketChartArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a9a78" stop-opacity=".28"/><stop offset="1" stop-color="#3a9a78" stop-opacity=".03"/></linearGradient></defs>${grid}<path class="market-chart-area" d="${areaPath}"/><path class="market-chart-line" d="${line}"/>${dots}</svg>`;
    $("#transactionChartCard").hidden = false;
  }

  function renderTransactionList() {
    const items = state.transactionItems;
    const definition = TRANSACTION_TYPES[state.transactionType] || TRANSACTION_TYPES.land;
    const limit = state.transactionShowAll ? Math.min(items.length, 200) : Math.min(items.length, 30);
    $("#transactionList").innerHTML = items.slice(0, limit).map((item) => `
      <article class="transaction-item${item.exact ? " exact" : ""}">
        <div class="market-item-head">
          <div>
            <span>${escapeHtml(item.date.replaceAll("-", "."))} 계약</span>
            <strong>${escapeHtml(item.buildingName || [item.umdNm, item.jibun || "지번 비공개"].filter(Boolean).join(" "))}</strong>
            <small>${escapeHtml([item.buildingName ? [item.umdNm, item.jibun].filter(Boolean).join(" ") : "", item.jimok, item.landUse, item.buildingType, item.buildingUse, item.floor ? `${item.floor}층` : "", item.dealType].filter(Boolean).join(" · ") || "세부 항목 미제공")}</small>
          </div>
          <span class="market-badge${item.exact ? "" : " neutral"}">${item.exact ? "공개 지번 일치" : !normalizeLot(item.jibun) ? "지번 일부공개 · 필지 미확정" : "같은 법정동 비교"}</span>
        </div>
        <dl class="market-item-facts">
          <div><dt>거래금액</dt><dd>${escapeHtml(formatDealAmount(item.amount))}</dd></div>
          <div><dt>${escapeHtml(definition.areaKind)}</dt><dd>${escapeHtml(formatNumber(item.area, 2))}㎡</dd></div>
          <div><dt>거래단가</dt><dd>${escapeHtml(formatNumber(item.unitPrice, 1))}만원/㎡</dd></div>
          <div><dt>공개 지번</dt><dd>${escapeHtml(item.jibun || "미공개")}</dd></div>
        </dl>
      </article>`).join("") + (items.length > 30 ? `<button class="auction-item-action" type="button" data-toggle-transaction-list>${state.transactionShowAll ? "목록 접기" : `전체 ${formatNumber(Math.min(items.length, 200))}건 보기`}<span aria-hidden="true">${state.transactionShowAll ? "↑" : "↓"}</span></button>` : "");
    $("[data-toggle-transaction-list]")?.addEventListener("click", () => {
      state.transactionShowAll = !state.transactionShowAll;
      renderTransactionList();
    });
    $("#transactionListCount").textContent = items.length > 200 ? `총 ${formatNumber(items.length)}건 · 최대 200건 표시` : `총 ${formatNumber(items.length)}건`;
    $("#transactionListSection").hidden = false;
  }

  function renderTransactionView() {
    const group = state.transactionGroups;
    if (!group) return;
    const nearby = state.transactionView === "nearby";
    const items = nearby ? group.comparable : group.items;
    renderTransactions(items, group.scope + (nearby ? " · 같은 법정동 비교" : " · 공개 지번 일치 거래"), group.failedMonths, group.requestedMonths, {exact: !nearby && group.exact, truncated: group.truncated});
    const status = $("#transactionStatus");
    if (!status) return;
    let control = $("#transactionScopeSwitch");
    if (!control) { control = document.createElement("div"); control.id = "transactionScopeSwitch"; status.before(control); }
    control.className = "transaction-scope-switch";
    control.replaceChildren();
    for (const [mode, label] of [["parcel", "해당 필지"], ["nearby", "같은 법정동 비교"]]) {
      const count = mode === "parcel" ? group.items.length : group.comparable.length;
      const known = mode === "nearby" ? group.regionalCovered : Boolean(count);
      const button = document.createElement("button"); button.type = "button";
      button.textContent = label + (count ? ` · ${count}건 확인` : mode === "parcel" ? " · 미확인" : known ? " · 확인된 거래 없음" : " · 미조회");
      button.setAttribute("aria-pressed", String(state.transactionView === mode));
      button.addEventListener("click", () => { state.transactionView = mode; renderTransactionSession(state.transactionSession); });
      control.appendChild(button);
    }
    let disclosure = $("#transactionDisclosure");
    if (!disclosure) { disclosure = document.createElement("div"); disclosure.id = "transactionDisclosure"; status.before(disclosure); }
    disclosure.className = "transaction-disclosure";
    disclosure.hidden = !group.undisclosedCount && state.transactionType !== "commercial";
    disclosure.textContent = group.undisclosedCount
      ? `조회된 같은 법정동 거래 중 ${group.undisclosedCount}건은 지번이 일부 공개되거나 누락돼 있습니다. 해당 필지 여부를 확정할 수 없으며 비교 자료로만 표시합니다.`
      : "상업·업무용 일반건축물은 지번이 일부만 공개됩니다. 집합건축물 등 공개 지번이 완전한 거래만 필지 일치를 확인할 수 있습니다.";
    let paging = $("#transactionPaging");
    if (!paging) { paging = document.createElement("div"); paging.id = "transactionPaging"; status.after(paging); }
    paging.className = "transaction-paging"; paging.replaceChildren();
    const coverage = document.createElement("small");
    coverage.textContent = group.savedOnly
      ? `저장된 자료 · 확인 ${group.coveredMonths}개월 · 전체 거래이력 확보 여부 미확인`
      : `${group.periodLabel} · 확인 ${group.coveredMonths}/${group.totalMonths}개월` + (group.remainingMonths ? ` · 미조회 ${group.remainingMonths}개월` : "");
    if (group.failedMonths) coverage.textContent += ` · 실패 ${group.failedMonths}개월`;
    if (group.truncated) coverage.textContent += " · 일부 월 페이지 미수신";
    if (group.snapshotAt) coverage.textContent += ` · 원본 확인 ${group.snapshotAt.slice(0, 10)}`;
    paging.appendChild(coverage);
    const primary = document.createElement("button"); primary.type = "button";
    primary.textContent = group.loading ? "조회 중단" : group.savedOnly ? "같은 법정동 최근 3개월 조회" : group.remainingMonths || group.failedMonths ? "선택 기간 추가 확인 (최대 3개월)" : "선택 기간 다시 확인";
    primary.addEventListener("click", () => {
      if (group.loading) { state.transactionController?.abort(); return; }
      if (group.savedOnly) {
        $("#transactionRange").value = "3";
        void loadTransactions(false, false, {view: "nearby"});
      } else void loadTransactions(!group.remainingMonths, false, {more: true, view: state.transactionView});
    });
    paging.appendChild(primary);
    if (group.savedOnly) {
      const hint = document.createElement("small"); hint.className = "transaction-provider-note";
      hint.textContent = group.directAnswered ? `${group.directSource} 필지·기간 조회 결과입니다. 계약된 제공 범위 내 자료이며 전체 이력의 완전성은 별도 확인이 필요합니다.` : "필지·기간 일괄 실거래 서비스는 아직 연결되지 않았습니다. 저장된 거래는 전체 이력이 아니며, 2006년부터 월별 자동 조회하지 않습니다. 과거 자료는 조회기간에서 연도를 선택하세요.";
      paging.appendChild(hint);
    }
    let message = group.error;
    if (!message && group.loading) message = "선택한 기간의 자료를 확인 중입니다. 이미 받은 거래는 유지합니다.";
    if (!message && nearby) message = group.regionalCovered ? "같은 법정동 비교 거래입니다. 선택 필지의 거래가 아니며 반경·거리 기준 자료가 아닙니다." : "같은 법정동 거래는 아직 조회하지 않았습니다.";
    if (!message && items.length) message = "공개 지번이 일치하는 확인된 거래입니다. 미조회 기간이 있으며, 같은 지번의 다른 호실 거래가 포함될 수 있습니다.";
    if (!message && group.undisclosedCount) message = "해당 필지 여부 미확인 · 지번 비공개 거래가 있어 거래 없음으로 판단할 수 없습니다.";
    if (!message) message = group.savedOnly ? "저장된 해당 필지 거래가 없습니다. 전체 거래이력이 없다는 뜻은 아닙니다." : "확인한 기간에서 공개 지번 일치 거래를 찾지 못했습니다. 과거 거래 없음으로 판단하지 않습니다.";
    setStatus("#transactionStatus", message, group.error ? "error" : group.loading ? "loading" : "");
    state.transactionMeta = {...state.transactionMeta,
      status: group.loading ? "loading" : group.error ? (items.length ? "partial" : "error") : group.savedOnly || group.remainingMonths || group.failedMonths || group.truncated || group.undisclosedCount ? "partial" : "success",
      periodLabel: group.periodLabel, coveredMonths: group.coveredMonths, totalMonths: group.totalMonths,
      remainingMonths: group.remainingMonths, failedMonths: group.failedMonths, error: group.error || "", snapshotAt: group.snapshotAt,
      savedOnly: group.savedOnly, undisclosedCount: group.undisclosedCount, historyComplete: false};
    if (!items.length) renderMarketStats("#transactionStats", [{label: nearby ? "같은 법정동 비교" : "해당 필지 거래",
      value: group.loading ? "조회 중" : "미확인", note: "자료 미확보·지번 비공개·미조회는 거래 없음이 아닙니다"}]);
  }

  function renderTransactions(items, scope, failedMonths, requestedMonths, {exact: exactMatch = false, truncated = false} = {}) {
    const definition = TRANSACTION_TYPES[state.transactionType] || TRANSACTION_TYPES.land;
    state.transactionItems = items;
    state.transactionShowAll = false;
    state.transactionMeta = {
      status: "success",
      scope: scope || "선택 지역",
      requestedMonths,
      failedMonths,
      type: state.transactionType,
      exact: exactMatch,
      truncated,
      fetchedAt: new Date().toISOString(),
      error: ""
    };
    if (!items.length) {
      renderMarketStats("#transactionStats", [{label: "해당 기간 공개 지번 일치", value: "미확인", note: "조회 범위와 공개 제한을 확인하세요"}]);
      $("#transactionChartCard").hidden = true;
      $("#transactionListSection").hidden = true;
      setStatus("#transactionStatus", `${scope || "선택 지역"}에서 최근 ${requestedMonths}개월 신고된 ${definition.label} 매매를 찾지 못했습니다.`, "success");
      return;
    }
    const exactCount = items.filter((item) => item.exact).length;
    const latest = items[0]?.date?.replaceAll("-", ".") || "미제공";
    renderMarketStats("#transactionStats", [
      {label: `${definition.label} 거래`, value: `${formatNumber(items.length)}건`, note: `${scope} · 취소 제외`},
      {label: "중위 거래금액", value: formatDealAmount(median(items.map((item) => item.amount))), note: "총액 · 매매가격"},
      {label: "중위 거래단가", value: `${formatNumber(median(items.map((item) => item.unitPrice)), 1)}만원/㎡`, note: "거래금액÷면적"},
      {label: exactCount ? "선택 필지·단지" : "비교 거래", value: `${formatNumber(items.length)}건`, note: `최근 신고 ${latest}`}
    ]);
    renderTransactionChart(items);
    renderTransactionList();
    const partial = failedMonths ? ` · ${failedMonths}개월 응답 실패` : "";
    const pageNotice = truncated ? " · 일부 월 최대 5페이지 표시" : "";
    setStatus("#transactionStatus", `${scope}의 최근 ${requestedMonths}개월 ${definition.label} 공개 거래를 조회했습니다${partial}${pageNotice}.`, failedMonths ? "" : "success");
  }

  async function fetchDirectHistory(session, parcel, signal) {
    const endpoint = String(window.__TOJI_RUNTIME_CONFIG__?.parcelHistoryEndpoint || "").trim();
    if (!endpoint || session.period !== "saved") return;
    const pnu = String(parcel?.pnu || "");
    if (!/^\d{19}$/.test(pnu)) return;
    try {
      const target = new URL(endpoint, window.location.href);
      if (target.protocol !== "https:" && target.origin !== window.location.origin) throw new Error("unsafe endpoint");
      const end = new Date().toISOString().slice(0,10).replaceAll("-", "");
      const controller = new AbortController();
      const cancel = () => controller.abort();signal?.addEventListener("abort",cancel,{once:true});
      const timer = setTimeout(cancel, 8000);
      try {
        const response = await fetch(target, {method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},body:JSON.stringify({pnu,start_date:"20060101",end_date:end,type:session.type}),signal:controller.signal});
        if (!response.ok) throw new Error("provider unavailable");
        const data = await response.json();
        if (data.pnu !== pnu || !Array.isArray(data.items)) throw new Error("invalid provider identity");
        session.directItems = data.items.filter(item => item.pnu === pnu && item.type === session.type && Number.isFinite(item.amount) && item.amount>0 && Number.isFinite(item.area) && item.area>0 && /^20\d{2}-\d{2}-\d{2}$/.test(item.date || ""))
          .map(item => ({...item,umdNm:session.area.emd}));
        session.directAnswered = true;
        session.directSource = String(data.source || "필지 조회 공급처");
      } finally {clearTimeout(timer);signal?.removeEventListener("abort",cancel);}
    } catch {session.error = "필지·기간 조회 공급처에 연결하지 못했습니다. 저장 자료는 유지하며 월별 전체 조회로 전환하지 않습니다.";}
  }

  function getVerifiedSnapshots() {
    if (!snapshotPromise) snapshotPromise = fetch(SNAPSHOT_URL, {signal: AbortSignal.timeout(2000)})
      .then(response => response.ok ? response.json() : {entries: []}).catch(() => ({entries: []}));
    return snapshotPromise;
  }

  function sessionMonths(session) {
    return session.period === "saved" ? [...new Set([...session.results.keys(), ...session.snapshots.keys()])].sort().reverse() : session.months;
  }

  function coveredSessionMonths(session, nearby = state.transactionView === "nearby") {
    const result = new Set([...session.results].filter(([, value]) => !value.truncated).map(([month]) => month));
    if (!nearby && session.snapshotFresh) session.snapshots.forEach((_, month) => { if (!session.results.has(month)) result.add(month); });
    return result;
  }

  function renderTransactionSession(session) {
    if (state.transactionSession !== session) return;
    const allItems = [...session.results.values()].flatMap(value => value.items);
    // A successfully re-fetched month replaces its older parcel-only snapshot, including an empty response.
    for (const [month, rows] of session.snapshots) if (!session.results.has(month)) allItems.push(...rows);
    if (session.directItems?.length) {
      // Keep comparison rows, replace duplicate exact-parcel evidence with provider rows.
      for (let i=allItems.length-1;i>=0;i--) if (normalizeLot(allItems[i].jibun)===session.area.lot && normalizeAreaName(allItems[i].umdNm)===normalizeAreaName(session.area.emd)) allItems.splice(i,1);
      allItems.push(...session.directItems);
    }
    const scoped = scopeTransactionItems(allItems, session.area, session.type);
    const expected = sessionMonths(session);
    const covered = coveredSessionMonths(session);
    const relevantFailures = [...session.failures.keys()].filter(month => expected.includes(month));
    const remaining = expected.filter(month => !covered.has(month) && !session.failures.has(month));
    const savedOnly = session.period === "saved";
    state.transactionGroups = {...scoped,
      comparable: scoped.comparable,
      savedOnly, directAnswered: Boolean(session.directAnswered), directSource: session.directSource || "",
      requestedMonths: expected.length, totalMonths: expected.length,
      coveredMonths: expected.filter(month => covered.has(month)).length,
      remainingMonths: remaining.length, failedMonths: relevantFailures.length,
      regionalCovered: [...session.results.keys()].some(month => expected.includes(month)),
      periodLabel: savedOnly ? "저장된 자료 (전체 이력 아님)" : session.period.startsWith("year-") ? session.period.slice(5) + "년" : "최근 " + session.months.length + "개월",
      snapshotAt: session.snapshotAt, loading: session.loading, error: session.error,
      truncated: [...session.results.values()].some(value => value.truncated)
    };
    renderTransactionView();
  }

  async function loadTransactions(force = false, allowInactive = false, options = {}) {
    const parcel = state.parcel;
    if (!parcel || (!allowInactive && state.activeTab !== "transactions")) return;
    if (!state.transactionTypeManuallySelected) applyTransactionType(recommendTransactionType(parcel));
    const type = state.transactionType;
    const area = parseParcelArea(parcel);
    if (!area.lawdCode || !area.emd || !area.lot) {
      setStatus("#transactionStatus", "선택 필지의 법정동·지번 식별정보를 확인하지 못했습니다. 거래 없음이 아닙니다.", "error"); return;
    }
    const selectedPeriod = String($("#transactionRange")?.value || "saved");
    const period = selectedPeriod === "all" ? "saved" : selectedPeriod;
    const months = transactionMonths(period);
    const cacheKey = `${area.lawdCode}:${area.emd}:${area.lot}:${type}:${period}`;
    let session = state.transactionSession;
    if (session?.key === cacheKey && session.loading) return;
    if (session?.key === cacheKey && !force && !options.more) { renderTransactionSession(session); return; }
    state.transactionController?.abort();
    const controller = new AbortController();
    state.transactionController = controller;
    const requestId = ++state.transactionRequest;
    const current = () => requestId === state.transactionRequest && state.transactionSession === session;
    const fresh = !session || session.key !== cacheKey;
    if (fresh) {
      session = {key: cacheKey, type, area, period, months, results: new Map(), snapshots: new Map(), failures: new Map(), loading: true, error: "", snapshotAt: "", snapshotFresh: false};
      state.transactionSession = session;
      state.transactionView = options.view || "parcel";
      state.transactionCacheKey = cacheKey;
      renderTransactionSession(session);
      const snapshots = await getVerifiedSnapshots();
      if (!current() || controller.signal.aborted) { if (current()) { session.loading = false; session.error = "조회 중단. 받은 자료는 유지됩니다."; renderTransactionSession(session); } return; }
      const entry = snapshots.entries?.find(entry => entry.type === type && entry.lawdCode === area.lawdCode && entry.emd === area.emd && entry.lot === area.lot);
      if (entry) {
        session.snapshotAt = entry.verifiedAt || "";
        session.snapshotFresh = Date.now() - Date.parse(session.snapshotAt) < 7 * 86400000;
        for (const month of entry.completeMonths || []) if (period === "saved" || months.includes(month)) {
          session.snapshots.set(month, normalizeRtmsNodes((entry.rows || []).filter(row => `${field(row,["dealYear"])}${field(row,["dealMonth"]).padStart(2,"0")}` === month), type));
        }
      }
      // File/API collector publishes shared static datasets; no interactive government requests.
      if (window.TojiStaticTrades) {
        try {
          const staticEntry = await window.TojiStaticTrades.lookup(area, type);
          if (!current() || controller.signal.aborted) return;
          if (staticEntry) {
            session.snapshotAt = staticEntry.verifiedAt || session.snapshotAt;
            session.snapshotFresh = Date.now() - Date.parse(session.snapshotAt) < 7 * 86400000;
            for (const month of staticEntry.completeMonths) if (period === "saved" || months.includes(month)) {
              session.snapshots.set(month, normalizeRtmsNodes(staticEntry.rows.filter(row => `${row.dealYear}${row.dealMonth}` === month), type));
            }
          }
        } catch { /* Retain separately verified records when a static shard is unavailable. */ }
      }
      for (const [key, cached] of state.rtmsCache) {
        const [cacheType, lawdCode, month] = key.split(":");
        if (cacheType === type && lawdCode === area.lawdCode && cached.expiresAt > Date.now() && (period === "saved" || months.includes(month))) session.results.set(month, cached.value);
      }
      // Keep saved evidence visible while a configured PNU provider is contacted once.
      renderTransactionSession(session);
      await fetchDirectHistory(session, parcel, controller.signal);
      if (!current() || controller.signal.aborted) { if (current()) { session.loading=false;renderTransactionSession(session); } return; }
      session.loading = false;
      renderTransactionSession(session);
      // Verified parcel data can be read without any MOLIT request. No hard-coded addresses in query logic.
      if (session.snapshots.size && !force && !options.more) return;
    }
    if (!current()) return;
    if (period === "saved" && (!force || !sessionMonths(session).length)) { session.loading = false; renderTransactionSession(session); return; }
    if (!state.serviceKey) { session.loading = false; session.error = "현재 실거래 조회 서비스를 이용할 수 없습니다. 확인된 저장 자료만 표시합니다."; renderTransactionSession(session); return; }
    if (Date.now() < rtmsCooldownUntil) { session.loading = false; session.error = "API 요청 제한으로 추가 호출을 중단했습니다. 확인된 자료는 유지되며 제한 해제 시점은 공급기관에 따라 다릅니다."; renderTransactionSession(session); return; }
    const expected = sessionMonths(session);
    const covered = coveredSessionMonths(session);
    const pending = expected.filter(month => !covered.has(month) && !session.failures.has(month));
    const retry = [...session.failures.keys()].filter(month => expected.includes(month));
    const refresh = [...new Set([...retry, ...session.results.keys(), ...session.snapshots.keys()])].filter(month => expected.includes(month)).sort().reverse();
    const candidates = force ? refresh.length ? refresh : pending : pending.length ? pending : retry;
    const limit = Math.min(MORE_MONTH_LIMIT, options.limit || (options.more || force ? MORE_MONTH_LIMIT : INITIAL_MONTH_LIMIT));
    const batch = candidates.slice(0, limit);
    session.loading = Boolean(batch.length); session.error = "";
    renderTransactionSession(session);
    const deadline = setTimeout(() => controller.abort(), 12000);
    try {
      for (const month of batch) {
        if (!current() || controller.signal.aborted) throw abortError();
        try {
          const result = await fetchRtmsMonth(type, area.lawdCode, month, controller.signal, force);
          if (!current()) return;
          session.results.set(month, result); session.failures.delete(month);
          renderTransactionSession(session);
        } catch (error) {
          if (error.name === "AbortError") throw error;
          if (!current()) return;
          session.failures.set(month, String(error.code || "NETWORK"));
          session.error = apiErrorMessage(error, "국토교통부 실거래 API");
          // Stop on the FIRST failure, even when no preceding month succeeded. Never scan hundreds of failed months.
          break;
        }
      }
    } catch (error) { if (current()) session.error = error.name === "AbortError" ? "조회 중단. 확인된 거래는 유지됩니다." : apiErrorMessage(error, "실거래 API"); }
    finally { clearTimeout(deadline); if (current()) { session.loading = false; renderTransactionSession(session); } }
  }


  function parseOnbidItems(text) {
    const envelope = parseApiEnvelope(text);
    if (envelope.kind === "json") {
      const raw = envelope.body?.items?.item;
      const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return {items, totalCount: numberValue(envelope.body?.totalCount || items.length)};
    }
    const items = [...envelope.xml.getElementsByTagName("item")].map((node) => {
      const object = {};
      [...node.children].forEach((child) => { object[child.tagName] = child.textContent?.trim() || ""; });
      return object;
    });
    return {items, totalCount: numberValue(field(envelope.xml, ["totalCount"]) || items.length)};
  }

  function normalizeOnbidItem(item, parcel) {
    const pnu = String(item.ltnoPnu || "").trim();
    return {
      ...item,
      exact: Boolean(pnu && parcel?.pnu && pnu === String(parcel.pnu)),
      pnu,
      appraisal: numberValue(item.apslEvlAmt),
      landArea: numberValue(item.landSqms),
      buildingArea: numberValue(item.bldSqms),
      failedCount: numberValue(item.usbdNft),
      start: String(item.cltrBidBgngDt || ""),
      end: String(item.cltrBidEndDt || "")
    };
  }

  function onbidItemUrl(item) {
    const url = new URL("https://www.onbid.co.kr/op/cltrpbancinf/cltr/cltrcdtnsrch/CltrCdtnSrchController/mvmnCltrCdtnSrchClg.do");
    if (item.cltrMngNo) {
      url.searchParams.set("cltrMnmtNo", item.cltrMngNo);
      url.searchParams.set("keyword", item.cltrMngNo);
      url.searchParams.set("searchCltrMnmtNo", item.cltrMngNo);
    }
    return url.toString();
  }

  function renderAuctionList(items, totalCount) {
    const visible = items.slice(0, 100);
    $("#auctionList").innerHTML = visible.map((item) => {
      const address = [item.lctnSdnm, item.lctnSggnm, item.lctnEmdNm].filter(Boolean).join(" ");
      const area = [item.landArea ? `토지 ${formatNumber(item.landArea, 2)}㎡` : "", item.buildingArea ? `건물 ${formatNumber(item.buildingArea, 2)}㎡` : ""].filter(Boolean).join(" · ") || "면적 미제공";
      return `
        <article class="auction-item${item.exact ? " exact" : ""}">
          <div class="market-item-head">
            <div>
              <span>${escapeHtml([item.prptDivNm, item.dspsMthodNm, item.pbctStatNm].filter(Boolean).join(" · ") || "온비드 공매")}</span>
              <strong>${escapeHtml(item.onbidCltrNm || "물건명 미제공")}</strong>
              <small>${escapeHtml(address || "소재지 상세 미제공")} · ${escapeHtml(item.cltrMngNo || "관리번호 미제공")}</small>
            </div>
            <span class="market-badge${item.exact ? "" : " neutral"}">${item.exact ? "선택 필지 일치" : (item.pbctStatNm || "주변 물건")}</span>
          </div>
          <dl class="market-item-facts">
            <div><dt>감정평가금액</dt><dd>${escapeHtml(formatWon(item.appraisal))}</dd></div>
            <div><dt>최저입찰가격</dt><dd>${escapeHtml(item.lowstBidPrcIndctCont || "미공개")}</dd></div>
            <div><dt>면적</dt><dd>${escapeHtml(area)}</dd></div>
            <div><dt>유찰횟수</dt><dd>${formatNumber(item.failedCount)}회</dd></div>
            <div><dt>입찰 시작</dt><dd>${escapeHtml(formatCompactDate(item.start, true))}</dd></div>
            <div><dt>입찰 종료</dt><dd>${escapeHtml(formatCompactDate(item.end, true))}</dd></div>
          </dl>
          <a class="auction-item-action" href="${escapeHtml(onbidItemUrl(item))}" target="_blank" rel="noopener noreferrer"><span>온비드에서 물건 확인</span><span aria-hidden="true">↗</span></a>
        </article>`;
    }).join("");
    $("#auctionListCount").textContent = totalCount > visible.length ? `총 ${formatNumber(totalCount)}건 · ${formatNumber(visible.length)}건 표시` : `총 ${formatNumber(totalCount || visible.length)}건`;
    $("#auctionListSection").hidden = false;
  }

  function renderAuctions(items, totalCount, area) {
    state.auctionItems = items;
    state.auctionMeta = {
      status: "success",
      area: [area.sido, area.sgg, area.emd].filter(Boolean).join(" "),
      totalCount: Number(totalCount || items.length),
      fetchedAt: new Date().toISOString(),
      error: ""
    };
    const exact = items.filter((item) => item.exact).length;
    const appraisals = items.map((item) => item.appraisal).filter((value) => value > 0);
    const nearest = items.map((item) => item.end).filter(Boolean).sort()[0];
    renderMarketStats("#auctionStats", [
      {label: "주변 진행 물건", value: `${formatNumber(totalCount || items.length)}건`, note: `${area.emd || area.sgg || "선택 지역"} 검색`},
      {label: "선택 필지 일치", value: `${formatNumber(exact)}건`, note: "지번 PNU 기준"},
      {label: "중위 감정가", value: appraisals.length ? formatWon(median(appraisals)) : "미제공", note: "현재 조회 목록"},
      {label: "가까운 입찰마감", value: nearest ? formatCompactDate(nearest) : "미제공", note: "공고 정정 가능"}
    ]);
    if (items.length) {
      renderAuctionList(items, totalCount);
      setStatus("#auctionStatus", `${area.emd || area.sgg || "선택 지역"}의 온비드 입찰 중·입찰 예정 부동산을 조회했습니다.`, "success");
    } else {
      $("#auctionListSection").hidden = true;
      setStatus("#auctionStatus", `${area.emd || area.sgg || "선택 지역"}에서 현재 진행 중인 온비드 부동산 공매를 찾지 못했습니다.`, "success");
    }
    $("#auctionFetchedAt").textContent = `온비드 API 조회 ${new Date().toLocaleString("ko-KR", {year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"})}`;
  }

  async function loadAuctions(force = false, allowInactive = false) {
    const parcel = state.parcel;
    if (!parcel || (!allowInactive && state.activeTab !== "auctions")) return;
    if (!state.serviceKey) {
      state.auctionMeta = {...state.auctionMeta, status: "unavailable", error: "온비드 목록 조회는 현재 이용할 수 없습니다."};
      setStatus("#auctionStatus", "공식 조회 버튼은 바로 사용할 수 있으며, 온비드 목록 조회는 현재 이용할 수 없습니다.");
      return;
    }
    const area = parseParcelArea(parcel);
    if (!area.sido || !area.emd) {
      state.auctionMeta = {...state.auctionMeta, status: "error", error: "온비드 조회에 필요한 시도·읍면동을 주소에서 확인할 수 없습니다."};
      setStatus("#auctionStatus", "온비드 조회에 필요한 시도·읍면동을 주소에서 확인할 수 없습니다.", "error");
      return;
    }
    const cacheKey = `${parcel.pnu || parcel.id}:${area.sido}:${area.sgg}:${area.emd}`;
    if (!force && state.auctionCacheKey === cacheKey) return;
    state.auctionController?.abort();
    const controller = new AbortController();
    state.auctionController = controller;
    const requestId = ++state.auctionRequest;
    state.auctionMeta = {...state.auctionMeta, status: "loading", error: ""};
    $("#auctionStats").innerHTML = "";
    $("#auctionListSection").hidden = true;
    setStatus("#auctionStatus", `${area.emd}의 온비드 부동산 공매를 불러오고 있습니다.`, "loading");
    const params = new URLSearchParams({
      pageNo: "1",
      numOfRows: "100",
      resultType: "json",
      prptDivCd: ONBID_PROPERTY_CODES,
      pvctTrgtYn: "N",
      dspsMthodCd: "0001",
      lctnSdnm: area.sido,
      lctnEmdNm: area.emd
    });
    if (area.sgg) params.set("lctnSggnm", area.sgg);
    const url = appendServiceKey(`${ONBID_ENDPOINT}?${params}`, state.serviceKey);
    try {
      const response = await fetch(url, {signal: controller.signal, headers: {Accept: "application/json,application/xml;q=.9,*/*;q=.8"}});
      if (!response.ok) throw publicApiError(`온비드 API 응답 오류(${response.status})`, [401, 403].includes(response.status) ? "30" : String(response.status));
      const parsed = parseOnbidItems(await response.text());
      if (requestId !== state.auctionRequest || controller.signal.aborted) return;
      const items = parsed.items
        .map((item) => normalizeOnbidItem(item, parcel))
        .sort((a, b) => Number(b.exact) - Number(a.exact) || String(a.end || "999999999999").localeCompare(String(b.end || "999999999999")));
      state.auctionCacheKey = cacheKey;
      renderAuctions(items, parsed.totalCount, area);
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error("Onbid auction lookup failed", {message: error?.message, code: error?.code});
      const message = apiErrorMessage(error, "온비드 차세대 부동산 물건목록 API");
      state.auctionMeta = {...state.auctionMeta, status: "error", fetchedAt: new Date().toISOString(), error: message};
      setStatus("#auctionStatus", message, "error");
    }
  }

  function reportStatus(status, error) {
    if (status === "success") return "조회 완료";
    if (status === "loading") return "조회 중";
    if (status === "partial") return "부분 조회 · 미조회 기간 또는 실패 있음";
    if (status === "error") return error || "조회 실패";
    if (status === "unavailable") return error || "조회 서비스 이용 불가";
    return "조회하지 않음";
  }

  function getReportSections() {
    const transactionItems = state.transactionItems || [];
    const transactionMeta = state.transactionMeta || {};
    const transactionDefinition = TRANSACTION_TYPES[transactionMeta.type || state.transactionType] || TRANSACTION_TYPES.land;
    const exactTransactions = transactionItems.filter((item) => item.exact).length;
    const transactionSections = [{
      title: `${transactionDefinition.label} 실거래 조회 요약`,
      kind: "keyValue",
      rows: [
        ["조회 상태", reportStatus(transactionMeta.status, transactionMeta.error)],
        ["조회 범위", transactionMeta.scope || "-"],
        ["조회 기간", transactionMeta.periodLabel || "-"],
        ["조회 범위 확인", `${transactionMeta.coveredMonths || 0}/${transactionMeta.totalMonths || 0}개월 · 미조회 ${transactionMeta.remainingMonths || 0}개월`],
        ["거래 유형", transactionDefinition.label],
        ["공개 거래", `${formatNumber(transactionItems.length)}건`],
        ["선택 필지·단지 일치", exactTransactions ? `${formatNumber(exactTransactions)}건 확인` : "미확인 · 거래 없음이 아님"],
        ["중위 거래금액", transactionItems.length ? formatDealAmount(median(transactionItems.map((item) => item.amount))) : "미제공"],
        ["중위 거래단가", transactionItems.length ? `${formatNumber(median(transactionItems.map((item) => item.unitPrice)), 1)}만원/㎡` : "미제공"],
        ["일부 응답 실패", transactionMeta.failedMonths ? `${transactionMeta.failedMonths}개월` : "없음"],
        ["페이지 제한", transactionMeta.truncated ? "일부 월 최대 5페이지" : "없음"],
        ["조회 시각", transactionMeta.fetchedAt ? new Date(transactionMeta.fetchedAt).toLocaleString("ko-KR") : "-"]
      ]
    }];
    if (transactionItems.length) {
      transactionSections.push({
        title: `${transactionDefinition.label} 실거래 목록 전체 ${formatNumber(transactionItems.length)}건`,
        kind: "table",
        headers: ["계약일", "대상", "범위", "지목·용도", transactionDefinition.areaKind, "거래금액", "단가", "거래유형"],
        rows: transactionItems.map((item) => [
          item.date || "-",
          item.buildingName || [item.umdNm, item.jibun].filter(Boolean).join(" ") || "-",
          item.exact ? "선택 필지·단지" : "비교 거래",
          [item.jimok, item.landUse, item.floor ? `${item.floor}층` : ""].filter(Boolean).join(" · ") || "-",
          item.area ? `${formatNumber(item.area, 2)}㎡` : "-",
          formatDealAmount(item.amount),
          item.unitPrice ? `${formatNumber(item.unitPrice, 1)}만원/㎡` : "-",
          item.dealType || "-"
        ])
      });
    }

    const auctionItems = state.auctionItems || [];
    const auctionMeta = state.auctionMeta || {};
    const exactAuctions = auctionItems.filter((item) => item.exact).length;
    const appraisals = auctionItems.map((item) => item.appraisal).filter((value) => value > 0);
    const auctionSections = [{
      title: "경매·공매 조회 요약",
      kind: "keyValue",
      rows: [
        ["조회 상태", reportStatus(auctionMeta.status, auctionMeta.error)],
        ["조회 지역", auctionMeta.area || "-"],
        ["주변 진행 물건", `${formatNumber(auctionMeta.totalCount || auctionItems.length)}건`],
        ["보고서 수록 물건", `${formatNumber(auctionItems.length)}건`],
        ["선택 필지 일치", `${formatNumber(exactAuctions)}건`],
        ["중위 감정가", appraisals.length ? formatWon(median(appraisals)) : "미제공"],
        ["조회 시각", auctionMeta.fetchedAt ? new Date(auctionMeta.fetchedAt).toLocaleString("ko-KR") : "-"]
      ]
    }];
    if (auctionItems.length) {
      auctionSections.push({
        title: `온비드 공매 목록 전체 ${formatNumber(auctionItems.length)}건`,
        kind: "table",
        headers: ["물건명", "소재지", "필지", "구분·상태", "감정가", "최저입찰가", "면적", "유찰", "입찰기간", "관리번호", "PNU"],
        rows: auctionItems.map((item) => [
          item.onbidCltrNm || "물건명 미제공",
          [item.lctnSdnm, item.lctnSggnm, item.lctnEmdNm].filter(Boolean).join(" ") || "-",
          item.exact ? "선택 필지 일치" : "주변 물건",
          [item.prptDivNm, item.dspsMthodNm, item.pbctStatNm].filter(Boolean).join(" · ") || "-",
          formatWon(item.appraisal),
          item.lowstBidPrcIndctCont || "미공개",
          [item.landArea ? `토지 ${formatNumber(item.landArea, 2)}㎡` : "", item.buildingArea ? `건물 ${formatNumber(item.buildingArea, 2)}㎡` : ""].filter(Boolean).join(" · ") || "-",
          `${formatNumber(item.failedCount)}회`,
          [formatCompactDate(item.start, true), formatCompactDate(item.end, true)].join(" ~ "),
          item.cltrMngNo || "-",
          item.pnu || "-"
        ])
      });
    }
    return [...transactionSections, ...auctionSections];
  }

  async function prepareReportData() {
    if (!state.parcel) return;
    await Promise.all([loadTransactions(false, true), loadAuctions(false, true)]);
  }

  function setParcel(parcel) {
    state.parcel = parcel || null;
    if ($("#transactionRange")) $("#transactionRange").value = "saved";
    state.transactionController?.abort();
    state.auctionController?.abort();
    state.transactionRequest += 1;
    state.auctionRequest += 1;
    state.transactionCacheKey = "";
    state.transactionTypeManuallySelected = false;
    state.transactionType = recommendTransactionType(parcel);
    state.auctionCacheKey = "";
    state.transactionItems = [];
    state.transactionGroups = null;
    state.transactionSession = null;
    state.transactionView = "parcel";
    document.querySelector("#transactionScopeSwitch")?.remove();
    document.querySelector("#transactionDisclosure")?.remove();
    document.querySelector("#transactionPaging")?.remove();
    state.auctionItems = [];
    state.transactionMeta = {status: "idle", scope: "", requestedMonths: 0, failedMonths: 0, fetchedAt: "", error: ""};
    state.auctionMeta = {status: "idle", area: "", totalCount: 0, fetchedAt: "", error: ""};
    resetTransactionView();
    resetAuctionView();
  }

  function refreshParcel(parcel) {
    if (!parcel || !state.parcel || parcel.id !== state.parcel.id) return;
    const previousArea = parseParcelArea(state.parcel);
    const previousType = state.transactionType;
    state.parcel = parcel;
    if (!state.transactionTypeManuallySelected) applyTransactionType(recommendTransactionType(parcel));
    const area = parseParcelArea(parcel);
    if (previousType === state.transactionType && previousArea.lawdCode === area.lawdCode && previousArea.emd === area.emd && previousArea.lot === area.lot) return;
    state.transactionController?.abort();
    state.transactionSession = null;
    state.transactionCacheKey = "";
    resetTransactionView();
    if (state.activeTab === "transactions") void loadTransactions();
  }

  function activate(tab) {
    state.activeTab = tab;
    if (tab !== "transactions") state.transactionController?.abort();
    if (tab === "transactions") void loadTransactions();
    if (tab === "auctions") void loadAuctions();
  }

  function bindEvents() {
    $("#transactionType")?.addEventListener("change", (event) => {
      applyTransactionType(event.target.value, {manual: true});
      resetTransactionView();
      if (state.activeTab === "transactions") void loadTransactions(true);
    });
    $("#transactionRange")?.addEventListener("change", () => {
      state.transactionCacheKey = "";
      if (state.activeTab === "transactions") void loadTransactions(false, false, {view: state.transactionView});
    });
    $("#refreshTransactions")?.addEventListener("click", () => void loadTransactions(true));
    $("#refreshAuctions")?.addEventListener("click", () => void loadAuctions(true));
    $("#openOnbidSearch")?.addEventListener("click", () => openOfficialSite(ONBID_SEARCH_URL, "온비드"));
    $("#openCourtAuction")?.addEventListener("click", () => openOfficialSite(COURT_AUCTION_URL, "법원경매"));
    resetTransactionView();
    resetAuctionView();
  }

  window.TojihannunMarketData = {setParcel, refreshParcel, activate, prepareReportData, getReportSections};
  readMonthCache();
  bindEvents();
})();
