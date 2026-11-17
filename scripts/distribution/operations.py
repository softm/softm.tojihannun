#!/usr/bin/env python3
"""Production collection entrypoint. Secrets never enter public reports.
Every attempted API page is recorded locally BEFORE the request and persisted
by the workflow. Pages setup is independent from collection and checkpoints.
"""
import argparse
import itertools
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
import shards as s
from resumable import ResumableMonths, pending_tasks


def finish(pipe, run):
    run['pendingSegments'] = len(pipe.state.get('pendingSegments', {}))
    run['pendingPages'] = sum(len(x.get('pages', [])) for x in pipe.state.get('pendingSegments', {}).values())
    run['finishedAt'] = s.utc()
    pipe.state['lastRun'] = run
    pipe.state['history'] = [run, *pipe.state.get('history', [])][:100]
    if run.get('success', 0):
        pipe.state['lastSuccessfulCollectionAt'] = run['finishedAt']
    pipe.save()
    return run


class BudgetedClient(ResumableMonths, s.Client):
    def __init__(self, pipe, config, budget):
        super().__init__(os.environ.get('MOLIT_API_KEY', ''), max_requests=budget,
                         interval=1.5, deadline=time.monotonic()+480)
        self.pipe = pipe
        self.config = config
        self.calls_by_stream = {}

    def page(self, stream, code, month, page):
        if self.calls >= self.max_requests:
            raise s.SourceError('REQUEST_BUDGET')
        if s.request_budget(self.pipe.state, self.config, stream['id']) <= 0:
            raise s.SourceError('STREAM_REQUEST_BUDGET')
        # This is local until the workflow persists the checkpoint; do not claim
        # remote crash durability before that commit succeeds.
        cutoff = datetime.now(timezone.utc)-timedelta(days=2)
        ledger = [x for x in self.pipe.state.get('requestLedger', [])
                  if datetime.fromisoformat(x['at']) > cutoff]
        entry = {'at': s.utc(), 'requests': 1, 'stream': stream['id'],
                 'runId': os.environ.get('GITHUB_RUN_ID')}
        self.pipe.state['requestLedger'] = [*ledger, entry]
        self.pipe.save()
        before = self.calls
        try:
            return super().page(stream, code, month, page)
        finally:
            if self.calls == before:  # Client rejected before attempting the network.
                self.pipe.state['requestLedger'].remove(entry)
                self.pipe.save()
            else:
                self.calls_by_stream[stream['id']] = self.calls_by_stream.get(stream['id'], 0) + (self.calls-before)


COLLECTION_PHASES = (
    {'id':1,'label':'2020~2026','start':'2020-01-01','end':'2026-12-31'},
    {'id':2,'label':'2015~2019','start':'2015-01-01','end':'2019-12-31'},
    {'id':3,'label':'2010~2014','start':'2010-01-01','end':'2014-12-31'},
    {'id':4,'label':'2006~2009','start':'2006-01-01','end':'2009-12-31'},
)

def phase_tasks(pipe, phase, streams=None):
    end = min(phase['end'], pipe.asof)
    if phase['start'] > end:
        return iter(())
    return pipe.plan('backfill', streams=streams, month_start=phase['start'], month_end=end)

def phase_complete(pipe, phase):
    # Completion is based on persisted segments; unsupported/access-blocked streams
    # remain incomplete and visible rather than being silently skipped.
    return next(phase_tasks(pipe, phase), None) is None

def current_phase(pipe):
    for phase in COLLECTION_PHASES:
        if not phase_complete(pipe, phase):
            return phase
    return None

def recent_month_window(asof, months):
    year, month = map(int, asof[:7].split('-'))
    end_index = year * 12 + month - 1
    start_index = end_index - (months - 1)
    start_year, start_month0 = divmod(start_index, 12)
    return f'{start_year:04d}-{start_month0 + 1:02d}-01', asof

def history_audit_tasks(pipe, streams=None):
    # Audit one calendar month across every historical year. Repeating this
    # monthly covers all 12 calendar months over a year without a full recrawl.
    audit_month = int(pipe.asof[5:7])
    end_year = int(pipe.asof[:4])
    for year in range(2006, end_year + 1):
        point = f'{year:04d}-{audit_month:02d}-01'
        yield from pipe.plan('refresh', streams=streams, month_start=point, month_end=point)

