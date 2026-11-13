#!/usr/bin/env python3
"""Write a tiny, public, non-secret live collector status file."""
import argparse, json, os
from datetime import datetime, timedelta, timezone
from pathlib import Path

def utc(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()

def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--state", choices=["running","final"], required=True)
    ap.add_argument("--worker-outcome", default="")
    ap.add_argument("--result", default="collection-result.json")
    ap.add_argument("--output", default="live-status.json")
    args=ap.parse_args()

    now=datetime.now(timezone.utc)
    repo=os.environ.get("GITHUB_REPOSITORY","")
    run_id=os.environ.get("GITHUB_RUN_ID","")
    run_url=f"https://github.com/{repo}/actions/runs/{run_id}" if repo and run_id else None
    previous=read_json(args.output,{}) or {}

    if args.state=="running":
        body={
            "schemaVersion":1,
            "repository":repo,
            "runId":run_id,
            "runUrl":run_url,
            "status":"running",
            "collectionStatus":"running",
            "event":os.environ.get("GITHUB_EVENT_NAME"),
            "startedAt":utc(now),
            "updatedAt":utc(now),
            "expiresAt":utc(now+timedelta(minutes=25)),
            "message":"실제 수집 실행 중"
        }
    else:
        result=read_json(args.result,{}) or {}
        run=result.get("run",{}) if isinstance(result,dict) else {}
        collection=run.get("status")
        if collection=="deferred":
            status="deferred"
            message="호출 예산·재시도 대기"
        elif collection in ("failed","blocked","capacity_paused") or args.worker_outcome=="failure":
            status="failed"
            message="수집 오류·점검 필요"
        else:
            status="idle"
            message="정상 종료 · 다음 실행 대기"
        body={
            "schemaVersion":1,
            "repository":repo,
            "runId":run_id,
            "runUrl":run_url,
            "status":status,
            "collectionStatus":collection or ("failed" if args.worker_outcome=="failure" else "unknown"),
            "event":os.environ.get("GITHUB_EVENT_NAME"),
            "startedAt":previous.get("startedAt") if previous.get("runId")==run_id else run.get("startedAt"),
            "finishedAt":run.get("finishedAt") or utc(now),
            "updatedAt":utc(now),
            "expiresAt":None,
            "requests":run.get("requests",0),
            "success":run.get("success",0),
            "failed":run.get("failed",0),
            "stopReason":run.get("stopReason"),
            "message":message
        }
    Path(args.output).write_text(json.dumps(body,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(body,ensure_ascii=False))

if __name__=="__main__":
    main()
