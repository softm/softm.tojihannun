/* Pure, dependency-free helpers. Both browser UI and Node regression tests use these. */
(function (root) {
  "use strict";
  const sources = Object.freeze([
    {id: "city", label: "도시 정비·개발", kind: "ned", operation: "getCtySpceWFS", layer: "dt_d029", color: "#b45309", projection: "EPSG:3857", sourceUrl: "https://www.vworld.kr/"},
    {id: "planning", label: "지구단위계획", kind: "data", layer: "LT_C_UPISUQ161", color: "#6d28d9", projection: "EPSG:4326", sourceUrl: "https://www.vworld.kr/dev/v4dv_2ddataguide2_s002.do?svcIde=upisuq161"},
    {id: "lh", label: "LH 사업지구", kind: "data", layer: "LT_C_LHZONE", color: "#0369a1", projection: "EPSG:4326", sourceUrl: "https://www.vworld.kr/dev/v4dv_2ddataguide2_s002.do?svcIde=lhzone"}
  ]);
  function value(properties, keys) {
    const lower = Object.fromEntries(Object.entries(properties || {}).map(([key, v]) => [key.toLowerCase(), v]));
    for (const key of keys) {
      const v = lower[key.toLowerCase()];
      if ((typeof v === "string" || typeof v === "number") && String(v).trim()) return String(v).trim();
    }
    return "";
  }
  function metadata(properties, source) {
    const name = value(properties, ["district_name", "zone_nm", "biz_nm", "dstrc_nm", "dgm_nm", "dgm_ar_nm", "uname", "name", "사업지구명", "구역명"]);
    const type = value(properties, ["district_type", "zone_type", "ucode_nm", "use_nm", "lclas_nm", "사업유형"]);
    return {
      name: name || `${source.label} (명칭 미제공)`,
      type: type || (source.kind === "ned" ? "도시주제도 · 세부 유형 원문 확인" : source.label),
      // A layer name, notice date or an address is NOT evidence of a business stage.
      stage: value(properties, ["project_stage", "progress_stage", "진행단계"]) || "진행단계 미제공",
      date: value(properties, ["data_date", "reference_date", "기준일", "데이터기준일자"]) || "원본 기준일 미제공",
      notice: value(properties, ["ntfc_no", "ntfcno", "notice_no", "고시번호"]) || "미제공",
      boundary: value(properties, ["boundary_status", "경계기준"]) || "제공기관 도형 · 최신 고시 대조 필요"
    };
  }
  function unpack(payload) {
    if (!payload || typeof payload !== "object") throw new Error("구역 응답 형식이 올바르지 않습니다.");
    const response = payload.response;
    if (response) {
      if (response.status === "NOT_FOUND") return {features: [], total: 0};
      if (response.status !== "OK") throw new Error(String(response.error?.text || response.error?.code || response.status || "구역 조회 실패").slice(0, 180));
      const fc = response.result?.featureCollection;
      if (!fc || !Array.isArray(fc.features)) throw new Error("구역 도형 응답이 누락되었습니다.");
      const rawTotal = response.record?.total;
      const total = rawTotal !== undefined && rawTotal !== null && Number.isFinite(Number(rawTotal)) ? Number(rawTotal) : null;
      return {features: fc.features, total};
    }
    if (payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) throw new Error("구역 도형을 확인할 수 없습니다.");
    const count = payload.totalFeatures ?? payload.numberMatched;
    return {features: payload.features, total: count !== undefined && count !== null && count !== "unknown" && Number.isFinite(Number(count)) ? Number(count) : null};
  }
  function polygonFeatures(features) {
    return features.filter(f => f && f.type === "Feature" && ["Polygon", "MultiPolygon"].includes(f.geometry?.type));
  }
  function naverUrl(lonLat, zoom = 17) {
    if (!Array.isArray(lonLat) || lonLat.length < 2) return "https://fin.land.naver.com/map";
    const [lon, lat] = lonLat.map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return "https://fin.land.naver.com/map";
    // Use the public coordinate-link format, not the opaque token in a shared URL.
    const url = new URL("https://new.land.naver.com/houses");
    url.searchParams.set("ms", `${lat.toFixed(7)},${lon.toFixed(7)},${Math.max(12, Math.min(19, Math.round(Number(zoom) || 17)))}`);
    url.searchParams.set("a", "VL:DDDGG:SGJT:SG:GM:TOJI:APT:OPST");
    url.searchParams.set("b", "A1");
    return url.href;
  }
  function boundsKey(extent, ids) {
    if (!Array.isArray(extent) || extent.length !== 4 || !extent.every(Number.isFinite) || extent[0] >= extent[2] || extent[1] >= extent[3]) throw new Error("잘못된 지도 범위");
    return [...ids].sort().join(",") + ":" + extent.map(v => v.toFixed(3)).join(",");
  }
  root.TojiDistrictCore = Object.freeze({sources, value, metadata, unpack, polygonFeatures, naverUrl, boundsKey});
})(globalThis);
