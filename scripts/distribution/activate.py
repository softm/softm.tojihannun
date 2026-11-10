#!/usr/bin/env python3
"""Explicit, one-time ownership handover. Run only under rtms-collection lock.
Does not remove data or change service read URLs. Aborts on changed source anchors.
"""
import json,re,subprocess,tempfile
from pathlib import Path
import shards as s
ROOT=Path(__file__).resolve().parents[2]
def replace(text,a,b):
    if b in text:return text
    if text.count(a)!=1:raise ValueError('Source changed; reconcile '+a[:80])
    return text.replace(a,b)
def main():
    path=ROOT/'data/transactions/storage-registry.json';cfg=s.load(path)
    if cfg.get('mode')!='collecting':
        head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        assert re.fullmatch('[0-9a-f]{40}',head)
        official=s.load(ROOT/'data/transactions/registry.json');mapping=s.shard_map(cfg)
        assert all(d['code'] in mapping for d in official['districts'] if d['active'])
        original=s.load(ROOT/'data/transactions/collection-state.json');count=0
        for shard in cfg['shards']:
            if not shard['districtCodes']:shard['collectionEnabled']=False;continue
            with tempfile.TemporaryDirectory() as dest:
                receipt=s.bootstrap(dest,ROOT,set(shard['districtCodes']),head);count+=receipt['segments']
            shard.update(collectionOwner='shard',collectionEnabled=True,handoverCommit=head,status='collecting')
        assert count==len(original['segments']), 'Checkpoint loss or duplicate ownership'
        cfg.update(mode='collecting',revision='collection-operations-v3',note='10개 지역 수집기 가동; 10개 증설 대기. 기존 웹 조회와 Pages 전환은 별도 관리.',handover={'sourceCommit':head,'verifiedSegments':count,'records':sum(v['records'] for v in original['segments'].values()),'verifiedAt':s.utc()})
        path.write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+'\n')
    assert 'Legacy source collection is disabled' in (ROOT/'.github/workflows/collect-transactions.yml').read_text()
    p=ROOT/'scripts/distribution/expand_pool.py';t=p.read_text()
    t=replace(t,'    return result',"    if config.get('mode')=='collecting':\n        result['revision']=config['revision'];result['note']=config['note']\n    return result");p.write_text(t)
    p=ROOT/'scripts/distribution/test_shards.py';t=p.read_text();t=replace(t,"        self.assertTrue(s.legacy_allows(self.config,code))","        self.config['shards'][0]['collectionOwner']='legacy'\n        self.assertTrue(s.legacy_allows(self.config,code))");p.write_text(t)
    p=ROOT/'data-status.html';t=p.read_text()
    if './collection-status.js' not in t:t=replace(t,'<script src="./data-status.js','<script src="./collection-status.js?v=20261110.ops3"></script><script src="./data-status.js')
    t=re.sub(r'data-status.js\?v=[^"\']+','data-status.js?v=20261110.ops3',t);p.write_text(t)
    p=ROOT/'scripts/build-pages.mjs';t=p.read_text()
    if '"collection-status.js"' not in t:t=replace(t,'const publicFiles = [','const publicFiles = [\n  "collection-status.js",')
    p.write_text(t)
    p=ROOT/'data-status.js';t=p.read_text()
    t=replace(t,'  async function live(){','  async function live(){\n    if(!storage)return;\n    if(window.TojiCollectionOps?.live(storage,shardReports))return;')
    t=replace(t,"['전국 기반자료 수집','매 10분','미수집 구간 배치 처리 · 완료 시 종료']","['전국 기반자료 수집',storage?.mode==='collecting'?'지역별 매시간':'매 10분','미수집 구간 이어서 수집']")
    t=replace(t,"['정기 최신화','매일 04:00','KST · 최근 3개월 재확인']","['정기 최신화',storage?.mode==='collecting'?'수집 배치마다':'매일 04:00','최근 3개월 재확인 · 과거 수집 병행']")
    t=replace(t,"['접근 보류 유형',fmt(s.cooldownStreams),'API 권한 문제 · 재시도 시각 적용']","['접근 보류 레포·유형',fmt(s.cooldownStreams),'재시도 시각 적용 · 레포별 합계']")
    a="      const data=await get(remote?owner.pagesBaseUrl+'status-'+d.code+'.json':'./data/transactions/status/'+d.code+'.json');host.replaceChildren();"
    b="      const collected=window.TojiCollectionOps?.authoritative(owner,shardReports[owner?.id]);\n      const data=await get(collected?'https://raw.githubusercontent.com/'+owner.repository+'/main/data/transactions/status/'+d.code+'.json':remote?owner.pagesBaseUrl+'status-'+d.code+'.json':'./data/transactions/status/'+d.code+'.json');host.replaceChildren();"
    t=replace(t,a,b)
    t=replace(t,"setInterval(()=>{if(!document.hidden)void live();},60000)","setInterval(()=>{if(!document.hidden){void load();void live();}},60000)")
    p.write_text(t)
    print(json.dumps({'enabled':sum(bool(s.get('collectionEnabled')) for s in cfg['shards']),'handover':cfg['handover']},ensure_ascii=False))
if __name__=='__main__':main()
