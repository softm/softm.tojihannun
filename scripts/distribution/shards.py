#!/usr/bin/env python3
"""Region-owned RTMS workers. Public Pages artifacts contain gzip data, not keys/state.
The legacy collector remains authoritative until a verified, paused handover.
"""
import argparse, collections, gzip, hashlib, json, os, re, shutil, sys, time
from datetime import datetime, timezone, timedelta
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ENGINE / 'scripts/rtms'))
from collector import (Pipeline, Client, STREAMS, SourceError, cooldown_active,
                       dump, read_json, write_json, atomic, utc, today)

HARD = 1_000_000_000
ROTATE = 900_000_000
MAX_FILE = 50_000_000

def digest(raw): return hashlib.sha256(raw).hexdigest()
def load(path): return json.loads(Path(path).read_text(encoding='utf8'))
def total_bytes(root): return sum(p.stat().st_size for p in Path(root).rglob('*') if p.is_file())
def shard_map(config):
    """Reject ambiguous ownership; no province/name heuristics at runtime."""
    if config.get('schemaVersion') != 3: raise ValueError('Unsupported storage registry')
    seen = {}; ids = set()
    for s in config['shards']:
        if not re.fullmatch(r'realestate-data-\d{3}', s['id']) or s['id'] in ids: raise ValueError('Invalid shard id')
        ids.add(s['id'])
        if s['repository'] != 'softm/' + s['id']: raise ValueError('Unexpected repository owner')
        if s['pagesBaseUrl'] != 'https://softm.github.io/' + s['id'] + '/': raise ValueError('Unexpected Pages URL')
        if s['collectionOwner'] not in ('legacy', 'paused', 'shard'): raise ValueError('Invalid collection owner')
        for code in s['districtCodes']:
            if not re.fullmatch(r'\d{5}', code) or code in seen: raise ValueError('Duplicate or invalid district ' + code)
            seen[code] = s
    return seen

def owned(config, name, official):
    mapping = shard_map(config)
    source = next((s for s in config['shards'] if s['id'] == name), None)
    if not source: raise ValueError('Unregistered shard')
    codes = set(source['districtCodes'])
    known = {d['code'] for d in official['districts']}
    if codes - known: raise ValueError('Unknown district in assignment')
    if any(d['active'] and d['code'] not in mapping for d in official['districts']): raise ValueError('Unassigned active district')
    return source, {**official, 'districts': [d for d in official['districts'] if d['code'] in codes]}

def legacy_allows(config, code):
    entry = shard_map(config).get(code)
    return entry is None or entry['collectionOwner'] == 'legacy'

def bootstrap(root, source_root, codes, source_commit):
    """Verify everything before copying. Never remove original or newer worker data."""
    root, source_root = Path(root), Path(source_root)
    base = root / 'data/transactions'; source = source_root / 'data/transactions'
    old = read_json(base / 'collection-state.json', {'schemaVersion':2, 'segments':{}, 'failures':{}, 'imports':{}, 'history':[]})
    state = load(source / 'collection-state.json'); transfers = []
    for key, meta in state['segments'].items():
        if key.split('/')[0] not in codes: continue
        if not re.fullmatch(r'\d{5}/[A-Za-z]+-(sale|rent)/20\d{4}', key): raise ValueError('Invalid segment key')
        raw = (source / 'segments' / (key + '.json.gz')).read_bytes()
        if digest(raw) != meta['sha256']: raise ValueError('Migration hash mismatch: ' + key)
        body = json.loads(gzip.decompress(raw))
        if body.get('scope') != key or body.get('schemaVersion') != 2 or len(body['rows']) != meta['sourceRows']: raise ValueError('Migration count mismatch: ' + key)
        if old['segments'].get(key, {}).get('fetchedAt', '') > meta['fetchedAt']: raise ValueError('Refusing older bootstrap over newer worker data')
        transfers.append((key, meta, raw))
    if set(old['segments']) - {k for k,_,_ in transfers}: raise ValueError('Source snapshot omits existing worker segments')
    for key, meta, raw in transfers:
        target = base / 'segments' / (key + '.json.gz')
        if not target.exists() or digest(target.read_bytes()) != meta['sha256']: atomic(target, raw)
        old['segments'][key] = meta
    old['failures'] = {k:v for k,v in state.get('failures', {}).items() if k.split('/')[0] in codes}
    for field in ('streamCooldowns', 'apiCooldown'):
        if field in state: old[field] = state[field]
    old['imports'] = {k:v for k,v in state.get('imports', {}).items() if v.get('scope', {}).get('district') in codes}
    receipt = {'schemaVersion':1, 'sourceCommit':source_commit, 'sourceRepository':'softm/softm.tojihannun',
               'segments':len(transfers), 'sourceRows':sum(m['sourceRows'] for _,m,_ in transfers),
               'records':sum(m['records'] for _,m,_ in transfers),
               'hashes':{k:m['sha256'] for k,m,_ in transfers}, 'verifiedAt':utc()}
    old['migration'] = {k:v for k,v in receipt.items() if k != 'hashes'}
    write_json(base / 'collection-state.json', old)
    write_json(root / 'migration-receipt.json', receipt)
    return receipt

