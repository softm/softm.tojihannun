"""Load the official MOIS legal-area registry, including retired codes.
No regional code is guessed from a place name. A changed registry is versioned.
"""
import csv, io, json, hashlib, urllib.request, urllib.parse, zipfile
from datetime import datetime, timezone
from pathlib import Path
URL = 'https://www.code.go.kr/etc/codeFullDown.do'

def parse_registry(raw):
    if raw[:2] == b'PK':
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            files = [x for x in z.infolist() if x.filename.lower().endswith(('.txt','.csv'))]
            if len(files) != 1: raise ValueError('unexpected registry archive')
            if files[0].file_size > 30_000_000: raise ValueError('registry too large')
            raw = z.read(files[0])
    try: text = raw.decode('utf-8-sig')
    except UnicodeDecodeError: text = raw.decode('cp949')
    if '<html' in text[:1000].lower(): raise ValueError('registry returned HTML, not code data')
    rows = list(csv.reader(io.StringIO(text), delimiter='\t' if '\t' in text.splitlines()[0] else ','))
    codes = {}
    for row in rows:
        if len(row) < 2: continue
        code, name = row[0].strip(), row[1].strip()
        if len(code) != 10 or not code.isdigit(): continue
        current = len(row) < 3 or row[2].strip() in ('존재','현존','0','N','')
        codes[code] = {'code':code,'name':name,'active':current}
    if len(codes) < 1000: raise ValueError('incomplete official registry')
    prefixes = {code[:5] for code in codes if not code.endswith('00000')}
    districts = []
    for prefix in sorted(prefixes):
        parent = codes.get(prefix+'00000')
        if not parent: continue
        prov = codes.get(prefix[:2]+'00000000') or (parent if prefix == '36110' else None)
        if not prov: raise ValueError('province missing in registry')
        leaf = [r for c,r in codes.items() if c.startswith(prefix) and not c.endswith('00000')]
        active = any(x['active'] for x in leaf)
        districts.append({'code':prefix,'name':parent['name'],'sido':prefix[:2],
                          'sidoName':prov['name'],'active':active})
    if len(districts)<200: raise ValueError('incomplete district registry')
    return {'schemaVersion':1,'source':URL,'retrievedAt':datetime.now(timezone.utc).isoformat(),
            'sha256':hashlib.sha256(raw).hexdigest(),'districts':districts}

def refresh(target):
    req=urllib.request.Request(URL, data=urllib.parse.urlencode({'codeseId':'법정동코드'}).encode(),
       headers={'User-Agent':'Tojihannun-collector/2.0','Referer':'https://www.code.go.kr/stdcode/regCodeL.do'})
    with urllib.request.urlopen(req,timeout=35) as r:
        raw=r.read(30_000_001)
    if len(raw)>30_000_000: raise ValueError('registry response too large')
    result=parse_registry(raw)
    target=Path(target); target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return result

if __name__=='__main__':
    import sys
    result=refresh(sys.argv[1] if len(sys.argv)>1 else 'data/transactions/registry.json')
    print(json.dumps({'districts':len(result['districts']),'active':sum(x['active'] for x in result['districts']),
                      'provinces':len({x['sido'] for x in result['districts'] if x['active']})}))
