import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';

const base = 'https://softm.github.io/realestate-data-014/published/';
const district = '41194';
const stream = 'apartment-sale';
const dong = '옥길동';
const lot = '742-1';
const current = new Date();
const months = new Set(Array.from({length:6},(_,i)=>{
  const date = new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth()-i,1));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth()+1).padStart(2,'0')}`;
}));

async function fetchJson(relative) {
  const url = new URL(relative, base);
  const response = await fetch(url, {signal:AbortSignal.timeout(16000),headers:{'Cache-Control':'no-cache'}});
  if(!response.ok) throw new Error(`Published shard unavailable: ${relative} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return JSON.parse((bytes[0]===0x1f && bytes[1]===0x8b ? gunzipSync(bytes) : bytes).toString('utf8'));
}

const index = await fetchJson(`${district}/${stream}/index.json`);
assert.equal(index.schemaVersion,2);
assert.equal(index.district,district);
assert.equal(index.stream,stream);
const parts = (index.groups?.[dong] || []).filter(item=>months.has(item.month));
assert.ok(parts.length>0,'Recent Ok-gil apartment months are not published');
const datasets = [];
let cursor = 0;
await Promise.all(Array.from({length:Math.min(4,parts.length)},async()=>{
  while(cursor<parts.length){
    const i = cursor++;
    const part = parts[i];
    const data = await fetchJson(part.path);
    assert.equal(data.district,district);
    assert.equal(data.stream,stream);
    assert.equal(data.emd,dong);
    assert.equal(data.rows?.length,part.rows);
    datasets[i] = data.rows;
  }
}));
const matches = datasets.flat().filter(row =>
  row.type==='apartment' && row.deal==='sale' && row.umdNm===dong &&
  row.exactLotPublic && row.lot===lot && !row.cancelled);
matches.sort((a,b)=>b.date.localeCompare(a.date));
const report = {
  district, dong, lot, months:[...months].sort(), publishedMonths:index.coverage?.length,
  inspectedParts:parts.length, matchingRecords:matches.length,
  latest:matches.slice(0,8).map(r=>({date:r.date,amount:r.amount,area:r.exclusiveArea,floor:r.floor,buildingName:r.buildingName})),
  source:'국토부 수집자료 / realestate-data-014 GitHub Pages'
};
console.log(JSON.stringify(report,null,2));
assert.ok(matches.length>0,'No published sale matched 41194/Okgil-dong 742-1 despite confirmed official-based listing');
