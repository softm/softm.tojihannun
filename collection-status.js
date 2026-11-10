/* Collection status is authoritative from verified worker checkpoints, not Pages readiness. */
(() => {
  'use strict';
  const api=window.TojiDistributedStatus;if(!api)return;
  const previous={...api};
  async function json(url){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('HTTP '+r.status);const t=await r.text();if(t.length>2000000)throw Error('Oversized status');return JSON.parse(t);}
  async function load(registry){
    if(registry.mode!=='collecting')return previous.load(registry);
    const queue=[...registry.shards],reports={};
    async function worker(){while(queue.length){const s=queue.shift();
      if(!/^realestate-data-\d{3}$/.test(s.id)||s.repository!=='softm/'+s.id||s.pagesBaseUrl!=='https://softm.github.io/'+s.id+'/'){reports[s.id]={source:'unavailable',data:null};continue;}
      const base='https://raw.githubusercontent.com/'+s.repository+'/main/';
      const [repo,pages,ready]=await Promise.allSettled([json(base+'shard-status.json').then(d=>api.validate(d,s)),json(s.pagesBaseUrl+'shard-status.json').then(d=>api.validate(d,s)),json(base+'readiness.json')]);
      const choices=[repo.status==='fulfilled'?{data:repo.value,source:'repository'}:null,pages.status==='fulfilled'?{data:pages.value,source:'pages'}:null].filter(Boolean).sort((a,b)=>Date.parse(b.data.generatedAt)-Date.parse(a.data.generatedAt));
      reports[s.id]={...(choices[0]||{data:null,source:'unavailable'}),pagesVerified:pages.status==='fulfilled',checkedAt:new Date().toISOString(),readiness:ready.status==='fulfilled'&&ready.value.repository===s.repository?ready.value:null};
    }}
    await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));return reports;
  }
  function authoritative(s,r){return s?.collectionOwner==='shard'&&r?.data?.collectionOwner==='shard'&&r.data.migration?.sourceCommit===s.handoverCommit;}
  function merge(legacy,registry,reports){
    if(registry.mode!=='collecting')return previous.merge(legacy,registry,reports);
    const result=JSON.parse(JSON.stringify(legacy)),replacement=new Map(),accepted=[];
    const active=registry.shards.filter(s=>s.districtCodes.length&&s.collectionOwner==='shard');
    for(const s of active){const r=reports[s.id];if(!authoritative(s,r))continue;accepted.push(r.data);
      for(const region of r.data.regions||[])for(const d of region.districts||[]){if(!s.districtCodes.includes(d.code)||replacement.has(d.code))throw Error('Overlapping collection ownership');replacement.set(d.code,{...d,shardId:s.id});}}
    for(const region of result.regions||[]){region.districts=region.districts.map(d=>replacement.get(d.code)||d);const ds=region.districts.filter(d=>d.records!=null);region.records=ds.length?ds.reduce((n,d)=>n+d.records,0):null;region.status=region.districts.every(d=>d.status==='complete')?'complete':ds.length?'partial':'not_collected';}
    const ds=result.regions.flatMap(r=>r.districts);
    for(const [key,field]of[['records','records'],['completedTasks','completed'],['expectedTasks','expected']])result.summary[key]=ds.reduce((n,d)=>n+(d[field]||0),0);
    const all=accepted.length===active.length;
    for(const key of ['sourceRows','cancelled','identifiable','failedTasks','cooldownStreams','cooldownTasks','sourceBytes','fileImports'])result.summary[key]=all?accepted.reduce((n,d)=>n+(d.summary[key]||0),0):null;
    const dates=accepted.flatMap(d=>(d.regions||[]).flatMap(r=>(r.districts||[]).map(x=>x.lastSuccessAt))).filter(Boolean).sort();
    result.collection={...result.collection,schedule:'지역별 매시간 자동 수집 · 과거 미수집 구간과 최근 3개월 병행',lastSuccessAt:dates.at(-1)||legacy.collection?.lastSuccessAt,lastAttemptAt:accepted.map(d=>d.collection.startedAt).filter(Boolean).sort().at(-1)||null,history:accepted.flatMap(d=>[{...d.collection,message:d.shardId+' · '+(d.collection.status||'확인 중')+' · 정상 '+(d.collection.success||0)+' / 실패 '+(d.collection.failed||0)+' · 요청 '+(d.collection.requests||0)+'회'}]).sort((a,b)=>String(b.finishedAt).localeCompare(String(a.finishedAt)))};
    result.distributed=true;result.operational={active:active.length,verified:accepted.length,stale:active.length-accepted.length};
    result.sourcePolicy={...result.sourcePolicy,note:all?'지역별 수집 체크포인트 통합 · Pages 게시와 수집 성공은 별도로 확인합니다.':`${active.length}개 중 ${accepted.length}개 수집 담당 이관 확인 · 미확인 지역은 마지막 중앙 자료를 유지합니다.`};
    return result;
  }
  function live(registry,reports){
    if(registry?.mode!=='collecting')return false;
    const state=document.getElementById('liveState'),detail=document.getElementById('liveDetail');if(!state||!detail)return true;
    const active=registry.shards.filter(s=>s.districtCodes.length&&s.collectionEnabled);
    const ready=active.filter(s=>authoritative(s,reports[s.id]));
    const good=ready.filter(s=>['success','partial'].includes(reports[s.id].data.collection.status));
    const bad=ready.filter(s=>['failed','blocked','capacity_paused'].includes(reports[s.id].data.collection.status));
    state.textContent=`분산 자동 수집 ${active.length}개 · 최근 정상 응답 ${good.length}개`;
    detail.textContent=`매시간 실행 예약 · 이관 확인 ${ready.length}/${active.length} · 점검 필요 ${bad.length}개. 아래는 마지막 저장된 실행 결과이며, 현재 실행 중 여부는 각 실행 로그에서 확인합니다.`;
    const label=state.previousElementSibling;if(label)label.textContent='분산 수집 운영 상태';
    return true;
  }
  function render(registry,reports){previous.render(registry,reports);if(registry.mode!=='collecting')return;
    const cards=[...document.querySelectorAll('#shards .shard')];
    for(const [i,s]of registry.shards.entries()){const card=cards[i],r=reports[s.id];if(!card||!r)continue;
      for(const row of card.querySelectorAll('.key-value')){const k=row.querySelector('strong'),v=row.querySelector('span');if(!k||!v)continue;
        if(k.textContent==='설치·게시')v.textContent=r.pagesVerified?'Pages 게시 확인':authoritative(s,r)?'수집 저장 완료 · Pages 별도':'준비된 사본 · Pages 별도';
        if(k.textContent==='최근 처리'){const c=r.data?.collection||{};v.textContent=({success:'수집 성공',partial:'일부 성공',failed:'수집 실패',deferred:'호출 예산·재시도 대기',blocked:'설정 확인 필요',capacity_paused:'용량 분할 필요',idle:'이번 실행 대상 없음',ready:'이관 준비',paused:'이관 대기'})[c.status]||c.status;}
      }
    }
    live(registry,reports);
  }
  window.TojiCollectionOps={authoritative,merge,live};Object.assign(api,{load,merge,render});
})();
