import fs from "node:fs/promises";
import path from "node:path";
const key=process.env.MOLIT_API_KEY;
if(!key)throw Error("MOLIT_API_KEY is required");
const file="data/transactions/status-manifest.json",m=JSON.parse(await fs.readFile(file,"utf8"));
const region=m.regions.find(r=>r.code==="41"),district=region.districts.find(d=>d.code==="41210");
const endpoints={rowHouse:"RTMSDataSvcRHTrade2/getRTMSDataSvcRHTrade2",apartment:"RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",land:"RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade",commercial:"RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade"};
const start=Number(process.env.START_YEAR||"2025"),end=Number(process.env.END_YEAR||"2006");
const limit=Math.max(1,Math.min(24,Number(process.env.MONTH_LIMIT||"12")));
const tasks=[];
for(let y=start;y>=end;y--)for(let mm=12;mm>=1;mm--)for(const type of Object.keys(endpoints)){
 const month=String(y)+String(mm).padStart(2,"0");
 if(y===2026&&Number(month)>202611)continue;
 const t=district.types.find(x=>x.type===type);
 if(t?.months?.some(x=>x.month===month&&x.status==="complete"))continue;
 tasks.push({month,type});
}
const batch=tasks.slice(0,limit),at=new Date().toISOString();
m.collection.lastAttemptAt=at;m.collection.status="running";m.collection.active={at,scope:"광명시 과거 실거래",planned:batch.length,completed:0};m.generatedAt=at;
await fs.writeFile(file,JSON.stringify(m,null,2)+"\n");
let successes=0,failures=0;
for(const [index,{month,type}] of batch.entries()){
 const u=new URL("https://apis.data.go.kr/1613000/"+endpoints[type]);u.searchParams.set("serviceKey",key);u.searchParams.set("LAWD_CD","41210");u.searchParams.set("DEAL_YMD",month);u.searchParams.set("numOfRows","1000");
 let err="",count=null,pages=[];
 for(let attempt=0;attempt<3;attempt++){
  try{
   u.searchParams.set("pageNo","1");
   const res=await fetch(u,{signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error("HTTP "+res.status);
   const xml=await res.text(),rc=xml.match(/<resultCode>(.*?)<\/resultCode>/)?.[1];
   if(!["00","000"].includes(rc))throw Error("resultCode "+rc);
   count=Number(xml.match(/<totalCount>(\d+)<\/totalCount>/)?.[1]||0);
   pages=[xml];for(let p=2;p<=Math.ceil(count/1000);p++){u.searchParams.set("pageNo",String(p));const next=await fetch(u,{signal:AbortSignal.timeout(20000)});if(!next.ok)throw Error("page HTTP "+next.status);pages.push(await next.text())}
   const dir=path.join("data/transactions/raw/41210",type);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,month+".xml"),pages.join("\n"));break;
  }catch(e){err=String(e.message||e).slice(0,120);count=null;await new Promise(r=>setTimeout(r,1500*(attempt+1)))}
 }
 const t=district.types.find(x=>x.type===type),record={type,month,records:count,status:count===null?"error":"complete",pages:pages.length,at:new Date().toISOString()};
 if(count===null){record.error=err;failures++}else successes++;
 t.months=[...(t.months||[]).filter(x=>x.month!==month),record].sort((a,b)=>a.month.localeCompare(b.month));
 t.records=t.months.filter(x=>x.status==="complete").reduce((sum,x)=>sum+x.records,0);
 const years=Object.groupBy(t.months,x=>x.month.slice(0,4));
 t.years=Object.entries(years).map(([year,items])=>({year:Number(year),records:items.filter(x=>x.status==="complete").reduce((a,x)=>a+x.records,0),status:items.length===12&&items.every(x=>x.status==="complete")?"complete":"partial"}));
 m.collection.active.completed=index+1;
 console.log("BACKFILL",index+1+"/"+batch.length,type,month,record.status,count??err);
 await new Promise(r=>setTimeout(r,700));
}
district.records=district.types.reduce((a,t)=>a+(t.records||0),0);region.records=district.records;
district.lastSuccessAt=successes?new Date().toISOString():district.lastSuccessAt;region.lastSuccessAt=district.lastSuccessAt;
district.status="partial";region.status="partial";
m.collection.status=failures?"partial":"partial";m.collection.active=null;m.collection.lastSuccessAt=successes?new Date().toISOString():m.collection.lastSuccessAt;
m.collection.history=[{at,status:failures?"partial":"complete",region:"광명시 과거 이력",message:"월별 유형 "+successes+"/"+batch.length+" 성공, "+failures+" 실패; 잔여 작업 "+(tasks.length-batch.length)},...(m.collection.history||[])].slice(0,500);
m.generatedAt=new Date().toISOString();
await fs.writeFile(file,JSON.stringify(m,null,2)+"\n");
console.log("BACKFILL_SUMMARY",JSON.stringify({successes,failures,remaining:tasks.length-batch.length}));
if(failures)process.exitCode=1;
