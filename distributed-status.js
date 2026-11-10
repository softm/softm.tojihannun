/* Small operational manifests only; transaction payloads are never fetched here. */
(() => {
  'use strict';
  async function read(url) {
    const response = await fetch(url, {cache:'no-store',signal:AbortSignal.timeout(4500)});
    if(!response.ok)throw Error('HTTP '+response.status);
    const body=await response.text();if(body.length>2000000)throw Error('Manifest size limit');return JSON.parse(body);
  }
  function validate(data, shard) {
    if(data.schemaVersion!==1 || data.shardId!==shard.id || data.repository!==shard.repository)throw Error('Shard identity mismatch');
    if(JSON.stringify([...data.districtCodes].sort())!==JSON.stringify([...shard.districtCodes].sort()))throw Error('Assignment changed');
    if(!Number.isSafeInteger(data.capacity?.publishedBytes)||data.capacity.publishedBytes<0||data.capacity.publishedBytes>=1000000000)throw Error('Invalid artifact size');
    return data;
  }
  async function inspect(shard) {
    if(!/^realestate-data-\d{3}$/.test(shard.id)||shard.repository!=='softm/'+shard.id)throw Error('Untrusted repository');
    if(shard.pagesBaseUrl!=='https://softm.github.io/'+shard.id+'/')throw Error('Untrusted Pages URL');
    try{return {data:validate(await read(shard.pagesBaseUrl+'shard-status.json'),shard),source:'pages',checkedAt:new Date().toISOString()};}
    catch(error){
      try{return {data:validate(await read('https://raw.githubusercontent.com/softm/'+shard.id+'/main/shard-status.json'),shard),source:'repository',checkedAt:new Date().toISOString(),pagesError:error.message};}
      catch{return {data:null,source:'unavailable',error:'구조 설치 또는 게시 상태 확인 필요'};}
    }
  }
  async function readiness(shard) {
    try {
      const value=await read('https://raw.githubusercontent.com/softm/'+shard.id+'/main/readiness.json');
      if(value.schemaVersion!==1||value.repository!==shard.repository||typeof value.apiKeyConfigured!=='boolean')throw Error('Readiness identity mismatch');
      return {apiKeyConfigured:value.apiKeyConfigured,pagesConfigured:value.pagesConfigured===true?true:value.pagesConfigured===false?false:null,checkedAt:value.checkedAt};
    } catch { return null; }
  }
  async function load(registry) {
    const queue=[...(registry.shards||[])], reports={};
    async function worker(){while(queue.length){const s=queue.shift();try{const [report,ready]=await Promise.all([inspect(s),readiness(s)]);reports[s.id]={...report,readiness:ready};}catch(e){reports[s.id]={source:'unavailable',data:null,error:e.message};}}}
    await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));return reports;
  }
  function merge(legacy, registry, reports) {
    const result=JSON.parse(JSON.stringify(legacy));const replacements=new Map();
    for(const s of registry.shards||[]) {
      const r=reports[s.id];
      if(s.collectionOwner!=='shard'||s.serving!=='pages'||r?.source!=='pages')continue;
      for(const region of r.data.regions||[])for(const d of region.districts||[]){
        if(!s.districtCodes.includes(d.code)||replacements.has(d.code))throw Error('Overlapping summary');
        replacements.set(d.code,{...d,shardId:s.id});
      }
    }
    if(!replacements.size)return result;
    for(const r of result.regions||[]) {
      r.districts=(r.districts||[]).map(d=>replacements.get(d.code)||d);
      const known=r.districts.filter(d=>d.records!=null);
      r.records=known.length?known.reduce((n,d)=>n+d.records,0):null;
      r.status=r.districts.every(d=>d.status==='complete')?'complete':known.length?'partial':'not_collected';
    }
    const ds=result.regions.flatMap(r=>r.districts||[]);
    result.summary.records=ds.some(d=>d.records!=null)?ds.reduce((n,d)=>n+(d.records||0),0):null;
    result.summary.completedTasks=ds.reduce((n,d)=>n+(d.completed||0),0);
    result.summary.expectedTasks=ds.reduce((n,d)=>n+(d.expected||0),0);
    for(const k of ['sourceRows','cancelled','identifiable','failedTasks','cooldownStreams','cooldownTasks','sourceBytes','fileImports'])result.summary[k]=null;
    result.distributed=true;return result;
  }
  function render(storage,reports){
    const host=document.getElementById('shards');if(!host)return;host.replaceChildren();
    const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
    const fmt=n=>n==null?'미확인':Number(n).toLocaleString('ko-KR');
    const kv=(host,k,v)=>{const line=el('div',null,'key-value');line.append(el('strong',k),el('span',v));host.append(line);};
    const entries=storage.shards||[],reserved=entries.filter(s=>!s.districtCodes.length).length;
    host.append(el('p',`${entries.length}개 레포 · 게시 상한 합계 ${entries.length}GB · 900MB 분할 기준 ${(entries.length*.9).toFixed(1)}GB · 증설 대기 ${reserved}개`,'hint'));
    for(const shard of entries){
      const report=reports[shard.id],data=report?.data,card=el('article',null,'shard');
      card.append(el('strong',shard.label||shard.id));kv(card,'저장소',shard.repository);
      kv(card,'담당 시군구',shard.districtCodes.length?fmt(shard.activeDistrictCount)+'개 · 현행 코드':'증설 대기 · 아직 지역 미배정');
      kv(card,'설치·게시',report?.source==='pages'?'Pages 게시 확인':report?.source==='repository'?'복제 검증 완료 · Pages 미확인':report?'설치·게시 확인 필요':'확인 중');
      kv(card,'API 키 등록',report?.readiness?report.readiness.apiKeyConfigured?'등록 확인 (API 권한 별도)':'미등록':'실행 확인 전');
      kv(card,'Pages 설정',report?.readiness?.pagesConfigured===true?'GitHub Actions 설정 확인':report?.readiness?.pagesConfigured===false?'GitHub Actions 방식으로 전환 필요':'확인 전 또는 조회 권한 부족');
      kv(card,'수집 담당',!shard.districtCodes.length?'증설 대기 (중복 호출 없음)':shard.collectionOwner==='shard'?'지역 저장소':shard.collectionOwner==='paused'?'이관 일시 정지':'기존 중앙 수집기');
      kv(card,'복제·수집 거래',data?fmt(data.summary.records)+'건':'미확인');
      const used=data?.capacity?.publishedBytes;
      kv(card,'게시 산출물',used==null?'미측정 / 최대 1GB':(used/1000000).toFixed(2)+' MB / 최대 1GB');
      kv(card,'용량 보호','900MB에서 분할안 생성 / 1GB 배포 차단');
      if(used!=null){const meter=el('progress');meter.max=1000000000;meter.value=used;meter.setAttribute('aria-label','게시 용량 사용률');card.append(meter);}
      if(data){kv(card,'최근 처리',data.collection.status);kv(card,'체크포인트',fmt(data.summary.completedTasks)+'개 구간');}
      const link=el('a','수집·배포 로그 ↗');link.href='https://github.com/'+shard.repository+'/actions';link.target='_blank';link.rel='noopener noreferrer';card.append(link);host.append(card);
    }
  }
  window.TojiDistributedStatus={load,merge,validate,render};
})();
