(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = value => value == null ? '미확인' : Number(value).toLocaleString('ko-KR');
  const names={not_collected:'미수집',not_started:'미시작',partial:'부분 확보',complete:'확보 완료',success:'실행 성공',failed:'실행 실패',failure:'실행 실패',error:'오류',running:'수집 중',in_progress:'수집 중',queued:'실행 대기',pending:'실행 대기',cancelled:'취소',deferred:'요청 보류',idle:'대기 중'};
  const stamp=value=>value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'미확인';
  const bytes=n=>n==null?'미확인':n>1048576?(n/1048576).toFixed(1)+' MB':(n/1024).toFixed(1)+' KB';
  function el(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;}
  function badge(status){return el('span',names[status]||status||'미확인','badge '+status);}
  let model=null, storage=null;
  async function get(url){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();}
  function kv(host,k,v){const line=el('div',null,'key-value');line.append(el('strong',k),el('span',v));host.append(line);}
  function storageFor(code){
    return (storage?.shards||[]).find(shard=>(shard.districtCodes||[]).includes(code)||(shard.regionCodes||[]).some(prefix=>code.startsWith(prefix)))||null;
  }
  function renderShards(){
    const host=$('shards');if(!host)return;host.replaceChildren();
    if(!storage){host.append(el('p','저장소 구성 정보를 불러오지 못했습니다.'));return;}
    const shards=storage.shards||[];
    if(!shards.length){host.append(el('p','연결된 외부 데이터 저장소가 없습니다. 현재 수집 데이터는 기존 저장소에서 관리합니다.'));return;}
    for(const shard of shards){
      const card=el('article',null,'shard');const head=el('div',null,'shard-head');head.append(el('strong',shard.label||shard.id),badge(shard.status==='active'?'complete':'not_collected'));card.append(head);
      card.append(el('p',(shard.regions||[]).join(' · ')||'담당 지역 미지정'));
      const matched=(model?.regions||[]).flatMap(r=>r.districts||[]).filter(d=>storageFor(d.code)?.id===shard.id);
      kv(card,'담당 시군구',fmt(matched.length)+'개');kv(card,'수집된 거래',fmt(matched.reduce((sum,d)=>sum+(Number(d.records)||0),0))+'건');
      kv(card,'저장소 상태',shard.status==='active'?'연결됨':'연결 전 · 기존 저장소 사용');
      const cap=storage?.allocation?.maxPublishedBytes;const used=shard.publishedBytes;
      kv(card,'게시 용량',used==null?'미측정 / 최대 1GB':bytes(used)+' / '+bytes(cap));
      if(used!=null&&cap){const meter=el('progress');meter.max=cap;meter.value=used;meter.setAttribute('aria-label','저장소 게시 용량 사용률');card.append(meter);}
      if(shard.status==='active' && shard.pagesBaseUrl){try{const url=new URL(shard.pagesBaseUrl);if(url.protocol==='https:'){const a=el('a','게시 데이터 확인 ↗');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}}catch{}}
      host.append(card);
    }
  }
  function renderRegions(){
    const query=$('search').value.trim(),filter=$('filter').value;const host=$('regions');host.replaceChildren();
    for(const region of model.regions||[]){
      const ds=(region.districts||[]).filter(d=>(!query||[d.name,region.name].some(n=>n.includes(query)))&&(!filter||d.status===filter));
      if(!ds.length)continue;
      const section=el('details',null,'province');if(query)section.open=true;
      const heading=el('summary');heading.append(el('span',region.name),el('span',(region.records==null?'미수집':fmt(region.records)+'건')+' · '+ds.length+'개 지역'));section.append(heading);
      const grid=el('div',null,'districts');
      for(const d of ds){const b=el('button');b.type='button';b.append(el('span',d.name),badge(d.status),el('small',d.records==null?'거래 건수 미확인':fmt(d.records)+'건'));const shard=storageFor(d.code);if(shard)b.append(el('small','담당: '+(shard.label||shard.id)));b.onclick=()=>showDistrict(d);grid.append(b);}
      section.append(grid);host.append(section);
    }
    if(!host.childElementCount)host.append(el('p','조건에 맞는 지역이 없습니다.'));
  }
  async function showDistrict(d){
    $('detailTitle').textContent=d.name+' 상세';const sh=storageFor(d.code),st=$('districtStorage');if(st)st.textContent=sh?'데이터 저장소: '+(sh.label||sh.id)+(sh.status==='active'?' · 연결됨':' · 연결 준비 중 (현재 기존 저장소 조회)'):'데이터 저장소: 기존 토지한눈 저장소';const host=$('detail');host.textContent='상세 현황 확인 중';
    if(!d.completed && d.records==null && d.status!=='error'){host.textContent='아직 수집 완료한 구간이 없습니다. 거래가 없다는 뜻이 아닙니다.';return;}
    try{
      if(!/^\d{5}$/.test(d.code))throw Error('잘못된 지역 코드');
      const data=await get('./data/transactions/status/'+d.code+'.json');host.replaceChildren();
      kv(host,'최근 정상 수집',stamp(data.lastSuccessAt));kv(host,'확보 구간',fmt(data.completed)+' / '+fmt(data.expected)+' 지역·유형·계약월');
      for(const type of data.types||[]){const details=el('details');const head=el('summary');head.append(el('span',type.label),badge(type.status),el('span',type.records==null?'미확인':fmt(type.records)+'건'));details.append(head);
        const wrap=el('div',null,'table-wrap'),table=el('table'),thead=el('thead'),tr=el('tr');for(const t of ['계약연도','상태','유효 거래','확보 / 대상 월'])tr.append(el('th',t));thead.append(tr);table.append(thead);
        const body=el('tbody');for(const y of type.years||[]){const row=el('tr');for(const t of [y.year,names[y.status]||y.status,fmt(y.records),y.completedMonths+' / '+y.expectedMonths])row.append(el('td',t));body.append(row);}table.append(body);wrap.append(table);details.append(wrap);host.append(details);
      }
    }catch(e){host.textContent='상세 현황을 읽지 못했습니다. 기존 거래자료와 별개입니다. '+e.message;}
  }
  function render(){
    const c=model.collection||{},s=model.summary||{};const cards=[['전국 기반자료 수집','매 10분','미수집 구간 배치 처리 · 완료 시 종료'],['정기 최신화','매일 04:00','KST · 최근 3개월 재확인'],['마지막 정상 수집',stamp(c.lastSuccessAt),'원본을 정상 수신한 시각'],['유효 거래',fmt(s.records),'취소 제외 · 확보 범위 내'],['완료 구간',fmt(s.completedTasks)+' / '+fmt(s.expectedTasks),'시군구 × 유형 × 계약월'],['지번 식별 가능',fmt(s.identifiable),'가려진 지번은 포함하지 않음'],['취소 기록',fmt(s.cancelled),'취소 정보를 별도 보존'],['접근 보류 유형',fmt(s.cooldownStreams),'API 권한 문제 · 재시도 시각 적용'],['재시도 대기',fmt(s.cooldownTasks),'실패한 구간 재시도 예약'],['파일 반입',fmt(s.fileImports),'검증 완료한 Excel/CSV'],['저장 용량',bytes(s.sourceBytes),'정규화 원본 gzip 합계']];
    $('summary').replaceChildren();for(const [label,value,note]of cards){const box=el('div',null,'card');box.append(el('span',label),el('strong',value),el('small',note));$('summary').append(box);}
    $('notice').textContent=model.sourcePolicy?.note||'실제 확보 범위를 확인하세요. 전국 수집 완료를 뜻하지 않습니다.';renderShards();renderRegions();
    const ops=$('operations');ops.replaceChildren();for(const [k,v]of [['자동 수집',c.schedule||'미설정'],['마지막 시도',stamp(c.lastAttemptAt)],['API 호출 제한 해제 예정',s.apiCooldownUntil?stamp(s.apiCooldownUntil):'호출 제한 보류 없음'],['자료 생성',stamp(model.generatedAt)],['검증 범위',(model.verification?.level||'미확인')+' · '+fmt(model.verification?.segmentsChecked)+'개 원본'],['운영 게시파일 별도 검증',stamp(model.deployment?.lastVerifiedAt)],['웹 다운로드 자동화',model.sourcePolicy?.excelAutomation==='permission_required'?'승인 필요 · 자동 크롤링 비활성':'미확인'],['수집 오류 현황',(c.recentErrors||[]).map(x=>(x.code==='403'?'API 접근 거부(403)':x.code==='NETWORK_TIMEOUT'?'네트워크 지연':x.code==='429'||x.code==='22'?'호출 제한':x.code)+' '+fmt(x.count)+'개 구간').join(' · ')||'기록된 오류 없음']])kv(ops,k,v);for(const x of c.blockedSources||[])kv(ops,'접근 보류 · '+x.label,(x.reason||'재시도 대기')+' · 다음 재시도 '+stamp(x.nextRetryAt));
    const history=$('history');history.replaceChildren();const rows=(c.history||[]).slice(0,500);
    if(!rows.length)history.append(el('p','수집 실행 이력이 없습니다.'));
    for(const run of rows){const item=el('article',null,'history-item');item.append(badge(run.status),el('strong',' '+stamp(run.finishedAt||run.at||run.startedAt)));if(run.status==='partial'&&run.success>0)item.append(el('small',' · 일부 성공: 정상 자료 저장됨, 실패 유형 별도 기록'));item.append(el('p',run.message||'성공 '+fmt(run.success)+' / 실패 '+fmt(run.failed)+' · 요청 '+fmt(run.requests)+'회'));if(run.added!=null)item.append(el('small','원본 비교: 추가 '+fmt(run.added)+' · 사라짐 '+fmt(run.removed)+' · 취소표시 '+fmt(run.cancelled)));history.append(item);}
    $('sources').replaceChildren();for(const source of model.source||[]){try{const url=new URL(source.url);if(url.protocol!=='https:')continue;const p=el('p'),a=el('a',source.name+' ↗');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';p.append(a);$('sources').append(p);}catch{}}
  }
  async function live(){
    try{
      const data=await get('https://api.github.com/repos/softm/softm.tojihannun/actions/runs?per_page=15');
      const runs=(data.workflow_runs||[]).filter(r=>r.name==='Collect transaction sources');const running=runs.find(r=>['queued','pending','in_progress','waiting'].includes(r.status));const last=running||runs[0];
      if(!last){$('liveState').textContent='등록된 본수집 실행 없음';return;}
      $('liveState').textContent=running?(names[last.status]||last.status):(names[last.conclusion]||'종료');
      $('liveDetail').textContent=(running?'현재 실행은 GitHub에서 확인했습니다. 세부 건수는 작업 게시 시 갱신됩니다.':'현재 실행 중이 아닙니다. 마지막 실행 결과이며 전국 수집 완료를 뜻하지 않습니다.')+' · 확인 '+stamp(new Date().toISOString());
      if(last.html_url?.startsWith('https://github.com/softm/softm.tojihannun/actions/runs/'))$('runLink').href=last.html_url;
    }catch{$('liveState').textContent='실시간 실행 상태 미확인';$('liveDetail').textContent='GitHub 조회 제한 또는 연결 오류입니다. 아래는 마지막 게시된 수집 결과입니다.';}
  }
  async function load(){try{const [manifest,registry]=await Promise.all([get('./data/transactions/status-manifest.json'),get('./data/transactions/storage-registry.json').catch(()=>null)]);model=manifest;storage=registry;render();}catch(e){$('notice').textContent='수집 현황 조회 실패: '+e.message;}}
  $('search').oninput=()=>model&&renderRegions();$('filter').onchange=()=>model&&renderRegions();$('refresh').onclick=()=>{void load();void live();};
  void load();void live();setInterval(()=>{if(!document.hidden)void live();},60000);
})();