def check_handover(root, shard):
    receipt = read_json(Path(root)/'migration-receipt.json', {})
    expected_repo = shard.get('handoverSourceRepository', 'softm/softm.tojihannun')
    if (not shard.get('handoverCommit') or
        receipt.get('sourceCommit') != shard['handoverCommit'] or
        receipt.get('sourceRepository') != expected_repo):
        raise ValueError('Verified final checkpoint and source repository required before shard collection')

def request_budget(state, config, now=None):
    now = now or datetime.now(timezone.utc)
    history = state.get('requestLedger', [])
    def recent(hours):
        total = 0
        for run in history:
            try:
                if datetime.fromisoformat(run['at']) > now - timedelta(hours=hours): total += int(run['requests'])
            except (ValueError, KeyError, TypeError): raise ValueError('Invalid request ledger')
        return total
    q = config['requestBudget']
    shard_id = os.environ.get('GITHUB_REPOSITORY','').split('/')[-1]
    allocations = q.get('perShardDaily', {})
    daily = int(allocations.get(shard_id, q.get('perDay', 0)))
    per_run = int(q.get('perRun', daily))
    # Continuous mode deliberately has no hourly throttle. Each independent shard
    # owns a fixed daily allocation; all allocations sum below the account limit.
    return max(0, min(per_run, daily - recent(24)))

def collect(pipe, config, mode):
    budget = request_budget(pipe.state, config)
    run = {'startedAt':utc(), 'mode':mode, 'status':'running', 'runId':os.environ.get('GITHUB_RUN_ID'),
           'success':0, 'failed':0, 'requests':0, 'added':0, 'removed':0, 'cancelled':0}
    if not budget: run.update(status='deferred', stopReason='LOCAL_REQUEST_BUDGET'); return run
    if cooldown_active(pipe.state.get('apiCooldown')): run.update(status='deferred', stopReason='API_COOLDOWN'); return run
    key = os.environ.get('MOLIT_API_KEY', '')
    if not key: run.update(status='blocked', stopReason='MISSING_MOLIT_API_KEY'); return run
    client = Client(key, max_requests=budget, interval=1.2, deadline=time.monotonic()+480)
    try:
        blocked = set()
        for task in pipe.plan(mode):
            if client.calls >= budget: break
            code, sid, month = task.split('/')
            if sid in blocked: continue
            try:
                rows = client.month(STREAMS[sid], pipe.districts[code], month)
                meta = pipe.put(task, rows, 'public_api'); run['success'] += 1
                for field in ('added','removed','cancelled'): run[field] += meta[field]
            except SourceError as err:
                pipe.fail(task, err); run['failed'] += 1
                if err.code in ('429','22','23','29','REQUEST_BUDGET','TIME_BUDGET','STOPPED'):
                    run['stopReason'] = err.code; break
                if err.code in ('401','403','20','30','31','12','404'): blocked.add(sid)
        run['status'] = 'partial' if run['failed'] else 'success' if run['success'] else 'idle'
    finally:
        run.update(requests=client.calls, finishedAt=utc())
        cutoff = datetime.now(timezone.utc) - timedelta(days=2)
        ledger = [r for r in pipe.state.get('requestLedger', []) if datetime.fromisoformat(r['at']) > cutoff]
        pipe.state['requestLedger'] = [*ledger, {'at':utc(), 'requests':client.calls}]
        if mode == 'refresh': pipe.state['lastRefreshAt'] = utc()
        pipe.state['lastRun'] = run; pipe.state['history'] = [run, *pipe.state.get('history', [])][:100]
        pipe.save()
    return run

