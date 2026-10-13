(() => {
  "use strict";

  const RTMS_ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade";
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
    auctionCacheKey: "",
    transactionItems: [],
    transactionShowAll: false,
    auctionItems: []
  };

  let toastTimer = 0;

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
      lot: normalizeLot(parcel?.number || (lotIndex >= 0 ? tokens[lotIndex] : ""))
    };
  }

  function normalizeLot(value) {
    const match = String(value || "").replace(/번지/g, "").match(/(산)?\s*0*(\d+)(?:-0*(\d+))?/);
    if (!match) return "";
    return `${match[1] ? "산" : ""}${Number(match[2])}${match[3] !== undefined ? `-${Number(match[3])}` : ""}`;
  }

  function normalizeAreaName(value) {
    return String(value || "").replace(/\s+/g, "").trim();
  }

  function field(node, names) {
    for (const name of names) {
      const element = node.getElementsByTagName(name)[0];
      if (element?.textContent?.trim()) return element.textContent.trim();
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
    if (["22", "23"].includes(code) || /LIMITED_NUMBER|트래픽/i.test(message)) {
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
    if ($("#transactionAreaLabel")) {
      $("#transactionAreaLabel").textContent = area.emd ? `${area.sido} ${area.sgg} ${area.emd} · 선택 필지 ${state.parcel?.number || ""}`.replace(/\s+/g, " ").trim() : "선택 필지 주변 거래를 확인합니다.";
    }
    $("#transactionStats").innerHTML = "";
    $("#transactionChart").innerHTML = "";
    $("#transactionChartCard").hidden = true;
    $("#transactionList").innerHTML = "";
    $("#transactionListSection").hidden = true;
    setStatus("#transactionStatus", state.serviceKey ? "실거래 탭을 열면 최근 거래를 조회합니다." : "현재 실거래 조회 서비스를 이용할 수 없습니다.");
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

  async function fetchRtmsMonth(lawdCode, month, signal) {
    const cacheKey = `${lawdCode}:${month}`;
    if (state.rtmsCache.has(cacheKey)) return state.rtmsCache.get(cacheKey);
    const params = new URLSearchParams({LAWD_CD: lawdCode, DEAL_YMD: month, pageNo: "1", numOfRows: "1000"});
    const url = appendServiceKey(`${RTMS_ENDPOINT}?${params}`, state.serviceKey);
    const response = await fetch(url, {signal, headers: {Accept: "application/xml,text/xml,*/*"}});
    if (!response.ok) throw publicApiError(`실거래 API 응답 오류(${response.status})`, [401, 403].includes(response.status) ? "30" : String(response.status));
    const text = await response.text();
    const envelope = parseApiEnvelope(text);
    const nodes = envelope.kind === "xml" ? [...envelope.xml.getElementsByTagName("item")] : [];
    const items = nodes.map((node) => {
      const year = field(node, ["dealYear", "년"]);
      const monthValue = field(node, ["dealMonth", "월"]);
      const day = field(node, ["dealDay", "일"]);
      const amount = numberValue(field(node, ["dealAmount", "거래금액"]));
      const area = numberValue(field(node, ["dealArea", "거래면적", "plotAr"]));
      const cancel = field(node, ["cdealType", "해제여부"]);
      return {
        date: `${year}-${String(monthValue).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        month: `${year}${String(monthValue).padStart(2, "0")}`,
        amount,
        area,
        unitPrice: amount > 0 && area > 0 ? amount / area : 0,
        umdNm: field(node, ["umdNm", "법정동"]),
        jibun: field(node, ["jibun", "지번"]),
        jimok: field(node, ["jimok", "지목"]),
        landUse: field(node, ["landUse", "용도지역"]),
        dealType: field(node, ["dealingGbn", "dealType", "거래유형"]),
        cancel
      };
    }).filter((item) => item.amount > 0 && item.area > 0 && !/O|Y|해제/i.test(item.cancel));
    state.rtmsCache.set(cacheKey, items);
    return items;
  }

  function scopeTransactionItems(items, area) {
    const matchingArea = items.filter((item) => normalizeAreaName(item.umdNm) === normalizeAreaName(area.emd));
    const scoped = area.emd && matchingArea.length ? matchingArea : items;
    const seen = new Set();
    return {
      scope: area.emd && matchingArea.length ? area.emd : `${area.sido} ${area.sgg}`.trim(),
      items: scoped.filter((item) => {
        const key = [item.date, item.umdNm, item.jibun, item.amount, item.area].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        item.exact = Boolean(area.lot && normalizeLot(item.jibun) === area.lot);
        return true;
      }).sort((a, b) => b.date.localeCompare(a.date))
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
    const limit = state.transactionShowAll ? Math.min(items.length, 200) : Math.min(items.length, 30);
    $("#transactionList").innerHTML = items.slice(0, limit).map((item) => `
      <article class="transaction-item${item.exact ? " exact" : ""}">
        <div class="market-item-head">
          <div>
            <span>${escapeHtml(item.date.replaceAll("-", "."))} 신고</span>
            <strong>${escapeHtml([item.umdNm, item.jibun || "지번 비공개"].filter(Boolean).join(" "))}</strong>
            <small>${escapeHtml([item.jimok, item.landUse, item.dealType].filter(Boolean).join(" · ") || "세부 항목 미제공")}</small>
          </div>
          <span class="market-badge${item.exact ? "" : " neutral"}">${item.exact ? "선택 필지 일치" : "동일 법정동"}</span>
        </div>
        <dl class="market-item-facts">
          <div><dt>거래금액</dt><dd>${escapeHtml(formatDealAmount(item.amount))}</dd></div>
          <div><dt>거래면적</dt><dd>${escapeHtml(formatNumber(item.area, 2))}㎡</dd></div>
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

  function renderTransactions(items, scope, failedMonths, requestedMonths) {
    state.transactionItems = items;
    state.transactionShowAll = false;
    if (!items.length) {
      renderMarketStats("#transactionStats", [
        {label: "공개 거래", value: "0건", note: "선택 기간·범위"},
        {label: "중위 거래금액", value: "미제공", note: "조회 결과 없음"},
        {label: "중위 거래단가", value: "미제공", note: "조회 결과 없음"},
        {label: "선택 필지 일치", value: "0건", note: "공개 지번 기준"}
      ]);
      $("#transactionChartCard").hidden = true;
      $("#transactionListSection").hidden = true;
      setStatus("#transactionStatus", `${scope || "선택 지역"}에서 최근 ${requestedMonths}개월 신고된 토지 매매를 찾지 못했습니다.`, "success");
      return;
    }
    const exact = items.filter((item) => item.exact).length;
    const latest = items[0]?.date?.replaceAll("-", ".") || "미제공";
    renderMarketStats("#transactionStats", [
      {label: "공개 거래", value: `${formatNumber(items.length)}건`, note: `${scope} · 취소 제외`},
      {label: "중위 거래금액", value: formatDealAmount(median(items.map((item) => item.amount))), note: "총액 · 매매가격"},
      {label: "중위 거래단가", value: `${formatNumber(median(items.map((item) => item.unitPrice)), 1)}만원/㎡`, note: "거래금액÷면적"},
      {label: "선택 필지 일치", value: `${formatNumber(exact)}건`, note: `최근 신고 ${latest}`}
    ]);
    renderTransactionChart(items);
    renderTransactionList();
    const partial = failedMonths ? ` · ${failedMonths}개월 응답 실패` : "";
    setStatus("#transactionStatus", `${scope}의 최근 ${requestedMonths}개월 공개 거래를 조회했습니다${partial}.`, failedMonths ? "" : "success");
  }

  async function loadTransactions(force = false) {
    const parcel = state.parcel;
    if (!parcel || state.activeTab !== "transactions") return;
    if (!state.serviceKey) {
      setStatus("#transactionStatus", "현재 실거래 조회 서비스를 이용할 수 없습니다.");
      return;
    }
    const area = parseParcelArea(parcel);
    if (!area.lawdCode) {
      setStatus("#transactionStatus", "실거래 조회에 필요한 시군구 코드(PNU)를 확인할 수 없습니다.", "error");
      return;
    }
    const range = Math.max(12, Math.min(36, Number($("#transactionRange")?.value || 12)));
    const cacheKey = `${parcel.pnu || parcel.id}:${range}`;
    if (!force && state.transactionCacheKey === cacheKey) return;
    state.transactionController?.abort();
    const controller = new AbortController();
    state.transactionController = controller;
    const requestId = ++state.transactionRequest;
    $("#transactionStats").innerHTML = "";
    $("#transactionChartCard").hidden = true;
    $("#transactionListSection").hidden = true;
    setStatus("#transactionStatus", `최근 ${range}개월 토지 매매를 불러오고 있습니다.`, "loading");
    try {
      const months = recentMonths(range);
      const results = await mapConcurrent(months, 4, (month) => fetchRtmsMonth(area.lawdCode, month, controller.signal));
      if (requestId !== state.transactionRequest || controller.signal.aborted) return;
      const successes = results.filter((result) => result.status === "fulfilled");
      if (!successes.length) throw results.find((result) => result.status === "rejected")?.reason || publicApiError("실거래를 조회하지 못했습니다.");
      const scoped = scopeTransactionItems(successes.flatMap((result) => result.value), area);
      state.transactionCacheKey = cacheKey;
      renderTransactions(scoped.items, scoped.scope, results.length - successes.length, range);
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error("RTMS land trade lookup failed", {message: error?.message, code: error?.code});
      setStatus("#transactionStatus", apiErrorMessage(error, "국토교통부 토지 실거래 API"), "error");
    }
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

  async function loadAuctions(force = false) {
    const parcel = state.parcel;
    if (!parcel || state.activeTab !== "auctions") return;
    if (!state.serviceKey) {
      setStatus("#auctionStatus", "공식 조회 버튼은 바로 사용할 수 있으며, 온비드 목록 조회는 현재 이용할 수 없습니다.");
      return;
    }
    const area = parseParcelArea(parcel);
    if (!area.sido || !area.emd) {
      setStatus("#auctionStatus", "온비드 조회에 필요한 시도·읍면동을 주소에서 확인할 수 없습니다.", "error");
      return;
    }
    const cacheKey = `${parcel.pnu || parcel.id}:${area.sido}:${area.sgg}:${area.emd}`;
    if (!force && state.auctionCacheKey === cacheKey) return;
    state.auctionController?.abort();
    const controller = new AbortController();
    state.auctionController = controller;
    const requestId = ++state.auctionRequest;
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
      setStatus("#auctionStatus", apiErrorMessage(error, "온비드 차세대 부동산 물건목록 API"), "error");
    }
  }

  function setParcel(parcel) {
    state.parcel = parcel || null;
    state.transactionController?.abort();
    state.auctionController?.abort();
    state.transactionRequest += 1;
    state.auctionRequest += 1;
    state.transactionCacheKey = "";
    state.auctionCacheKey = "";
    state.transactionItems = [];
    state.auctionItems = [];
    resetTransactionView();
    resetAuctionView();
  }

  function activate(tab) {
    state.activeTab = tab;
    if (tab === "transactions") void loadTransactions();
    if (tab === "auctions") void loadAuctions();
  }

  function bindEvents() {
    $("#transactionRange")?.addEventListener("change", () => {
      state.transactionCacheKey = "";
      if (state.activeTab === "transactions") void loadTransactions(true);
    });
    $("#refreshTransactions")?.addEventListener("click", () => void loadTransactions(true));
    $("#refreshAuctions")?.addEventListener("click", () => void loadAuctions(true));
    $("#openOnbidSearch")?.addEventListener("click", () => openOfficialSite(ONBID_SEARCH_URL, "온비드"));
    $("#openCourtAuction")?.addEventListener("click", () => openOfficialSite(COURT_AUCTION_URL, "법원경매"));
    resetTransactionView();
    resetAuctionView();
  }

  window.TojihannunMarketData = {setParcel, activate};
  bindEvents();
})();
