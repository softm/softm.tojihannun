#!/usr/bin/env python3
"""Apply reviewed RTMS text splices after verifying original/source SHA256."""
import base64, hashlib, json, lzma
from pathlib import Path
root = Path(__file__).resolve().parent.parent
encoded = ''.join((root / f'scripts/rtms-repair-part{i}.b64').read_text().strip() for i in range(4))
payload = json.loads(lzma.decompress(base64.b64decode(encoded)).decode('utf-8'))
writes = {}
for relative, entry in payload.items():
    target = (root / relative).resolve()
    if root not in target.parents:
        raise RuntimeError('Invalid bundle path')
    current = hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None
    if current == entry['after']:
        continue
    if current != entry['before']:
        raise RuntimeError('Source changed; reconcile before applying: ' + relative)
    text = target.read_text().splitlines(keepends=True) if target.exists() else []
    for start, end, replacement in reversed(entry['splices']):
        text[start:end] = replacement.splitlines(keepends=True)
    data = ''.join(text).encode('utf-8')
    if hashlib.sha256(data).hexdigest() != entry['after']:
        raise RuntimeError('Bundle integrity mismatch')
    writes[target] = data
for target, data in writes.items():
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
# Check the displayed statistic value, not the explanatory phrase '0건으로 표시하지 않습니다'.
browser = root / 'scripts/rtms.browser.mjs'
source = browser.read_text()
old = "assert.doesNotMatch(await page.locator('#transactionStats').innerText(),/0건/);"
new = "assert.equal(await page.locator('#transactionStats strong').innerText(),'미확인');"
if old not in source:
    raise RuntimeError('Browser assertion anchor changed')
browser.write_text(source.replace(old, new))
print('RTMS reviewed sources applied:', len(writes))
