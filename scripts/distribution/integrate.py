#!/usr/bin/env python3
"""One-time, idempotent integration. Keep generated source tracked and reviewable.
Existing user changes or a configured shard registry are never overwritten.
"""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def replace_once(text,before,after):
    if text.count(before)!=1:raise ValueError('Integration anchor changed: '+before[:70])
    return text.replace(before,after)
def integrate():
    base=ROOT/'data/transactions';config=json.loads((base/'storage-registry.json').read_text())
    if config.get('schemaVersion')!=3:
        official=json.loads((base/'registry.json').read_text());groups={i:[] for i in range(1,11)}
        lists={s:sorted(d['code'] for d in official['districts'] if d['sido']==s) for s in ('11','41')}
        for d in official['districts']:
            code,sido=d['code'],d['sido']
            if sido=='11':i=1+lists[sido].index(code)%2
            elif sido=='41':i=3+lists[sido].index(code)%2
            elif sido in ('23','28','42','51'):i=5
            elif sido in ('25','30','36','43','44'):i=6
            elif sido in ('12','24','29','45','46','52'):i=7
            elif sido in ('21','26','31','49','50'):i=8
            elif sido in ('22','27','47'):i=9
            elif sido=='48':i=10
            else:raise ValueError('Review new official province code: '+sido)
            groups[i].append(code)
        labels=['서울 A','서울 B','경기 A','경기 B','인천·강원','충청','호남','부산·울산·제주','대구·경북','경남']
        config={'schemaVersion':3,'revision':'regional-workers-v1','mode':'staged',
            'bootstrapSourceRef':'f328c729eece4fe45f1b403a1af1fcd62fa5de46',
            'note':'10개 지역 저장소에 기존 체크포인트를 복제합니다. 검증된 담당 이관 전에는 기존 수집·조회가 유지됩니다.',
            'allocation':{'unit':'bytes','maxPublishedBytes':1000000000,'rotateAtBytes':900000000,'onHardLimit':'block-deployment','onThreshold':'pause-and-propose-split','verifyBeforeDelete':True},
            'requestBudget':{'perRun':8,'perHour':8,'perDay':160,'scope':'per-shard; ten activated shards total at most 80 requests/hour and 1600/day, excluding legacy work'},
            'naming':{'owner':'softm','prefix':'realestate-data-','digits':3},'shards':[]}
        for i in range(1,11):
            sid=f'realestate-data-{i:03}';ds=[d for d in official['districts'] if d['code'] in groups[i]]
            config['shards'].append({'id':sid,'label':f'{i:03} · '+labels[i-1],'repository':'softm/'+sid,'status':'provisioning',
                'districtCodes':sorted(groups[i]),'regions':sorted({d['sidoName'] for d in ds if d['active']}),
                'activeDistrictCount':sum(d['active'] for d in ds),'collectionOwner':'legacy','serving':'legacy','handoverCommit':None,
                'pagesBaseUrl':'https://softm.github.io/'+sid+'/','publishedBytes':None})
        (base/'storage-registry.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
    path=ROOT/'scripts/rtms/collector.py';text=path.read_text()
    if 'def collection_owners(base):' not in text:
        text=replace_once(text,'def month_range(start,end):',"""def collection_owners(base):
    config=read_json(Path(base)/'storage-registry.json',{})
    if config.get('schemaVersion')!=3:return {}
    owners={}
    for shard in config.get('shards',[]):
        owner=shard.get('collectionOwner')
        if owner not in ('legacy','paused','shard'):raise SourceError('INVALID_COLLECTION_OWNER')
        for code in shard['districtCodes']:
            if code in owners:raise SourceError('DUPLICATE_COLLECTION_OWNER')
            owners[code]=owner
    return owners

def month_range(start,end):""")
        text=replace_once(text,"        if not districts:raise SourceError('IMPORT_REGION_NOT_FOUND')","        if not districts:raise SourceError('IMPORT_REGION_NOT_FOUND')\n        owners=collection_owners(self.base)\n        if any(owners.get(d['code'],'legacy')!='legacy' for d in districts):raise SourceError('IMPORT_REGION_OWNERSHIP_MOVED')")
        text=replace_once(text,'        streams=streams or list(STREAMS)','        streams=streams or list(STREAMS)\n        owners=collection_owners(self.base)\n        codes=[c for c in codes if owners.get(c,\'legacy\')==\'legacy\']')
        path.write_text(text)
    path=ROOT/'data-status.js';text=path.read_text()
    if 'shardReports={}' not in text:
        text=replace_once(text,'  let model=null, storage=null;','  let model=null, storage=null, shardReports={}, loadVersion=0;')
        text=replace_once(text,'  function renderShards(){','  function renderShards(){\n    if(storage?.schemaVersion===3&&window.TojiDistributedStatus)return window.TojiDistributedStatus.render(storage,shardReports);')
        text=replace_once(text,"      const data=await get('./data/transactions/status/'+d.code+'.json');host.replaceChildren();","      const owner=storageFor(d.code),remote=owner?.serving==='pages'&&shardReports[owner.id]?.source==='pages';\n      const data=await get(remote?owner.pagesBaseUrl+'status-'+d.code+'.json':'./data/transactions/status/'+d.code+'.json');host.replaceChildren();")
        a=text.index('  async function load(){');b=text.index("  $('search').oninput",a)
        text=text[:a]+"""  async function load(){
    const version=++loadVersion;
    try{
      const [manifest,registry]=await Promise.all([get('./data/transactions/status-manifest.json'),get('./data/transactions/storage-registry.json').catch(()=>null)]);
      if(version!==loadVersion)return;model=manifest;storage=registry;render();
      if(storage?.schemaVersion===3&&window.TojiDistributedStatus){
        const reports=await window.TojiDistributedStatus.load(storage);if(version!==loadVersion)return;
        shardReports=reports;model=window.TojiDistributedStatus.merge(manifest,storage,reports);render();
      }
    }catch(e){if(version===loadVersion)$('notice').textContent='수집 현황 조회 실패: '+e.message;}
  }
"""+text[b:]
        path.write_text(text)
    path=ROOT/'data-status.html';text=path.read_text()
    if './distributed-status.js' not in text:
        text=replace_once(text,'<script src="./data-status.js','<script src="./distributed-status.js?v=20261110.5"></script><script src="./data-status.js')
    text=text.replace('data-status.js?v=20261110.4','data-status.js?v=20261110.5');path.write_text(text)
    path=ROOT/'scripts/build-pages.mjs';text=path.read_text()
    if '"distributed-status.js"' not in text:text=replace_once(text,'const publicFiles = [','const publicFiles = [\n  "distributed-status.js",')
    path.write_text(text)
    print('Distributed integration ready; existing data, collection ownership and service routes preserved.')
if __name__=='__main__':integrate()
