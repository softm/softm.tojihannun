"""Resume multi-page API months without publishing incomplete snapshots.

Only normalized rows are staged. API keys and URLs are never stored. The last
verified month stays authoritative until all pages and a first-page recheck pass.
"""
import gzip
import hashlib
import json
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
import shards as s
from formats import normalize


def scope_key(stream, district, month):
    key = f"{district['code']}/{stream['id']}/{month}"
    if not re.fullmatch(r'\d{5}/[A-Za-z]+-(sale|rent)/20\d{4}', key):
        raise s.SourceError('INVALID_SEGMENT_KEY')
    if stream['id'] not in s.STREAMS:
        raise s.SourceError('UNKNOWN_STREAM')
    return key


def clear_pending(pipe, key):
    if not re.fullmatch(r'\d{5}/[A-Za-z]+-(sale|rent)/20\d{4}', key):
        raise s.SourceError('INVALID_SEGMENT_KEY')
    folder = pipe.base / 'pending' / key
    if folder.exists():
        shutil.rmtree(folder)
    pipe.state.setdefault('pendingSegments', {}).pop(key, None)
    pipe.save()


def pending_tasks(pipe):
    for key in sorted(pipe.state.get('pendingSegments', {})):
        parts = key.split('/')
        if len(parts) != 3:
            raise s.SourceError('INVALID_PENDING_SCOPE')
        code, sid, month = parts
        if (code not in pipe.districts or sid not in s.STREAMS or
                not re.fullmatch(r'20\d{4}', month)):
            raise s.SourceError('INVALID_PENDING_SCOPE')
        if s.cooldown_active(pipe.state.get('failures', {}).get(key)):
            continue
        if s.cooldown_active(pipe.state.get('streamCooldowns', {}).get(sid)):
            continue
        yield key


class ResumableMonths:
    """Mixin for BudgetedClient: every network request still passes through page()."""
    def finish_segment(self, stream, district, month):
        clear_pending(self.pipe, scope_key(stream, district, month))

    def month(self, stream, district, month):
        key = scope_key(stream, district, month)
        pipe = self.pipe
        pending = pipe.state.setdefault('pendingSegments', {})
        meta = pending.get(key)
        if meta:
            try:
                expired = datetime.fromisoformat(meta['startedAt']) < datetime.now(timezone.utc)-timedelta(days=7)
            except (KeyError, ValueError, TypeError):
                raise s.SourceError('INVALID_PENDING_STATE') from None
            if expired:
                clear_pending(pipe, key)
                meta = None
        if meta is None:
            meta = {'schemaVersion':1, 'scope':key, 'startedAt':s.utc(),
                    'total':None, 'pages':[], 'rows':0}
            pending[key] = meta
        if meta.get('schemaVersion') != 1 or meta.get('scope') != key:
            raise s.SourceError('INVALID_PENDING_STATE')
        folder = pipe.base/'pending'/key
        rows = []
        for index, page in enumerate(meta['pages'], 1):
            raw = (folder/f'{index:04}.json.gz').read_bytes()
            if page.get('page') != index or hashlib.sha256(raw).hexdigest() != page['sha256']:
                raise s.SourceError('PENDING_HASH_MISMATCH')
            chunk = json.loads(gzip.decompress(raw))
            if len(chunk) != page['rows']:
                raise s.SourceError('PENDING_ROW_COUNT_MISMATCH')
            rows.extend(chunk)
        if len(rows) != meta['rows']:
            raise s.SourceError('PENDING_ROW_COUNT_MISMATCH')
        total = meta['total']
        count = max(1, (total+999)//1000) if total is not None else 1
        page_number = len(meta['pages'])+1
        try:
            while page_number <= count:
                next_total, raw_rows = self.page(stream, district['code'], month, page_number)
                if not isinstance(next_total, int) or next_total < 0:
                    raise s.SourceError('INVALID_TOTAL_COUNT')
                if total is None:
                    total = next_total
                    count = max(1, (total+999)//1000)
                    if count > 100:
                        raise s.SourceError('PAGE_LIMIT')
                    meta['total'] = total
                elif next_total != total:
                    raise s.SourceError('SOURCE_CHANGED_DURING_PAGING')
                expected = min(1000, max(0, total-(page_number-1)*1000))
                if len(raw_rows) != expected:
                    raise s.SourceError('ROW_COUNT_MISMATCH')
                chunk = [normalize(row, district, stream, month) for row in raw_rows]
                packed = gzip.compress(s.dump(chunk), mtime=0)
                s.atomic(folder/f'{page_number:04}.json.gz', packed)
                meta['pages'].append({'page':page_number, 'rows':len(chunk),
                                      'sha256':hashlib.sha256(packed).hexdigest()})
                rows.extend(chunk)
                meta['rows'] = len(rows)
                meta['updatedAt'] = s.utc()
                pipe.save()
                page_number += 1
            if len(rows) != total:
                raise s.SourceError('ROW_COUNT_MISMATCH')
            # APIs are not transactional: reject changed totals/first-page content.
            # The recheck is budgeted, and itself resumes on the next invocation.
            if count > 1:
                check_total, raw_rows = self.page(stream, district['code'], month, 1)
                check_rows = [normalize(row, district, stream, month) for row in raw_rows]
                if check_total != total or s.dump(check_rows) != s.dump(rows[:1000]):
                    raise s.SourceError('SOURCE_CHANGED_DURING_PAGING')
            return rows
        except s.SourceError as error:
            if error.code in ('SOURCE_CHANGED_DURING_PAGING','ROW_COUNT_MISMATCH','INVALID_TOTAL_COUNT','PAGE_LIMIT'):
                clear_pending(pipe, key)
            raise