def capacity(root, config):
    files = list(Path(root).rglob('*'))
    if any(p.is_symlink() for p in files): raise ValueError('Symlinks forbidden in Pages artifact')
    sizes = [p.stat().st_size for p in files if p.is_file()]
    used = sum(sizes)
    hard = min(HARD, int(config['allocation']['maxPublishedBytes']))
    rotate = min(ROTATE, int(config['allocation']['rotateAtBytes']))
    if any(n >= MAX_FILE for n in sizes): raise ValueError('File must be split below 50MB')
    if used >= hard: raise ValueError('Pages artifact exceeds 1GB hard ceiling')
    return {'publishedBytes':used, 'hardLimitBytes':hard, 'rotateAtBytes':rotate,
            'remainingBytes':hard-used, 'needsSplit':used >= rotate}

def publish(pipe, root, config, shard, run):
    """Only gzip payloads plus small indexes. Partition by district/type/month/dong."""
    root = Path(root); stage = root/'site.next'
    if stage.exists(): shutil.rmtree(stage)
    stage.mkdir(parents=True)
    catalog = {}; district_index = {}; partition_sizes = collections.Counter()
    for key, meta in sorted(pipe.state['segments'].items()):
        code, sid, month = key.split('/')
        raw = pipe.segment_path(key).read_bytes()
        if digest(raw) != meta['sha256']: raise ValueError('Source hash mismatch before publishing')
        payload = json.loads(gzip.decompress(raw))
        if payload['scope'] != key or len(payload['rows']) != meta['sourceRows']: raise ValueError('Source scope/count mismatch')
        index = district_index.setdefault(code, {'schemaVersion':2,'district':code,'coverage':{},'groups':{},'updatedAt':''})
        index['coverage'].setdefault(sid, []).append(month); index['updatedAt'] = max(index['updatedAt'], meta['fetchedAt'])
        groups = collections.defaultdict(list)
        for r in payload['rows']:
            if r['district'] != code or r['month'] != month or r['type'] != STREAMS[sid]['category'] or r['deal'] != STREAMS[sid]['deal']: raise ValueError('Cross-scope source record')
            if not r['cancelled']: groups[r['umdNm']].append(r)
        for dong, rows in sorted(groups.items()):
            parts = index['groups'].setdefault(sid, {}).setdefault(dong, [])
            for offset in range(0,len(rows),1500):
                chunk = rows[offset:offset+1500]
                body = dump({'schemaVersion':2,'district':code,'stream':sid,'emd':dong,'rows':chunk})
                gz = gzip.compress(body, mtime=0)
                path = f"{code}/{sid}/{month}/{digest(dong.encode())[:16]}-{offset//1500}.json.gz"
                atomic(stage/'published'/path, gz); partition_sizes[key] += len(gz)
                parts.append({'path':path,'encoding':'gzip','rows':len(chunk),'bytes':len(body),
                              'gzipBytes':len(gz),'sha256':digest(body),'gzipSha256':digest(gz),'month':month})
    for code, index in district_index.items():
        write_json(stage/'published'/code/'index.json',index)
        catalog[code] = {'index':code+'/index.json','name':pipe.districts[code]['name'],'updatedAt':index['updatedAt']}
    write_json(stage/'published/index.json', {'schemaVersion':2,'generatedAt':utc(),'districts':catalog,'fullCountryComplete':False})
    manifest = pipe.status()
    manifest['collection'].update(workflow='Regional transaction collector', executionSource=f"https://github.com/{shard['repository']}/actions",
        schedule='지역별 시간당 제한 수집 · 수집 담당 이관 및 활성화 후 실행', runStatus=run['status'])
    write_json(stage/'status-manifest.json', manifest)
    for code in shard['districtCodes']:
        file = pipe.base/'status'/(code+'.json')
        if file.exists(): shutil.copy2(file, stage/('status-'+code+'.json'))
    atomic(stage/'.nojekyll', b'')
    atomic(stage/'index.html', ('<!doctype html><meta charset="utf-8"><title>'+shard['id']+'</title><h1>'+shard['id']+'</h1><p>국토교통부 공개 실거래 자료. 개인정보·인증키는 게시하지 않습니다.</p><p><a href="./data-status.html">이 저장소 수집 현황</a> · <a href="https://tojihannun.designboard.net/data-status.html">전국 수집 현황</a></p>').encode())
    stats = {'schemaVersion':1,'shardId':shard['id'],'repository':shard['repository'],'registryRevision':config['revision'],
             'generatedAt':utc(),'districtCodes':shard['districtCodes'], 'collectionOwner':shard['collectionOwner'],
             'collection':run,'summary':manifest['summary'],'regions':manifest['regions'],
             'migration':pipe.state.get('migration'), 'deployment':{'verified':False},
             'capacity':{'publishedBytes':0,'hardLimitBytes':HARD,'rotateAtBytes':ROTATE,'needsSplit':False}}
    # The status file contributes to its own artifact size; converge the byte count.
    for _ in range(8):
        write_json(stage/'shard-status.json', stats)
        measured = capacity(stage, config)
        if measured == stats['capacity']: break
        stats['capacity'] = measured
    write_json(stage/'shard-status.json',stats)
    status_html = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>__SHARD__ 수집 현황</title><style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#173d31;background:#f3f7f5}body{margin:0}.top{background:#123f32;color:white;padding:22px 18px}.wrap{max-width:860px;margin:auto}.top a{color:#d9eee6}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0}.card,.panel{background:white;border:1px solid #dce7e2;border-radius:12px;padding:14px}.card strong{display:block;font-size:22px;margin-top:5px}.state{font-weight:800;font-size:18px}.running{color:#14704b;animation:pulse 1s ease-in-out infinite}.deferred{color:#8a651d}.stopped{color:#607169}.failed{color:#a23d31}progress{width:100%;height:12px}.row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #edf2ef}.row:last-child{border:0}.muted{color:#657a71;font-size:13px}@keyframes pulse{50%{opacity:.35}}@media(max-width:650px){.grid{grid-template-columns:repeat(2,1fr)}.wrap{padding:0 12px}}@media(prefers-reduced-motion:reduce){.running{animation:none}}
