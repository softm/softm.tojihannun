#!/usr/bin/env python3
"""Stage verified district checkpoints from an active collector into a reserved repo.

This command DOES NOT change ownership, activate API calls, or delete source data.
"""
import argparse, gzip, hashlib, json, os, pathlib, subprocess, tempfile

def load(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))

def write(path, data):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as out:
        json.dump(data, out, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        out.write("\n")
        name = out.name
    os.replace(name, path)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--root", required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--plan", required=True)
    p.add_argument("--target", required=True)
    a=p.parse_args()
    root=pathlib.Path(a.root).resolve()
    source=pathlib.Path(a.source).resolve()
    plan=load(a.plan)
    if plan["schemaVersion"]!=1 or plan["phase"]!="staging-only":
        raise ValueError("Only verified staging plans are accepted")
    pair=next(x for x in plan["pairs"] if x["target"]==a.target)
    if os.getenv("GITHUB_REPOSITORY") and os.environ["GITHUB_REPOSITORY"]!="softm/"+a.target:
        raise ValueError("Target repository mismatch")
    source_name=source.name
    if source_name not in (pair["source"], "_source"):
        raise ValueError("Unexpected source checkout")
    codes=set(pair["targetCodes"])
    if not codes or codes & set(pair["sourceCodes"]):
        raise ValueError("Invalid disjoint ownership plan")
    if set(pair["sourceCodes"])|codes != set(pair["sourceOriginalCodes"]):
        raise ValueError("Plan omits original districts")
    base=source/"data/transactions"
    original=load(base/"collection-state.json")
    target_base=root/"data/transactions"
    target_base.mkdir(parents=True,exist_ok=True)
    state_path=target_base/"collection-state.json"
    state=load(state_path) if state_path.exists() else {"schemaVersion":2,"segments":{},"failures":{},"imports":{},"history":[]}
    if any(k.split("/")[0] not in codes for k in state.get("segments",{})):
        raise ValueError("Target contains out-of-plan segments")
    selected={k:v for k,v in original.get("segments",{}).items() if k.split("/")[0] in codes}
    copied=0
    for key, meta in sorted(selected.items()):
        src=base/"segments"/(key+".json.gz")
        raw=src.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=meta["sha256"]:
            raise ValueError("Source segment hash mismatch: "+key)
        body=json.loads(gzip.decompress(raw))
        if body.get("scope")!=key or len(body["rows"])!=meta["sourceRows"]:
            raise ValueError("Source segment row/scope mismatch: "+key)
        dest=target_base/"segments"/(key+".json.gz")
        previous=state["segments"].get(key)
        if previous and previous.get("fetchedAt","")>meta.get("fetchedAt",""):
            continue  # Never overwrite a newer target checkpoint.
        if previous and previous.get("fetchedAt")==meta.get("fetchedAt") and previous["sha256"]!=meta["sha256"]:
            raise ValueError("Conflicting checkpoint: "+key)
        dest.parent.mkdir(parents=True,exist_ok=True)
        if not dest.exists() or hashlib.sha256(dest.read_bytes()).hexdigest()!=meta["sha256"]:
            with tempfile.NamedTemporaryFile("wb",dir=dest.parent,delete=False) as out:
                out.write(raw)
                temp=out.name
            os.replace(temp,dest)
        state["segments"][key]=meta
        copied+=1
    for field in ("failures","pendingSegments"):
        source_items={k:v for k,v in original.get(field,{}).items() if k.split("/")[0] in codes}
        state[field]={**source_items, **state.get(field,{})}
    state["imports"]={**{k:v for k,v in original.get("imports",{}).items() if v.get("scope",{}).get("district") in codes},**state.get("imports",{})}
    for field in ("streamCooldowns","apiCooldown"):
        if field in original and field not in state:
            state[field]=original[field]
    # Conservatively carry all recent request reservations into the new worker.
    old=state.get("requestLedger",[])
    ledger=original.get("requestLedger",[])
    uniq={}
    for x in [*old,*ledger]:
        uniq[json.dumps(x,sort_keys=True)]=x
    state["requestLedger"]=list(uniq.values())
    source_ref=subprocess.check_output(["git","rev-parse","HEAD"],cwd=source,text=True).strip()
    if len(source_ref)!=40:
        raise ValueError("Unpinned source")
    receipt={"schemaVersion":1,"phase":"staged","sourceRepository":"softm/"+pair["source"],
             "sourceCommit":source_ref,"targetRepository":"softm/"+a.target,
             "districtCodes":sorted(codes),"segments":len(selected),
             "records":sum(v["records"] for v in selected.values()),
             "pendingSegments":len([k for k in original.get("pendingSegments",{}) if k.split("/")[0] in codes]),
             "hashes":{k:v["sha256"] for k,v in selected.items()}}
    # The receipt is a staging proof, not an activation receipt.
    write(state_path,state)
    write(root/"rebalance-stage.json",receipt)
    migration={**receipt,"phase":"handover","sourceRows":sum(v.get("sourceRows",0) for v in selected.values()),"verifiedAt":receipt.get("verifiedAt") or None}
    migration["verifiedAt"]=__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    write(root/"migration-receipt.json",migration)
    print(json.dumps({"target":a.target,"phase":"staged","sourceCommit":source_ref,
                      "districts":len(codes),"verifiedSegments":copied,
                      "pendingSegments":receipt["pendingSegments"],"apiRequests":0},ensure_ascii=False))

if __name__=="__main__":
    main()
