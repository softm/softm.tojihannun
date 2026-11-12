#!/usr/bin/env python3
"""Resumable RTMS static-data pipeline.
Input: supplied official XLSX/CSV, plus licensed data.go.kr API. Never scrapes rt.molit.go.kr.
A segment is replaced only after EVERY page and row has been validated; failures preserve last good data.
"""
import argparse, calendar, collections, gzip, hashlib, json, os, re, signal, sys, time
import urllib.request, urllib.parse, urllib.error
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from formats import SourceError, api_page, normalize, table_rows, field
from registry import refresh as refresh_registry
HERE=Path(__file__).resolve().parent
STREAMS={x['id']:x for x in json.loads((HERE/'catalog.json').read_text())['streams']}
STOP=False

def utc(): return datetime.now(timezone.utc).isoformat()
def today(): return (datetime.now(timezone.utc)+timedelta(hours=9)).date()
# Source access failure is not a data failure. Keep blocked streams out of
# subsequent runs without hiding the error from the public status dashboard.
ACCESS_ERRORS=frozenset(('401','403','20','30','31','12','404'))
QUOTA_ERRORS=frozenset(('429','22','23','29'))
def cooldown_active(item,now=None):
    if not isinstance(item,dict):return False
    expiry=item.get('nextRetryAt') or item.get('until')
    if not expiry:return False
    try:return datetime.fromisoformat(expiry)> (now or datetime.now(timezone.utc))
    except (ValueError,TypeError):return False
def retry_delay(code,attempts):
    # Never hammer an unapproved endpoint every ten minutes.
    if code in ACCESS_ERRORS:return 24*3600
    if code in QUOTA_ERRORS:return 60*60
    if code=='NETWORK_TIMEOUT':return min(4*3600,600*2**min(attempts-1,5))
    return min(6*3600,600*2**min(attempts-1,5))
def run_exit_code(run):
    # GitHub action success = persisted useful work, not nationwide completion.
    # Source gaps remain explicitly visible as partial in the manifest.
    if run.get('status')=='partial' and run.get('success',0)>0:return 0
    return 1 if run.get('status') in ('failed','partial') else 0
