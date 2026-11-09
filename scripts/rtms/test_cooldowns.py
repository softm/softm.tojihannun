"""Regression tests for non-hammering nationwide backfill and honest job semantics."""
import sys, tempfile, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from collector import Pipeline, cooldown_active, retry_delay, run_exit_code
from formats import SourceError
REG={'schemaVersion':1,'districts':[
  {'code':'41210','name':'경기도 광명시','sido':'41','sidoName':'경기도','active':True},
  {'code':'44210','name':'충청남도 서산시','sido':'44','sidoName':'충청남도','active':True}
]}
class CooldownTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.pipe=Pipeline(self.temp.name,REG,'2026-11-09')
 def tearDown(self):self.temp.cleanup()
 def test_403_blocks_whole_stream_not_unrelated_categories(self):
  p=self.pipe
  p.fail('41210/rowHouse-rent/202611',SourceError('403'))
  self.assertEqual(list(p.plan('backfill',['41210','44210'],['rowHouse-rent'])),[])
  other=next(p.plan('backfill',['41210'],['apartment-sale']))
  self.assertEqual(other,'41210/apartment-sale/202611')
  self.assertEqual(p.state['streamCooldowns']['rowHouse-rent']['code'],'403')
  self.assertTrue(cooldown_active(p.state['streamCooldowns']['rowHouse-rent']))
 def test_403_cooldown_persists_across_processes(self):
  p=self.pipe
  p.fail('41210/rights-sale/202611',SourceError('403'))
  reloaded=Pipeline(self.temp.name,REG,'2026-11-09')
  self.assertFalse(any(True for _ in reloaded.plan('backfill',['44210'],['rights-sale'])))
 def test_network_timeout_skips_only_failing_month(self):
  p=self.pipe
  p.fail('41210/apartment-sale/202611',SourceError('NETWORK_TIMEOUT'))
  self.assertFalse('apartment-sale' in p.state.get('streamCooldowns',{}))
  first=next(p.plan('backfill',['41210'],['apartment-sale']))
  self.assertEqual(first,'41210/apartment-sale/202610')
 def test_exponential_backoff_has_ceiling(self):
  self.assertEqual(retry_delay('403',3),86400)
  self.assertEqual(retry_delay('NETWORK_TIMEOUT',1),600)
  self.assertEqual(retry_delay('NETWORK_TIMEOUT',2),1200)
  self.assertLessEqual(retry_delay('NETWORK_TIMEOUT',100),4*3600)
 def test_rate_limit_creates_global_cooldown(self):
  p=self.pipe;p.fail('41210/land-sale/202610',SourceError('429'))
  self.assertTrue(cooldown_active(p.state['apiCooldown']))
  self.assertEqual(p.state['apiCooldown']['code'],'429')
 def test_expired_cooldown_is_eligible(self):
  p=self.pipe;p.fail('41210/rowHouse-rent/202611',SourceError('403'))
  p.state['streamCooldowns']['rowHouse-rent']['nextRetryAt']=(datetime.now(timezone.utc)-timedelta(seconds=10)).isoformat()
  p.state['failures']['41210/rowHouse-rent/202611']['nextRetryAt']=(datetime.now(timezone.utc)-timedelta(seconds=10)).isoformat()
  self.assertEqual(next(p.plan('backfill',['41210'],['rowHouse-rent'])),'41210/rowHouse-rent/202611')
 def test_partial_success_is_job_success_but_not_full_completion(self):
  self.assertEqual(run_exit_code({'status':'partial','success':90,'failed':6}),0)
  self.assertEqual(run_exit_code({'status':'partial','success':0,'failed':6}),1)
  self.assertEqual(run_exit_code({'status':'failed','success':90,'failed':1}),1)
  self.assertEqual(run_exit_code({'status':'deferred','success':0}),0)
if __name__=='__main__':unittest.main()