def task_queue(pipe, mode, streams=None):
    seen = set()
    special = mode in ('refresh-year', 'audit-history')
    # Weekly/yearly verification begins only after the historical backfill is
    # complete. Hourly auto already prioritizes failed/pending segments before then.
    if special and current_phase(pipe) is not None:
        return
    if mode in ('auto', 'backfill', 'refresh-year', 'audit-history'):
        for task in pending_tasks(pipe, streams):
            seen.add(task)
            yield task
    if mode == 'refresh-year':
        start, end = recent_month_window(pipe.asof, 12)
        for task in pipe.plan('refresh', streams=streams, month_start=start, month_end=end):
            if task not in seen:
                seen.add(task)
                yield task
        return
    if mode == 'audit-history':
        for task in history_audit_tasks(pipe, streams):
            if task not in seen:
                seen.add(task)
                yield task
        return
    if mode not in ('auto','backfill'):
        for task in pipe.plan(mode, streams=streams):
            if task not in seen:
                seen.add(task)
                yield task
        return
    phase = current_phase(pipe)
    if mode == 'backfill':
        if phase:
            for task in phase_tasks(pipe, phase, streams):
                if task not in seen:
                    seen.add(task)
                    yield task
        return
    # Auto: spend most calls on the current historical phase while reserving
    # regular turns for recent corrections/cancellations.
    queues = {'refresh': iter(pipe.plan('refresh', streams=streams))}
    if phase:
        queues['backfill'] = phase_tasks(pipe, phase, streams)
    pattern = ('backfill','backfill','backfill','refresh') if phase else ('refresh',)
    for kind in itertools.cycle(pattern):
        if not queues:
            return
        queue = queues.get(kind)
        if queue is None:
            continue
        task = next(queue, None)
        if task is None:
            queues.pop(kind)
        elif task not in seen:
            seen.add(task)
            yield task


def collect(pipe, config, mode, client_factory=BudgetedClient):
    run = {'startedAt':s.utc(), 'mode':mode, 'status':'running',
           'runId':os.environ.get('GITHUB_RUN_ID'), 'success':0, 'failed':0,
           'requests':0, 'requestsByStream':{}, 'added':0, 'removed':0, 'cancelled':0}
    if not os.environ.get('MOLIT_API_KEY', '').strip():
        run.update(status='blocked', stopReason='MISSING_MOLIT_API_KEY')
        return finish(pipe, run)
    if s.cooldown_active(pipe.state.get('apiCooldown')):
        run.update(status='deferred', stopReason='API_COOLDOWN')
        return finish(pipe, run)

    available = [sid for sid in s.STREAMS
                 if s.request_budget(pipe.state, config, sid) > 0
                 and not s.cooldown_active(pipe.state.get('streamCooldowns', {}).get(sid))]
    if not available:
        run.update(status='deferred', stopReason='LOCAL_REQUEST_BUDGET')
        return finish(pipe, run)

    per_run = int(config['requestBudget'].get('perRun', 1000))
    client = client_factory(pipe, config, per_run)
    blocked = set()
    pipe.state['lastRun'] = run
    pipe.save()
    try:
        for task in task_queue(pipe, mode, streams=available):
            if client.calls >= per_run:
                run['stopReason'] = 'REQUEST_BUDGET'
                break
            code, sid, month = task.split('/')
            if sid in blocked:
                continue
            if s.request_budget(pipe.state, config, sid) <= 0:
                blocked.add(sid)
                continue
            run['currentTask'] = task
            try:
                rows = client.month(s.STREAMS[sid], pipe.districts[code], month)
                meta = pipe.put(task, rows, 'public_api')
                if hasattr(client, 'finish_segment'):
                    client.finish_segment(s.STREAMS[sid], pipe.districts[code], month)
                run['success'] += 1
                for key in ('added', 'removed', 'cancelled'):
                    run[key] += meta[key]
            except s.SourceError as error:
                if error.code == 'STREAM_REQUEST_BUDGET':
                    blocked.add(sid)
                    continue
                if error.code in ('REQUEST_BUDGET', 'TIME_BUDGET', 'STOPPED'):
                    run['stopReason'] = error.code
                    break
                pipe.fail(task, error)
                run['failed'] += 1
                run.setdefault('errors', {}).setdefault(error.code, 0)
                run['errors'][error.code] += 1
                if error.code in ('429', '22', '23'):
                    blocked.add(sid)
                    continue
                if error.code == '29':
                    run['stopReason'] = error.code
                    break
                if error.code in ('401', '403', '20', '30', '31', '12', '404'):
                    blocked.add(sid)
        run['requestsByStream'] = dict(getattr(client, 'calls_by_stream', {}))
        timeout_only = bool(run['failed']) and not run['success'] and set(run.get('errors', {})) == {'NETWORK_TIMEOUT'}
        if timeout_only:
            run['status'] = 'deferred'
            run['stopReason'] = 'NETWORK_TIMEOUT'
        elif run['success'] and run['failed']:
            run['status'] = 'partial'
        elif run['failed']:
            run['status'] = 'failed'
        elif run['success']:
            run['status'] = 'success'
        elif blocked:
            run['status'] = 'deferred'
            run.setdefault('stopReason', 'STREAMS_UNAVAILABLE')
        elif run.get('stopReason'):
            run['status'] = 'deferred'
        else:
            run['status'] = 'idle'
    except Exception as error:
        run.update(status='failed', stopReason='INTERNAL_VALIDATION_ERROR', errorType=type(error).__name__)
    finally:
        run['requests'] = client.calls
        run['requestsByStream'] = dict(getattr(client, 'calls_by_stream', run.get('requestsByStream', {})))
        finish(pipe, run)
    return run


