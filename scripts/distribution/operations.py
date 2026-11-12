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
    def __init__(self, pipe, budget):
        super().__init__(os.environ.get('MOLIT_API_KEY', ''), max_requests=budget,
                         interval=1.5, deadline=time.monotonic()+480)
        self.pipe = pipe

    def page(self, stream, code, month, page):
        if self.calls >= self.max_requests:
            raise s.SourceError('REQUEST_BUDGET')
        # This is local until the workflow persists the checkpoint; do not claim
        # remote crash durability before that commit succeeds.
        cutoff = datetime.now(timezone.utc)-timedelta(days=2)
        ledger = [x for x in self.pipe.state.get('requestLedger', [])
                  if datetime.fromisoformat(x['at']) > cutoff]
        entry = {'at': s.utc(), 'requests': 1, 'runId': os.environ.get('GITHUB_RUN_ID')}
        self.pipe.state['requestLedger'] = [*ledger, entry]
        self.pipe.save()
        before = self.calls
        try:
            return super().page(stream, code, month, page)
        finally:
            if self.calls == before:  # Client rejected before attempting the network.
                self.pipe.state['requestLedger'].remove(entry)
                self.pipe.save()


def task_queue(pipe, mode):
    seen = set()
    if mode in ('auto', 'backfill'):
        for task in pending_tasks(pipe):
            seen.add(task)
            yield task
    if mode != 'auto':
        for task in pipe.plan(mode):
            if task not in seen:
                seen.add(task)
                yield task
        return
    # Refresh recent reports/cancellations without starving historical backfill.
    queues = {'refresh': iter(pipe.plan('refresh')), 'backfill': iter(pipe.plan('backfill'))}
    for kind in itertools.cycle(('backfill', 'backfill', 'backfill', 'refresh')):
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
           'requests':0, 'added':0, 'removed':0, 'cancelled':0}
    budget = s.request_budget(pipe.state, config)
    reason = ('LOCAL_REQUEST_BUDGET' if budget <= 0 else
              'API_COOLDOWN' if s.cooldown_active(pipe.state.get('apiCooldown')) else
              'MISSING_MOLIT_API_KEY' if not os.environ.get('MOLIT_API_KEY', '').strip() else None)
    if reason:
        run.update(status='blocked' if reason=='MISSING_MOLIT_API_KEY' else 'deferred', stopReason=reason)
        return finish(pipe, run)
    client = client_factory(pipe, budget)
    blocked = set()
    pipe.state['lastRun'] = run
    pipe.save()
    try:
        for task in task_queue(pipe, mode):
            if client.calls >= budget:
                break
            code, sid, month = task.split('/')
            if sid in blocked:
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
                if error.code in ('REQUEST_BUDGET', 'TIME_BUDGET', 'STOPPED'):
                    run['stopReason'] = error.code
                    break  # Local batching is not a failed source segment.
                pipe.fail(task, error)
                run['failed'] += 1
                run.setdefault('errors', {}).setdefault(error.code, 0)
                run['errors'][error.code] += 1
                if error.code in ('429', '22', '23', '29'):
                    run['stopReason'] = error.code
                    break
                if error.code in ('401', '403', '20', '30', '31', '12', '404'):
                    blocked.add(sid)
        run['status'] = ('partial' if run['success'] and run['failed'] else
                         'failed' if run['failed'] else 'success' if run['success'] else
                         'deferred' if run.get('stopReason') else 'idle')
    except Exception as error:
        run.update(status='failed', stopReason='INTERNAL_VALIDATION_ERROR', errorType=type(error).__name__)
        # Do not expose exception messages containing URLs or credential values.
    finally:
        run['requests'] = client.calls
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
        if receipt.get('sourceCommit') != args.source_commit:
            s.bootstrap(root, source, set(shard['districtCodes']), args.source_commit)
        s.check_handover(root, shard)
        result = {'status':'ready','requests':0,'finishedAt':s.utc()}
    pipe = s.Pipeline(root, registry)
    if any(key[:5] not in set(shard['districtCodes']) for key in pipe.state['segments']):
        raise ValueError('Out-of-assignment checkpoint')
    if result['status'] == 'ready' and args.mode not in ('bootstrap','build'):
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
    parser.add_argument('--mode', choices=['auto','backfill','refresh','bootstrap','build'], default='auto')
    sys.exit(worker(parser.parse_args()))
