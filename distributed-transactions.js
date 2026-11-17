/* Distributed RTMS reader. Shard Pages are preferred only after an explicit serving=pages handoff.
   Any routing, CORS, gzip, integrity or availability failure falls back to the tracked central dataset. */
(() => {
  'use strict';

  const REGISTRY_URL = new URL('./data/transactions/storage-registry.json', document.baseURI);
  const MAX_JSON_BYTES = 2_000_000;
  const MAX_LEGACY_DISTRICT_INDEX_BYTES = 20_000_000;
  const MAX_CHUNK_BYTES = 50_000_000;
  const cache = new Map();
  let registryPromise = null;

  const norm = value => String(value || '').replace(/\s+/g, '');
  const trustedId = value => /^realestate-data-\d{3}$/.test(String(value || ''));
  const validCode = value => /^\d{5}$/.test(String(value || ''));
  const validMonth = value => /^20\d{4}$/.test(String(value || ''));

  function invalidate() {
    cache.clear();
    registryPromise = null;
  }

  async function fetchJson(url, {limit = MAX_JSON_BYTES} = {}) {
    const href = url instanceof URL ? url.href : String(url);
    if (!cache.has(href)) {
      cache.set(href, (async () => {
        const response = await fetch(href, {cache:'no-cache', credentials:'omit', signal:AbortSignal.timeout(6500)});
        if (!response.ok) throw new Error('Distributed transaction data unavailable');
        const length = Number(response.headers.get('content-length') || 0);
        if (length && length > limit) throw new Error('Distributed manifest size limit');
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > limit) throw new Error('Distributed manifest size limit');
        return JSON.parse(text);
      })().catch(error => {
        cache.delete(href);
        throw error;
      }));
    }
    return cache.get(href);
  }

  async function fetchChunk(url) {
    const href = url instanceof URL ? url.href : String(url);
    if (!cache.has(href)) {
      cache.set(href, (async () => {
        const response = await fetch(href, {cache:'no-cache', credentials:'omit', signal:AbortSignal.timeout(8000)});
        if (!response.ok) throw new Error('Distributed transaction chunk unavailable');
        const length = Number(response.headers.get('content-length') || 0);
        if (length && length >= MAX_CHUNK_BYTES) throw new Error('Distributed chunk size limit');
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength >= MAX_CHUNK_BYTES) throw new Error('Distributed chunk size limit');
        const bytes = new Uint8Array(buffer);
        const gzip = bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b;
        let text;
        if (gzip) {
          if (typeof DecompressionStream !== 'function') throw new Error('Gzip decompression unsupported');
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
          text = await new Response(stream).text();
        } else {
          // Some CDNs transparently decode Content-Encoding. Accept the decoded JSON bytes.
          text = new TextDecoder().decode(bytes);
        }
        if (new TextEncoder().encode(text).byteLength >= MAX_CHUNK_BYTES) throw new Error('Distributed decoded chunk size limit');
        return JSON.parse(text);
      })().catch(error => {
        cache.delete(href);
        throw error;
      }));
    }
    return cache.get(href);
  }

  async function registry(force = false) {
    if (force) invalidate();
    if (!registryPromise) {
      registryPromise = fetchJson(REGISTRY_URL).then(value => {
        if (value?.schemaVersion !== 3 || !Array.isArray(value.shards)) throw new Error('Unsupported shard registry');
        return value;
      }).catch(error => {
        registryPromise = null;
        throw error;
      });
    }
    return registryPromise;
  }

  function selectShard(config, lawdCode) {
    if (config?.schemaVersion !== 3 || !Array.isArray(config.shards) || !validCode(lawdCode)) return null;
    const matches = config.shards.filter(shard => Array.isArray(shard.districtCodes) && shard.districtCodes.includes(lawdCode));
    if (matches.length !== 1) {
      if (matches.length > 1) throw new Error('Overlapping distributed transaction ownership');
      return null;
    }
    const shard = matches[0];
    if (shard.collectionOwner !== 'shard' || shard.serving !== 'pages') return null;
    if (!trustedId(shard.id) || shard.repository !== 'softm/' + shard.id) throw new Error('Untrusted shard repository');
    const expectedBase = 'https://softm.github.io/' + shard.id + '/';
    if (shard.pagesBaseUrl !== expectedBase) throw new Error('Untrusted shard Pages URL');
    return shard;
  }

  function safePart(base, shard, area, stream, part) {
    if (!part || part.encoding !== 'gzip' || !Number.isSafeInteger(part.rows) || part.rows < 0 || part.rows > 1500) {
      throw new Error('Invalid distributed part metadata');
    }
    const path = String(part.path || '');
    if (!/^[\w/.-]+\.json\.gz$/.test(path) || path.includes('..') || !path.startsWith(area.lawdCode + '/' + stream + '/')) {
      throw new Error('Invalid distributed chunk path');
    }
    if (!validMonth(part.month)) throw new Error('Invalid distributed month');
    const url = new URL(path, base);
    if (url.origin !== new URL(shard.pagesBaseUrl).origin || !url.pathname.startsWith('/' + shard.id + '/published/')) {
      throw new Error('Distributed chunk escaped shard scope');
    }
    return url;
  }

  function mapRows(data, area, type, includeNearby) {
    const rows = [];
    for (const row of data.rows || []) {
      if (row.cancelled || row.type !== type || row.deal !== 'sale') continue;
      if (!includeNearby && !(row.exactLotPublic && row.lot === area.lot)) continue;
      if (norm(row.umdNm) !== norm(area.emd)) throw new Error('Distributed row legal dong mismatch');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')) throw new Error('Invalid distributed contract date');
      const [year, month, day] = row.date.split('-');
      rows.push({
        dealYear:year, dealMonth:month, dealDay:day, dealAmount:row.amount,
        umdNm:row.umdNm, jibun:row.exactLotPublic ? row.lot : '',
        mhouseNm:row.buildingName, buildingNm:row.buildingName,
        floor:row.floor, excluUseAr:row.exclusiveArea, buildingAr:row.buildingArea, landAr:row.landArea,
        dealArea:type === 'land' ? row.area : '', jimok:row.jimok, landUse:row.landUse,
        dealingGbn:row.dealType, cdealDay:'', cdealType:'', sourceRecord:row.sourceId
      });
    }
    return rows;
  }

  async function lookup(area, type, {includeNearby = false, force = false, months} = {}) {
    if (!validCode(area?.lawdCode) || !area.emd || !area.lot || !/^[A-Za-z]+$/.test(String(type || ''))) return null;
    const config = await registry(force);
    const shard = selectShard(config, area.lawdCode);
    if (!shard) return null;

    const publishedBase = new URL('published/', shard.pagesBaseUrl);
    const catalog = await fetchJson(new URL('index.json', publishedBase));
    if (catalog?.schemaVersion !== 2 || typeof catalog.districts !== 'object' || !catalog.districts) {
      throw new Error('Unsupported distributed catalog');
    }
    const region = catalog.districts[area.lawdCode];
    if (!region) return null;
    if (region.index !== area.lawdCode + '/index.json') throw new Error('Distributed district route mismatch');

    const stream = type + '-sale';
    // New publications expose a small stream-specific manifest. Older shards
    // still use the district-wide index, which may exceed the old 2 MB limit.
    let index;
    let streamSpecific = false;
    try {
      index = await fetchJson(new URL(area.lawdCode + '/' + stream + '/index.json', publishedBase));
      streamSpecific = true;
    } catch (error) {
      if (/size limit/i.test(String(error?.message || ''))) throw error;
      index = await fetchJson(new URL(region.index, publishedBase), {limit:MAX_LEGACY_DISTRICT_INDEX_BYTES});
    }
    if (index?.schemaVersion !== 2 || index.district !== area.lawdCode ||
        (streamSpecific && index.stream !== stream)) throw new Error('Distributed district/stream mismatch');

    const covered = streamSpecific ? index.coverage : index.coverage?.[stream];
    if (!Array.isArray(covered) || !covered.length) return null;
    if (covered.some(month => !validMonth(month))) throw new Error('Invalid distributed coverage month');

    const groups = (streamSpecific ? index.groups : index.groups?.[stream]) || {};
    const names = Object.keys(groups).filter(name => norm(name) === norm(area.emd));
    if (names.length > 1) throw new Error('Ambiguous distributed legal dong');

    const tasks = [];
    for (const name of names) {
      const parts = groups[name];
      if (!Array.isArray(parts)) throw new Error('Invalid distributed group');
      for (const part of parts) {
        if (!covered.includes(part.month)) throw new Error('Distributed part outside coverage');
        if (months && !months.includes(part.month)) continue;
        tasks.push({name, part, url:safePart(publishedBase, shard, area, stream, part)});
      }
    }
    // A large district can have many months. Keep browser network concurrency
    // bounded and retain source order for deterministic row presentation.
    const batches = new Array(tasks.length);
    let cursor = 0;
    await Promise.all(Array.from({length:Math.min(4,tasks.length)}, async () => {
      while (cursor < tasks.length) {
        const i = cursor++;
        const task = tasks[i];
        const data = await fetchChunk(task.url);
        if (data?.schemaVersion !== 2 || data.district !== area.lawdCode || data.stream !== stream ||
            norm(data.emd) !== norm(area.emd) || !Array.isArray(data.rows) || data.rows.length !== task.part.rows) {
          throw new Error('Distributed shard scope/count mismatch');
        }
        batches[i] = mapRows(data, area, type, includeNearby);
      }
    }));
    const rows = batches.flat();

    return {
      type, lawdCode:area.lawdCode, emd:area.emd, lot:area.lot,
      completeMonths:[...new Set(covered)].filter(month => !months || months.includes(month)).sort(), rows,
      includesNearby:includeNearby, verifiedAt:index.updatedAt || region.updatedAt || catalog.generatedAt,
      source:'국토부 분산 수집 자료', storageShard:shard.id, fullHistoryComplete:false
    };
  }

  window.TojiDistributedTrades = Object.freeze({lookup, invalidate, selectShard});
})();
