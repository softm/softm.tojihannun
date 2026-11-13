import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import expand_pool
import readiness
import shards

class PoolTests(unittest.TestCase):
    def setUp(self): self.config=json.loads((shards.ENGINE/'data/transactions/storage-registry.json').read_text())
    def test_existing_ownership_and_checkpoints_are_preserved(self):
        original={**self.config,'shards':self.config['shards'][:10]}
        before=json.dumps(original['shards'],sort_keys=True);after=expand_pool.expand(original)
        self.assertEqual(before,json.dumps(after['shards'][:10],sort_keys=True))
        self.assertEqual(original['bootstrapSourceRef'],after['bootstrapSourceRef'])
        self.assertEqual(original['requestBudget'],after['requestBudget'])
    def test_twenty_slots_have_no_duplicate_collectors(self):
        expanded=expand_pool.expand(self.config);self.assertEqual(len(expanded['shards']),20)
        self.assertEqual(len(shards.shard_map(expanded)),len(shards.shard_map(self.config)))
        self.assertEqual(sum(bool(entry['districtCodes']) for entry in expanded['shards']),20)
        self.assertTrue(all(entry['collectionOwner']=='shard' for entry in expanded['shards']))
    def test_expansion_is_idempotent(self):
        self.assertEqual(expand_pool.expand(self.config),expand_pool.expand(expand_pool.expand(self.config)))
    def test_capacity_is_ceiling_not_current_usage(self):
        result=expand_pool.expand(self.config)
        self.assertEqual(result['pool']['maxPublishedBytes'],20_000_000_000)
        self.assertEqual(result['pool']['rotationCapacityBytes'],18_000_000_000)
        self.assertEqual(result['pool']['reservedCount'],0)
        self.assertTrue(all(s['publishedBytes'] is None for s in result['shards']))
    def test_new_reserved_worker_bootstrap_never_calls_api(self):
        import argparse
        with tempfile.TemporaryDirectory() as directory:
            control=Path(directory)/'control'
            (control/'data/transactions').mkdir(parents=True)
            expanded=expand_pool.expand(self.config,count=21)
            (control/'data/transactions/storage-registry.json').write_text(json.dumps(expanded))
            (control/'data/transactions/registry.json').write_text((shards.ENGINE/'data/transactions/registry.json').read_text())
            with patch.dict(os.environ,{'GITHUB_REPOSITORY':'softm/realestate-data-021'},clear=True), patch.object(shards,'collect',side_effect=AssertionError('Reserve called API')):
                args=argparse.Namespace(root=directory,control=str(control),legacy=str(shards.ENGINE),source_commit='a'*40,shard='realestate-data-021',mode='auto')
                with contextlib.redirect_stdout(io.StringIO()): self.assertEqual(shards.run(args),0)
                state=json.loads((Path(directory)/'shard-status.json').read_text())
                self.assertEqual(state['summary']['completedTasks'],0);self.assertEqual(state['collection']['requests'],0)
                self.assertEqual(state['districtCodes'],[])
    def test_key_value_not_logged_or_written(self):
        fake='not-a-real-key-test-only-0123456789'
        class Response:
            def __enter__(self):return io.StringIO('{"build_type":"workflow"}')
            def __exit__(self,*args):pass
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'GITHUB_REPOSITORY':'softm/realestate-data-020','MOLIT_API_KEY':fake,'GH_TOKEN':'fake-test-token'}), patch.object(readiness.urllib.request,'urlopen',return_value=Response()):
            old=os.getcwd();os.chdir(directory)
            try:
                output=io.StringIO()
                with contextlib.redirect_stdout(output): result=readiness.check()
                self.assertTrue(result['apiKeyConfigured']);self.assertTrue(result['pagesConfigured'])
                self.assertFalse(result['apiAccessVerified'])
                self.assertNotIn(fake,Path('readiness.json').read_text()+output.getvalue())
            finally:os.chdir(old)
