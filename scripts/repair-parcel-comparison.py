from pathlib import Path

MARKER = 'PARCEL_COMPARISON_20261117'
changed = {}
def read(path): return Path(path).read_text()
def once(text, before, after, label):
    if text.count(before) != 1:
        raise RuntimeError('Source changed; reconcile ' + label)
    return text.replace(before, after, 1)

def replace_function(text, start, end, replacement):
    a, b = text.index(start), text.index(end, text.index(start))
    return text[:a] + replacement + '\n\n' + text[b:]

parser = r'''  // PARCEL_COMPARISON_20261117: selected cadastral identity and regional scope are independent.
  function parseParcelArea(parcel) {
    const suffix = /\s*[전답과목임광염대장학차주창도철제천구유양수공체원종사묘잡]$/;
    const legalName = /^[가-힣][가-힣0-9·.]*[동읍면리가]$/;
    function addressParts(value, roadOnly = false) {
      const raw = String(value || "").trim();
      const tokens = raw.replace(/[(),]/g, " ").split(/\s+/).filter(Boolean);
      const lotIndex = tokens.findIndex(token => /^(?:산)?\d+(?:-\d+)?(?:번지)?(?:[전답과목임광염대장학차주창도철제천구유양수공체원종사묘잡])?$/.test(token));
      const roadIndex = tokens.findIndex(token => /(?:로|길)$/.test(token));
      const isRoad = roadOnly || (roadIndex >= 0 && (lotIndex < 0 || roadIndex < lotIndex));
      const boundary = isRoad && roadIndex >= 0 ? roadIndex : lotIndex >= 0 ? lotIndex : tokens.length;
      let emdIndex = -1;
      for (let index = boundary - 1; index >= 0; index -= 1) {
        if (legalName.test(tokens[index])) { emdIndex = index; break; }
      }
      // A parenthesized legal dong can supplement a road address. Its street number is NEVER a lot.
      const parenthesized = [...raw.matchAll(/\(([^)]*)\)/g)].flatMap(match => match[1].split(/[\s,]+/));
      const emd = emdIndex >= 0 ? tokens[emdIndex] : parenthesized.find(token => legalName.test(token)) || "";
      const prefix = tokens.slice(0, emdIndex >= 0 ? emdIndex : boundary);
      const sido = prefix.find(token => /(?:특별시|광역시|특별자치시|특별자치도|도)$/.test(token)) || "";
      const sgg = prefix.filter(token => token !== sido && /(?:시|군|구)$/.test(token)).join(" ");
      const addressLot = !isRoad && lotIndex >= 0
        ? (tokens[lotIndex - 1] === "산" ? "산" : "") + tokens[lotIndex].replace(suffix, "") : "";
      return {sido, sgg, emd, lot: normalizeLot(addressLot)};
    }
    const cadastral = addressParts(parcel?.address);
    const road = addressParts(parcel?.road, true);
    const pnu = String(parcel?.pnu || "").trim();
    return {
      sido: cadastral.sido || road.sido,
      sgg: cadastral.sgg || road.sgg,
      emd: cadastral.emd || road.emd,
      lawdCode: /^\d{10}(?:[12]\d{8})?$/.test(pnu) ? pnu.slice(0, 5) : "",
      lot: parcelLot(parcel, cadastral.lot)
    };
  }'''
