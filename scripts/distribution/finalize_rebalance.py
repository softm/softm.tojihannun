#!/usr/bin/env python3
"""Finalize source-side state after a verified staged handover.

Moved segment files are NOT deleted. Their active metadata is archived so the
source worker cannot publish or recollect districts now owned by another shard.
"""
import argparse, json, pathlib, subprocess, tempfile, os

def load(p): return json.loads(pathlib.Path(p).read_text(encoding="utf-8"))
def write(p,obj):
    p=pathlib.Path(p); p.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile("w",encoding="utf-8",dir=p.parent,delete=False) as f:
        json.dump(obj,f,ensure_ascii=False,separators=(",",":"),sort_keys=True);f.write("\n");n=f.name
    os.replace(n,p)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--root",required=True);ap.add_argument("--frozen",required=True)
    ap.add_argument("--target",required=True);ap.add_argument("--plan",required=True)
    ap.add_argument("--source",required=True)
    a=ap.parse_args()
    root=pathlib.Path(a.root).resolve(); frozen=pathlib.Path(a.frozen).resolve(); target=pathlib.Path(a.target).resolve()
    plan=load(a.plan); pair=next(x for x in plan["pairs"] if x["source"]==a.source)
    moved=set(pair["targetCodes"]); stay=set(pair["sourceCodes"])
    receipt=load(target/"migration-receipt.json")
    if receipt["sourceRepository"]!="softm/"+a.source: raise ValueError("Receipt source mismatch")
    frozen_sha=subprocess.check_output(["git","rev-parse","HEAD"],cwd=frozen,text=True).strip()
    if receipt["sourceCommit"]!=frozen_sha: raise ValueError("Receipt is not for frozen source snapshot")
    fstate=load(frozen/"data/transactions/collection-state.json")
    tstate=load(target/"data/transactions/collection-state.json")
    selected={k:v for k,v in fstate.get("segments",{}).items() if k.split("/")[0] in moved}
    if set(receipt["hashes"])!=set(selected): raise ValueError("Receipt segment set mismatch")
    for k,v in selected.items():
        if receipt["hashes"][k]!=v["sha256"] or tstate.get("segments",{}).get(k,{}).get("sha256")!=v["sha256"]:
            raise ValueError("Target checkpoint verification failed: "+k)
    state=load(root/"data/transactions/collection-state.json")
    # Refuse to retire any moved checkpoint newer than the frozen handover.
    for k,v in state.get("segments",{}).items():
        if k.split("/")[0] in moved:
            fv=selected.get(k)
            if not fv or v.get("fetchedAt","")!=fv.get("fetchedAt","") or v.get("sha256")!=fv.get("sha256"):
                raise ValueError("Source changed after staging: "+k)
    retired_path=root/"data/transactions/rebalance-retired.json"
    retired=load(retired_path) if retired_path.exists() else {"schemaVersion":1,"handoffs":[],"segments":{},"failures":{},"pendingSegments":{},"imports":{}}
    for field in ("segments","failures","pendingSegments"):
        bucket=state.get(field,{})
        take={k:v for k,v in bucket.items() if k.split("/")[0] in moved}
        retired.setdefault(field,{}).update(take)
        state[field]={k:v for k,v in bucket.items() if k.split("/")[0] not in moved}
    imports=state.get("imports",{})
    take={k:v for k,v in imports.items() if v.get("scope",{}).get("district") in moved}
    retired.setdefault("imports",{}).update(take)
    state["imports"]={k:v for k,v in imports.items() if v.get("scope",{}).get("district") not in moved}
    retired["handoffs"].append({"source":a.source,"target":pair["target"],"sourceCommit":frozen_sha,
        "districtCodes":sorted(moved),"segments":len(selected),"records":sum(v.get("records",0) for v in selected.values())})
    # Keep requestLedger and cooldowns conservatively on the source; target already copied them.
    write(root/"data/transactions/collection-state.json",state)
    write(retired_path,retired)
    write(root/"rebalance-source-finalized.json",retired["handoffs"][-1])
    print(json.dumps({"source":a.source,"target":pair["target"],"retiredDistricts":len(moved),
                      "retiredSegments":len(selected),"sourceFilesDeleted":0},ensure_ascii=False))
if __name__=="__main__": main()
