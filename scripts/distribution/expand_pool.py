#!/usr/bin/env python3
"""Add empty capacity slots without moving existing collection ownership or data."""
import copy
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

def expand(config, count=20):
    if config.get('schemaVersion') != 3: raise ValueError('Expected version 3 registry')
    if not 10 <= count <= 100: raise ValueError('Pool size outside reviewed range')
    result = copy.deepcopy(config)
    existing = {s['id'] for s in result['shards']}
    if len(existing) != len(result['shards']): raise ValueError('Duplicate shard identity')
    for number in range(1, count + 1):
        name = f'realestate-data-{number:03}'
        if name in existing: continue
        result['shards'].append({
            'id':name,'label':f'{number:03} · 증설 대기','repository':'softm/'+name,
            'status':'standby','role':'reserve','districtCodes':[],'regions':[],
            'activeDistrictCount':0,'collectionOwner':'paused','serving':'legacy','handoverCommit':None,
            'pagesBaseUrl':'https://softm.github.io/'+name+'/','publishedBytes':None})
    result['shards'].sort(key=lambda s:s['id'])
    result['revision']='regional-workers-v2-pool20'
    result['note']='20개 저장소를 등록했습니다. 기존 10개 지역 배정은 유지하며, 새 저장소는 중복 수집 없이 증설 대기합니다. 본수집 이관과 Pages 게시 상태는 별도입니다.'
    hard=int(result['allocation']['maxPublishedBytes']);rotate=int(result['allocation']['rotateAtBytes'])
    result['pool']={'repositoryCount':len(result['shards']),'reservedCount':sum(not s['districtCodes'] for s in result['shards']),
                    'maxPublishedBytes':hard*len(result['shards']),'rotationCapacityBytes':rotate*len(result['shards'])}
    if config.get('mode')=='collecting':
        result['revision']=config['revision'];result['note']=config['note']
    return result

if __name__=='__main__':
    target=ROOT/'data/transactions/storage-registry.json'
    updated=expand(json.loads(target.read_text()))
    target.write_text(json.dumps(updated,ensure_ascii=False,indent=2)+'\n')
    print('20 capacity slots registered. Existing data and ownership unchanged.')
