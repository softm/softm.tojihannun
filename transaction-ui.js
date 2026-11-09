/* Collection-aware presentation. This module never requests a source API. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const text = value => String(value ?? '');
  const esc = value => text(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = (value, digits = 0) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('ko-KR', {maximumFractionDigits:digits}) : '미제공';
  function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '미제공';
    const eok = Math.floor(n / 10000), rest = n % 10000;
    return eok ? `${number(eok)}억${rest ? ` ${number(rest)}만원` : '원'}` : `${number(n)}만원`;
  }
  const months = values => [...new Set((values || []).filter(v => /^\d{4}(0[1-9]|1[0-2])$/.test(v)))].sort();
  const monthLabel = value => `${value.slice(0,4)}.${value.slice(4)}`;
  function coverage(group) {
    const keys = months(group.coveredMonthKeys);
    const expected = group.savedOnly ? null : Number(group.totalMonths || 0);
    const count = keys.length;
    const partial = expected == null || count < expected || Boolean(group.failedMonths || group.truncated);
    const label = group.loading ? '자료 불러오는 중' : group.staticError ? '수집 파일 확인 필요' : !count ? '수집 범위 미확인' : partial ? '일부 기간 확보' : '선택 기간 확보';
    const range = count ? `${monthLabel(keys[0])}${count > 1 ? ` ~ ${monthLabel(keys.at(-1))}` : ''}` : '확보 월 미확인';
    return {keys, count, expected, partial, label, range};
  }
  function sorted(items, order = 'date-desc') {
    const copy = [...items];
    const latest = (a,b) => text(b.date).localeCompare(text(a.date));
    const comparators = {
      'date-desc':latest,
      'date-asc':(a,b) => text(a.date).localeCompare(text(b.date)),
      'amount-desc':(a,b) => b.amount-a.amount || latest(a,b),
      'amount-asc':(a,b) => a.amount-b.amount || latest(a,b),
      'unit-desc':(a,b) => b.unitPrice-a.unitPrice || latest(a,b)
    };
    return copy.sort(comparators[order] || latest);
  }
  let current = null, lastKey = '', limit = 20, order = 'date-desc';
  function mount() {
    const panel = $('detailPanelTransactions');
    if (!panel) return null;
    panel.classList.add('collection-trades');
    const controls = panel.querySelector('.transaction-market-controls');
    if (controls && !controls.dataset.arranged) {
      controls.dataset.arranged = 'true';
      for (const id of ['transactionType','transactionRange']) {
        const field = document.createElement('div'); field.className = 'trade-filter';
        const label = controls.querySelector(`label[for="${id}"]`);
        if (label) field.append(label);
        if ($(id)) field.append($(id));
        controls.insertBefore(field, $('refreshTransactions'));
      }
      const typeLabel = controls.querySelector('label[for="transactionType"]');
      if(typeLabel) typeLabel.textContent = '부동산 유형';
      const refresh = $('refreshTransactions');
      if (refresh) {refresh.setAttribute('aria-label','최신 수집 자료 다시 불러오기');refresh.title='수집 자료 새로고침';refresh.insertAdjacentHTML('beforeend','<span>새로고침</span>');}
      const saved = $('transactionRange')?.querySelector('[value="saved"]');
      if (saved) saved.textContent = '수집된 전체 기간';
      for (const option of $('transactionRange')?.options || []) if (option.value.startsWith('year-')) option.textContent = `${option.value.slice(5)}년 · 수집 자료`;
      const listCaption = $('transactionListSection')?.querySelector('.market-section-head span');
      if (listCaption) listCaption.textContent = '계약일 기준 · 취소 제외';
      const disclaimer = panel.querySelector('.market-disclaimer');
      if (disclaimer) disclaimer.textContent = '수집된 계약월의 공개 거래만 표시합니다. 미수집·읽기 실패·지번 비공개는 거래 없음이 아닙니다. 같은 지번의 다른 호실이 포함될 수 있으며 현재 시세나 동일 호실의 연속 거래를 뜻하지 않습니다.';
    }
    if (!$('transactionCollection')) {
      const section = document.createElement('section'); section.id='transactionCollection';section.className='trade-collection';section.setAttribute('aria-label','실거래 수집 범위');
      panel.querySelector('.market-panel-head').after(section);
    }
    if (!$('transactionChartToggle') && $('transactionChartCard')) {
      const details=document.createElement('details');details.id='transactionChartToggle';details.className='trade-chart-toggle';
      details.innerHTML='<summary>월별 거래단가 차트 보기 <small>면적·층·호실 구성에 따라 달라집니다</small></summary>';
      $('transactionListSection').after(details);details.append($('transactionChartCard'));
    }
    return panel;
  }
  function reset() {
    const panel=mount(); if(!panel)return;
    current=null;lastKey='';limit=20;order='date-desc';
    $('transactionCollection').hidden=true;
    if($('transactionChartToggle'))$('transactionChartToggle').hidden=true;
    $('transactionEmpty')?.remove();$('transactionSortRow')?.remove();
    $('refreshTransactions').disabled=false;panel.removeAttribute('aria-busy');
  }
  function drawList() {
    if(!current)return;
    const {group,view,definition}=current;
    const items=sorted(view==='nearby'?group.comparable:group.items,order);
    const host=$('transactionList');
    host.innerHTML=items.slice(0,limit).map(item => `<article class="trade-row" aria-label="${esc(item.date)} 계약 거래">
      <div class="trade-row-top"><time datetime="${esc(item.date)}">${esc(text(item.date).replaceAll('-','.'))}</time><strong>${esc(money(item.amount))}</strong></div>
      <div class="trade-row-name">${esc(item.buildingName || [item.umdNm,item.jibun || '지번 미공개'].filter(Boolean).join(' '))}</div>
      <div class="trade-row-scope">${esc(item.exact?'공개 지번 일치':item.jibun?'같은 법정동 비교':'지번 미공개 · 필지 미확정')}<span>${esc([item.umdNm,item.jibun].filter(Boolean).join(' '))}</span></div>
      <dl><div><dt>${esc(definition.areaKind)}</dt><dd>${esc(number(item.area,2))}㎡</dd></div><div><dt>층</dt><dd>${esc(item.floor ? item.floor+'층':'미제공')}</dd></div><div><dt>거래단가</dt><dd>${esc(number(item.unitPrice,1))}<small>만원/㎡</small></dd></div></dl>
      ${[item.dealType,item.jimok,item.landUse,item.buildingUse].some(Boolean)?`<div class="trade-row-meta">${esc([item.dealType,item.jimok,item.landUse,item.buildingUse].filter(Boolean).join(' · '))}</div>`:''}
    </article>`).join('');
    if(items.length>limit){const more=document.createElement('button');more.type='button';more.className='trade-more';more.textContent=`거래 20건 더 보기 · ${number(Math.min(limit,items.length))}/${number(items.length)}건 표시`;more.onclick=()=>{limit+=20;drawList();};host.append(more);}
    $('transactionListCount').textContent=`${number(items.length)}건 · ${number(Math.min(limit,items.length))}건 표시`;
    $('transactionListSection').hidden=!items.length;
  }
  function render(props) {
    const panel=mount();if(!panel)return;
    current=props;
    const {group,definition,view,type,period,onView,onReload,onStop}=props;
    const key=[group.scope,type,period,view].join('|');
    if(key!==lastKey){lastKey=key;limit=20;order='date-desc';}
    const nearby=view==='nearby', items=nearby?group.comparable:group.items, cov=coverage(group);
    panel.setAttribute('aria-busy',String(Boolean(group.loading)));
    $('refreshTransactions').disabled=Boolean(group.loading);
    $('transactionHeading').textContent=`${definition.label} 매매 실거래`;
    $('transactionAreaLabel').textContent=`${group.scope} · ${nearby?'같은 법정동 비교':'선택 지번 기준'}`;
    const collected=$('transactionCollection');collected.hidden=false;
    const source=group.staticLoaded?'국토교통부 수집 자료':group.snapshotAt?'개별 검증 저장 자료':'수집 자료';
    const stamp=group.snapshotAt?text(group.snapshotAt).slice(0,10):'미확인';
    collected.innerHTML=`<div class="trade-collection-head"><strong>${esc(source)}</strong><span class="trade-state${group.staticError?' error':''}">${esc(cov.label)}</span></div>
      <div class="trade-coverage-main">${esc(cov.range)} <b>${cov.expected==null?`${cov.count}개 계약월 확보`:`${cov.count}/${cov.expected}개 계약월 확보`}</b></div>
      <div class="trade-collection-foot"><span>자료 갱신 ${esc(stamp)} · 전체 이력 아님</span><a href="./data-status.html" target="_blank" rel="noopener">수집 현황 ↗</a></div>
      ${cov.count?`<details class="trade-month-details"><summary>확보한 계약월 확인${cov.partial?' · 중간 미수집 기간 확인':''}</summary><p>${cov.keys.map(monthLabel).map(esc).join(' · ')}</p></details>`:''}`;
    const scope=$('transactionScopeSwitch');
    if(scope){scope.className='transaction-scope-switch';scope.replaceChildren();for(const [mode,label,list]of[['parcel','해당 지번',group.items],['nearby','같은 법정동 비교',group.comparable]]){const b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',String(view===mode));b.textContent=`${label} · ${list.length?number(list.length)+'건':group.loading?'조회 중':'미확인'}`;b.onclick=()=>onView(mode);scope.append(b);}}
    const disclosure=$('transactionDisclosure');
    if(disclosure){disclosure.hidden=!nearby&&!group.undisclosedCount;disclosure.textContent=nearby?'같은 법정동의 비교 자료입니다. 선택 필지의 거래나 거리순 주변 거래가 아닙니다.':`같은 법정동 ${number(group.undisclosedCount)}건은 지번 식별이 불가능해 해당 필지 거래에 포함하지 않았습니다.`;}
    const paging=$('transactionPaging');if(paging){paging.className='transaction-paging trade-help';paging.replaceChildren();const note=document.createElement('small');note.textContent='기간·유형 변경은 수집 자료를 필터링합니다. 미수집 기간은 자동 수집 후 반영됩니다.';paging.append(note);if(group.loading){const stop=document.createElement('button');stop.type='button';stop.textContent='조회 중단';stop.onclick=onStop;paging.append(stop);}else if(group.staticError){const retry=document.createElement('button');retry.type='button';retry.textContent='수집 자료 다시 불러오기';retry.onclick=onReload;paging.append(retry);}}
    const status=$('transactionStatus');
    status.dataset.tone=group.error||group.staticError?'error':group.loading?'loading':items.length?'success':'';
    status.textContent=group.error || (group.loading?'수집 자료를 불러오고 있습니다.':items.length?`${number(items.length)}건 확인 · ${nearby?'비교 거래':'공개 지번 일치'} · 취소 제외`:'확보한 범위에서 지번 일치 거래를 확인하지 못했습니다.');
    const newest=sorted(items)[0];
    $('transactionStats').innerHTML=newest?[
      ['확인된 매매',number(items.length)+'건',nearby?'같은 법정동 비교':'해당 지번 · 여러 호실 포함 가능'],
      ['최근 계약금액',money(newest.amount),'현재 시세·감정가 아님'],
      ['최근 계약일',text(newest.date).replaceAll('-','.'),`${definition.areaKind} ${number(newest.area,2)}㎡${newest.floor?' · '+newest.floor+'층':''}`]
    ].map(([a,b,c])=>`<div class="market-stat"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join(''):'';
    let empty=$('transactionEmpty');if(!empty){empty=document.createElement('div');empty.id='transactionEmpty';empty.className='trade-empty';$('transactionStats').after(empty);}
    empty.hidden=Boolean(items.length);
    const emptyTitle=group.loading?'거래 자료 확인 중':group.staticError?'수집 자료를 읽지 못했습니다':!cov.count?'선택 조건의 수집 자료 미확보':'해당 지번 거래 미확인';
    empty.innerHTML=`<strong>${esc(emptyTitle)}</strong><p>${esc(group.loading?'확인 중에는 거래 건수를 0건으로 확정하지 않습니다.':group.staticError?'네트워크 상태를 확인한 뒤 새로고침해 주세요. 거래가 없다는 뜻은 아닙니다.':!cov.count?'아직 수집하지 않은 지역·유형·기간일 수 있습니다. 다른 기간·유형과 수집 현황을 확인해 주세요.':nearby?'확보한 기간에 확인된 비교 거래가 없습니다. 다른 기간을 확인해 주세요.':'미수집 기간이나 지번 비공개 거래가 있을 수 있습니다. 해당 필지의 전체 거래 이력이 없다는 뜻은 아닙니다.')}</p>`;
    let sortRow=$('transactionSortRow');if(!sortRow){sortRow=document.createElement('div');sortRow.id='transactionSortRow';sortRow.className='trade-sort';sortRow.innerHTML='<label for="transactionSort">거래 정렬</label><select id="transactionSort"><option value="date-desc">최신 계약순</option><option value="date-asc">과거 계약순</option><option value="amount-desc">금액 높은순</option><option value="amount-asc">금액 낮은순</option><option value="unit-desc">단가 높은순</option></select>';$('transactionList').before(sortRow);$('transactionSort').onchange=e=>{order=e.target.value;limit=20;drawList();};}
    $('transactionSort').value=order;
    drawList();
    $('transactionChartToggle').hidden=!items.length;
  }
  window.TojiTransactionUI=Object.freeze({render,reset,coverage,sorted,money});
})();
