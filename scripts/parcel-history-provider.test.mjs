import test from 'node:test';
import assert from 'node:assert/strict';
import {queryParcelHistory,validateHistoryRequest} from '../parcel-history-provider.mjs';
const body={pnu:'4121010100101580217',start_date:'20060101',end_date:'20261108',type:'commercial'};
const sample={pnu:body.pnu,deal_division_name:'매매',house_division_name:'상업업무',contract_date:'20200815',price:310000000,private_area:59.7,floor_name:'3',deal_number:42,deal_building_number:1};
test('unconfigured PNU route never calls a paid provider',async()=>{
 let called=false;await assert.rejects(queryParcelHistory(body,{token:'',priceUnit:'won',fetchImpl:async()=>{called=true;}}),e=>e.status===503);assert.equal(called,false);
});
test('PNU and whole period are sent in one server-side call; credentials not returned',async()=>{
 let calls=0;
 const data=await queryParcelHistory(body,{token:'server-only-JWT',priceUnit:'won',fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://api.bigvalue.co.kr/api/bv-platform/realdeal/pnu');assert.equal(options.headers.Authorization,'Bearer server-only-JWT');
  assert.deepEqual(JSON.parse(options.body),{REQUEST_DATA:[{pnu:body.pnu,start_date:'20060101',end_date:'20261108'}]});
  return Response.json({DATA_COUNT:1,DATA:[sample]});
 }});
 assert.equal(calls,1);assert.equal(data.items[0].amount,31000);assert.equal(data.items[0].jibun,'158-217');assert.equal(data.historyComplete,false);assert.ok(!JSON.stringify(data).includes('server-only-JWT'));
});
test('other parcels, rental transactions, future dates and cancelled sales are never exact results',async()=>{
 const data=await queryParcelHistory(body,{token:'test',priceUnit:'manwon',fetchImpl:async()=>Response.json({DATA:[sample,{...sample,pnu:'4121010100101580216'},{...sample,deal_division_name:'전세'},{...sample,cancel_date:'20200820'},{...sample,contract_date:'20270101'}]})});
 assert.equal(data.items.length,1);
});
test('invalid dates, backwards periods and arbitrary type requests fail validation',()=>{
 for(const value of [{...body,pnu:'file:///secret'},{...body,start_date:'20260230'},{...body,start_date:'20270101'},{...body,type:'admin'}]) assert.throws(()=>validateHistoryRequest(value));
});
test('provider errors never reveal tokens and do not start a monthly fallback',async()=>{
 let calls=0;await assert.rejects(queryParcelHistory(body,{token:'private',priceUnit:'won',fetchImpl:async()=>{calls++;return new Response('',{status:429});}}),e=>e.status===429&&!e.message.includes('private'));assert.equal(calls,1);
});
test('ambiguous price unit is not silently interpreted',async()=>{
 await assert.rejects(queryParcelHistory(body,{token:'test',priceUnit:'unknown'}),e=>e.status===503);
});