js = read('market-data.js')
if MARKER not in js:
    js = replace_function(js, '  function parseParcelArea(parcel) {', '  function normalizeLot(value) {', parser)
    helper = r'''  function selectTransactionView(view) {
    const session = state.transactionSession;
    if (!session || !["parcel", "nearby"].includes(view)) return;
    if (!session.area.lawdCode || !session.area.emd || (view === "parcel" && !session.area.lot)) return;
    session.viewManuallySelected = true;
    state.transactionView = view;
    renderTransactionSession(session);
  }

'''
    js = once(js, '  function renderTransactionView() {', helper + '  function renderTransactionView() {', 'view handler')
    js = once(js, 'state.transactionView = mode; renderTransactionSession(state.transactionSession);', 'selectTransactionView(mode);', 'legacy scope control')
    js = once(js, 'onView:(view) => {state.transactionView=view;renderTransactionSession(state.transactionSession);},', 'onView:selectTransactionView,', 'presentation scope control')
    js = once(js, '    const scoped = scopeTransactionItems(allItems, session.area, session.type);', '''    const scoped = scopeTransactionItems(allItems, session.area, session.type);
    if (!session.loading && !session.error && !session.viewManuallySelected && !scoped.items.length && scoped.comparable.length) {
      state.transactionView = "nearby";
    }''', 'regional fallback')
    js = once(js, '    state.transactionGroups = {...scoped,', '''    state.transactionGroups = {...scoped,
      regionScope: session.area.emd,
      parcelIdentified: Boolean(session.area.lot),
      regionIdentified: Boolean(session.area.lawdCode && session.area.emd),
      identityError: Boolean(session.identityError),
      autoNearby: state.transactionView === "nearby" && !session.viewManuallySelected && !scoped.items.length,''', 'identity flags')
    js = once(js, '''    if (!area.lawdCode || !area.emd || !area.lot) {
      setStatus("#transactionStatus", "선택 필지의 법정동·지번 식별정보를 확인하지 못했습니다. 거래 없음이 아닙니다.", "error"); return;
    }''', '''    if (!area.lawdCode || !area.emd) {
      state.transactionController?.abort();
      state.transactionRequest += 1;
      const period = String($("#transactionRange")?.value || DEFAULT_TRANSACTION_RANGE);
      const session = {key:"unresolved", type:state.transactionType, area, period, months:transactionMonths(period),
        results:new Map(), snapshots:new Map(), failures:new Map(), loading:false, identityError:true,
        error:"선택 지역의 법정동을 확인하지 못했습니다. 지번주소로 다시 검색해 주세요. 거래 없음이 아닙니다."};
      state.transactionSession = session;
      renderTransactionSession(session);
      return;
    }''', 'regional identity guard')
    js = once(js, 'if (window.TojiStaticTrades && (!buildingType || buildingType === "multiFamily")) {', 'if (area.lot && window.TojiStaticTrades && (!buildingType || buildingType === "multiFamily")) {', 'exact-only type discovery')
    js = once(js, '      state.transactionSession = session;\n      state.transactionView = options.view || "parcel";', '''      session.viewManuallySelected = Boolean(options.view);
      state.transactionSession = session;
      state.transactionView = area.lot ? options.view || "parcel" : "nearby";''', 'initial scope')
    changed['market-data.js'] = js
for path, before, after in [
    ('static-transactions.js', "|| !area.emd || !area.lot) return null;", "|| !area.emd || (!includeNearby && !area.lot)) return null;"),
    ('distributed-transactions.js', "|| !area.emd || !area.lot ||", "|| !area.emd || (!includeNearby && !area.lot) ||")
]:
    src = read(path)
    if MARKER not in src:
        changed[path] = '// ' + MARKER + ': regional reads do not require an exact lot.\n' + once(src, before, after, path)
