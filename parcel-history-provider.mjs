// Server-only opt-in adapter. Never expose JWT credentials through runtime-config.js.
// Official contract: https://docs.bigvalue.ai/data/data/realdeal/
const ENDPOINT = 'https://api.bigvalue.co.kr/api/bv-platform/realdeal/pnu';
const TYPES = new Set(['land','apartment','rowHouse','officetel','detached','commercial','factory']);
export class HistoryError extends Error {
  constructor(code, status=502) { super(code); this.code=code; this.status=status; }
}
function validDate(value) {
  if (!/^20\d{6}$/.test(value || '')) return false;
  const date = new Date(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0,10).replaceAll('-','') === value;
}
export function validateHistoryRequest(body) {
  const {pnu,start_date,end_date,type} = body || {};
  if (!/^\d{10}[12]\d{8}$/.test(pnu || '') || !validDate(start_date) || !validDate(end_date) || start_date > end_date || start_date < '20060101' || !TYPES.has(type)) throw new HistoryError('INVALID_REQUEST',400);
  return {pnu,start_date,end_date,type};
}
function transactionType(name) {
  const value=String(name || '');
  if (/아파트/.test(value)) return 'apartment';
  if (/연립|다세대/.test(value)) return 'rowHouse';
  if (/오피스텔/.test(value)) return 'officetel';
  if (/단독|다가구/.test(value)) return 'detached';
  if (/상업|업무|상가/.test(value)) return 'commercial';
  if (/공장|창고/.test(value)) return 'factory';
  if (/토지/.test(value)) return 'land';
  return '';
}
export async function queryParcelHistory(body, {token=process.env.BIGVALUE_JWT,priceUnit=process.env.BIGVALUE_PRICE_UNIT,fetchImpl=fetch}={}) {
  const request=validateHistoryRequest(body);
  // Price units must be confirmed against the contracted product before enabling it.
  if (!token || !['won','manwon'].includes(priceUnit)) throw new HistoryError('PARCEL_HISTORY_NOT_CONFIGURED',503);
  let response;
  try {
    response=await fetchImpl(ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({REQUEST_DATA:[{pnu:request.pnu,start_date:request.start_date,end_date:request.end_date}]}),signal:AbortSignal.timeout(8000)});
  } catch {throw new HistoryError('PROVIDER_UNAVAILABLE',502);}
  if (!response.ok) throw new HistoryError(response.status===429?'PROVIDER_RATE_LIMIT':'PROVIDER_UNAVAILABLE',response.status===429?429:502);
  let data;try {data=await response.json();} catch {throw new HistoryError('INVALID_PROVIDER_RESPONSE');}
  if (!Array.isArray(data.DATA) || data.DATA.length > 5000) throw new HistoryError('INVALID_PROVIDER_RESPONSE');
  const seen=new Set(); const items=[];
  for (const row of data.DATA) {
    const date=String(row.contract_date || '').replaceAll('-','');
    if (String(row.pnu)!==request.pnu || !validDate(date) || date<request.start_date || date>request.end_date || row.deal_division_name!=='매매' || transactionType(row.house_division_name)!==request.type || (row.cancel_date && row.cancel_date!=='-')) continue;
    const price=Number(row.price);const amount=priceUnit==='won'?price/10000:price;
    // Do not substitute land area for a building's missing floor area.
    const area=Number(request.type==='land'?row.land_area:row.private_area || row.building_area);
    if (!(amount>0) || !(area>0)) continue;
    const id=row.deal_number && `${row.deal_number}:${row.deal_building_number || ''}`;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const main=Number(request.pnu.slice(11,15)),sub=Number(request.pnu.slice(15,19));
    items.push({type:request.type,pnu:request.pnu,id:id || '',date:`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,month:date.slice(0,6),amount,area,unitPrice:amount/area,
      jibun:`${request.pnu[10]==='2'?'산':''}${main}${sub?'-'+sub:''}`,buildingName:String(row.complex_name || ''),floor:String(row.floor_name || ''),source:'BigValue',lotDisclosed:true});
  }
  return {pnu:request.pnu,source:'BigValue',items:items.sort((a,b)=>b.date.localeCompare(a.date)),queriedPeriod:{from:request.start_date,to:request.end_date},historyComplete:false,
    notice:'계약된 데이터 공급 범위의 결과입니다. 요청 기간 전체의 누락 없는 이력은 별도 검증이 필요합니다.'};
}
