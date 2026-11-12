#!/usr/bin/env python3
"""Build and validate an ingestion manifest for official MOLIT RTMS Excel/CSV exports.

This does not download the official website. It inventories supplied official files,
validates rows with the same parser used by the API collector, and emits provenance
for later shard distribution.
"""
import argparse, hashlib, json, pathlib, re, sys
from datetime import datetime, timezone
HERE=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from formats import table_rows, field, SourceError

STREAMS={
 "apartment-sale":("매매","아파트"),"rowHouse-sale":("매매","연립다세대"),
 "detached-sale":("매매","단독다가구"),"officetel-sale":("매매","오피스텔"),
 "rights-sale":("매매","분양입주권"),"commercial-sale":("매매","상업업무용"),
 "land-sale":("매매","토지"),"factory-sale":("매매","공장창고"),
 "apartment-rent":("전월세","아파트"),"rowHouse-rent":("전월세","연립다세대"),
 "detached-rent":("전월세","단독다가구"),"officetel-rent":("전월세","오피스텔")
}
def sha(p):
 h=hashlib.sha256()
 with open(p,"rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
 return h.hexdigest()
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("file");ap.add_argument("--stream",required=True,choices=STREAMS)
 ap.add_argument("--province",required=True);ap.add_argument("--start",required=True);ap.add_argument("--end",required=True)
 ap.add_argument("--source-url",default="https://rt.molit.go.kr/pt/xls/xls.do?mobileAt=")
 ap.add_argument("--output",required=True)
 a=ap.parse_args();p=pathlib.Path(a.file)
 if p.suffix.lower() not in (".xlsx",".csv"):raise SourceError("UNSUPPORTED_FILE_USE_XLSX_OR_CSV")\n file_format="xlsx" if p.suffix.lower()==".xlsx" else "csv"
 if not re.fullmatch(r"20\d\d-\d\d-\d\d",a.start) or not re.fullmatch(r"20\d\d-\d\d-\d\d",a.end) or a.start>a.end:raise SourceError("INVALID_SCOPE")
 rows=0;months=set();district_labels=set()
 for row in table_rows(p):
  rows+=1
  y=field(row,"계약년월","계약연월");d=field(row,"계약일자");addr=field(row,"시군구","소재지")
  digits=re.sub(r"\D","",d or y)
  if len(digits)>=6:months.add(digits[:6])
  if addr:district_labels.add(addr.split()[0] if addr.split() else addr)
 out={"schemaVersion":1,"kind":"official-rtms-bulk-export","sourceUrl":a.source_url,
      "file":p.name,"format":file_format,"preferredFormat":"xlsx","bytes":p.stat().st_size,"sha256":sha(p),"stream":a.stream,
      "transaction":STREAMS[a.stream][0],"propertyType":STREAMS[a.stream][1],
      "province":a.province,"contractStart":a.start,"contractEnd":a.end,
      "parsedRows":rows,"months":sorted(months),"districtLabelCount":len(district_labels),
      "observedAt":datetime.now(timezone.utc).isoformat()}
 pathlib.Path(a.output).write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print(json.dumps(out,ensure_ascii=False))
if __name__=="__main__":main()