ui = read('transaction-ui.js')
if MARKER not in ui:
    ui = '// ' + MARKER + ': keep comparable and exact transactions explicitly separated.\n' + ui
    ui = once(ui, "    $('refreshTransactions').disabled=false;panel.removeAttribute('aria-busy');", "    for(const id of ['transactionPricingControls','transactionPriceContext','transactionInsight'])if($(id))$(id).hidden=true;\n    $('refreshTransactions').disabled=false;panel.removeAttribute('aria-busy');", 'reset blank analytics')
    ui = once(ui, "  controls.hidden=!allItems.length;", "  controls.hidden=!allItems.length;\n  controls.querySelector('.price-control-heading strong').textContent=`비교할 ${definition.areaKind}`;", 'area heading')
    ui = once(ui, "    $('transactionAreaLabel').textContent=`${group.scope} · ${nearby?'같은 법정동 비교':'선택 지번 기준'}`;", "    const displayScope=nearby?group.regionScope||group.scope:group.scope;\n    $('transactionAreaLabel').textContent=`${displayScope} · ${nearby?'같은 법정동 비교':'선택 지번 기준'}`;", 'scope heading')
    before = "    if(scope){scope.className='transaction-scope-switch';scope.replaceChildren();for(const [mode,label,list]of[['parcel','해당 지번',group.items],['nearby','같은 법정동 비교',group.comparable]]){const b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',String(view===mode));b.textContent=label+(list.length?' · '+number(list.length)+'건':group.loading?' · 조회 중':'');b.onclick=()=>onView(mode);scope.append(b);}}"
    after = """    if(scope){
      scope.className='transaction-scope-switch';scope.replaceChildren();
      for(const [mode,label,list]of[['parcel','해당 지번',group.items],['nearby','같은 법정동 비교',group.comparable]]){
        const b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',String(view===mode));
        b.disabled=group.regionIdentified===false || (mode==='parcel' && group.parcelIdentified===false);
        const unavailable=group.regionIdentified===false?' · 지역 미확인':mode==='parcel'&&group.parcelIdentified===false?' · 지번 미확인':'';
        b.textContent=label+(unavailable || (list.length?' · '+number(list.length)+'건':group.loading?' · 조회 중':''));
        b.onclick=()=>onView(mode);scope.append(b);
      }
    }"""
    ui = once(ui, before, after, 'scope buttons')
    ui = once(ui, "nearby?'같은 법정동의 비교 자료입니다. 선택 필지의 거래나 거리순 주변 거래가 아닙니다.'", "nearby?(group.autoNearby?'해당 지번 거래를 확인하지 못해 같은 법정동 비교를 표시합니다. 선택 필지의 거래나 거리순 주변 거래가 아닙니다.':'같은 법정동의 비교 자료입니다. 선택 필지의 거래나 거리순 주변 거래가 아닙니다.')", 'comparison disclosure')
    ui = once(ui, "status.textContent=failed?", "status.textContent=group.identityError?group.error:failed?", 'identity error message')
    ui = once(ui, 'areaKind:definition.areaKind,scope:group.scope,selectedArea', 'areaKind:definition.areaKind,scope:displayScope,selectedArea', 'analysis scope label')
    ui = once(ui, '    renderPriceControls(allItems,options,definition);', "    $('transactionPriceContext').hidden=!items.length;\n    $('transactionInsight').hidden=!items.length;\n    renderPriceControls(allItems,options,definition);", 'restore populated analytics')
    ui = once(ui, "const emptyTitle=group.loading?'거래 내역 조회 중':failed?'거래 정보를 읽지 못했습니다':'해당 지번의 거래 자료를 아직 확인하지 못했습니다';", "const emptyTitle=group.identityError?'조회할 지역을 확인하지 못했습니다':group.loading?'거래 내역 조회 중':failed?'거래 정보를 읽지 못했습니다':nearby?'같은 법정동의 거래 자료를 아직 확인하지 못했습니다':'해당 지번의 거래 자료를 아직 확인하지 못했습니다';", 'empty scope title')
    ui = once(ui, "esc(group.loading?'거래 내역을 불러오고 있습니다.':failed?", "esc(group.identityError?group.error:group.loading?'거래 내역을 불러오고 있습니다.':failed?", 'empty identity guidance')
    changed['transaction-ui.js'] = ui
html = read('index.html')
import re
html = re.sub(r'(distributed-transactions\.js|market-data\.js|static-transactions\.js|transaction-ui\.js)\?v=[^"\s\'>]+', r'\1?v=20261117.parcel-comparison-1', html)
changed['index.html'] = html

