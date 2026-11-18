// PARCEL_COMPARISON_20261117: keep comparable and exact transactions explicitly separated.
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
  function hasBlockingFailure(group) {
    return Boolean(group.error || (group.staticError && !group.regionalCovered));
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

  // UNIFIED_PRICE_CONTEXT_V1: one price basis and one cohort for all visible analytics.
  const pricing=window.TojiPriceContext;
  let priceMode='total',areaSelectionManual=false;
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
  const areaKey = item => pricing.areaKey(item);
  const medianAmount = items => {
    const amounts = items.map(item => Number(item.amount)).filter(n => Number.isFinite(n) && n > 0).sort((a,b)=>a-b);
    if (!amounts.length) return 0;
    const middle = Math.floor(amounts.length / 2);
    return amounts.length % 2 ? amounts[middle] : (amounts[middle - 1] + amounts[middle]) / 2;
  };
  function areaOptions(items,type){return pricing.areaOptions(items,type);}
  function filteredItems(items,options=[],area=selectedArea){return pricing.filterArea(items,area);}
  function mountPriceControls(){
  if(!$('transactionPricingControls')){
    const controls=document.createElement('section');controls.id='transactionPricingControls';controls.className='trade-pricing-controls';
    controls.setAttribute('aria-label','실거래 비교 기준');
    controls.innerHTML='<div class="price-control-heading"><strong>비교할 전용면적</strong><small id="transactionAreaSelectionNote"></small></div><label class="price-metric-label" for="transactionPriceMetric">가격 표시 기준<select id="transactionPriceMetric"><option value="total">매매총액 · 억/만원</option><option value="sqm">면적 ㎡당 가격</option><option value="area33">면적 3.3㎡당 가격</option></select></label>';
    $('transactionStats').before(controls);
    controls.querySelector('.price-metric-label').before($('transactionAreaFilters'));
    const context=document.createElement('p');context.id='transactionPriceContext';context.className='trade-price-context';
    controls.after(context);
    $('transactionPriceMetric').onchange=event=>{priceMode=event.target.value;currentPage=1;render(current);};
  }
}
  function renderPriceControls(allItems,options,definition){
  const controls=$('transactionPricingControls');
  controls.hidden=!allItems.length;
  controls.querySelector('.price-control-heading strong').textContent=`비교할 ${definition.areaKind}`;
  // SINGLE_TRADE_PRESENTATION_V1: no competing area choices for one available row.
  const singleAvailableTrade=allItems.length===1;
  const filters=$('transactionAreaFilters');filters.replaceChildren();filters.hidden=!options.length||singleAvailableTrade;
  controls.querySelector('.price-control-heading').hidden=!options.length||singleAvailableTrade;
  $('transactionAreaSelectionNote').textContent=areaSelectionManual?'선택한 면적 기준':'거래가 많은 면적 자동 선택';
  const choose=key=>{selectedArea=key;areaSelectionManual=true;currentPage=1;render(current);};
  const makeButton=(key,label,title)=>{
    const button=document.createElement('button');button.type='button';button.className='trade-area-chip';button.textContent=label;
    button.title=title||label;button.dataset.areaKey=key;button.setAttribute('aria-pressed',String(selectedArea===key));
    button.onclick=()=>{choose(key);$('transactionAreaFilters').querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});};
    filters.append(button);
  };
  if(options.length){
    makeButton('all',`전체 면적 · ${number(allItems.length)}건`,'혼합 면적의 분포입니다. 하나의 면적 시세로 해석하지 마세요.');
    const frequent=[...options].sort((a,b)=>b.count-a.count||b.latest.localeCompare(a.latest)).slice(0,4);
    const selected=options.find(option=>option.key===selectedArea);
    if(selected&&!frequent.some(option=>option.key===selected.key))frequent.splice(3,1,selected);
    frequent.sort((a,b)=>Number(a.key)-Number(b.key)).forEach(option=>makeButton(option.key,option.label,option.title));
    if(options.length>4){
      const label=document.createElement('label');label.className='price-all-areas';label.textContent='다른 전용면적 ';
      const select=document.createElement('select');select.setAttribute('aria-label','모든 전용면적대');
      select.innerHTML='<option value="all">전체 면적 (혼합)</option>'+options.map(option=>`<option value="${esc(option.key)}">${esc(option.label+' · '+option.title.split(' · ')[0])}</option>`).join('');
      select.value=selectedArea;select.onchange=event=>choose(event.target.value);label.append(select);filters.append(label);
    }
  }
  const selector=$('transactionPriceMetric');selector.value=priceMode;
  selector.querySelector('[value="sqm"]').textContent=`${definition.areaKind} ㎡당 가격`;
  selector.querySelector('[value="area33"]').textContent=`${definition.areaKind} 3.3㎡당 가격`;
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
      if (saved) saved.textContent = '전체 기간';
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
      $('transactionStats').after(details);details.append($('transactionChartCard'));
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
    mountPriceControls();
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
    current=null;lastKey='';currentPage=1;order='date-desc';selectedArea='all';areaSelectionManual=false;priceMode='total';
    $('transactionChartToggle')?.setAttribute('open','');
    if ($('transactionAreaFilters')) $('transactionAreaFilters').replaceChildren();
    if($('transactionChartToggle'))$('transactionChartToggle').hidden=true;
    $('transactionEmpty')?.remove();$('transactionSortRow')?.remove();
    for(const id of ['transactionPricingControls','transactionPriceContext','transactionInsight'])if($(id))$(id).hidden=true;
    $('refreshTransactions').disabled=false;panel.removeAttribute('aria-busy');
  }
  function canOpenParcel(item,view) {
    return view==='nearby' && /^(?:산\s*)?\d+(?:-\d+)?$/.test(text(item?.jibun).trim());
  }
  function drawList() {
    if(!current)return;
    const {group,view,definition}=current;
    const raw=view==='nearby'?group.comparable:group.items;
    const items=sorted(filteredItems(raw,areaOptions(raw,current.type)).filter(item=>pricing.valueOf(item,priceMode)!==null),order);
    const host=$('transactionList');
    const paging=paginationWindow(items.length,currentPage);
    currentPage=paging.page;
    const visibleItems=items.slice(paging.firstIndex,paging.lastIndex);
    host.innerHTML=visibleItems.map((item,index) => {
      const name=item.buildingName || [item.umdNm,item.jibun || '지번 미공개'].filter(Boolean).join(' ');
      const address=[item.umdNm,item.jibun].filter(Boolean).join(' ');
      const scope=item.exact?'공개 지번 일치':item.inferred?`조건 일치 추정 · ${(item.inferredEvidence||[]).join(' · ')}`:item.sameComplex?'동일 단지 거래':item.jibun?'같은 법정동 비교':'지번 미공개 · 필지 미확정';
      const extras=[item.dealType,item.jimok,item.landUse,item.buildingUse].filter(Boolean);
      const openable=canOpenParcel(item,view);
      const openAttributes=openable?` data-open-parcel-index="${index}" role="button" tabindex="0" aria-label="${esc([item.date,name,money(item.amount),scope,'해당 필지 보기'].join(' · '))}"`:` aria-label="${esc([item.date,name,money(item.amount),scope].join(' · '))}"`;
      return `<article class="trade-row trade-row--compact${openable?' trade-row--openable':''}"${openAttributes}>
        <div class="trade-row-top"><time datetime="${esc(item.date)}">${esc(text(item.date).replaceAll('-','.'))}</time><strong>${esc(pricing.formatPrice(pricing.valueOf(item,priceMode),priceMode))}</strong></div>
        <div class="trade-row-inline">
          <strong class="trade-row-name" title="${esc(name)}">${esc(name)}</strong>
          ${address && address!==name ? `<span class="trade-row-address" title="${esc(address)}">${esc(address)}</span>` : ''}
          ${Number(item.area)>0 ? `<span class="trade-row-fact">${esc(definition.areaKind)} ${esc(number(item.area,2))}㎡</span>` : ''}
          ${item.floor ? `<span class="trade-row-fact">${esc(item.floor)}층</span>` : ''}
          ${priceMode!=='total' ? `<span class="trade-row-fact">매매총액 ${esc(money(item.amount))}</span>` : ''}
          ${extras.map(value=>`<span class="trade-row-fact">${esc(value)}</span>`).join('')}
          <span class="trade-row-scope-chip${item.exact||item.inferred||item.sameComplex?'':' neutral'}" title="${esc(scope)}">${item.exact?'지번 일치':item.inferred?'추정 일치':item.sameComplex?'동일 단지':item.jibun?'같은 동 비교':'지번 미확정'}</span>
          ${openable?'<span class="trade-row-open-hint" aria-hidden="true">필지 보기 ›</span>':''}
        </div>
      </article>`;
    }).join('');
    host.querySelectorAll('[data-open-parcel-index]').forEach(row=>{
      const open=()=>current?.onSelectParcel?.(visibleItems[Number(row.dataset.openParcelIndex)]);
      row.addEventListener('click',open);
      row.addEventListener('keydown',event=>{
        if(event.key!=='Enter'&&event.key!==' ')return;
        event.preventDefault();open();
      });
    });
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
    // The sole contract is already shown in full in the summary card.
    $('transactionListSection').hidden=items.length<=1;
    if($('transactionSortRow'))$('transactionSortRow').hidden=items.length<=1;
  }
  function render(props) {
    const panel=mount();if(!panel)return;
    current=props;
    const {group,definition,view,type,period,onView,onReload,onStop}=props;
    const key=[group.scope,type,period,view].join('|');
    if(key!==lastKey){lastKey=key;currentPage=1;order='date-desc';selectedArea='all';areaSelectionManual=false;priceMode=type==='land'?'sqm':'total';}
    const nearby=view==='nearby', allItems=nearby?group.comparable:group.items;
    const options=areaOptions(allItems,type);
    if(!areaSelectionManual)selectedArea=pricing.defaultArea(allItems,type);
    if(selectedArea!=='all'&&!options.some(option=>option.key===selectedArea)&&!areaSelectionManual)selectedArea='all';
    const items=filteredItems(allItems,options).filter(item=>pricing.valueOf(item,priceMode)!==null);
    const failed=hasBlockingFailure(group);
    const partialStored=Boolean(group.degraded && !group.officialCovered);
    panel.setAttribute('aria-busy',String(Boolean(group.loading)));
    $('refreshTransactions').disabled=Boolean(group.loading);
    $('transactionHeading').textContent=`${definition.label} 매매 실거래`;
    const displayScope=nearby?group.regionScope||group.scope:group.scope;
    $('transactionAreaLabel').textContent=`${displayScope} · ${nearby?'같은 법정동 비교':group.inferredCount?'선택 지번·조건 일치 추정 기준':group.complexCount?'선택 지번·동일 단지 기준':'선택 지번 기준'}`;
    const scope=$('transactionScopeSwitch');
    if(scope){
      scope.className='transaction-scope-switch';scope.replaceChildren();
      for(const [mode,label,list]of[['parcel',group.inferredCount?'해당 지번·추정 포함':group.complexCount?'해당 지번·동일 단지':'해당 지번',group.items],['nearby','같은 법정동 비교',group.comparable]]){
        const b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',String(view===mode));
        b.disabled=group.regionIdentified===false || (mode==='parcel' && group.parcelIdentified===false);
        const unavailable=group.regionIdentified===false?' · 지역 미확인':mode==='parcel'&&group.parcelIdentified===false?' · 지번 미확인':'';
        b.textContent=label+(unavailable || (list.length?' · '+number(list.length)+'건':group.loading?' · 조회 중':''));
        b.onclick=()=>onView(mode);scope.append(b);
      }
    }
    const disclosure=$('transactionDisclosure');
    if(disclosure){
      const inferredNotice=group.inferredCount?`면적·지목·용도지역·마스킹 지번이 모두 일치한 ${number(group.inferredCount)}건을 추정 거래로 표시합니다. 공개 지번이 가려져 있어 해당 필지 거래로 확정할 수 없습니다.`:'';
      const complexNotice=group.complexCount?`${group.complexName||'같은 건물명'}의 동일 단지 거래 ${number(group.complexCount)}건을 함께 표시합니다. 공개 지번 ${group.complexLots?.join(', ')||'미확인'}이며 선택 필지 직접 거래와 구분됩니다.`:'';
      disclosure.hidden=!nearby&&!group.undisclosedCount&&!complexNotice&&!inferredNotice;
      disclosure.textContent=nearby?(group.autoNearby?'해당 지번·동일 단지 거래를 확인하지 못해 같은 법정동 비교를 표시합니다. 선택 필지의 거래나 거리순 주변 거래가 아닙니다.':'같은 법정동의 비교 자료입니다. 선택 필지의 거래나 거리순 주변 거래가 아닙니다.'):(inferredNotice||complexNotice||`같은 법정동 ${number(group.undisclosedCount)}건은 지번 식별이 불가능해 해당 필지 거래에 포함하지 않았습니다.`);
    }
    // Keep actionable loading/error controls only, with no collection-progress prose.
    const paging=$('transactionPaging');
    if(paging){
      paging.className='transaction-paging trade-help';paging.replaceChildren();paging.hidden=!group.loading&&!failed;paging.style.display=paging.hidden?'none':'';
      if(group.loading){const stop=document.createElement('button');stop.type='button';stop.textContent='조회 중단';stop.onclick=onStop;paging.append(stop);}
      else if(failed){const retry=document.createElement('button');retry.type='button';retry.textContent='다시 불러오기';retry.onclick=onReload;paging.append(retry);}
    }
    const status=$('transactionStatus');
    status.dataset.tone=failed?'error':group.loading?'loading':items.length?'success':'';
    status.textContent=group.identityError?group.error:failed?'거래 정보를 불러오지 못했습니다. 다시 시도해 주세요.':group.loading?'거래 내역을 불러오는 중입니다.':items.length?'':partialStored?'저장된 일부 기간의 자료만 확인했습니다. 실제 거래가 없다는 뜻은 아닙니다.':'확보한 수집 범위에서 해당 거래를 확인하지 못했습니다. 실제 거래가 없다는 뜻이 아닙니다.';
    const priceModel=pricing.model(items,{metric:priceMode,type,areaKind:definition.areaKind,scope:displayScope,selectedArea,options,coveredMonthKeys:group.coveredMonthKeys||[],allPeriod:period==='saved'});
    $('transactionPriceContext').hidden=!items.length;
    $('transactionInsight').hidden=!items.length;
    renderPriceControls(allItems,options,definition);
    pricing.renderSummary(priceModel);
    try {
      pricing.renderChart(priceModel);
    } catch(error) {
      console.error('Transaction chart render failed',error);
      const chart=$('transactionChart');
      if(chart)chart.innerHTML='<p class="price-chart-error">차트를 표시하지 못했습니다. 거래 목록은 계속 확인할 수 있습니다.</p>';
      if($('transactionChartMeta'))$('transactionChartMeta').textContent='차트 표시 오류 · 거래 목록과 조회 결과는 유지됩니다.';
    }
    let empty=$('transactionEmpty');if(!empty){empty=document.createElement('div');empty.id='transactionEmpty';empty.className='trade-empty';$('transactionStats').after(empty);}
    empty.hidden=Boolean(items.length);
    const emptyTitle=group.identityError?'조회할 지역을 확인하지 못했습니다':group.loading?'거래 내역 조회 중':failed?'거래 정보를 읽지 못했습니다':nearby?'같은 법정동의 거래 자료를 아직 확인하지 못했습니다':'해당 지번의 거래 자료를 아직 확인하지 못했습니다';
    empty.innerHTML=`<strong>${esc(emptyTitle)}</strong><p>${esc(group.identityError?group.error:group.loading?'거래 내역을 불러오고 있습니다.':failed?'네트워크 상태를 확인한 뒤 다시 불러오기를 눌러 주세요.':partialStored?'저장된 일부 기간만 확인된 상태입니다. 조회 기간을 바꾸거나 다시 불러와 주세요.':'수집 범위 밖 계약이나 미확보 거래가 있을 수 있습니다. 조회 기간 또는 데이터 상태를 확인해 주세요.')}</p>`;
    let sortRow=$('transactionSortRow');if(!sortRow){sortRow=document.createElement('div');sortRow.id='transactionSortRow';sortRow.className='trade-sort';sortRow.innerHTML='<label for="transactionSort">거래 정렬</label><select id="transactionSort"><option value="date-desc">최신 계약순</option><option value="date-asc">과거 계약순</option><option value="amount-desc">금액 높은순</option><option value="amount-asc">금액 낮은순</option><option value="unit-desc">단가 높은순</option></select>';$('transactionList').before(sortRow);$('transactionSort').onchange=e=>{order=e.target.value;currentPage=1;drawList();};}
    $('transactionSort').value=order;
    $('transactionSort').querySelector('[value="unit-desc"]').textContent='면적당 가격 높은순';
    $('transactionListTitle').textContent=priceMode==='total'?'매매 거래목록':'면적당 가격 비교 목록';
    drawList();
    $('transactionChartToggle').hidden=priceModel.count<=1;
  }
  window.TojiTransactionUI=Object.freeze({render,reset,coverage,hasBlockingFailure,sorted,money,areaOptions,filteredItems,medianAmount,paginationWindow,canOpenParcel,PAGE_SIZE,VISIBLE_PAGE_BUTTONS});
})();
