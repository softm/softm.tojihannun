import fs from 'node:fs';
import crypto from 'node:crypto';
function blob(file) { const data=fs.readFileSync(file);return crypto.createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex'); }

// Deterministic, reviewable edits. Unexpected source changes stop installation.
const marker = 'COLLECTION_UI_20261110';
function replaceOnce(s, before, after, label) {
  if (s.split(before).length !== 2) throw new Error('Source changed; reconcile '+label);
  return s.replace(before, after);
}
let js = fs.readFileSync('market-data.js','utf8');
if (!js.includes(marker)) {
  if(blob('market-data.js')!=='b84ccd262043cb9b579621a70ac22455fbadec02') throw new Error('market-data.js changed; reconcile before installing');
  js = replaceOnce(js, '  function resetTransactionView() {', `  // ${marker}: collected-only filters and explicit presentation state.\n  function resetTransactionView() {\n    window.TojiTransactionUI?.reset();`, 'reset');
  js = replaceOnce(js,
    '    setStatus("#transactionStatus", state.serviceKey ? `${definition.label} 확인된 거래를 먼저 표시하고, 미조회 기간은 추가 조회합니다.` : "현재 실거래 조회 서비스를 이용할 수 없습니다.");',
    '    setStatus("#transactionStatus", `${definition.label} 수집 자료를 확인합니다. 미수집은 거래 없음이 아닙니다.`);', 'initial message');
  js = replaceOnce(js,
    '  }\n\n  function renderTransactions(items, scope, failedMonths, requestedMonths, {exact: exactMatch = false, truncated = false} = {}) {',
    `    window.TojiTransactionUI?.render({group, type:state.transactionType, definition:TRANSACTION_TYPES[state.transactionType],\n      view:state.transactionView, period:state.transactionSession?.period || "saved",\n      onView:(view) => {state.transactionView=view;renderTransactionSession(state.transactionSession);},\n      onReload:() => void loadTransactions(true), onStop:() => {state.transactionController?.abort();\n        if(state.transactionSession){state.transactionSession.loading=false;state.transactionSession.error="조회 중단. 다시 불러오기로 재시도할 수 있습니다.";renderTransactionSession(state.transactionSession);}}});\n  }\n\n  function renderTransactions(items, scope, failedMonths, requestedMonths, {exact: exactMatch = false, truncated = false} = {}) {`, 'render hook');
  js = replaceOnce(js,
    '      snapshotAt: session.snapshotAt, loading: session.loading, error: session.error,',
    `      coveredMonthKeys: expected.filter(month => covered.has(month)),\n      staticLoaded: Boolean(session.staticLoaded), staticError: Boolean(session.staticError),\n      snapshotAt: session.snapshotAt, loading: session.loading, error: session.error,`, 'coverage');
  js = replaceOnce(js,
    '  async function loadTransactions(force = false, allowInactive = false, options = {}) {',
    `  async function loadTransactions(force = false, allowInactive = false, options = {}) {\n    // Filter/refresh published files by default. A government query requires an explicit opt-in.\n    const collectedOnly = options.collectedOnly !== false;\n    if (force && collectedOnly) snapshotPromise = undefined;`, 'load mode');
  js = replaceOnce(js,
    '    const fresh = !session || session.key !== cacheKey;',
    '    const fresh = !session || session.key !== cacheKey || (force && collectedOnly);', 'refresh');
  js = replaceOnce(js,
    '          const staticEntry = await window.TojiStaticTrades.lookup(area, type);',
    '          const staticEntry = await window.TojiStaticTrades.lookup(area, type, {includeNearby:true, force:force && collectedOnly});', 'lookup');
  js = replaceOnce(js,
    '          if (!current() || controller.signal.aborted) return;\n          if (staticEntry) {',
    '          if (!current() || controller.signal.aborted) { if(current()){session.loading=false;renderTransactionSession(session);} return; }\n          if (staticEntry) {\n            session.staticLoaded = true;', 'stale lookup');
  js = replaceOnce(js,
    '              session.snapshots.set(month, normalizeRtmsNodes(staticEntry.rows.filter(row => `${row.dealYear}${row.dealMonth}` === month), type));',
    '              session.results.set(month, {items:normalizeRtmsNodes(staticEntry.rows.filter(row => `${row.dealYear}${row.dealMonth}` === month), type), truncated:false, source:"collected"});', 'regional rows');
  js = replaceOnce(js,
    '        } catch { /* Retain separately verified records when a static shard is unavailable. */ }',
    '        } catch { session.staticError=true;session.error="수집 파일을 불러오지 못했습니다. 다시 불러와 주세요. 별도로 확인된 기록이 있으면 유지합니다."; }', 'error state');
  js = replaceOnce(js,
    '      for (const [key, cached] of state.rtmsCache) {',
    '      for (const [key, cached] of (collectedOnly ? [] : state.rtmsCache)) {', 'no stale browser overrides');
  js = replaceOnce(js,
    '      await fetchDirectHistory(session, parcel, controller.signal);',
    '      if (!collectedOnly) await fetchDirectHistory(session, parcel, controller.signal);', 'provider opt in');
  js = replaceOnce(js,
    '    if (!current()) return;\n    if (period === "saved"',
    '    if (!current()) return;\n    if (collectedOnly) { session.loading=false;renderTransactionSession(session);return; }\n    if (period === "saved"', 'no interactive API');
  fs.writeFileSync('market-data.js', js);
}
let html = fs.readFileSync('index.html','utf8');
if (!html.includes('transaction-ui.css')) html = replaceOnce(html, '</head>', '    <link rel="stylesheet" href="./transaction-ui.css?v=20261110.1" />\n  </head>', 'stylesheet');
if (!html.includes('src="./transaction-ui.js')) html = replaceOnce(html, '    <script src="./market-data.js', '    <script src="./transaction-ui.js?v=20261110.1"></script>\n    <script src="./market-data.js', 'script');
html = html.replace(/(market-data\.js|static-transactions\.js)\?v=[^"']+/g, '$1?v=20261110.1');
fs.writeFileSync('index.html', html);
let build = fs.readFileSync('scripts/build-pages.mjs','utf8');
if (!build.includes('"transaction-ui.js"')) build=replaceOnce(build, 'const publicFiles = [', 'const publicFiles = [\n  "transaction-ui.js",\n  "transaction-ui.css",', 'build');
fs.writeFileSync('scripts/build-pages.mjs',build);
console.log('Transaction UI source installed without changing collection workflows or data.');