def dump(obj):return json.dumps(obj,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()
def atomic(path,raw):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.tmp');tmp.write_bytes(raw);tmp.replace(path)
def write_json(path,obj):atomic(path,dump(obj)+b'\n')
def read_json(path,default):
    return json.loads(Path(path).read_text()) if Path(path).exists() else default

def collection_owners(base):
    config=read_json(Path(base)/'storage-registry.json',{})
    if config.get('schemaVersion')!=3:return {}
    owners={}
    for shard in config.get('shards',[]):
        owner=shard.get('collectionOwner')
        if owner not in ('legacy','paused','shard'):raise SourceError('INVALID_COLLECTION_OWNER')
        for code in shard['districtCodes']:
            if code in owners:raise SourceError('DUPLICATE_COLLECTION_OWNER')
            owners[code]=owner
    return owners

def month_range(start,end):
    y,m=map(int,start[:7].split('-'));ey,em=map(int,end[:7].split('-'))
    if (y,m)>(ey,em):return []
    result=[]
    while (y,m)<=(ey,em):
        result.append(f'{y:04}{m:02}');m+=1
        if m==13:y+=1;m=1
    return result

def source_summary(rows):
    return {'sourceRows':len(rows),'records':sum(not r['cancelled'] for r in rows),
            'cancelled':sum(r['cancelled'] for r in rows),
            'identifiable':sum(not r['cancelled'] and r['exactLotPublic'] for r in rows),
            'unidentifiable':sum(not r['cancelled'] and not r['exactLotPublic'] for r in rows)}

class Pipeline:
    def __init__(self,root,registry,asof=None):
        self.root=Path(root);self.base=self.root/'data/transactions';self.public=self.base/'published'
        self.registry=registry;self.districts={x['code']:x for x in registry['districts']}
        self.asof=asof or today().isoformat()
        self.state=read_json(self.base/'collection-state.json',{'schemaVersion':2,'segments':{},'failures':{},'imports':{},'history':[]})
        self.touched=set();self.active=None
    def segment_path(self,key):return self.base/'segments'/(key+'.json.gz')
    def old_rows(self,key):
        p=self.segment_path(key)
        return json.loads(gzip.decompress(p.read_bytes()))['rows'] if p.exists() else []
    def save(self):write_json(self.base/'collection-state.json',self.state)
    def put(self,key,rows,source,fetched_at=None,scope_end=None):
        code,stream_id,month=key.split('/');stream=STREAMS[stream_id]
        if code not in self.districts or not re.fullmatch(r'20\d{4}',month):raise SourceError('INVALID_SEGMENT_KEY')
        if any(r['month']!=month or r['district']!=code or r['type']!=stream['category'] or r['deal']!=stream['deal'] for r in rows):raise SourceError('SEGMENT_SCOPE_MISMATCH')
        # Multisets preserve legitimate same-day/price/area/floor records. No arbitrary deduplication.
        old=collections.Counter(dump(r) for r in self.old_rows(key));new=collections.Counter(dump(r) for r in rows)
        counts=source_summary(rows);at=fetched_at or utc()
        data={'schemaVersion':2,'scope':key,'fetchedAt':at,'source':source,'rows':rows}
        raw=gzip.compress(dump(data),mtime=0);atomic(self.segment_path(key),raw)
        self.state['segments'][key]={**counts,'status':'complete','source':source,'fetchedAt':at,
          'scopeEnd':scope_end or min(self.asof,f"{month[:4]}-{month[4:]}-{calendar.monthrange(int(month[:4]),int(month[4:]))[1]:02}"),
          'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
          'added':sum((new-old).values()),'removed':sum((old-new).values()),'unchanged':sum((new&old).values())}
        self.state['failures'].pop(key,None)
        if source=='public_api':self.state.setdefault('streamCooldowns',{}).pop(stream_id,None)
        self.touched.add(code);self.save()
        return self.state['segments'][key]
    def fail(self,key,error):
        prior=self.state['failures'].get(key,{})
        code=getattr(error,'code','UNKNOWN')
        attempts=prior.get('attempts',0)+1
        at=utc()
        retry_at=(datetime.now(timezone.utc)+timedelta(seconds=retry_delay(code,attempts))).isoformat()
        self.state['failures'][key]={'code':code,'at':at,'attempts':attempts,
            'preserved':key in self.state['segments'],'nextRetryAt':retry_at}
        if code in ACCESS_ERRORS:
            stream_id=key.split('/')[1]
            self.state.setdefault('streamCooldowns',{})[stream_id]={
                'code':code,'at':at,'nextRetryAt':retry_at,
                'reason':'source_access_unavailable'}
        elif code in QUOTA_ERRORS:
            self.state['apiCooldown']={'code':code,'at':at,'nextRetryAt':retry_at,'reason':'quota_or_rate_limit'}
        self.save()
    def migrate_legacy(self):
        migrated=0
        old_manifest=read_json(self.base/'status-manifest.json',{})
        old_times={}
        for r in old_manifest.get('regions',[]):
            for d in r.get('districts',[]):
                for t in d.get('types',[]):
                    for m in t.get('months',[]):old_times[d['code']+'/'+t['type']+'-sale/'+m['month']]=m.get('at')
        for p in sorted((self.base/'raw').glob('*/*/*.xml')):
            code,category,filename=p.parts[-3:];stream=category+'-sale';month=p.stem;key=f'{code}/{stream}/{month}'
            if key in self.state['segments'] or code not in self.districts or stream not in STREAMS:continue
            try:
                text=p.read_text();docs=re.findall(r'<response(?:\s[^>]*)?>.*?</response>',text,re.S)
                if not docs:raise SourceError('INVALID_LEGACY_XML')
                pages=[api_page(t) for t in docs];total=pages[0][0]
                if any(n!=total for n,_ in pages) or sum(len(r) for _,r in pages)!=total:raise SourceError('INCOMPLETE_LEGACY_PAGES')
                rows=[normalize(r,self.districts[code],STREAMS[stream],month) for _,rs in pages for r in rs]
                self.put(key,rows,'legacy_api',fetched_at=old_times.get(key) or datetime.fromtimestamp(p.stat().st_mtime,timezone.utc).isoformat())
                migrated+=1
            except SourceError as e:self.fail(key,e)
        return migrated
    def import_file(self,meta_path):
        meta_path=Path(meta_path);meta=read_json(meta_path,{})
        if meta.get('unfiltered') is not True:raise SourceError('IMPORT_SCOPE_REQUIRES_UNFILTERED_EXPORT')
        file=(meta_path.parent/meta['file']).resolve()
        if meta_path.parent.resolve() not in file.parents:raise SourceError('INVALID_IMPORT_PATH')
        if file.stat().st_size>100_000_000:raise SourceError('FILE_SIZE_LIMIT')
        digest=hashlib.sha256(file.read_bytes()).hexdigest();import_id=hashlib.sha256(dump(meta)+digest.encode()).hexdigest()
        if import_id in self.state['imports']:return 0
        code=str(meta.get('district') or '');stream_id=meta['stream'];start=date.fromisoformat(meta['start']);end=date.fromisoformat(meta['end'])
        if stream_id not in STREAMS or end<start or (end-start).days>366 or end>today():raise SourceError('INVALID_IMPORT_SCOPE')
        if start.day!=1:raise SourceError('IMPORT_MUST_START_AT_MONTH_BOUNDARY')
        # Partial months cannot overwrite a complete snapshot.
        if end != today() and end.day!=calendar.monthrange(end.year,end.month)[1]:raise SourceError('IMPORT_MUST_END_AT_MONTH_BOUNDARY_OR_TODAY')
        districts=[self.districts[code]] if code in self.districts else [d for d in self.districts.values() if d['sido']==str(meta.get('sido','')) and d['active']]
        if not districts:raise SourceError('IMPORT_REGION_NOT_FOUND')
        owners=collection_owners(self.base)
        if any(owners.get(d['code'],'legacy')!='legacy' for d in districts):raise SourceError('IMPORT_REGION_OWNERSHIP_MOVED')
        grouped={d['code']:{m:[] for m in month_range(str(start),str(end))} for d in districts}
        for source_row in table_rows(file):
            matches=[d for d in districts if field(source_row,'시군구','소재지').startswith(d['name']+' ')]
            if len(districts)==1:matches=districts
            if len(matches)!=1:raise SourceError('AMBIGUOUS_IMPORT_DISTRICT')
            d=matches[0];row=normalize(source_row,d,STREAMS[stream_id])
            if not str(start)<=row['date']<=str(end):raise SourceError('IMPORT_DATE_OUT_OF_SCOPE')
            grouped[d['code']][row['month']].append(row)
        count=sum(len(rows) for monthly in grouped.values() for rows in monthly.values())
        if meta.get('expectedRows') is None or count!=meta['expectedRows']:raise SourceError('IMPORT_COUNT_MISMATCH_OR_UNKNOWN')
        # All input rows are validated before any previous segment is replaced.
        for dc,monthly in grouped.items():
            for month,rows in monthly.items():self.put(f'{dc}/{stream_id}/{month}',rows,'official_file',scope_end=min(str(end),f'{month[:4]}-{month[4:]}-{calendar.monthrange(int(month[:4]),int(month[4:]))[1]:02}'))
        self.state['imports'][import_id]={'file':file.name,'sha256':digest,'sourceRows':count,'scope':meta,'at':utc()};self.save()
        return count
    def plan(self,mode='refresh',codes=None,streams=None,month_start=None,month_end=None):
        codes=codes or [x['code'] for x in self.registry['districts'] if x['active']]
        streams=streams or list(STREAMS)
        owners=collection_owners(self.base)
        codes=[c for c in codes if owners.get(c,'legacy')=='legacy']
        # Breadth-first province ordering prevents one large province starving every other province.
        provinces=collections.defaultdict(list)
        for c in codes:provinces[self.districts[c]['sido']].append(c)
        ordered=[]
        for i in range(max(map(len,provinces.values()),default=0)):
            for ps in sorted(provinces):
                if i<len(provinces[ps]):ordered.append(provinces[ps][i])
        for c in reversed(['41210','44210']):
            if c in ordered:ordered.remove(c);ordered.insert(0,c)
        range_start = month_start or '2006-01-01'
        range_end = month_end or self.asof
        all_months=month_range(range_start,range_end)[::-1]
        if mode=='refresh' and month_start is None and month_end is None:all_months=all_months[:3]
        candidates=[]
        now=datetime.now(timezone.utc)
        blocked_streams={sid for sid,entry in self.state.get('streamCooldowns',{}).items() if cooldown_active(entry,now)}
        failures=self.state.get('failures',{})
        for month in all_months:
            for stream_id in streams:
                if stream_id in blocked_streams:continue
                if month<STREAMS[stream_id]['start'][:7].replace('-',''):continue
                for code in ordered:
                    key=f'{code}/{stream_id}/{month}';old=self.state['segments'].get(key)
                    if cooldown_active(failures.get(key),now):continue
                    if old and mode=='backfill':continue
                    if old and mode=='refresh' and (now-datetime.fromisoformat(old['fetchedAt'])).total_seconds()<20*3600:continue
                    candidates.append((old['fetchedAt'] if old else '',key))
        if mode=='refresh':candidates.sort(key=lambda x:x[0])
        # Establish real support/permission for each stream before broadening nationwide.
        seed=[]
        for sid in streams:
            if not any(k.split('/')[1]==sid for k in self.state['segments']):
                key=next((k for _,k in candidates if k.startswith(ordered[0]+'/'+sid+'/')),None) if ordered else None
                if key:seed.append(key)
        yield from seed
        for _,key in candidates:
            if key not in seed:yield key
    def publish(self):
        """Publish required dong/type shards, not one enormous country file."""
        self.public.mkdir(parents=True,exist_ok=True)
        codes=sorted({k.split('/')[0] for k in self.state['segments']});catalog={}
        for code in codes:
            groups=collections.defaultdict(list);coverage=collections.defaultdict(list);at=''
            for key,meta in self.state['segments'].items():
                c,stream,month=key.split('/')
                if c!=code:continue
                coverage[stream].append(month);at=max(at,meta['fetchedAt'])
                raw=self.segment_path(key).read_bytes()
                if hashlib.sha256(raw).hexdigest()!=meta['sha256']:raise SourceError('SEGMENT_HASH_MISMATCH')
                for r in json.loads(gzip.decompress(raw))['rows']:
                    if not r['cancelled']:groups[(stream,r['umdNm'])].append(r)
            target=self.public/code;target.mkdir(parents=True,exist_ok=True)
            index={'schemaVersion':2,'district':code,'updatedAt':at,'coverage':dict(coverage),'groups':{}}
            used={'index.json'}
            for (stream,emd),rows in groups.items():
                rows.sort(key=lambda r:(r['date'],r['lot'],str(r.get('floor',''))),reverse=True)
                shard_id=hashlib.sha256((stream+'|'+emd).encode()).hexdigest()[:16]
                # Records retain all years; spatial coordinates are not invented.
                parts=[]
                for offset in range(0,len(rows),1500):
                    chunk=rows[offset:offset+1500];body=dump({'schemaVersion':2,'district':code,'stream':stream,'emd':emd,'rows':chunk})
                    stem=f'{shard_id}-{offset//1500}';atomic(target/(stem+'.json'),body)
                    gz=gzip.compress(body,mtime=0);atomic(target/(stem+'.json.gz'),gz)
                    used.update((stem+'.json',stem+'.json.gz'))
                    parts.append({'path':f'{code}/{stem}.json','gzip':f'{code}/{stem}.json.gz','rows':len(chunk),
                                  'bytes':len(body),'gzipBytes':len(gz),'sha256':hashlib.sha256(body).hexdigest()})
                index['groups'].setdefault(stream,{})[emd]=parts
            write_json(target/'index.json',index)
            for p in target.iterdir():
                if p.is_file() and p.name not in used:p.unlink()
            catalog[code]={'name':self.districts[code]['name'],'index':f'{code}/index.json','updatedAt':at,'coverage':dict(coverage)}
        write_json(self.public/'index.json',{'schemaVersion':2,'generatedAt':utc(),'districts':catalog,'fullCountryComplete':False})
        self.status()
    def status(self):
        """Counts reflect validated persisted records. Missing scopes remain unknown."""
        provinces={};details={};segments=self.state['segments'];all_codes=[d for d in self.registry['districts'] if d['active'] or any(k.startswith(d['code']+'/') for k in segments)]
        for d in all_codes:
            # Current and retired geographic code namespaces remain explicit, never merged heuristically.
            code=d['code'];ps=provinces.setdefault(d['sido'],{'code':d['sido'],'name':d['sidoName'],'status':'not_collected','records':None,'districts':[], 'active':False})
            ps['active'] |= d['active']
            district={'code':code,'name':d['name'],'active':d['active'],'status':'not_collected','records':None,'types':[]}
            for sid,s in STREAMS.items():
                done={k.split('/')[-1]:v for k,v in segments.items() if k.startswith(code+'/'+sid+'/')}
                errs={k.split('/')[-1]:v for k,v in self.state['failures'].items() if k.startswith(code+'/'+sid+'/')}
                expected=month_range(s['start'],self.asof);known=len(done);annual=[]
                for year in sorted({m[:4] for m in expected},reverse=True):
                    ym=[m for m in expected if m.startswith(year)];found=[done[m] for m in ym if m in done]
                    annual.append({'year':int(year),'status':'complete' if len(found)==len(ym) else 'partial' if found else 'error' if any(m in errs for m in ym) else 'not_collected',
                        'records':sum(v['records'] for v in found) if found else None,'completedMonths':len(found),'expectedMonths':len(ym)})
                district['types'].append({'type':sid,'label':s['label']+' '+('매매' if s['deal']=='sale' else '전월세'),
                   'years':annual,'records':sum(v['records'] for v in done.values()) if done else None,'sourceRows':sum(v['sourceRows'] for v in done.values()),
                   'cancelled':sum(v['cancelled'] for v in done.values()),'identifiable':sum(v['identifiable'] for v in done.values()),
                   'completed':known,'expected':len(expected),'failures':len(errs),'status':'complete' if known==len(expected) else 'partial' if known else 'error' if errs else 'not_collected',
                   'lastSuccessAt':max((v['fetchedAt'] for v in done.values()),default=None)})
            dt=district['types'];known=[t for t in dt if t['records'] is not None]
            district['records']=sum(t['records'] for t in known) if known else None
            district['completed']=sum(t['completed'] for t in dt);district['expected']=sum(t['expected'] for t in dt)
            district['status']='complete' if all(t['status']=='complete' for t in dt) else 'partial' if known else 'error' if any(t['failures'] for t in dt) else 'not_collected'
            district['lastSuccessAt']=max((t['lastSuccessAt'] for t in dt if t['lastSuccessAt']),default=None)
            details[code]=district
            ps['districts'].append({k:v for k,v in district.items() if k!='types'})
        for ps in provinces.values():
            known=[d for d in ps['districts'] if d['records'] is not None]
            ps['records']=sum(d['records'] for d in known) if known else None
            ps['status']='complete' if all(d['status']=='complete' for d in ps['districts']) else 'partial' if known else 'error' if any(d['status']=='error' for d in ps['districts']) else 'not_collected'
            ps['lastSuccessAt']=max((d['lastSuccessAt'] for d in known),default=None)
        total=sum(v['records'] for v in segments.values());history=self.state.get('history',[])[:500]
        # The hash/schema validation below happens before this status is published.
        for code,obj in details.items():
            if obj['completed'] or any(t['failures'] for t in obj['types']):write_json(self.base/'status'/f'{code}.json',obj)
        last=self.state.get('lastRun',{})
        valid_count=0
        for key,meta in segments.items():
            raw=self.segment_path(key).read_bytes()
            if hashlib.sha256(raw).hexdigest()!=meta['sha256']:raise SourceError('SEGMENT_HASH_MISMATCH')
            payload=json.loads(gzip.decompress(raw))
            if payload.get('scope')!=key or payload.get('schemaVersion')!=2 or len(payload['rows'])!=meta['sourceRows']:raise SourceError('SEGMENT_CONTENT_MISMATCH')
            valid_count+=1
        manifest={'schemaVersion':2,'generatedAt':utc(),'sourceAsOf':self.asof,'regions':list(provinces.values()),
          'collection':{'status': 'running' if self.active else 'partial' if segments else 'not_started',
            'runStatus':last.get('status','not_started'),'lastAttemptAt':last.get('startedAt'),
            'lastSuccessAt':max((v['fetchedAt'] for v in segments.values()),default=None),
            'schedule':'최신화 매일 04:00 KST · 미확보 자료 매 10분 제한 수집 · 오류 유형별 재시도 대기 · Excel inbox 반입 시 자동 적재',
            'history':history,'active':self.active,'workflow':'Collect transaction sources',
            'blockedSources':[{'type':sid,'label':STREAMS[sid]['label']+' '+('매매' if STREAMS[sid]['deal']=='sale' else '전월세'),
                'errorCode':v.get('code'),'nextRetryAt':v.get('nextRetryAt'),
                'reason':'API 활용승인/접근권한 확인 필요' if v.get('code') in ACCESS_ERRORS else '재시도 대기'}
                for sid,v in self.state.get('streamCooldowns',{}).items() if sid in STREAMS and cooldown_active(v)],
            'recentErrors':[{'code':code,'count':count} for code,count in
                collections.Counter(v.get('code','UNKNOWN') for v in self.state.get('failures',{}).values()).most_common()],
            'executionSource':'https://api.github.com/repos/softm/softm.tojihannun/actions/runs?per_page=10'},
          'summary':{'records':total if segments else None,'sourceRows':sum(v['sourceRows'] for v in segments.values()),
              'cancelled':sum(v['cancelled'] for v in segments.values()),'identifiable':sum(v['identifiable'] for v in segments.values()),
              'completedTasks':len(segments),'failedTasks':len(self.state['failures']),
              'cooldownStreams':sum(cooldown_active(v) for v in self.state.get('streamCooldowns',{}).values()),
              'cooldownTasks':sum(cooldown_active(v) for v in self.state.get('failures',{}).values()),
              'apiCooldownUntil':self.state.get('apiCooldown',{}).get('nextRetryAt') if cooldown_active(self.state.get('apiCooldown')) else None,
              'expectedTasks':sum(d['expected'] for d in details.values()),
              'sourceBytes':sum(v['bytes'] for v in segments.values()),'fileImports':len(self.state['imports'])},
          'sourcePolicy':{'excelAutomation':'permission_required','excelImported':len(self.state['imports']),'apiIsBulkSource':True,
              'note':'Excel/CSV 반입 지원. 공식 웹사이트 대량 자동다운로드는 실행하지 않습니다. API 작업은 수집 서버에서만 실행합니다.'},
          'verification':{'segmentsChecked':valid_count,'validatedAt':utc(),'level':'local_hash_schema_count','publishedCheck':None},
          'deployment':{'lastVerifiedAt':None},'source':[{'name':'국토교통부 공공데이터 API','url':'https://www.data.go.kr/'},
             {'name':'공식 파일 제공 및 자동 이용 안내','url':'https://rt.molit.go.kr/pt/info/info.do?mobileAt='},
             {'name':'법정동 공식 코드','url':'https://www.code.go.kr/stdcode/regCodeL.do'}]}
        write_json(self.base/'status-manifest.json',manifest)
        return manifest

class Client:
    def __init__(self,key,max_requests=160,interval=1.1,deadline=None):
        self.key=urllib.parse.unquote(key.strip());self.calls=0;self.max_requests=max_requests;self.interval=interval;self.last=0.;self.deadline=deadline
    def page(self,stream,code,month,page):
        if STOP:raise SourceError('STOPPED')
        if self.calls>=self.max_requests:raise SourceError('REQUEST_BUDGET')
        if self.deadline and time.monotonic()>self.deadline:raise SourceError('TIME_BUDGET')
        time.sleep(max(0,self.interval-(time.monotonic()-self.last)));self.calls+=1;self.last=time.monotonic()
        params={'serviceKey':self.key,'LAWD_CD':code,'DEAL_YMD':month,'pageNo':page,'numOfRows':1000}
        url='https://apis.data.go.kr/1613000/'+stream['service']+'/get'+stream['service']+'?'+urllib.parse.urlencode(params)
        req=urllib.request.Request(url,headers={'Accept':'application/xml,application/json','User-Agent':'Tojihannun-collector/2.0'})
        try:
            with urllib.request.urlopen(req,timeout=20) as r:raw=r.read(50_000_001)
        except urllib.error.HTTPError as e:raise SourceError(str(e.code)) from None
        except (OSError,TimeoutError):raise SourceError('NETWORK_TIMEOUT') from None
        if len(raw)>50_000_000:raise SourceError('RESPONSE_SIZE')
        return api_page(raw)
    def month(self,stream,district,month):
        total,raw=self.page(stream,district['code'],month,1)
        pages=max(1,(total+999)//1000)
        if pages-1>self.max_requests-self.calls:raise SourceError('REQUEST_BUDGET')
        if pages>100:raise SourceError('PAGE_LIMIT')
        for p in range(2,pages+1):
            next_total,rows=self.page(stream,district['code'],month,p)
            if next_total!=total:raise SourceError('SOURCE_CHANGED_DURING_PAGING')
            raw+=rows
        if len(raw)!=total:raise SourceError('ROW_COUNT_MISMATCH')
        return [normalize(r,district,stream,month) for r in raw]


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',default=str(HERE.parent.parent));ap.add_argument('--mode',choices=['import','refresh','backfill','build'],default='import')
    ap.add_argument('--max-tasks',type=int,default=48);ap.add_argument('--max-requests',type=int,default=160);ap.add_argument('--max-seconds',type=int,default=600)
    ap.add_argument('--districts',default='');ap.add_argument('--streams',default='');ap.add_argument('--refresh-registry',action='store_true')
    args=ap.parse_args();root=Path(args.root);reg_path=root/'data/transactions/registry.json'
    reg=refresh_registry(reg_path) if args.refresh_registry or not reg_path.exists() else read_json(reg_path,{})
    pipe=Pipeline(root,reg);run={'startedAt':utc(),'status':'running','mode':args.mode,'runId':os.environ.get('GITHUB_RUN_ID'),
       'success':0,'failed':0,'requests':0,'added':0,'removed':0,'cancelled':0}
    pipe.state['lastRun']=run;pipe.active=run;pipe.save()
    try:
        # Preserve timestamps from the original manifest before the first schema-v2 rewrite.
        migrated=pipe.migrate_legacy();run['legacySegmentsImported']=migrated
        pipe.status()
        for p in sorted((pipe.base/'inbox').glob('*.scope.json')):
            try:
                imported=pipe.import_file(p)
                if imported:
                    run['importedFiles']=run.get('importedFiles',0)+1
                    run['importedRows']=run.get('importedRows',0)+imported
            except (SourceError,KeyError,ValueError,FileNotFoundError) as e:
                run['failed']+=1;run.setdefault('fileErrors',[]).append({'file':p.name,'code':getattr(e,'code','INVALID_IMPORT')})
        if args.mode in ('refresh','backfill'):
            key=os.environ.get('MOLIT_API_KEY','')
            if not key:raise SourceError('MISSING_KEY')
            client=Client(key,max_requests=max(1,min(args.max_requests,500)),deadline=time.monotonic()+max(30,min(args.max_seconds,900)))
            blocked=set();done=0
            if cooldown_active(pipe.state.get('apiCooldown')):
                run['stopReason']='API_COOLDOWN'
            codes=args.districts.split(',') if args.districts else None;streams=args.streams.split(',') if args.streams else None
            if codes and any(c not in pipe.districts for c in codes):raise SourceError('UNKNOWN_DISTRICT')
            if streams and any(s not in STREAMS for s in streams):raise SourceError('UNKNOWN_STREAM')
            for task in (() if run.get('stopReason')=='API_COOLDOWN' else pipe.plan(args.mode,codes,streams)):
                if done>=max(1,min(args.max_tasks,500)) or STOP:break
                code,sid,month=task.split('/')
                if sid in blocked:continue
                # Status aggregation scans every district and validates all saved shards.
                # Do not repeat it for each monthly request: the run log is live and
                # the manifest is rebuilt once, after the batch is safely persisted.
                run['currentTask']=task;pipe.active=dict(run)
                try:
                    rows=client.month(STREAMS[sid],pipe.districts[code],month)
                    result=pipe.put(task,rows,'public_api');run['success']+=1
                    for k in ('added','removed','cancelled'):run[k]+=result[k]
                    print(json.dumps({'task':task,'status':'complete','rows':result['sourceRows'],'active':result['records']},ensure_ascii=False),flush=True)
                except SourceError as e:
                    pipe.fail(task,e);run['failed']+=1
                    print(json.dumps({'task':task,'status':'failed','code':e.code}),flush=True)
                    if e.code in ('429','22','23','29','REQUEST_BUDGET','TIME_BUDGET','STOPPED'):
                        run['stopReason']=e.code;break
                    if e.code in ('20','30','31','401','403','12','404'):blocked.add(sid)
                done+=1;run['requests']=client.calls
            run['requests']=client.calls
        run['status']='partial' if run['failed'] or STOP else 'deferred' if run.get('stopReason')=='API_COOLDOWN' else 'idle' if run.get('success',0)==0 and not run.get('importedFiles') else 'success'
    except SourceError as e:run['status']='failed';run['errorCode']=e.code
    except Exception as e:run['status']='failed';run['errorCode']=type(e).__name__;raise
    finally:
        run['finishedAt']=utc();run.pop('currentTask',None);pipe.active=None
        pipe.state['lastRun']=run;pipe.state['history']=[dict(run),*pipe.state.get('history',[])][:500];pipe.save();pipe.publish()
        print('COLLECTION_SUMMARY '+json.dumps(run,ensure_ascii=False),flush=True)
        if run.get('status')=='partial' and run.get('success',0)>0:
            print('::warning title=Partial RTMS collection::Validated data was saved, but '+str(run['failed'])+' source tasks failed. See status-manifest.json.',flush=True)
        if run.get('status')=='deferred':
            print('::warning title=RTMS quota cooldown::Source requests are deferred until the recorded retry time.',flush=True)
    return run_exit_code(run)

def request_stop(signum,frame):
    global STOP
    STOP=True

if __name__=='__main__':
    signal.signal(signal.SIGTERM,request_stop);signal.signal(signal.SIGINT,request_stop)
    sys.exit(main())
