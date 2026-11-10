import gzip, json, shutil, sys, tempfile, unittest
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).resolve().parent))
import shards as s

class DistributionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.config=json.loads((s.ENGINE/'data/transactions/storage-registry.json').read_text())
        self.official=json.loads((s.ENGINE/'data/transactions/registry.json').read_text())
    def tearDown(self):self.tmp.cleanup()
    def test_every_active_region_assigned_once(self):
        m=s.shard_map(self.config)
        self.assertTrue(all(d['code'] in m for d in self.official['districts'] if d['active']))
        self.assertEqual(len(m),len(self.official['districts']))
        self.assertEqual(len(self.config['shards']),10)
    def test_duplicate_ownership_rejected(self):
        self.config['shards'][1]['districtCodes'].append(self.config['shards'][0]['districtCodes'][0])
        with self.assertRaises(ValueError):s.shard_map(self.config)
    def test_unknown_codes_rejected(self):
        self.config['shards'][0]['districtCodes'].append('99999')
        with self.assertRaises(ValueError):s.owned(self.config,'realestate-data-001',self.official)
    def test_only_same_owner_pages(self):
        self.config['shards'][0]['pagesBaseUrl']='https://attacker.example/'
        with self.assertRaises(ValueError):s.shard_map(self.config)
    def test_handover_pauses_legacy_first(self):
        code=self.config['shards'][0]['districtCodes'][0]
        self.assertTrue(s.legacy_allows(self.config,code))
        self.config['shards'][0]['collectionOwner']='paused';self.assertFalse(s.legacy_allows(self.config,code))
        self.config['shards'][0]['collectionOwner']='shard';self.assertFalse(s.legacy_allows(self.config,code))
    def test_shard_cannot_run_without_verified_final_snapshot(self):
        with self.assertRaises(ValueError):s.check_handover(self.root,self.config['shards'][0])
    def test_exact_final_snapshot_required(self):
        shard={**self.config['shards'][0],'handoverCommit':'a'*40}
        s.write_json(self.root/'migration-receipt.json',{'sourceCommit':'b'*40})
        with self.assertRaises(ValueError):s.check_handover(self.root,shard)
        s.write_json(self.root/'migration-receipt.json',{'sourceCommit':'a'*40});s.check_handover(self.root,shard)
    def test_hourly_request_budget_shared_by_manual_reruns(self):
        now=datetime.now(timezone.utc);state={'requestLedger':[{'at':now.isoformat(),'requests':6}]}
        self.assertEqual(s.request_budget(state,self.config,now),2)
        state['requestLedger'][0]['requests']=8;self.assertEqual(s.request_budget(state,self.config,now),0)
    def test_one_gb_means_decimal_and_includes_all_files(self):
        self.config['allocation'].update(maxPublishedBytes=100,rotateAtBytes=90)
        (self.root/'data.gz').write_bytes(b'a'*80);(self.root/'index.json').write_bytes(b'a'*10)
        cap=s.capacity(self.root,self.config);self.assertEqual(cap['publishedBytes'],90);self.assertTrue(cap['needsSplit'])
        (self.root/'meta.json').write_bytes(b'a'*10)
        with self.assertRaises(ValueError):s.capacity(self.root,self.config)
    def test_symbolic_links_not_published(self):
        (self.root/'link').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):s.capacity(self.root,self.config)
    def test_real_checkpoint_bootstrap_keeps_hashes_and_failures(self):
        shard,registry=s.owned(self.config,'realestate-data-003',self.official)
        receipt=s.bootstrap(self.root,s.ENGINE,set(shard['districtCodes']),'a'*40)
        state=s.load(self.root/'data/transactions/collection-state.json')
        self.assertGreater(receipt['segments'],0)
        self.assertEqual(receipt['segments'],len(state['segments']))
        self.assertTrue(all(k[:5] in shard['districtCodes'] for k in state['segments']))
        self.assertTrue(all(k[:5] in shard['districtCodes'] for k in state['failures']))
        self.assertTrue(all(s.digest((self.root/'data/transactions/segments'/(k+'.json.gz')).read_bytes())==v['sha256'] for k,v in state['segments'].items()))
    def test_corrupt_bootstrap_rejected_before_writes(self):
        src=self.root/'src';(src/'data/transactions/segments/41210/land-sale').mkdir(parents=True)
        s.write_json(src/'data/transactions/collection-state.json',{'segments':{'41210/land-sale/202610':{'sha256':'bad','sourceRows':0}}})
        (src/'data/transactions/segments/41210/land-sale/202610.json.gz').write_bytes(b'bad')
        with self.assertRaises(ValueError):s.bootstrap(self.root/'worker',src,{'41210'},'a'*40)
        self.assertFalse((self.root/'worker/data/transactions/collection-state.json').exists())
    def test_gzip_only_pages_and_size_accurate(self):
        shard,registry=s.owned(self.config,'realestate-data-003',self.official)
        s.bootstrap(self.root,s.ENGINE,set(shard['districtCodes']),'a'*40)
        pipe=s.Pipeline(self.root,registry)
        result=s.publish(pipe,self.root,self.config,shard,{'status':'mirroring','requests':0})
        self.assertEqual(s.total_bytes(self.root/'site'),result['capacity']['publishedBytes'])
        chunks=list((self.root/'site/published').rglob('*.gz'));self.assertTrue(chunks)
        for p in chunks:
            self.assertFalse(p.with_suffix('').exists())
            self.assertEqual(json.loads(gzip.decompress(p.read_bytes()))['schemaVersion'],2)
        self.assertFalse((self.root/'site/collection-state.json').exists())
        self.assertFalse((self.root/'site/segments').exists())
        self.assertFalse(result['deployment']['verified'])
    def test_no_key_is_blocked_not_fabricated_success(self):
        import os
        before=os.environ.pop('MOLIT_API_KEY',None)
        try:
            pipe=s.Pipeline(self.root,{'districts':[]})
            result=s.collect(pipe,self.config,'backfill')
            self.assertEqual(result['status'],'blocked');self.assertEqual(result['requests'],0)
        finally:
            if before is not None:os.environ['MOLIT_API_KEY']=before

if __name__=='__main__':unittest.main()
