/* Read-only operations dashboard. It never dispatches workflows or calls MOLIT. */
(() => {
  'use strict';
  const HOUR = 3600000, STALE = 2 * HOUR, ACTION_TTL = 15 * 60000, LIVE_POLL = 30000;
  const SNAPSHOT_KEY = 'toji.collection.observation.v1', ACTION_KEY = 'toji.collection.actions.v1';
  const names = {not_collected:'미수집',not_started:'미시작',partial:'일부 성공',complete:'계획 구간 완료',success:'수집 성공',failed:'수집 실패',failure:'실행 실패',error:'오류',running:'실행 중 기록',in_progress:'실행 중 기록',queued:'실행 대기',pending:'실행 대기',cancelled:'취소',deferred:'재시도·예산 대기',idle:'이번 대상 없음',blocked:'접근·설정 확인',capacity_paused:'용량 분할 필요',ready:'준비',paused:'이관 대기',mirroring:'기존 자료 복제',reserved:'증설 대기'};
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  const fmt = n => n == null ? '미확인' : Number(n).toLocaleString('ko-KR');
  const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST' : '미확인';
  const bytes = n => n == null ? '미확인' : n >= 1e9 ? (n/1e9).toFixed(2)+' GB' : (n/1e6).toFixed(2)+' MB';
  const age = (value, now=Date.now()) => {const t=Date.parse(value);if(!Number.isFinite(t))return '시각 미확인';const m=Math.max(0,Math.floor((now-t)/60000));return m<1?'방금':m<60?m+'분 전':m<1440?Math.floor(m/60)+'시간 '+m%60+'분 전':Math.floor(m/1440)+'일 전';};
  function formatPercent(done, expected) {
    if (!integer(done) || !integer(expected) || !expected || done > expected) return '—';
    if (done === expected) return '100%';
    return Math.min(99.999,done/expected*100).toLocaleString('ko-KR',{minimumFractionDigits:3,maximumFractionDigits:3})+'%';
  }
  function trusted(shard) { return /^realestate-data-\d{3}$/.test(shard?.id||'') && shard.repository==='softm/'+shard.id && shard.pagesBaseUrl==='https://softm.github.io/'+shard.id+'/'; }
  function verified(shard, report) {
    const d=report?.data;
    return trusted(shard) && shard.collectionOwner==='shard' && d?.collectionOwner==='shard' && d.shardId===shard.id && d.repository===shard.repository && !!shard.handoverCommit && d.migration?.sourceCommit===shard.handoverCommit && Array.isArray(d.districtCodes) && JSON.stringify([...d.districtCodes].sort())===JSON.stringify([...shard.districtCodes].sort()) && integer(d.summary?.records) && integer(d.summary?.completedTasks) && integer(d.summary?.expectedTasks) && d.summary.completedTasks<=d.summary.expectedTasks && Number.isFinite(Date.parse(d.generatedAt)) && Date.parse(d.generatedAt)<=Date.now()+300000;
  }
  function lastSuccess(data) {
    return data?.collection?.lastSuccessfulCollectionAt || (data?.collection?.success>0?data.collection.finishedAt:null) || (data?.regions||[]).flatMap(r=>(r.districts||[]).map(d=>d.lastSuccessAt)).filter(Boolean).sort().at(-1) || null;
  }
  function derive(registry, reports, model, now=Date.now()) {
    const rows=(registry?.shards||[]).map(shard=>{
      const report=reports[shard.id], assigned=!!shard.districtCodes?.length, valid=verified(shard,report), data=valid?report.data:null;
      const at=lastSuccess(data), stale=!!data && (!at || now-Date.parse(at)>STALE);
      const attention=assigned && (!valid || stale || ['failed','partial','blocked','capacity_paused'].includes(data?.collection?.status) || (data?.summary?.cooldownStreams||0)>0 || data?.capacity?.needsSplit);
      return {shard,report,assigned,valid,data,at,stale,attention};
    });
    const owned=rows.filter(r=>r.assigned&&r.shard.collectionOwner==='shard'), good=owned.filter(r=>r.valid), data=good.map(r=>r.data);
    const all=owned.length>0 && good.length===owned.length && !rows.some(r=>r.assigned&&r.shard.collectionOwner!=='shard');
    const sum=k=>data.reduce((n,d)=>n+(integer(d.summary[k])?d.summary[k]:0),0);
    const runSum=k=>data.reduce((n,d)=>n+(integer(d.collection?.[k])?d.collection[k]:0),0);
    const expected=all?sum('expectedTasks'):integer(model?.summary?.expectedTasks)?model.summary.expectedTasks:null;
    const records=data.length?sum('records'):null, done=data.length?sum('completedTasks'):null;
    const latest=data.map(lastSuccess).filter(Boolean).sort().at(-1)||null;
    const errors={};for(const d of data)for(const [key,count]of Object.entries(d.collection?.errors||{}))if(integer(count))errors[key]=(errors[key]||0)+count;
    const fingerprint=JSON.stringify([registry?.revision,expected,rows.filter(r=>r.assigned).map(r=>[r.shard.id,r.shard.districtCodes,r.shard.handoverCommit])]);
    const signature=data.map(d=>d.shardId+':'+d.generatedAt).sort().join('|');
    return {rows,owned,good,all,records,done,expected,remaining:integer(done)&&integer(expected)?Math.max(0,expected-done):null,latest,fingerprint,signature,errors,requests:runSum('requests'),success:runSum('success'),failed:runSum('failed'),pending:runSum('pendingSegments'),cooldowns:sum('cooldownStreams'),sourceBytes:sum('sourceBytes'),cancelled:sum('cancelled'),stale:good.filter(r=>r.stale).length,reserved:rows.filter(r=>!r.assigned).length,enabled:rows.filter(r=>r.assigned&&r.shard.collectionEnabled).length};
  }
  function observation(current, previous, now=Date.now()) {
    if(!current.all)return {next:previous||null,delta:null,reason:'partial'};
    const next={fingerprint:current.fingerprint,signature:current.signature,records:current.records,done:current.done,at:new Date(now).toISOString()};
    if(!previous||previous.fingerprint!==next.fingerprint||!integer(previous.records)||!integer(previous.done))return {next,delta:null,reason:'baseline'};
    return {next,delta:{records:next.records-previous.records,done:next.done-previous.done,from:previous.at},reason:previous.signature===next.signature?'unchanged':'changed'};
  }
  function selectedRun(body, repo) {
    return (body?.workflow_runs||[]).filter(r=>r.head_branch==='main' && r.path?.split('@')[0]==='.github/workflows/collect.yml' && r.repository?.full_name===repo && /^\d+$/.test(String(r.id)) && r.html_url==='https://github.com/'+repo+'/actions/runs/'+r.id).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0]||null;
  }
  window.TojiStatusDashboard={derive,verified,formatPercent,observation,selectedRun};
  if(typeof document==='undefined'||!document.getElementById?.('shards'))return;
  const $=id=>document.getElementById(id);
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
  const badge=(text,cls)=>el('span',text,'badge '+(cls||''));
  const actionState = run => {
    if(!run) return {key:'unknown',label:'상태 미확인',live:false};
    if(run.status==='in_progress') return {key:'running',label:'● 실제 수집 실행 중',live:true};
    if(['queued','waiting','pending','requested'].includes(run.status)) return {key:'queued',label:'● 실행 대기',live:false};
    if(run.status==='completed' && run.conclusion==='success') return {key:'stopped',label:'● 실행 종료',live:false};
    if(run.status==='completed' && ['failure','cancelled','timed_out','action_required'].includes(run.conclusion)) return {key:'failed',label:'● 실행 실패·중단',live:false};
    return {key:'stopped',label:'● '+(names[run.status]||run.status||'실행 종료'),live:false};
  };
  function liveVisual(id, now=Date.now()){
    const item=liveFiles[id], d=item?.data;
    if(!d||item.error||d.schemaVersion!==1||!Number.isFinite(Date.parse(d.updatedAt)))return null;
    const updated=Date.parse(d.updatedAt);
    if(updated>now+300000)return {key:'failed',label:'● 상태 시각 오류',live:false,data:d,updatedAt:d.updatedAt};
    if(d.status==='running'){
      const expiry=Date.parse(d.expiresAt);
      if(!Number.isFinite(expiry)||expiry<=now)return {key:'stale',label:'● 실행 상태 만료',live:false,data:d,updatedAt:d.updatedAt};
      return {key:'running',label:'● 실제 수집 실행 중',live:true,data:d,updatedAt:d.updatedAt};
    }
    if(now-updated>STALE)return {key:'stale',label:'● 상태 오래됨',live:false,data:d,updatedAt:d.updatedAt};
    if(d.status==='deferred')return {key:'deferred',label:'● 호출 예산·재시도 대기',live:false,data:d,updatedAt:d.updatedAt};
    if(d.status==='failed')return {key:'failed',label:'● 오류·점검 필요',live:false,data:d,updatedAt:d.updatedAt};
    if(d.status==='stopped')return {key:'stopped',label:'● 수집 정지·종료',live:false,data:d,updatedAt:d.updatedAt};
    return {key:'unknown',label:'● 상태 미확인',live:false,data:d,updatedAt:d.updatedAt};
  }
  function link(text,url){const a=el('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
  function kv(host,key,value){const d=el('div',null,'key-value');d.append(el('strong',key),el('span',value));host.append(d);}
  function readStore(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
  function writeStore(key,data){try{localStorage.setItem(key,JSON.stringify(data));}catch{/* Private browsing must not break live data. */}}
  let model=null, registry=null, reports={}, snapshot=null, loading=false, ready=false, checked=null, detailVersion=0, observed=null;
  let actionBusy=false, actionMessage='', autoActionsStarted=false, liveBusy=false, liveFiles={};
  let actions=readStore(ACTION_KEY)||{checkedAt:0,reports:{},ledger:[]};
  if(!Array.isArray(actions.ledger)||typeof actions.reports!=='object'||!actions.reports)actions={checkedAt:0,reports:{},ledger:[]};
  async function get(url){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('HTTP '+r.status);const text=await r.text();if(text.length>2000000)throw Error('현황 파일 크기 초과');return JSON.parse(text);}
  async function refreshLiveFiles(){
    if(liveBusy||!registry||document.hidden)return;
    liveBusy=true;
    const queue=(registry.shards||[]).filter(s=>s.districtCodes?.length&&trusted(s));
    async function worker(){
      while(queue.length){
        const shard=queue.shift();
        try{
          const url='https://raw.githubusercontent.com/'+shard.repository+'/main/live-status.json?v='+Math.floor(Date.now()/LIVE_POLL);
          const d=await get(url);
          if(d.schemaVersion!==1||d.repository!==shard.repository||!['running','stopped','deferred','failed'].includes(d.status))throw Error('잘못된 live 상태');
          if(!Number.isFinite(Date.parse(d.updatedAt)))throw Error('live 시각 오류');
          liveFiles[shard.id]={data:d,checkedAt:Date.now()};
        }catch(e){
          const previous=liveFiles[shard.id];
          liveFiles[shard.id]=previous?.data?{...previous,error:null,lastReadError:e.message}:{error:e.message,checkedAt:Date.now()};
        }
      }
    }
    await Promise.all(Array.from({length:Math.min(5,queue.length)},worker));
    liveBusy=false;
    if(snapshot){renderLive();renderShards();}
  }
  function card(label,value,note){const node=el('article',null,'card');node.append(el('span',label),el('strong',value),el('small',note));return node;}
  function addAlert(text,kind=''){const d=el('div',text,'alert '+kind);$('alerts').append(d);}
  function renderLive(){
    if(!snapshot)return;
    const states=snapshot.owned.map(r=>liveVisual(r.shard.id)).filter(Boolean);
    const running=states.filter(x=>x.key==='running').length;
    const deferred=states.filter(x=>x.key==='deferred').length;
    const stopped=states.filter(x=>x.key==='stopped').length;
    const failed=states.filter(x=>['failed','stale'].includes(x.key)).length;
    const latest=states.map(x=>Date.parse(x.updatedAt)).filter(Number.isFinite).sort((x,y)=>y-x)[0];
    if(states.length){
      $('liveState').textContent=`현재 실행 ${running}개 · 대기 ${deferred}개 · 정지 ${stopped}개 · 오류 ${failed}개`;
      $('liveDetail').textContent=`live-status 30초 자동 갱신 · 확인 ${states.length}/${snapshot.owned.length}개${latest?' · 최근 상태 '+age(new Date(latest).toISOString()):''}. 실행 중일 때만 초록색으로 점멸합니다.`;
    }else{
      const entries=snapshot.owned.map(r=>actions.reports[r.shard.id]);
      const fresh=entries.filter(r=>r&&Date.now()-r.checkedAt<120000&&!r.error);
      const apiRunning=fresh.filter(r=>r.run?.status==='in_progress').length;
      const queued=fresh.filter(r=>['queued','waiting','pending','requested'].includes(r.run?.status)).length;
      $('liveState').textContent=actionBusy?'실행 상태 확인 중':fresh.length?`GitHub 조회: 실행 ${apiRunning}개 · 대기 ${queued}개`:'실시간 실행 상태 확인 중';
      $('liveDetail').textContent=fresh.length?'live-status가 아직 생성되지 않은 레포는 GitHub 실행 기록을 보조로 표시합니다.':'첫 live-status 파일을 기다리고 있습니다.';
    }
    const liveBox=$('liveState').closest('.live');
    liveBox.classList.toggle('active',running>0);
    liveBox.classList.toggle('waiting',running===0&&deferred>0);
    liveBox.classList.toggle('stopped',running===0&&deferred===0&&failed===0&&states.length>0);
    liveBox.classList.toggle('failed',failed>0);
    $('liveState').classList.toggle('live-pulse',running>0);
    $('actionsNote').textContent=actionMessage||'실행 상태는 각 수집 레포의 live-status.json을 30초마다 읽어 갱신합니다. “실행 상태 확인” 버튼은 GitHub Actions 기록을 별도로 확인하는 보조 기능입니다.';
  }
  function renderOverview(){
    if(!snapshot)return;const s=snapshot;
    $('progressPercent').textContent=formatPercent(s.done,s.expected);
    $('totalProgress').max=s.expected||100;$('totalProgress').value=s.done||0;
    $('progressCount').textContent=`${s.all?'완료':'확인된 완료'} ${fmt(s.done)} / ${fmt(s.expected)}개 구간`;
    $('progressRemaining').textContent=`${s.all?'남은 구간':'미완료·미확인 구간'} ${fmt(s.remaining)}개`;
    $('progressBasis').textContent=`시군구 × 거래유형 × 계약월 기준 · 수집 결과 확인 ${s.good.length}/${s.owned.length}개 담당 레포. ${s.done===s.expected&&s.all?'계획 구간 100%이며 전체 이력 검증은 별도입니다.':'거래 건수의 완료율이 아닙니다.'}`;
    $('summary').replaceChildren(card(s.all?'누적 유효 거래':'확인된 유효 거래',fmt(s.records)+'건',s.all?'검증된 담당 레포 합계 · 취소 제외':'미확인 레포는 합산하지 않음'),card('완료 / 남은 구간',fmt(s.done),`미완료·미확인 ${fmt(s.remaining)}개`),card('수집 예약 / 예비 레포',s.enabled+' / '+s.reserved,'실제 실행 중 개수와는 별개'),card('마지막 정상 수집 후 경과',age(s.latest),stamp(s.latest)));
    if(observed?.delta){const d=observed.delta;const signed=n=>(n>0?'+':'')+fmt(n);$('delta').textContent=`이 브라우저 직전 확인 대비 거래 ${signed(d.records)}건 · 완료 구간 ${signed(d.done)}개 | 비교 기준 ${stamp(d.from)}`;}
    else $('delta').textContent=s.all?'첫 확인값을 저장했습니다. 다음 갱신부터 이 브라우저의 관측값과 비교합니다.':'일부 레포가 미확인이라 증가량 비교를 보류합니다. 조회 실패를 거래 감소로 계산하지 않습니다.';
    $('alerts').replaceChildren();
    if(!s.all)addAlert(`담당 레포 ${s.owned.length}개 중 ${s.good.length}개만 검증했습니다. 현재 합계는 확인된 범위이며 전체 최신 합계가 아닐 수 있습니다.`);
    if(s.stale)addAlert(`담당 레포 ${s.stale}개에서 정상 수집 시각이 미확인이거나 2시간 이상 지났습니다. 예약 지연·실패·예산 대기는 실행 로그에서 구분해 확인하세요.`);
    if(s.cooldowns)addAlert(`API 접근 보류 ${s.cooldowns}개 레포·유형 조합이 남아 있습니다. 같은 유형이 레포별로 중복 집계된 값이며 전체 수집 완료로 처리하지 않습니다.`);
    if(s.failed||s.pending)addAlert(`레포별 마지막 배치 합계: 요청 ${fmt(s.requests)}회 · 성공 ${fmt(s.success)}개 · 실패 ${fmt(s.failed)}개 · 이어받기 대기 ${fmt(s.pending)}개 구간. ${Object.entries(s.errors).map(([k,n])=>k+' '+n+'건').join(' · ')}`);
    if(s.good.some(r=>r.data.capacity?.needsSplit))addAlert('900MB 분할 기준에 도달한 레포가 있습니다. 기존 정상 자료를 보존하고 분할 상태를 확인하세요.');
    const legacy=s.owned.filter(r=>r.shard.serving!=='pages').length;
    if(legacy)addAlert(`수집 담당 ${s.owned.length}개 중 ${legacy}개는 서비스 조회 설정이 기존 중앙 데이터입니다. 수집 증가와 실거래 화면 갱신은 별개입니다.`,'info');
    $('poolSummary').textContent=`총 ${s.rows.length}개 · 수집 예약 ${s.enabled}개 · 예비 ${s.reserved}개 · 확인 ${s.good.length}/${s.owned.length}개 · 레포당 게시 상한 1GB`;
    renderLive();
  }
  function renderShards(){
    if(!snapshot)return;const filter=$('shardFilter').value;
    const rows=snapshot.rows.filter(r=>filter==='all'||filter==='active'&&r.assigned||filter==='reserved'&&!r.assigned||filter==='attention'&&r.attention||filter==='stale'&&r.stale);
    const table=el('table'),thead=el('thead'),head=el('tr');for(const name of ['레포 · 담당','진행률 / 완료 구간','유효 거래','마지막 정상 수집','마지막 수집 배치','GitHub 실행 확인','게시 산출물','서비스 조회'])head.append(el('th',name));thead.append(head);table.append(thead);const body=el('tbody');
    for(const r of rows){const {shard:s,data:d}=r, a=actions.reports[s.id], action=actionState(a&&!a.error?a.run:null), batchStatus=d?.collection?.status||'';const rowClasses=[!r.assigned?'reserved':r.attention?'attention':'',action.key==='running'?'running-row':action.key==='queued'?'queued-row':'',action.key==='failed'?'failed-row':'',batchStatus==='deferred'?'deferred-row':''].filter(Boolean).join(' '), tr=el('tr',null,rowClasses);
      const td=()=>{const x=el('td');tr.append(x);return x;};
      const identity=td();identity.append(link(s.id.replace('realestate-data-','DATA '),'https://github.com/'+s.repository),el('small',s.label?.replace(/^\d+\s*·\s*/, '')||s.id),el('small',r.assigned?fmt(s.activeDistrictCount)+'개 현행 시군구':'지역 미배정'));
      const progress=td();if(r.valid){progress.append(el('strong',formatPercent(d.summary.completedTasks,d.summary.expectedTasks)),el('small',fmt(d.summary.completedTasks)+' / '+fmt(d.summary.expectedTasks)));const p=el('progress');p.max=d.summary.expectedTasks||1;p.value=d.summary.completedTasks;p.setAttribute('aria-label',s.id+' 수집 진행률');progress.append(p);}else progress.append(badge(!r.assigned?'증설 대기':'미확인',!r.assigned?'reserved':'error'));
      td().append(el('span',r.valid?fmt(d.summary.records)+'건':r.assigned?'미확인':'—','num'));
      const time=td();time.append(el('span',r.valid?age(r.at):'—'),el('small',r.valid?stamp(r.at):r.assigned?'검증된 최신 저장 기록 없음':'담당 배정 전'));if(r.stale)time.append(badge('저장 지연','stale'));
      const batch=td();if(d){const c=d.collection||{};batch.append(badge(names[c.status]||c.status,c.status),el('small',`요청 ${fmt(c.requests)} · 성공 ${fmt(c.success)} · 실패 ${fmt(c.failed)}`));if(d.summary.cooldownStreams)batch.append(el('small','접근 보류 '+d.summary.cooldownStreams+'개 유형'));}else batch.textContent=r.assigned?'확인 전':'수집하지 않음';
      const actionCell=td();if(!r.assigned)actionCell.textContent='예비';else if(a&&!a.error&&a.run){const visual=actionState(a.run);actionCell.append(badge(visual.label,visual.key),el('small','조회 '+age(new Date(a.checkedAt).toISOString())));if(visual.live)actionCell.append(el('small','현재 실행 중 · 완료되면 점멸이 멈춥니다','running-note'));if(Date.now()-a.checkedAt>=120000)actionCell.append(el('small','지난 조회값 · 현재 상태 아님'));}else actionCell.append(el('span',a?.error?'조회 실패':a?'최근 20건에 수집 실행 없음':'조회 전'));actionCell.append(link('실행 로그 ↗','https://github.com/'+s.repository+'/actions/workflows/collect.yml'));
      td().append(el('span',d?bytes(d.capacity?.publishedBytes):'미측정'),el('small','최대 1GB / 900MB 분할'));
      const service=td();service.append(badge(!r.assigned?'조회 미배정':s.serving==='pages'?'지역 Pages':'기존 중앙',s.serving==='pages'?'success':''),el('small',r.report?.pagesVerified?'Pages 응답 확인':'Pages 응답 미확인'));
      body.append(tr);
    }
    table.append(body);$('shards').replaceChildren(rows.length?table:el('p','조건에 맞는 레포가 없습니다.','empty'));
  }
  function renderRegions(){
    const opened=new Set([...$('regions').querySelectorAll('details[open]')].map(d=>d.dataset.code));
    const query=$('search').value.trim(),filter=$('filter').value,host=$('regions');host.replaceChildren();
    for(const region of model?.regions||[]){const districts=(region.districts||[]).filter(d=>(!query||[d.name,region.name].some(n=>n?.includes(query)))&&(!filter||d.status===filter));if(!districts.length)continue;
      const section=el('details',null,'province');section.dataset.code=region.code;section.open=!!query||opened.has(region.code);const heading=el('summary');const done=(region.districts||[]).reduce((n,d)=>n+(d.completed||0),0),expected=(region.districts||[]).reduce((n,d)=>n+(d.expected||0),0);heading.append(el('span',region.name),el('span',fmt(region.records)+'건 · '+formatPercent(done,expected)+' · '+districts.length+'개 지역'));section.append(heading);const grid=el('div',null,'districts');
      for(const d of districts){const b=el('button');b.type='button';const owner=(registry?.shards||[]).find(s=>s.districtCodes?.includes(d.code));b.append(el('span',d.name),badge(d.status==='complete'?'계획 구간 완료':d.status==='partial'?'부분 확보':names[d.status]||d.status,d.status),el('small',fmt(d.records)+'건 · '+fmt(d.completed)+' / '+fmt(d.expected)+'개 구간'),el('small',owner?owner.label:'중앙'));b.onclick=()=>showDistrict(d,owner);grid.append(b);}section.append(grid);host.append(section);
    }
    if(!host.childElementCount)host.append(el('p','조건에 맞는 지역이 없습니다.','empty'));
  }
  async function showDistrict(d,owner){
    const token=++detailVersion,host=$('detail');$('detailTitle').textContent=d.name+' 상세';$('districtStorage').hidden=false;const remote=owner&&verified(owner,reports[owner.id]);$('districtStorage').textContent=(owner?.label||'중앙')+' · '+(remote?'지역 수집 체크포인트':'중앙 마지막 자료');host.textContent='거래유형·연도별 현황 확인 중';
    try{if(!/^\d{5}$/.test(d.code))throw Error('잘못된 지역 코드');if(!d.completed&&d.records==null&&d.status!=='error'){host.textContent='아직 완료된 수집 구간이 없습니다. 거래가 없다는 뜻이 아닙니다.';return;}
      const url=remote?'https://raw.githubusercontent.com/'+owner.repository+'/main/data/transactions/status/'+d.code+'.json':'./data/transactions/status/'+d.code+'.json';const data=await get(url);if(token!==detailVersion)return;if(data.code!==d.code)throw Error('지역 코드 불일치');host.replaceChildren();kv(host,'최근 정상 수집',stamp(data.lastSuccessAt));kv(host,'완료 구간',fmt(data.completed)+' / '+fmt(data.expected));
      for(const type of data.types||[]){const details=el('details'),head=el('summary');head.append(el('span',type.label),badge(names[type.status]||type.status,type.status),el('span',fmt(type.records)+'건'));details.append(head);const wrap=el('div',null,'table-wrap'),table=el('table'),thead=el('thead'),tr=el('tr');for(const name of ['계약연도','상태','유효 거래','완료 / 대상 월'])tr.append(el('th',name));thead.append(tr);table.append(thead);const body=el('tbody');for(const y of type.years||[]){const row=el('tr');for(const v of [y.year,names[y.status]||y.status,fmt(y.records),y.completedMonths+' / '+y.expectedMonths])row.append(el('td',v));body.append(row);}table.append(body);wrap.append(table);details.append(wrap);host.append(details);}
    }catch(e){if(token===detailVersion)host.textContent='상세 현황을 읽지 못했습니다. '+e.message;}
  }
  function renderHistory(){
    const host=$('history');host.replaceChildren();const rows=snapshot.good.map(r=>({row:r,run:r.data.collection})).sort((a,b)=>String(b.run.finishedAt).localeCompare(String(a.run.finishedAt))).slice(0,500);
    for(const {row,run}of rows){const article=el('article',null,'history-item');article.append(el('strong',row.shard.label),badge(names[run.status]||run.status,run.status),el('p',stamp(run.finishedAt)),el('p',`API ${fmt(run.requests)}회 · 구간 성공 ${fmt(run.success)} / 실패 ${fmt(run.failed)}`));if(run.currentTask)article.append(el('small','최근 작업 '+run.currentTask));if(/^\d+$/.test(String(run.runId)))article.append(link(' 해당 실행 ↗','https://github.com/'+row.shard.repository+'/actions/runs/'+run.runId));host.append(article);}
    if(!rows.length)host.append(el('p','검증된 지역별 실행 결과가 없습니다.','empty'));
    const ops=$('operations');ops.replaceChildren();for(const [k,v]of [['현황 조회',stamp(checked)],['수집 결과 확인',snapshot.good.length+' / '+snapshot.owned.length+'개 담당 레포'],['수집 기준','시군구 × 거래유형 × 계약월 · 페이지 검증 완료 후 반영'],['자동 실행 설정',registry?.mode==='collecting'?'지역별 매시간 예약 (실제 실행은 GitHub 기록으로 확인)':'분산 담당 이관 전'],['레포별 요청 한도',`실행당 ${fmt(registry?.requestBudget?.perRun)}회 · 시간당 ${fmt(registry?.requestBudget?.perHour)}회 · 24시간당 ${fmt(registry?.requestBudget?.perDay)}회`],['원본 gzip 합계',bytes(snapshot.sourceBytes)],['재개 대기 구간',fmt(snapshot.pending)],['미수집·실패 처리','정상 0건 응답과 구분 · 기존 정상 데이터 보존'],['배포·조회','Pages 공개와 사용자 실거래 화면 연결은 수집과 별도']])kv(ops,k,v);
    $('sources').replaceChildren();for(const source of model?.source||[]){try{const u=new URL(source.url);if(u.protocol==='https:'){const p=el('p');p.append(link(source.name+' ↗',u.href));$('sources').append(p);}}catch{}}
  }
  function render(){if(!model||!registry)return;snapshot=derive(registry,reports,model);renderOverview();renderShards();renderRegions();renderHistory();}
  async function load(){
    if(loading)return;loading=true;$('refresh').disabled=true;$('refreshNote').textContent='현황 조회 중 · 원본 API 호출 없음';
    try{const [base,config]=await Promise.all([get('./data/transactions/status-manifest.json'),get('./data/transactions/storage-registry.json')]);if(config.schemaVersion!==3||!Array.isArray(config.shards))throw Error('지원하지 않는 저장소 구성');
      const next=await window.TojiDistributedStatus.load(config);const merged=window.TojiDistributedStatus.merge(base,config,next);registry=config;reports=next;model=merged;ready=true;checked=new Date().toISOString();snapshot=derive(config,next,merged);observed=observation(snapshot,readStore(SNAPSHOT_KEY));if(observed.next&&snapshot.all)writeStore(SNAPSHOT_KEY,observed.next);
      $('checkedAt').textContent='현황 확인 '+stamp(checked);$('notice').textContent=snapshot.all?'지역별 검증된 저장 결과를 통합했습니다. 사본은 중복 합산하지 않습니다.':'일부 수집 결과를 확인하지 못했습니다. 확인된 범위와 미확인 레포를 구분합니다.';render();
      if(!autoActionsStarted){autoActionsStarted=true;void checkRuns();}
    }catch(e){$('notice').textContent='수집 현황 조회 실패: '+e.message+' · 이전 표시가 있으면 마지막 확인값입니다.';$('checkedAt').textContent='최신 현황 확인 실패'+(checked?' · 마지막 확인 '+stamp(checked):'');}
    finally{loading=false;$('refresh').disabled=false;$('refreshNote').textContent=$('autoRefresh').checked?'현황 자동 갱신 · 60초 (수집 실행 주기와 별개)':'현황 자동 갱신 일시 정지';}
  }
  async function checkRuns(){
    if(actionBusy||!registry||!snapshot)return;
    const now=Date.now(),targets=snapshot.owned.filter(r=>trusted(r.shard));
    const cached=readStore(ACTION_KEY);if(cached&&Array.isArray(cached.ledger)&&cached.reports){actions=cached;}
    if(now-(actions.checkedAt||0)<ACTION_TTL){actionMessage='실행 상태는 '+stamp(new Date(actions.checkedAt).toISOString())+'의 조회값입니다. 공개 API 보호를 위해 15분 뒤 다시 확인합니다.';renderLive();renderShards();return;}
    actions.ledger=actions.ledger.filter(t=>Number.isFinite(t)&&t>now-HOUR);
    if(actions.blockedUntil>now||actions.ledger.length+targets.length>30){actionMessage='GitHub 실행 조회 한도 보호로 잠시 대기합니다. 데이터 현황 갱신과 수집기는 계속 동작할 수 있으며, 현재 실행 여부는 개별 로그에서 확인하세요.';renderLive();return;}
    actionBusy=true;$('checkRuns').disabled=true;renderLive();const queue=[...targets];let stop=false;
    async function worker(){while(queue.length&&!stop){const {shard}=queue.shift();const at=Date.now();actions.ledger.push(at);writeStore(ACTION_KEY,actions);
      try{const response=await fetch('https://api.github.com/repos/'+shard.repository+'/actions/runs?per_page=20',{cache:'no-store',headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(8000)});
        const remaining=response.headers.get('x-ratelimit-remaining');if(remaining!=null&&Number(remaining)<5)stop=true;
        if(!response.ok){if([403,429].includes(response.status)){stop=true;const reset=Number(response.headers.get('x-ratelimit-reset'))*1000;actions.blockedUntil=Number.isFinite(reset)&&reset>at?reset:at+ACTION_TTL;}throw Error('HTTP '+response.status);}
        const body=await response.json();actions.reports[shard.id]={checkedAt:Date.now(),run:selectedRun(body,shard.repository)};
      }catch(e){actions.reports[shard.id]={checkedAt:Date.now(),error:e.message};}
    }}
    await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));actions.checkedAt=Date.now();writeStore(ACTION_KEY,actions);actionBusy=false;$('checkRuns').disabled=false;
    const failures=targets.filter(r=>actions.reports[r.shard.id]?.error).length;actionMessage=`실행 기록 조회 ${stamp(new Date(actions.checkedAt).toISOString())} · 조회 실패 ${failures}개${stop?' · 조회 한도 보호로 일부 대기':''}. 버튼은 읽기 전용이며 재실행하지 않습니다.`;renderLive();renderShards();
  }
  $('search').oninput=()=>model&&renderRegions();$('filter').onchange=()=>model&&renderRegions();$('shardFilter').onchange=renderShards;
  $('refresh').onclick=()=>void load();$('checkRuns').onclick=()=>void checkRuns();
  $('autoRefresh').onchange=()=>{$('refreshNote').textContent=$('autoRefresh').checked?'현황 자동 갱신 · 60초':'현황 자동 갱신 일시 정지';};
  void load();setInterval(()=>{if(!document.hidden&&$('autoRefresh').checked)void load();else if(ready)renderLive();},60000);
})();
