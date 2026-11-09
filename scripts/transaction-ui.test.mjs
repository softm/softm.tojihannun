import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const src=fs.readFileSync(new URL('transaction-ui.js',root),'utf8');
const sandbox={window:{},document:{}};vm.createContext(sandbox);vm.runInContext(src,sandbox);
const ui=sandbox.window.TojiTransactionUI;
test('collected history never claims full history',()=>{const c=ui.coverage({savedOnly:true,coveredMonthKeys:['202610','202608','202610']});assert.equal(c.count,2);assert.equal(c.partial,true);assert.equal(c.expected,null);assert.equal(c.label,'일부 기간 확보');});
test('explicit period distinguishes missing and complete months',()=>{assert.equal(ui.coverage({totalMonths:12,coveredMonthKeys:['202610']}).partial,true);assert.equal(ui.coverage({totalMonths:1,coveredMonthKeys:['202610']}).partial,false);});
test('loading and failure never become zero transactions',()=>{assert.match(ui.coverage({loading:true}).label,/불러오는/);assert.match(ui.coverage({staticError:true}).label,/확인 필요/);assert.equal(ui.coverage({}).label,'수집 범위 미확인');});
test('invalid coverage months are rejected',()=>assert.equal(ui.coverage({coveredMonthKeys:['202613','202600','2026','202611']}).count,1));
test('money values retain ten-thousand-won units',()=>{assert.equal(ui.money(51500),'5억 1,500만원');assert.equal(ui.money(50000),'5억원');assert.equal(ui.money(900),'900만원');assert.equal(ui.money(null),'미제공');});
test('sorting does not mutate exported data',()=>{const items=[{date:'2026-01-01',amount:100},{date:'2026-02-01',amount:50}];assert.equal(ui.sorted(items)[0].date,'2026-02-01');assert.equal(ui.sorted(items,'amount-desc')[0].amount,100);assert.equal(items[0].date,'2026-01-01');});
test('UI uses no source API requests or fixed overlays',()=>{assert.doesNotMatch(src,/\bfetch\s*\(/);const css=fs.readFileSync(new URL('transaction-ui.css',root),'utf8');assert.doesNotMatch(css,/position\s*:\s*fixed/);assert.match(src,/limit\+=20/);assert.doesNotMatch(src,/Math\.min\(items\.length, 200\)/);});

async function loader(overrides={}){
  const row={date:'2026-10-21',amount:51500,umdNm:'광명동',lot:'94-9',exactLotPublic:true,type:'rowHouse',deal:'sale',exclusiveArea:59.7,buildingName:'테스트 전용',floor:3};
  const rows=[row,{...row,lot:'1-1'},{...row,lot:'94-9',exactLotPublic:false},{...row,cancelled:true}];
  const calls=[];
  const files={
    'index.json':{schemaVersion:2,districts:{41210:{index:'41210/index.json'}}},
    '41210/index.json':{schemaVersion:2,district:'41210',coverage:{'rowHouse-sale':['202610']},groups:{'rowHouse-sale':{'광명동':[{path:'41210/dong.json',rows:4}]}}},
    '41210/dong.json':{schemaVersion:2,district:'41210',stream:'rowHouse-sale',emd:'광명동',rows},...overrides
  };
  const env={window:{},URL,AbortSignal,document:{baseURI:'https://example.test/'},fetch:async url=>{calls.push(String(url));const key=String(url).split('/published/')[1];return{ok:Boolean(files[key]),json:async()=>files[key]};}};
  vm.createContext(env);vm.runInContext(fs.readFileSync(new URL('static-transactions.js',root),'utf8'),env);
  return {api:env.window.TojiStaticTrades,calls,area:{lawdCode:'41210',emd:'광명동',lot:'94-9'}};
}
test('default static lookup remains exact and excludes cancellations',async()=>{const {api,area}=await loader();assert.equal((await api.lookup(area,'rowHouse')).rows.length,1);});
test('comparison data never turns a masked lot into an exact match',async()=>{const {api,area,calls}=await loader();const result=await api.lookup(area,'rowHouse',{includeNearby:true});assert.equal(result.rows.length,3);assert.equal(result.rows.filter(r=>r.jibun==='94-9').length,1);assert.equal(result.rows.filter(r=>r.jibun==='').length,1);assert.ok(calls.every(u=>u.startsWith('https://example.test/data/transactions/published/')));});
test('manual reload fetches published files again',async()=>{const {api,area,calls}=await loader();await api.lookup(area,'rowHouse');const n=calls.length;await api.lookup(area,'rowHouse');assert.equal(calls.length,n);await api.lookup(area,'rowHouse',{force:true});assert.ok(calls.length>n);});
test('uncollected region is distinct from a failed published file',async()=>{const {api,area}=await loader();assert.equal(await api.lookup({...area,lawdCode:'99999'},'rowHouse'),null);const bad=await loader({'41210/dong.json':null});await assert.rejects(bad.api.lookup(bad.area,'rowHouse'),/unavailable/);});
