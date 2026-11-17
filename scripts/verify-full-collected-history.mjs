import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const urls=[];
const env={window:{},document:{baseURI:'https://tojihannun.designboard.net/'},console,URL,AbortSignal,TextEncoder,TextDecoder,Blob,Response,DecompressionStream,
 fetch:async(url,options)=>{
  const u=new URL(String(url));
  assert.ok((u.origin==='https://tojihannun.designboard.net'&&u.pathname.startsWith('/data/transactions/'))||
   (u.origin==='https://softm.github.io'&&/^\/realestate-data-\d{3}\/published\//.test(u.pathname)), 'Only existing static JSON is permitted: '+u.origin);
  urls.push(u.href);assert.ok(urls.length<=600,'Unexpected static-file request growth');
  return fetch(u,options);
 }};
vm.createContext(env);
for(const name of ['distributed-transactions.js','static-transactions.js'])vm.runInContext(fs.readFileSync(name,'utf8'),env);
const started=Date.now();
const data=await env.window.TojiStaticTrades.lookup({lawdCode:'41194',emd:'옥길동',lot:'742-1'},'apartment',{includeNearby:true});
assert.ok(data&&!data.degraded,'Must verify distributed full history, not a degraded central fallback');
const rows=data.rows.filter(r=>r.umdNm==='옥길동'&&r.jibun==='742-1').sort((a,b)=>(a.dealYear+a.dealMonth+a.dealDay).localeCompare(b.dealYear+b.dealMonth+b.dealDay));
const now=new Date();const recent=new Set(Array.from({length:6},(_,i)=>{
 const d=new Date(now.getFullYear(),now.getMonth()-i,1);return String(d.getFullYear())+String(d.getMonth()+1).padStart(2,'0');
}));
const recentCount=rows.filter(r=>recent.has(r.dealYear+r.dealMonth)).length;
assert.ok(rows.length>recentCount,'Confirmed parcel should retain historical contracts beyond six months');
const date=r=>r?`${r.dealYear}-${r.dealMonth}-${String(r.dealDay).padStart(2,'0')}`:null;
const report={source:data.source,shard:data.storageShard,lawdCode:'41194',dong:'옥길동',lot:'742-1',
 coveredMonthCount:data.completeMonths.length,wholePeriodRecords:rows.length,recentSixMonthRecords:recentCount,
 earliestContract:date(rows[0]),latestContract:date(rows.at(-1)),staticRequests:urls.length,governmentApiRequests:0,
 elapsedMs:Date.now()-started,verifiedAt:new Date().toISOString()};
fs.mkdirSync('test-results/full-history',{recursive:true});
fs.writeFileSync('test-results/full-history/published-data.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
