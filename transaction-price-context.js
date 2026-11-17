/* Price-context presentation: pure calculations share the exact same cohort and metric.
   No source API calls, price estimates, supply-area conversions or synthetic transactions. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const str = value => String(value ?? '');
  const esc = value => str(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (value, digits = 0) => Number(value).toLocaleString('ko-KR', {maximumFractionDigits:digits});
  const validMonth = value => /^\d{4}(0[1-9]|1[0-2])$/.test(str(value));
  const residential = type => ['apartment','rowHouse','officetel'].includes(type);
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
  const areaKey = item => positive(item?.area) ? String(Math.floor(Number(item.area) + 1e-8)) : 'unknown';
  const areaLabel = (min, max) => min === max ? `${num(min,4)}㎡` : `${num(min,4)}~${num(max,4)}㎡`;
  function areaOptions(items, type) {
    if (!residential(type)) return [];
    const groups = new Map();
    for (const item of items || []) {
      const key = areaKey(item);
      if (key === 'unknown') continue;
      const area = Number(item.area), date = str(item.date);
      const group = groups.get(key) || {key,count:0,min:area,max:area,latest:''};
      group.count++; group.min = Math.min(group.min, area); group.max = Math.max(group.max, area);
      if (date > group.latest) group.latest = date;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a,b) => Number(a.key)-Number(b.key)).map(group => ({
      ...group, label:`전용 ${group.key}㎡대 · ${num(group.count)}건`,
      title:`실제 전용면적 ${areaLabel(group.min,group.max)} · 면적대 묶음이며 같은 평면을 의미하지 않습니다.`
    }));
  }
  function defaultArea(items, type) {
    return [...areaOptions(items,type)].sort((a,b) => b.count-a.count || b.latest.localeCompare(a.latest) || Number(a.key)-Number(b.key))[0]?.key || 'all';
  }
  function filterArea(items, key = 'all') {
    return key === 'all' ? [...items] : items.filter(item => areaKey(item) === key);
  }
  function valueOf(item, metric = 'total') {
    if (!positive(item?.amount)) return null;
    if (metric === 'total') return Number(item.amount); // upstream unit: 만원
    if (!positive(item?.area)) return null;
    return Number(item.amount) / Number(item.area) * (metric === 'area33' ? 3.3 : 1);
  }
  function median(values) {
    const clean = values.filter(value => typeof value === 'number' && Number.isFinite(value)).sort((a,b)=>a-b);
    if (!clean.length) return null;
    const mid = Math.floor(clean.length/2);
    return clean.length % 2 ? clean[mid] : (clean[mid-1]+clean[mid])/2;
  }
  function formatPrice(value, metric = 'total', axis = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '미확인';
    if (metric !== 'total') return `${num(value,1)}${axis ? '' : metric === 'area33' ? '만원/3.3㎡' : '만원/㎡'}`;
    if (axis) return `${num(value/10000,2)}억`;
    const whole = Math.floor(value/10000), rest = Math.round((value-whole*10000)*10)/10;
    return whole ? `${num(whole)}억${rest ? ` ${num(rest,1)}만원` : '원'}` : `${num(value,1)}만원`;
  }
  function metricLabel(metric, areaKind) {
    return metric === 'total' ? '매매총액' : `${areaKind || '면적'} ${metric === 'area33' ? '3.3㎡당 가격' : '㎡당 가격'}`;
  }
  function calendarMonths(first, last) {
    if (!validMonth(first) || !validMonth(last)) return [];
    const out=[]; let year=Number(first.slice(0,4)), month=Number(first.slice(4));
    while (out.length < 300) {
      const key=String(year)+String(month).padStart(2,'0');
      if (key>last) break;
      out.push(key); month++; if(month>12){month=1;year++;}
    }
    return out;
  }
  function model(items, {metric='total',type='apartment',areaKind='전용면적',scope='',selectedArea='all',options=[],coveredMonthKeys=[],allPeriod=false} = {}) {
    const eligible = (items || []).filter(item => !item.cancelled && !item.cancellationDate && !/^(O|Y|1|해제)$/i.test(str(item.cancel)));
    const rows = eligible.filter(item => valueOf(item,metric) !== null).sort((a,b)=>str(b.date).localeCompare(str(a.date)));
    const values = rows.map(item=>valueOf(item,metric));
    const latestDate = str(rows[0]?.date);
    const latestRows = rows.filter(item=>str(item.date)===latestDate);
    const byMonth = new Map();
    for (const item of rows) {
      const month = validMonth(item.month) ? item.month : str(item.date).slice(0,7).replace('-','');
      if(!validMonth(month))continue;
      if(!byMonth.has(month))byMonth.set(month,[]);
      byMonth.get(month).push(valueOf(item,metric));
    }
    // FULL_HISTORY_CHART_V1: full history includes every observed transaction.
    // Do not waste the chart on years before the first known trade. Interior
    // missing months remain explicit gaps, never fabricated zero prices.
    const observed=[...byMonth.keys()].sort();
    const coverage=allPeriod&&observed.length
      ? coveredMonthKeys.filter(key=>key>=observed[0]&&key<=observed.at(-1))
      : coveredMonthKeys;
    const keys=[...new Set([...byMonth.keys(),...coverage.filter(validMonth)])].sort();
    const months=calendarMonths(keys[0],keys.at(-1)).map(month=>{
      const values=byMonth.get(month)||[];
      return {month,count:values.length,value:median(values),low:values.length?Math.min(...values):null,high:values.length?Math.max(...values):null};
    });
    const bands = new Set(rows.map(areaKey));
    const mixed = residential(type) && selectedArea === 'all' && bands.size > 1;
    const selected = options.find(option=>option.key===selectedArea);
    const areaDescription = selected ? `전용 ${selected.key}㎡대 (${areaLabel(selected.min,selected.max)})` : residential(type) ? '전체 전용면적' : areaKind;
    return {rows,values,months,metric,type,areaKind,scope,selectedArea,mixed,areaDescription,
      label:metricLabel(metric,areaKind), count:rows.length,excluded:eligible.length-rows.length,
      latestDate,latestRows,median:median(values),low:values.length?Math.min(...values):null,high:values.length?Math.max(...values):null,
      oldestDate:str(rows.at(-1)?.date),smallSample:rows.length>0&&rows.length<3};
  }
  function rangeText(values, metric) {
    if(!values.length)return '미확인';
    const low=Math.min(...values), high=Math.max(...values);
    return low===high ? formatPrice(low,metric) : `${formatPrice(low,metric)} ~ ${formatPrice(high,metric)}`;
  }
  function summaryRows(data) {
    if(!data.count)return [];
    const latest = data.latestRows[0];
    const lastNote=data.latestRows.length===1
      ? `${data.latestDate.replaceAll('-','.')} · ${data.areaKind} ${num(latest.area,4)}㎡${latest.floor?' · '+latest.floor+'층':''}`
      : `${data.latestDate.replaceAll('-','.')} 같은 날 ${num(data.latestRows.length)}건의 범위`;
    // SINGLE_TRADE_PRESENTATION_V1: one observed price is not four statistics.
    if(data.count===1){
      const facts=[latest.buildingName,lastNote,latest.dealType,latest.jimok,latest.landUse,latest.buildingUse];
      if(data.metric!=='total')facts.push('매매총액 '+formatPrice(Number(latest.amount),'total'));
      return [[data.metric==='total'?'확인된 계약 1건':'확인된 계약 1건 · '+data.label,
        formatPrice(data.values[0],data.metric),facts.filter(Boolean).join(' · ')]];
    }
    return [
      [`최근 계약${data.metric==='total'?'금액':'단가'}`,rangeText(data.latestRows.map(item=>valueOf(item,data.metric)),data.metric),lastNote],
      [data.mixed?'혼합 거래 중앙값':data.metric==='total'?'대표 거래금액':'대표 거래단가',formatPrice(data.median,data.metric),`${num(data.count)}건을 가격순으로 놓은 중앙값${data.smallSample?' · 표본 적음':''}`],
      ['조회기간 최저 ~ 최고',rangeText(data.values,data.metric),'현재 선택한 면적·기간 내 신고가격 범위'],
      ['비교에 사용한 거래',`${num(data.count)}건`,`${data.oldestDate.replaceAll('-','.')} ~ ${data.latestDate.replaceAll('-','.')}`]
    ];
  }
  function renderSummary(data) {
    const stats=$('transactionStats');
    if(stats){stats.dataset.metric=data.metric;stats.dataset.cohortCount=String(data.count);stats.innerHTML=summaryRows(data).map(([label,value,note])=>`<div class="market-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('');}
    if(stats){stats.dataset.sampleState=data.count===1?'single':data.count?'multiple':'empty';stats.hidden=!data.count;}
    const context=$('transactionPriceContext');
    if(context){context.hidden=!data.count;context.textContent=`${data.scope} · ${data.areaDescription} · ${data.label} 기준 · ${num(data.count)}건`;}
    const insight=$('transactionInsight');
    if(insight){
      insight.hidden=!data.count;
      const messages=[];
      if(data.count===1)messages.push('선택한 조건에서 확인된 거래가 1건입니다. 한 건의 신고가격만으로 현재 시세나 가격 흐름을 판단할 수 없습니다.');
      else if(data.mixed)messages.push('서로 다른 면적을 합친 분포입니다. 가격 수준을 비교하려면 전용면적을 하나 선택하세요.');
      else messages.push('위 요약·아래 차트·거래목록은 같은 면적 선택과 같은 가격 기준입니다.');
      if(data.metric!=='total')messages.push(`${data.areaKind}으로 나눈 가격입니다.${data.areaKind==='전용면적'?' 공급면적 기준 평당가와 다릅니다.':''}`);
      if(data.smallSample&&data.count!==1)messages.push('거래가 적어 일반 시세를 대표하지 않을 수 있습니다.');
      if(data.excluded)messages.push(`면적·금액 미확인 ${num(data.excluded)}건은 단가 계산에서 제외했습니다.`);
      insight.textContent=messages.join(' ');
    }
  }
  let lastModel=null, resizeFrame=0;
  function monthText(point,data) {
    const label=`${point.month.slice(0,4)}.${point.month.slice(4)}`;
    if(!point.count)return `${label} · 표시 자료 없음 (가격 0 아님)`;
    return `${label} · ${num(point.count)}건 · ${point.count===1?'신고가격':'중앙값'} ${formatPrice(point.value,data.metric)} · 범위 ${rangeText([point.low,point.high],data.metric)}${point.count<3?' · 표본 적음':''}`;
  }
  function renderChart(data) {
    lastModel=data;
    const host=$('transactionChart'),card=$('transactionChartCard'),details=$('transactionChartToggle');
    if(!host||!card)return;
    const points=data.months.filter(point=>point.count);
    const showChart=data.count>1&&points.length>0;
    card.dataset.metric=data.metric;card.dataset.cohortCount=String(data.count);
    card.hidden=!showChart;
    if(details)details.hidden=!showChart;
    if(!showChart){
      host.replaceChildren();host.scrollLeft=0;
      host.dataset.historyScroll='false';delete host.dataset.historyKey;
      host.style.removeProperty('--history-chart-width');
      $('transactionMonthReadout')?.remove();
      $('transactionPriceCaveat')?.remove();
      if($('transactionChartMeta'))$('transactionChartMeta').textContent='';
      return;
    }
    const heading=data.mixed?'월별 신고가격 분포':data.metric==='total'?'월별 매매금액':'월별 면적당 가격';
    if($('transactionChartTitle'))$('transactionChartTitle').textContent=heading;
    const unit=card.querySelector('.market-section-head > small');
    if(unit)unit.textContent=data.metric==='total'?'매매총액 · 억원':data.metric==='area33'?'만원/3.3㎡':'만원/㎡';
    const kicker=card.querySelector('.market-section-head > div > span');
    if(kicker)kicker.textContent=data.areaDescription;
    if(details?.querySelector('summary'))details.querySelector('summary').innerHTML=`${esc(heading)} 보기 <small>${esc(data.label)} · ${data.mixed?'혼합면적 대표선 표시 안 함':'월별 중앙값과 거래가격 범위'}</small>`;
    const viewportWidth=Math.max(270,Math.min(760,host.clientWidth||520));
    const scrollable=data.months.length>24;
    const width=scrollable?Math.max(viewportWidth,(data.months.length-1)*30+80):viewportWidth,height=238;
    const previousScroll=host.scrollLeft;
    const chartKey=[data.scope,data.selectedArea,data.metric,data.months[0]?.month,data.months.at(-1)?.month].join('|');
    const changed=host.dataset.historyKey!==chartKey;
    host.dataset.historyScroll=String(scrollable);
    host.dataset.historyKey=chartKey;
    host.style.setProperty('--history-chart-width',width+'px');
    const pad={left:58,right:22,top:24,bottom:45},cw=width-pad.left-pad.right,ch=height-pad.top-pad.bottom;
    const highest=Math.max(...points.map(point=>point.high));
    const magnitude=Math.pow(10,Math.floor(Math.log10(highest||1)));
    const top=Math.ceil((highest||1)/magnitude*4)/4*magnitude*1.05;
    const x=index=>data.months.length===1?pad.left+cw/2:pad.left+index/(data.months.length-1)*cw;
    const y=value=>pad.top+ch-(value/top)*ch;
    const grid=[0,.25,.5,.75,1].map(ratio=>`<line class="market-chart-grid" x1="${pad.left}" x2="${width-pad.right}" y1="${y(top*ratio)}" y2="${y(top*ratio)}"/><text class="market-chart-label" x="${pad.left-8}" y="${y(top*ratio)+4}" text-anchor="end">${esc(formatPrice(top*ratio,data.metric,true))}</text>`).join('');
    const labelStep=scrollable?6:Math.max(1,Math.ceil(data.months.length/(width<380?4:6)));
    const showPointValues=points.length<=8;
    let path='',previous=false;
    const markers=data.months.map((point,index)=>{
      const xx=x(index),label=index%labelStep===0||index===data.months.length-1;
      const labelSvg=label?`<text class="market-chart-label" x="${xx}" y="${height-25}" text-anchor="middle">${point.month.slice(2,4)}.${point.month.slice(4)}</text><text class="price-chart-count" x="${xx}" y="${height-9}" text-anchor="middle">${point.count?point.count+'건':'미확인'}</text>`:'';
      if(!point.count){previous=false;return labelSvg;}
      if(!data.mixed)path+=`${previous?'L':'M'}${xx.toFixed(1)},${y(point.value).toFixed(1)} `;
      previous=true;
      const title=monthText(point,data);
      const pointValue=showPointValues?`<text class="price-chart-value" x="${xx}" y="${Math.max(14,y(point.high)-10)}" text-anchor="middle">${esc(formatPrice(point.value,data.metric,true))}</text>`:'';
      return labelSvg+`<g class="price-month-point" data-month-index="${index}" tabindex="0" role="button" aria-label="${esc(title)}"><title>${esc(title)}</title><rect x="${xx-15}" y="${pad.top}" width="30" height="${ch}" fill="transparent"/><line class="price-chart-range" x1="${xx}" x2="${xx}" y1="${y(point.low)}" y2="${y(point.high)}"/><line class="price-chart-range" x1="${xx-5}" x2="${xx+5}" y1="${y(point.low)}" y2="${y(point.low)}"/><line class="price-chart-range" x1="${xx-5}" x2="${xx+5}" y1="${y(point.high)}" y2="${y(point.high)}"/><circle class="market-chart-dot${point.count<3?' small-sample':''}" cx="${xx}" cy="${y(point.value)}" r="5"/>${pointValue}</g>`;
    }).join('');
    host.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${esc(heading+' · '+data.label+' · 세로축 0부터. '+points.map(point=>monthText(point,data)).join('; '))}">${grid}${!data.mixed?`<path class="market-chart-line" d="${path}"/>`:''}${markers}</svg>`;
    // Focus the last OBSERVED trade, not an empty recent coverage month.
    const lastObservedIndex=data.months.findLastIndex(point=>point.count>0);
    const lastObservedOffset=Math.max(0,x(lastObservedIndex)-(host.clientWidth||viewportWidth)/2);
    host.scrollLeft=scrollable?(changed?lastObservedOffset:previousScroll):0;
    let readout=$('transactionMonthReadout');
    if(!readout){readout=document.createElement('p');readout.id='transactionMonthReadout';readout.className='price-month-readout';readout.setAttribute('role','status');host.after(readout);}
    readout.textContent=monthText(points.at(-1),data);
    host.querySelectorAll('[data-month-index]').forEach(node=>{
      const select=()=>{readout.textContent=monthText(data.months[Number(node.dataset.monthIndex)],data);};
      node.addEventListener('click',select);node.addEventListener('focus',select);
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});
    });
    const meta=$('transactionChartMeta');
    if(meta)meta.textContent=`점: ${data.mixed?'혼합 거래 중앙값':'월별 중앙값'} · 세로선: 최저~최고 · ${data.mixed?'면적 혼합으로 연결선 숨김':'자료 없는 월은 연결하지 않음'} · 세로축 0부터`;
    if(meta&&scrollable)meta.textContent+=' · 전체 기간 차트: 좌우로 이동해 과거 월 확인';
    let caveat=$('transactionPriceCaveat');
    if(!caveat){caveat=document.createElement('p');caveat.id='transactionPriceCaveat';caveat.className='price-caveat';card.append(caveat);}
    caveat.textContent='신고된 거래의 분포이지 시세지수가 아닙니다. 같은 면적대라도 층·향·동·상태에 따라 가격이 다르며, 최근 계약월은 추가 신고·취소로 바뀔 수 있습니다.';
  }
  window.addEventListener?.('resize',()=>{
    if(!lastModel)return;
    if(resizeFrame)window.cancelAnimationFrame(resizeFrame);
    resizeFrame=window.requestAnimationFrame(()=>{resizeFrame=0;renderChart(lastModel);});
  });
  window.TojiPriceContext=Object.freeze({areaKey,areaOptions,defaultArea,filterArea,valueOf,median,formatPrice,metricLabel,calendarMonths,model,summaryRows,renderSummary,renderChart,residential});
})();