</style></head><body><header class="top"><div class="wrap"><a href="https://tojihannun.designboard.net/data-status.html">← 전국 통합 대시보드</a><h1>__SHARD__ 수집 현황</h1><div>__LABEL__ · 담당 현행 시군구 __ACTIVE__개</div></div></header><main class="wrap"><div class="panel" style="margin-top:16px"><div id="state" class="state">상태 확인 중</div><div id="updated" class="muted"></div></div><section class="grid"><div class="card">진행률<strong id="pct">—</strong></div><div class="card">유효 거래<strong id="records">—</strong></div><div class="card">완료 구간<strong id="done">—</strong></div><div class="card">게시 용량<strong id="bytes">—</strong></div></section><div class="panel"><progress id="progress" max="1" value="0"></progress><div class="row"><span>완료 / 계획 구간</span><b id="tasks">—</b></div><div class="row"><span>마지막 배치</span><b id="batch">—</b></div><div class="row"><span>API 요청 / 성공 / 실패</span><b id="calls">—</b></div><div class="row"><span>마지막 정상 수집</span><b id="last">—</b></div><div class="row"><span>저장 상한</span><b>1GB · 900MB 분할</b></div><div class="row"><span>GitHub Actions</span><a href="https://github.com/__REPO__/actions/workflows/collect.yml">실행 로그 ↗</a></div></div></main><script>
const $=id=>document.getElementById(id),fmt=n=>n==null?'—':Number(n).toLocaleString('ko-KR'),age=v=>{const t=Date.parse(v);if(!Number.isFinite(t))return '—';const m=Math.max(0,Math.floor((Date.now()-t)/60000));return m<1?'방금':m<60?m+'분 전':Math.floor(m/60)+'시간 전'},mb=n=>n==null?'—':(n/1e6).toFixed(2)+' MB';
async function get(p){const r=await fetch(p+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error(r.status);return r.json()}
async function draw(){try{const [s,l]=await Promise.all([get('./shard-status.json'),get('https://raw.githubusercontent.com/__REPO__/main/live-status.json')]);const done=s.summary?.completedTasks||0,exp=s.summary?.expectedTasks||0;$('pct').textContent=exp?(done/exp*100).toFixed(3)+'%':'—';$('records').textContent=fmt(s.summary?.records)+'건';$('done').textContent=fmt(done);$('bytes').textContent=mb(s.capacity?.publishedBytes);$('progress').max=exp||1;$('progress').value=done;$('tasks').textContent=fmt(done)+' / '+fmt(exp);$('batch').textContent=s.collection?.status||'—';$('calls').textContent=fmt(s.collection?.requests)+' / '+fmt(s.collection?.success)+' / '+fmt(s.collection?.failed);$('last').textContent=age(s.collection?.lastSuccessfulCollectionAt);const map={running:['● 실제 수집 실행 중','running'],deferred:['● 호출 예산·재시도 대기','deferred'],failed:['● 오류·점검 필요','failed'],stopped:['● 수집 정지·종료','stopped']},v=map[l.status]||['● 상태 미확인','stopped'];$('state').textContent=v[0];$('state').className='state '+v[1];$('updated').textContent='상태 '+age(l.updatedAt)+' · 30초 자동 갱신';}catch(e){$('state').textContent='● 상태 확인 실패';$('state').className='state failed';}}draw();setInterval(()=>{if(!document.hidden)draw()},30000);
</script></body></html>"""
    status_html = status_html.replace('__SHARD__', shard['id'].upper()).replace('__LABEL__', shard.get('label', shard['id'])).replace('__ACTIVE__', str(shard.get('activeDistrictCount', len(shard['districtCodes'])))).replace('__REPO__', shard['repository'])
    atomic(stage/'data-status.html', status_html.encode('utf-8'))
    if total_bytes(stage) != stats['capacity']['publishedBytes']: 
        stats['capacity'] = capacity(stage, config)
        write_json(stage/'shard-status.json',stats)
    capacity(stage, config)
    write_json(root/'shard-status.json', stats)
    write_json(root/'split-plan.json', {'schemaVersion':1,'required':stats['capacity']['needsSplit'],
        'shardId':shard['id'],'reason':'900MB rotation threshold' if stats['capacity']['needsSplit'] else None,
        'largestPartitions':[{'scope':k,'bytes':n} for k,n in partition_sizes.most_common(50)],
        'action':'pause collection and migrate complete district/type/month partitions; never delete before verification'})
    target = root/'site'
    if target.exists(): shutil.rmtree(target)
    stage.replace(target)
    return stats

def run(args):
    root = Path(args.root).resolve(); control = Path(args.control).resolve(); legacy = Path(args.legacy).resolve()
    config = load(control/'data/transactions/storage-registry.json')
    official = load(control/'data/transactions/registry.json')
    shard, registry = owned(config, args.shard, official)
    if os.environ.get('GITHUB_REPOSITORY') and os.environ['GITHUB_REPOSITORY'] != shard['repository']: raise ValueError('Worker/repository mismatch')
    base = root/'data/transactions'; base.mkdir(parents=True, exist_ok=True)
    write_json(base/'registry.json', registry)
    if shard['collectionOwner'] != 'shard':
        receipt = bootstrap(root, legacy, set(shard['districtCodes']), args.source_commit)
        result = {'status':'mirroring' if shard['collectionOwner']=='legacy' else 'paused', 'requests':0,
                  'importedSegments':receipt['segments'], 'finishedAt':utc()}
    else:
        check_handover(root, shard)
        result = {'status':'ready','requests':0,'finishedAt':utc()}
    pipe = Pipeline(root, registry)
    previous = read_json(root/'shard-status.json', {})
    if args.mode not in ('bootstrap','build') and shard['collectionOwner'] == 'shard':
        if previous.get('capacity',{}).get('needsSplit'):
            result = {'status':'capacity_paused','requests':0,'finishedAt':utc()}
        else:
            mode = args.mode
            if mode == 'auto':
                last = pipe.state.get('lastRefreshAt')
                mode = 'refresh' if not last or datetime.fromisoformat(last) < datetime.now(timezone.utc)-timedelta(hours=20) else 'backfill'
            result = collect(pipe, config, mode)
    stats = publish(pipe, root, config, shard, result)
    # Only track own data, not the source checkout, uncompressed payloads or build artifacts.
    (root/'.gitignore').write_text('_engine/\n_control/\n_legacy/\nsite/\nsite.next/\nnode_modules/\n__pycache__/\n*.pyc\ntest-results/\n')
    print(json.dumps({'shard':shard['id'],'status':result['status'],'records':stats['summary']['records'],
                      'sourceSegments':stats['summary']['completedTasks'],'publishedBytes':stats['capacity']['publishedBytes'],
                      'requests':result['requests']}, ensure_ascii=False))
    return 1 if result['status']=='failed' else 0

if __name__ == '__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--root',required=True);ap.add_argument('--control',required=True)
    ap.add_argument('--legacy',required=True);ap.add_argument('--source-commit',required=True);ap.add_argument('--shard',required=True)
    ap.add_argument('--mode',choices=['bootstrap','build','auto','refresh','backfill'],default='bootstrap')
    sys.exit(run(ap.parse_args()))
