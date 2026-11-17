/* Transaction presentation. Collection diagnostics stay in the operations page. */
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
  // Keep coverage semantics available internally; do not render operational metadata.
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

  // UI-only filters: they never change the underlying official-source rows.
  const PAGE_SIZE = 10;
  const VISIBLE_PAGE_BUTTONS = 5;
  let current = null, lastKey = '', currentPage = 1, order = 'date-desc', selectedArea = 'all';
  function paginationWindow(totalItems, requestedPage = 1) {
    const totalPages = Math.max(1, Math.ceil(Math.max(0, totalItems) / PAGE_SIZE));
    const page = Math.min(totalPages, Math.max(1, Math.trunc(Number(requestedPage)) || 1));
    const start = Math.max(1, Math.min(page - Math.floor(VISIBLE_PAGE_BUTTONS / 2), totalPages - VISIBLE_PAGE_BUTTONS + 1));
    const end = Math.min(totalPages, start + VISIBLE_PAGE_BUTTONS - 1);
    return {page, totalPages, start, end, firstIndex:(page - 1) * PAGE_SIZE, lastIndex:Math.min(totalItems, page * PAGE_SIZE)};
  }
  const areaKey = item => Number(item?.area) > 0 ? String(Math.round(Number(item.area))) : '';
  const medianAmount = items => {
    const amounts = items.map(item => Number(item.amount)).filter(n => Number.isFinite(n) && n > 0).sort((a,b)=>a-b);
    if (!amounts.length) return 0;
    const middle = Math.floor(amounts.length / 2);
    return amounts.length % 2 ? amounts[middle] : (amounts[middle - 1] + amounts[middle]) / 2;
  };
  function areaOptions(items, type) {
    if (!['apartment','rowHouse','officetel'].includes(type)) return [];
    const counts = new Map();
    items.forEach(item => {
      const key = areaKey(item);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    if (counts.size < 2) return [];
    const ranked = [...counts].sort((a,b)=>b[1]-a[1] || Number(a[0])-Number(b[0]));
    const shown = ranked.slice(0, 4);
    const others = ranked.slice(4).reduce((total, item)=>total+item[1],0);
    return [...shown.map(([key,count])=>({key,label:`약 ${key}㎡ · ${count}건`})),
      ...(others ? [{key:'other',label:`기타 면적 · ${others}건`}] : [])];
  }
  function filteredItems(items, options = [], area = selectedArea) {
    if (area === 'all') return items;
    const keyset = new Set(options.filter(item=>item.key !== 'other').map(item=>item.key));
    return items.filter(item=> area === 'other'
      ? !keyset.has(areaKey(item)) : areaKey(item) === area);
  }
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
      if (refresh) {refresh.setAttribute('aria-label','실거래 내역 새로고침');refresh.title='실거래 내역 새로고침';refresh.insertAdjacentHTML('beforeend','<span>새로고침</span>');}
      const saved = $('transactionRange')?.querySelector('[value="saved"]');
      if (saved) saved.textContent = '최근 6개월 우선';
      for (const option of $('transactionRange')?.options || []) if (option.value.startsWith('year-')) option.textContent = `${option.value.slice(5)}년`;
      const listCaption = $('transactionListSection')?.querySelector('.market-section-head span');
      if (listCaption) listCaption.textContent = '계약일 기준 · 취소 제외';
      const disclaimer = panel.querySelector('.market-disclaimer');
      if (disclaimer) disclaimer.textContent = '계약 신고 기준의 매매 내역입니다. 같은 지번의 여러 호실 거래가 포함될 수 있습니다.';
    }
    // Remove the legacy coverage card rather than hiding an operational link with CSS.
    $('transactionCollection')?.remove();
    if (!$('transactionChartToggle') && $('transactionChartCard')) {
      const details=document.createElement('details');details.id='transactionChartToggle';details.className='trade-chart-toggle';
      details.innerHTML='<summary>월별 거래단가 추이 <small>거래 월별 중위값 · 건별 면적 및 층수 차이 주의</small></summary>';
      // The monthly chart is the primary insight, not an optional hidden panel.
      details.open=true;
      $('transactionStats').before(details);details.append($('transactionChartCard'));
      const filters=document.createElement('div');filters.id='transactionAreaFilters';filters.className='trade-area-filters';
      filters.setAttribute('role','group');filters.setAttribute('aria-label','전용면적별 거래 비교');
      details.querySelector('summary').after(filters);
    }
    if (!$('transactionInsight')) {
      const insight=document.createElement('p');insight.id='transactionInsight';insight.className='trade-insight';
      $('transactionStats').after(insight);
    }
    if (!$('transactionChartToggle').open && !panel.dataset.chartInitialized) {
      $('transactionChartToggle').open=true;
    }
    panel.dataset.chartInitialized='true';
    if (!$('transactionPagination')) {
      const pagination=document.createElement('nav');
      pagination.id='transactionPagination';
      pagination.className='trade-pagination';
      pagination.setAttribute('aria-label','실거래 내역 페이지 이동');
      $('transactionListSection').append(pagination);
    }
    $('transactionListCount')?.setAttribute('aria-live','polite');
    return panel;
  }
  function reset() {
    const panel=mount(); if(!panel)return;
    current=null;lastKey='';currentPage=1;order='date-desc';selectedArea='all';
    $('transactionChartToggle')?.setAttribute('open','');
    if ($('transactionAreaFilters')) $('transactionAreaFilters').replaceChildren();
    if($('transactionChartToggle'))$('transactionChartToggle').hidden=true;
    $('transactionEmpty')?.remove();$('transactionSortRow')?.remove();
    $('refreshTransactions').disabled=false;panel.removeAttribute('aria-busy');
  }
  function drawList() {
    if(!current)return;
    const {group,view,definition}=current;
    const raw=view==='nearby'?group.comparable:group.items;
    const items=sorted(filteredItems(raw,areaOptions(raw,current.type)),order);
    const host=$('transactionList');
    const paging=paginationWindow(items.length,currentPage);
    currentPage=paging.page;
    host.innerHTML=items.slice(paging.firstIndex,paging.lastIndex).map(item => {
      const name=item.buildingName || [item.umdNm,item.jibun || '지번 미공개'].filter(Boolean).join(' ');
      const address=[item.umdNm,item.jibun].filter(Boolean).join(' ');
      const scope=item.exact?'공개 지번 일치':item.jibun?'같은 법정동 비교':'지번 미공개 · 필지 미확정';
      const extras=[item.dealType,item.jimok,item.landUse,item.buildingUse].filter(Boolean);
      return `<article class="trade-row trade-row--compact" aria-label="${esc([item.date,name,money(item.amount),scope].join(' · '))}">
        <div class="trade-row-top"><time datetime="${esc(item.date)}">${esc(text(item.date).replaceAll('-','.'))}</time><strong>${esc(money(item.amount))}</strong></div>
        <div class="trade-row-inline">
          <strong class="trade-row-name" title="${esc(name)}">${esc(name)}</strong>
          ${address && address!==name ? `<span class="trade-row-address" title="${esc(address)}">${esc(address)}</span>` : ''}
          ${Number(item.area)>0 ? `<span class="trade-row-fact">${esc(definition.areaKind)} ${esc(number(item.area,2))}㎡</span>` : ''}
          ${item.floor ? `<span class="trade-row-fact">${esc(item.floor)}층</span>` : ''}
          ${Number(item.unitPrice)>0 ? `<span class="trade-row-fact">${esc(number(item.unitPrice,1))}만원/㎡</span>` : ''}
          ${extras.map(value=>`<span class="trade-row-fact">${esc(value)}</span>`).join('')}
          <span class="trade-row-scope-chip${item.exact?'':' neutral'}" title="${esc(scope)}">${item.exact?'지번 일치':item.jibun?'같은 동 비교':'지번 미확정'}</span>
        </div>
      </article>`;
    }).join('');
    $('transactionListCount').textContent=items.length
      ? `총 ${number(items.length)}건 · ${number(paging.firstIndex+1)}–${number(paging.lastIndex)}건 표시`
      : '확인된 거래 0건';
    const nav=$('transactionPagination');
    nav.replaceChildren();
    nav.hidden=paging.totalPages<=1 || !items.length;
    if (!nav.hidden) {
      const addButton=(label,target,disabled=false,selected=false)=>{
        const button=document.createElement('button');
        button.type='button';
        button.textContent=label;
        button.className=selected?'trade-page-button is-current':'trade-page-button';
        button.disabled=disabled;
        button.setAttribute('aria-label',label==='이전'?'이전 페이지':label==='다음'?'다음 페이지':selected?`현재 ${target}페이지`:`${target}페이지로 이동`);
        if (selected) button.setAttribute('aria-current','page');
        button.addEventListener('click',()=>{
          if (target===currentPage) return;
          currentPage=target;drawList();
          $('transactionListSection').scrollIntoView({block:'start',behavior:'auto'});
        });
        nav.append(button);
      };
      addButton('이전',paging.page-1,paging.page===1);
      for(let p=paging.start;p<=paging.end;p++) addButton(String(p),p,false,p===paging.page);
      addButton('다음',paging.page+1,paging.page===paging.totalPages);
    }
    $('transactionListSection').hidden=!items.length;
  }
  function render(props) {
    const panel=mount();if(!panel)return;
    current=props;
    const {group,definition,view,type,period,onView,onReload,onStop}=props;
    const key=[group.scope,type,period,view].join('|');
    if(key!==lastKey){lastKey=key;currentPage=1;order='date-desc';selectedArea='all';}
    const nearby=view==='nearby', allItems=nearby?group.comparable:group.items;
    const options=areaOptions(allItems,type);
    if (selectedArea!=='all' && !options.some(option=>option.key===selectedArea)) selectedArea='all';
    const items=filteredItems(allItems,options);
    const failed=Boolean(group.error || group.staticError);
    panel.setAttribute('aria-busy',String(Boolean(group.loading)));
    $('refreshTransactions').disabled=Boolean(group.loading);
    $('transactionHeading').textContent=`${definition.label} 매매 실거래`;
    $('transactionAreaLabel').textContent=`${group.scope} · ${nearby?'같은 법정동 비교':'선택 지번 기준'}`;
    const scope=$('transactionScopeSwitch');
    if(scope){scope.className='transaction-scope-switch';scope.replaceChildren();for(const [mode,label,list]of[['parcel','해당 지번',group.items],['nearby','같은 법정동 비교',group.comparable]]){const b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',String(view===mode));b.textContent=label+(list.length?' · '+number(list.length)+'건':group.loading?' · 조회 중':'');b.onclick=()=>onView(mode);scope.append(b);}}
    const disclosure=$('transactionDisclosure');
    if(disclosure){disclosure.hidden=!nearby&&!group.undisclosedCount;disclosure.textContent=nearby?'같은 법정동의 비교 자료입니다. 선택 필지의 거래나 거리순 주변 거래가 아닙니다.':`같은 법정동 ${number(group.undisclosedCount)}건은 지번 식별이 불가능해 해당 필지 거래에 포함하지 않았습니다.`;}
    // Keep actionable loading/error controls only, with no collection-progress prose.
    const paging=$('transactionPaging');
    if(paging){
      paging.className='transaction-paging trade-help';paging.replaceChildren();paging.hidden=!group.loading&&!failed;paging.style.display=paging.hidden?'none':'';
      if(group.loading){const stop=document.createElement('button');stop.type='button';stop.textContent='조회 중단';stop.onclick=onStop;paging.append(stop);}
      else if(failed){const retry=document.createElement('button');retry.type='button';retry.textContent='다시 불러오기';retry.onclick=onReload;paging.append(retry);}
    }
    const status=$('transactionStatus');
    status.dataset.tone=failed?'error':group.loading?'loading':items.length?'success':'';
    status.textContent=failed?'거래 정보를 불러오지 못했습니다. 다시 시도해 주세요.':group.loading?'거래 내역을 불러오는 중입니다.':group.degraded?'분산 수집본 연결 실패 · 중앙 일부만 표시 중입니다. 이 화면의 0건은 거래가 없다는 뜻이 아닙니다.':items.length?'':'확보한 수집 범위에서 해당 거래를 확인하지 못했습니다. 실제 거래가 없다는 뜻이 아닙니다.';
    const newest=sorted(items)[0];
    const priced=items.filter(item=>Number.isFinite(Number(item.amount)) && Number(item.amount)>0);
    const low=priced.length?Math.min(...priced.map(item=>Number(item.amount))):0;
    const high=priced.length?Math.max(...priced.map(item=>Number(item.amount))):0;
    $('transactionStats').innerHTML=newest?[
      ['최근 계약',money(newest.amount),`${text(newest.date).replaceAll('-','.')} · ${number(newest.area,2)}㎡${newest.floor?' · '+newest.floor+'층':''}`],
      ['중위 매매금액',money(medianAmount(items)),`${number(items.length)}건 중위값 · 면적 차이 주의`],
      ['최저 ~ 최고',`${money(low)} ~ ${money(high)}`,'확인된 거래금액의 범위'],
      ['확인된 거래',number(items.length)+'건',nearby?'같은 법정동 비교 · 거리순 아님':'선택 지번의 공개 거래']
    ].map(([a,b,c])=>`<div class="market-stat"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join(''):'';
    const insight=$('transactionInsight');
    insight.hidden=!items.length;
    if (items.length) {
      const areas=new Set(items.map(areaKey).filter(Boolean));
      insight.textContent=areas.size>1
        ? '서로 다른 면적의 거래가 포함돼 있습니다. 아래 면적별 비교를 선택하면 차트·가격·거래목록이 함께 변경됩니다.'
        : '선택한 기간의 실제 신고 거래를 요약합니다. 층수·시점에 따른 가격 차이를 함께 확인하세요.';
    }
    const filters=$('transactionAreaFilters');
    filters.hidden=!options.length;
    filters.replaceChildren();
    if (options.length) {
      const makeButton=(key,label)=>{
        const button=document.createElement('button');button.type='button';button.textContent=label;
        button.className='trade-area-chip';button.setAttribute('aria-pressed',String(selectedArea===key));
        button.onclick=()=>{selectedArea=key;currentPage=1;render(current);};
        filters.append(button);
      };
      makeButton('all',`전체 면적 · ${number(allItems.length)}건`);
      options.forEach(option=>makeButton(option.key,option.label));
    }
    // Chart data and visible transaction list use exactly the same area filter.
    window.TojihannunMarketData?.renderChartForItems?.(items);
    let empty=$('transactionEmpty');if(!empty){empty=document.createElement('div');empty.id='transactionEmpty';empty.className='trade-empty';$('transactionStats').after(empty);}
    empty.hidden=Boolean(items.length);
    const emptyTitle=group.loading?'거래 내역 조회 중':failed?'거래 정보를 읽지 못했습니다':'해당 지번의 거래 자료를 아직 확인하지 못했습니다';
    empty.innerHTML=`<strong>${esc(emptyTitle)}</strong><p>${esc(group.loading?'거래 내역을 불러오고 있습니다.':failed?'네트워크 상태를 확인한 뒤 다시 불러오기를 눌러 주세요.':group.degraded?'분산 저장소 연결이 실패하여 중앙 일부 자료만 조회되었습니다. 실제 거래 존재 여부는 공식 실거래가 시스템에서 확인해 주세요.':'수집 범위 밖 계약이나 미확보 거래가 있을 수 있습니다. 조회 기간 또는 데이터 상태를 확인해 주세요.')}</p>`;
    let sortRow=$('transactionSortRow');if(!sortRow){sortRow=document.createElement('div');sortRow.id='transactionSortRow';sortRow.className='trade-sort';sortRow.innerHTML='<label for="transactionSort">거래 정렬</label><select id="transactionSort"><option value="date-desc">최신 계약순</option><option value="date-asc">과거 계약순</option><option value="amount-desc">금액 높은순</option><option value="amount-asc">금액 낮은순</option><option value="unit-desc">단가 높은순</option></select>';$('transactionList').before(sortRow);$('transactionSort').onchange=e=>{order=e.target.value;currentPage=1;drawList();};}
    $('transactionSort').value=order;
    drawList();
    $('transactionChartToggle').hidden=!items.length;
  }
  window.TojiTransactionUI=Object.freeze({render,reset,coverage,sorted,money,areaOptions,filteredItems,medianAmount,paginationWindow,PAGE_SIZE,VISIBLE_PAGE_BUTTONS});
})();
