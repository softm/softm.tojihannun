import fs from "node:fs/promises";
import path from "node:path";
const key=process.env.MOLIT_API_KEY;
if(!key)throw Error("MOLIT_API_KEY secret is required; no collection attempted");
const now=new Date(),kst=new Date(now.getTime()+9*3600000);
const months=[0,1,2].map(back=>{const d=new Date(Date.UTC(kst.getUTCFullYear(),kst.getUTCMonth()-back,1));return d.toISOString().slice(0,7).replace("-","")});
const types={rowHouse:"RTMSDataSvcRHTrade2/getRTMSDataSvcRHTrade2",apartment:"RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",land:"RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade",commercial:"RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade"};
const manifestPath="data/transactions/status-manifest.json",manifest=JSON.parse(await fs.readFile(manifestPath,"utf8"));
const region=manifest.regions.find(r=>r.code==="41");
const district=region.districts.find(d=>d.code==="41210")||{code:"41210",name:"광명시",status:"not_collected",records:null,types:[]};
if(!region.districts.some(d=>d.code==="41210"))region.districts.push(district);
const at=now.toISOString(),results=[];let failures=0;
for(const [type,endpoint] of Object.entries(types)){
 for(const month of months){
  const url=new URL("https://apis.data.go.kr/1613000/"+endpoint);
  url.searchParams.set("serviceKey",key);url.searchParams.set("LAWD_CD","41210");url.searchParams.set("DEAL_YMD",month);url.searchParams.set("numOfRows","1000");url.searchParams.set("pageNo","1");
  let success=false,error="";
  for(let attempt=0;attempt<3&&!success;attempt++){
   try{
    const response=await fetch(url,{signal:AbortSignal.timeout(16000)});
    if(!response.ok)throw Error("HTTP "+response.status);
    const xml=await response.text();
    const resultCode=xml.match(/<resultCode>(.*?)<\/resultCode>/)?.[1];
    if(resultCode!=="00"&&resultCode!=="000")throw Error("API resultCode "+(resultCode||"missing"));
    const count=Number(xml.match(/<totalCount>(\d+)<\/totalCount>/)?.[1]||0);
    const pages=Math.max(1,Math.ceil(count/1000));let documents=[xml];
    for(let page=2;page<=pages;page++){url.searchParams.set("pageNo",String(page));const next=await fetch(url,{signal:AbortSignal.timeout(16000)});if(!next.ok)throw Error("page "+page+" HTTP "+next.status);documents.push(await next.text())}
    const dir=path.join("data/transactions/raw/41210",type);await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,month+".xml"),documents.join("\n"));
    results.push({type,month,records:count,status:"complete",pages,at});success=true;
   }catch(e){error=String(e.message||e).slice(0,140);if(attempt<2)await new Promise(r=>setTimeout(r,(attempt+1)*1800))}
  }
  if(!success){failures++;results.push({type,month,records:null,status:"error",error,at})}
  await new Promise(r=>setTimeout(r,550));
 }
}
for(const type of Object.keys(types)){
 const previous=district.types.find(t=>t.type===type)||{type,label:({rowHouse:"연립·다세대",apartment:"아파트",land:"토지",commercial:"상업·업무"})[type],years:[]};
 if(!district.types.some(t=>t.type===type))district.types.push(previous);
 previous.months=[...(previous.months||[]).filter(m=>!months.includes(m.month)),...results.filter(r=>r.type===type)].sort((a,b)=>a.month.localeCompare(b.month));
 const valid=previous.months.filter(m=>m.status==="complete");previous.records=valid.length?valid.reduce((a,b)=>a+b.records,0):null;
 previous.years=Object.values(Object.groupBy(previous.months,m=>m.month.slice(0,4))).map(ms=>({year:Number(ms[0].month.slice(0,4)),records:ms.filter(m=>m.status==="complete").reduce((a,b)=>a+b.records,0),status:ms.every(m=>m.status==="complete")?"partial":"error"}));
}
district.records=district.types.every(t=>t.records!==null)?district.types.reduce((a,b)=>a+b.records,0):null;
district.status=failures?"partial":"partial";district.lastSuccessAt=results.some(r=>r.status==="complete")?at:district.lastSuccessAt||null;
region.status="partial";region.lastSuccessAt=district.lastSuccessAt;region.records=district.records;
manifest.generatedAt=at;manifest.collection.schedule="매일 04:00 KST · 최근 3개월 · 광명시 4개 유형 (시범 수집)";
manifest.collection.lastAttemptAt=at;manifest.collection.status=failures?"partial":"partial";
if(results.some(r=>r.status==="complete"))manifest.collection.lastSuccessAt=at;
manifest.collection.history=[{at,status:failures?"partial":"complete",region:"경기도 광명시",message:results.filter(r=>r.status==="complete").length+"/"+results.length+"개월·유형 성공; 실패 "+failures+"건"},...(manifest.collection.history||[])].slice(0,500);
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+"\n");
console.log(JSON.stringify({success:results.length-failures,failures,months,types:Object.keys(types)}));
if(failures)process.exitCode=1;
