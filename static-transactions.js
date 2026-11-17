/* Static RTMS data only. This loader never calls MOLIT or any third-party API. */
(() => {
  'use strict';
  const base = new URL('./data/transactions/published/', document.baseURI);
  const cache = new Map();
  const norm = value => String(value || '').replace(/\s+/g, '');
  function invalidate() { cache.clear(); }
  async function json(relative) {
    if (!/^[\w/.-]+$/.test(relative) || relative.includes('..')) throw new Error('Invalid data path');
    const key = new URL(relative, base).href;
    if (!cache.has(key)) cache.set(key, (async () => {
      const response = await fetch(key, {cache:'no-cache', signal: AbortSignal.timeout(6000)});
      if (!response.ok) throw new Error('Static transaction data unavailable');
      const data = await response.json();
      if (data.schemaVersion !== 2) throw new Error('Unsupported static transaction format');
      return data;
    })().catch(error => { cache.delete(key); throw error; }));
    return cache.get(key);
  }
  async function lookupCentral(area, type, {includeNearby = false, force = false, months} = {}) {
    if (!/^\d{5}$/.test(area?.lawdCode || '') || !area.emd || !area.lot) return null;
    if (force) invalidate();
    const catalog = await json('index.json');
    const region = catalog.districts?.[area.lawdCode];
    if (!region) return null;
    const index = await json(region.index);
    if (index.district !== area.lawdCode) throw new Error('Static district mismatch');
    const stream = type + '-sale';
    const covered = (index.coverage?.[stream] || []).filter(month => !months || months.includes(month));
    if (!covered.length) return null;
    const names = Object.keys(index.groups?.[stream] || {}).filter(name => norm(name) === norm(area.emd));
    if (names.length > 1) throw new Error('Ambiguous legal dong');
    const rows = [];
    for (const name of names) for (const file of index.groups[stream][name]) {
      const data = await json(file.path);
      if (data.district !== area.lawdCode || data.stream !== stream || norm(data.emd) !== norm(area.emd) || data.rows?.length !== file.rows) throw new Error('Static shard scope/count mismatch');
      for (const row of data.rows) {
        if (row.cancelled || row.type !== type || row.deal !== 'sale') continue;
        if (!includeNearby && !(row.exactLotPublic && row.lot === area.lot)) continue;
        if (norm(row.umdNm) !== norm(area.emd)) throw new Error('Static row legal dong mismatch');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')) throw new Error('Invalid static contract date');
        const [year, month, day] = row.date.split('-');
        if (months && !months.includes(year + month)) continue;
        rows.push({dealYear:year,dealMonth:month,dealDay:day,dealAmount:row.amount,
          umdNm:row.umdNm,jibun:row.exactLotPublic ? row.lot : '',mhouseNm:row.buildingName,buildingNm:row.buildingName,
          floor:row.floor,excluUseAr:row.exclusiveArea,buildingAr:row.buildingArea,landAr:row.landArea,
          dealArea:type === 'land' ? row.area : '',jimok:row.jimok,landUse:row.landUse,dealingGbn:row.dealType,
          cdealDay:'',cdealType:'',sourceRecord:row.sourceId});
      }
    }
    return {type,lawdCode:area.lawdCode,emd:area.emd,lot:area.lot,completeMonths:covered,rows,
      includesNearby:includeNearby,verifiedAt:index.updatedAt,source:'국토부 수집 정적자료',fullHistoryComplete:false};
  }
  async function lookup(area, type, options = {}) {
    const includeNearby = options.includeNearby === true;
    const force = options.force === true;
    const months = options.months;
    let distributedError = '';
    if (window.TojiDistributedTrades) {
      try {
        const remote = await window.TojiDistributedTrades.lookup(area, type, {includeNearby, force, months});
        if (remote) return remote;
      } catch (error) {
        // Retain previously published central rows, but DO NOT silently treat
        // a degraded fallback as a complete history or as zero transactions.
        distributedError = String(error?.message || error || '분산 저장소 조회 실패').slice(0, 240);
        console.warn('Distributed RTMS unavailable; trying partial central dataset:', distributedError);
      }
    }
    const central = await lookupCentral(area, type, {includeNearby, force, months});
    if (central) return {...central, degraded: true, distributedError, source:'중앙 임시 수집자료 (전체 이력 아님)'};
    if (distributedError) throw new Error('분산 실거래 자료 연결 실패: ' + distributedError);
    return null;
  }
  window.TojiStaticTrades = Object.freeze({lookup,invalidate});
})();