def worker(args):
    root, control, source = map(lambda p: Path(p).resolve(), (args.root, args.control, args.legacy))
    config = s.load(control/'data/transactions/storage-registry.json')
    shard, registry = s.owned(config, args.shard, s.load(control/'data/transactions/registry.json'))
    if os.environ.get('GITHUB_REPOSITORY') and os.environ['GITHUB_REPOSITORY'] != shard['repository']:
        raise ValueError('Repository identity mismatch')
    base = root/'data/transactions'
    s.write_json(base/'registry.json', registry)
    if not shard['districtCodes']:
        result = {'status':'reserved', 'requests':0, 'finishedAt':s.utc()}
    elif shard['collectionOwner'] != 'shard' or not shard.get('collectionEnabled', False):
        result = {'status':'paused', 'requests':0, 'finishedAt':s.utc()}
    else:
        if args.source_commit != shard.get('handoverCommit'):
            raise ValueError('Final checkpoint mismatch')
        receipt = s.read_json(root/'migration-receipt.json', {})
        expected_repo = shard.get('handoverSourceRepository', 'softm/softm.tojihannun')
        if receipt.get('sourceCommit') != args.source_commit or receipt.get('sourceRepository') != expected_repo:
            # Never replace a verified cross-shard handover receipt with a legacy
            # central bootstrap merely because the local state migration marker is stale.
            if receipt:
                raise ValueError('Existing migration receipt does not match registered handover')
            s.bootstrap(root, source, set(shard['districtCodes']), args.source_commit)
        s.check_handover(root, shard)
        # Keep the public/state migration marker aligned with the authoritative receipt.
        pipe_state = s.read_json(root/'data/transactions/collection-state.json', {})
        pipe_state['migration'] = {k:v for k,v in receipt.items() if k != 'hashes'}
        s.write_json(root/'data/transactions/collection-state.json', pipe_state)
        result = {'status':'ready','requests':0,'finishedAt':s.utc()}
    pipe = s.Pipeline(root, registry)
    if any(key[:5] not in set(shard['districtCodes']) for key in pipe.state['segments']):
        raise ValueError('Out-of-assignment checkpoint')
    if result['status'] == 'ready' and args.mode not in ('bootstrap','build'):
        # Staged API collection prioritizes the newest historical phase first while
        # retaining recent refreshes for corrections/cancellations. Official XLSX imports
        # can fill the same canonical segments faster without changing this checkpoint model.
        # Measure the current artifact before ANY new source request.
        preflight = s.publish(pipe, root, config, shard, result)
        if preflight['capacity']['needsSplit']:
            result = finish(pipe, {'status':'capacity_paused','requests':0,
                                   'stopReason':'ROTATION_REQUIRED','startedAt':s.utc()})
        else:
            result = collect(pipe, config, args.mode)
    result['apiKeyConfigured'] = bool(os.environ.get('MOLIT_API_KEY', '').strip())
    result['apiAccessVerified'] = bool(result.get('success', 0))
    result['lastSuccessfulCollectionAt'] = pipe.state.get('lastSuccessfulCollectionAt')
    stats = s.publish(pipe, root, config, shard, result)
    s.write_json(root/'collection-result.json', {'schemaVersion':1,'repository':shard['repository'],
                  'run':result,'summary':stats['summary'],'capacity':stats['capacity']})
    (root/'.gitignore').write_text('_engine/\n_control/\n_legacy/\nsite/\nsite.next/\nnode_modules/\n__pycache__/\n*.pyc\ntest-results/\n')
    print(json.dumps({'shard':shard['id'],'run':result,'records':stats['summary']['records'],
                      'completedTasks':stats['summary']['completedTasks'],
                      'publishedBytes':stats['capacity']['publishedBytes']}, ensure_ascii=False))
    return 1 if result['status'] in ('failed','blocked') else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for field in ('root','control','legacy','shard','source-commit'):
        parser.add_argument('--'+field, required=True)
    parser.add_argument('--mode', choices=['auto','backfill','refresh','refresh-year','audit-history','bootstrap','build'], default='auto')
    sys.exit(worker(parser.parse_args()))