# These tests join the normal npm test command only after the source patch is installed.
tests = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../market-data.js',import.meta.url),'utf8');
const parcel={id:'regression-parcel',pnu:'4121010100101590042',address:'광명동 159-42',road:'경기도 광명시 오리로 1034-1 (광명동)',number:'159-42대',buildings:[{use:'다세대주택'}]};
const row={dealYear:'2026',dealMonth:'10',dealDay:'05',dealAmount:'31000',excluUseAr:'59.7',umdNm:'광명동',jibun:'159-42',mhouseNm:'회귀검증용 건물',floor:'3'};
function harness(rows=[row]){
  const elements=new Map(),calls=[];
  const get=key=>{if(!elements.has(key))elements.set(key,{value:'',textContent:'',innerHTML:'',hidden:false,dataset:{},remove(){},classList:{add(){},remove(){}},addEventListener(){}});return elements.get(key);};
  class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-11-17T00:00:00Z']));}static now(){return new Date('2026-11-17T00:00:00Z').getTime();}}
  const context={console,Date:Clock,URL,URLSearchParams,AbortController,AbortSignal,DOMException,setTimeout,clearTimeout,
    document:{querySelector:get,querySelectorAll:()=>[]},navigator:{},
    localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}},
    fetch:async url=>{assert.match(String(url),/^\.\/rtms-verified/,'no government API requests');return {ok:true,json:async()=>({entries:[]})};},
    window:{location:{href:'https://tojihannun.designboard.net/'},__TOJI_RUNTIME_CONFIG__:{},TojiStaticTrades:{lookup:async(area,type,options)=>{calls.push({area,type,options});return {rows,completeMonths:['202610'],verifiedAt:'2026-11-17T00:00:00Z'};}}}};
  const injected=source.replace('  bindEvents();',`  renderTransactionView=()=>{state.transactionItems=state.transactionView==='nearby'?state.transactionGroups.comparable:state.transactionGroups.items;};
  window.testApi={state,parseParcelArea,normalizeLot,scopeTransactionItems,loadTransactions,setParcel,selectTransactionView,renderTransactionSession};
  bindEvents();`);
  vm.runInNewContext(injected,context);
  const api=context.window.testApi;assert.ok(api,'test seam');api.setParcel(parcel);api.state.activeTab='transactions';get('#transactionRange').value='36';
  return {api,get,calls,context};
}
test('short cadastral label keeps legal dong, region and PNU lot',()=>{
  const {api}=harness();const a=api.parseParcelArea(parcel);assert.equal(a.emd,'광명동');assert.equal(a.lawdCode,'41210');assert.equal(a.lot,'159-42');assert.equal(a.sido,'경기도');assert.equal(a.sgg,'광명시');
  for(const address of ['광명동 159-42대','경기도 광명시 광명동 159-42','광명동 159-42'])assert.equal(api.parseParcelArea({...parcel,address}).emd,'광명동');
});
test('road number is never mistaken for cadastral lot',()=>{
  const {api}=harness();const a=api.parseParcelArea({...parcel,pnu:'4121010100',number:'',address:'',road:parcel.road});assert.equal(a.emd,'광명동');assert.equal(a.lawdCode,'41210');assert.equal(a.lot,'');
  assert.equal(api.parseParcelArea({...parcel,pnu:'4121010100',number:'',address:parcel.road}).lot,'');
  assert.equal(api.parseParcelArea({...parcel,pnu:'',number:'',address:'광명동 산 15-2'}).lot,'산15-2');
});
test('short and full addresses load the same exact and comparison data',async()=>{
  for(const address of ['광명동 159-42','경기도 광명시 광명동 159-42']){
    const {api,calls}=harness([row,{...row,jibun:'159-43'},{...row,umdNm:'철산동'}]);api.setParcel({...parcel,address});await api.loadTransactions();
    assert.equal(api.state.transactionGroups.items.length,1);assert.equal(api.state.transactionGroups.comparable.length,1);assert.equal(api.state.transactionView,'parcel');assert.equal(calls.length,1);assert.equal(calls[0].options.includeNearby,true);
  }
});
test('no exact row automatically exposes same-dong analytics, not fabricated parcel records',async()=>{
  const {api}=harness([{...row,jibun:'159-43'},{...row,jibun:'159-**'},{...row,umdNm:'철산동'}]);await api.loadTransactions();
  assert.equal(api.state.transactionView,'nearby');assert.equal(api.state.transactionGroups.items.length,0);assert.equal(api.state.transactionItems.length,2);assert.ok(api.state.transactionItems.every(item=>!item.exact));
  api.selectTransactionView('parcel');assert.equal(api.state.transactionView,'parcel');assert.equal(api.state.transactionItems.length,0);api.renderTransactionSession(api.state.transactionSession);assert.equal(api.state.transactionView,'parcel','do not override explicit selection');
});
test('known legal region without an exact lot still loads comparison only',async()=>{
  const {api,calls}=harness();api.setParcel({...parcel,pnu:'4121010100',address:'광명동',number:''});await api.loadTransactions();
  assert.equal(calls.length,1);assert.equal(calls[0].area.lot,'');assert.equal(api.state.transactionView,'nearby');assert.equal(api.state.transactionGroups.parcelIdentified,false);assert.equal(api.state.transactionGroups.items.length,0);assert.equal(api.state.transactionGroups.comparable.length,1);
  api.selectTransactionView('parcel');assert.equal(api.state.transactionView,'nearby');
});
test('unknown legal region renders an identity error with neither fabricated zero nor stale rows',async()=>{
  const {api,calls}=harness();await api.loadTransactions();api.setParcel({...parcel,pnu:'',address:'',road:'',number:''});await api.loadTransactions();
  assert.equal(calls.length,1);assert.equal(api.state.transactionGroups.regionIdentified,false);assert.equal(api.state.transactionGroups.identityError,true);assert.equal(api.state.transactionItems.length,0);assert.match(api.state.transactionGroups.error,/지번주소/);
});
test('masked public lots still cannot become exact matches',()=>{
  const {api}=harness();for(const lot of ['159-*','159-**','159-42대','159-42 외 1필지'])assert.equal(api.normalizeLot(lot),'');
});
test('central static reader allows missing lot only for an explicit regional comparison',async()=>{
  const calls=[];const files={
    'index.json':{schemaVersion:2,districts:{41210:{index:'41210/index.json'}}},
    '41210/index.json':{schemaVersion:2,district:'41210',coverage:{'rowHouse-sale':['202610']},groups:{'rowHouse-sale':{'광명동':[{path:'41210/rows.json',rows:1}]}}},
    '41210/rows.json':{schemaVersion:2,district:'41210',stream:'rowHouse-sale',emd:'광명동',rows:[{type:'rowHouse',deal:'sale',exactLotPublic:true,lot:'159-42',umdNm:'광명동',date:'2026-10-05',amount:31000,exclusiveArea:59.7}]}
  };
  const context={URL,AbortSignal,window:{},document:{baseURI:'https://test.example/'},fetch:async url=>{const key=String(url).split('/published/')[1];calls.push(key);assert.ok(files[key],key);return {ok:true,json:async()=>files[key]};}};
  vm.runInNewContext(fs.readFileSync(new URL('../static-transactions.js',import.meta.url),'utf8'),context);
  const area={lawdCode:'41210',emd:'광명동',lot:''};assert.equal(await context.window.TojiStaticTrades.lookup(area,'rowHouse'),null);assert.equal(calls.length,0);
  const result=await context.window.TojiStaticTrades.lookup(area,'rowHouse',{includeNearby:true,months:['202610']});assert.equal(result.rows.length,1);assert.equal(result.rows[0].umdNm,'광명동');
});
test('distributed reader likewise preserves exact-only guard while permitting regional reads',async()=>{
  let calls=0;const context={URL,AbortSignal,TextEncoder,window:{},document:{baseURI:'https://test.example/'},fetch:async()=>{calls++;return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({schemaVersion:3,shards:[]})};}};
  vm.runInNewContext(fs.readFileSync(new URL('../distributed-transactions.js',import.meta.url),'utf8'),context);
  const area={lawdCode:'41210',emd:'광명동',lot:''};await context.window.TojiDistributedTrades.lookup(area,'rowHouse');assert.equal(calls,0);await context.window.TojiDistributedTrades.lookup(area,'rowHouse',{includeNearby:true});assert.equal(calls,1);
});
'''
changed['scripts/parcel-comparison.test.mjs'] = tests

browser = read('scripts/transaction-ui.browser.mjs')
if MARKER not in browser:
    # Extend the existing real-published-data browser test before its normal sample lookup.
    scenario = r'''  // PARCEL_COMPARISON_20261117: real collected rows; user-reported short address.
  for(const candidate of [
    {id:'short-address-regression',pnu:'4121010100101590042',address:'광명동 159-42',road:'경기도 광명시 오리로 1034-1 (광명동)',number:'159-42대',buildings:[{use:'다세대주택'}]},
    {id:'regional-only-regression',pnu:'4121010100',address:'광명동',number:'',buildings:[{use:'다세대주택'}]}
  ]){
    await page.evaluate(p=>{
      const sheet=document.getElementById('detailSheet');sheet.classList.add('open');sheet.hidden=false;
      document.querySelectorAll('[data-detail-panel]').forEach(e=>e.hidden=e.id!=='detailPanelTransactions');
      window.TojihannunMarketData.setParcel(p);window.TojihannunMarketData.activate('transactions');
    },candidate);
    await page.waitForFunction(()=>document.getElementById('detailPanelTransactions').getAttribute('aria-busy')==='false'&&document.querySelector('#transactionScopeSwitch button'));
    assert.doesNotMatch(await page.locator('#transactionStatus').textContent(),/식별정보|법정동을 확인하지 못/);
    assert.equal(await page.locator('#transactionScopeSwitch button').count(),2);
    await page.locator('#transactionScopeSwitch button').nth(1).click();
    assert.ok(await page.locator('.trade-row').count()>0,'published same-dong comparison rows must render');
    assert.ok(await page.locator('#transactionAreaFilters button').count()>0,'comparison area filters remain available');
    assert.equal(await page.locator('#transactionChartToggle').isVisible(),true);
    assert.equal(await page.locator('#transactionChartToggle').getAttribute('open'),'');
    assert.match(await page.locator('#transactionAreaLabel').textContent(),/^광명동 · 같은 법정동 비교$/);
    assert.doesNotMatch(await page.locator('#transactionPriceContext').textContent(),/159-42/,'comparison prices must not be labeled as the selected parcel price');
    if(candidate.id==='regional-only-regression')assert.equal(await page.locator('#transactionScopeSwitch button').first().isDisabled(),true);
    await page.setViewportSize({width:1280,height:850});
    assert.equal(await page.locator('#transactionChartToggle').isVisible(),true);
    await page.setViewportSize({width:360,height:800});
    proof.checks.push(candidate.id+': scope tabs, real legal-dong rows, area filters and expanded chart at mobile/desktop widths');
  }
'''
    browser = once(browser, "  await page.goto(origin,{waitUntil:'domcontentloaded'});", "  await page.goto(origin,{waitUntil:'domcontentloaded'});\n" + scenario, 'browser regression entry')
    changed['scripts/transaction-ui.browser.mjs'] = browser

# All source anchors have been validated before touching any tracked file.
for path, content in changed.items():
    Path(path).write_text(content)
print('Installed parcel/region separation in: ' + ', '.join(changed))
