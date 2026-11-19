import json, os, sys, tempfile, unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parent))
import operations as o
import shards as s

class OperationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.reg={'districts':[{'code':'41210','name':'경기도 광명시','active':True,'sido':'41','sidoName':'경기도'}]}
        self.pipe=s.Pipeline(self.root,self.reg,asof='2026-11-10')
        self.config={'requestBudget':{'perRun':8,'perDay':8}}
    def tearDown(self):self.tmp.cleanup()
    def test_missing_key_is_persisted_and_never_requests(self):
        with patch.dict(os.environ,{},clear=True):
            r=o.collect(self.pipe,self.config,'backfill')
        self.assertEqual(r['status'],'blocked');self.assertEqual(r['requests'],0)
        self.assertEqual(s.load(self.pipe.base/'collection-state.json')['lastRun']['status'],'blocked')
    def test_budget_deferral_is_persisted(self):
        self.pipe.state['requestLedger']=[{'at':s.utc(),'requests':8}]
        with patch.dict(os.environ,{'MOLIT_API_KEY':'test-not-real'}):
            r=o.collect(self.pipe,self.config,'backfill')
        self.assertEqual(r['stopReason'],'LOCAL_REQUEST_BUDGET')
        self.assertTrue(r['finishedAt'])
    def test_shared_quota_error_stops_run(self):
        class Client:
            def __init__(self,*a):self.calls=0
            def month(self,*a):self.calls+=1;raise s.SourceError('429')
        with patch.dict(os.environ,{'MOLIT_API_KEY':'test-not-real'}):
            r=o.collect(self.pipe,self.config,'backfill',Client)
        self.assertGreater(r['requests'],0);self.assertEqual(r['status'],'failed')
        self.assertTrue(self.pipe.state.get('streamCooldowns'))
    def test_network_timeout_only_batch_is_deferred_for_retry(self):
        class Client:
            def __init__(self,*a):self.calls=0
            def month(self,*a):self.calls+=1;raise s.SourceError('NETWORK_TIMEOUT')
        with patch.dict(os.environ,{'MOLIT_API_KEY':'test-not-real'}):
            r=o.collect(self.pipe,self.config,'backfill',Client)
        self.assertEqual(r['requests'],8)
        self.assertEqual(r['failed'],8)
        self.assertEqual(r['status'],'deferred')
        self.assertEqual(r['stopReason'],'NETWORK_TIMEOUT')
    def test_valid_empty_month_is_a_successful_response(self):
        class Client:
            def __init__(self,*a):self.calls=0
            def month(self,*a):self.calls+=1;return []
        with patch.dict(os.environ,{'MOLIT_API_KEY':'test-not-real'}):
            r=o.collect(self.pipe,self.config,'backfill',Client)
        self.assertEqual(r['success'],8);self.assertEqual(len(self.pipe.state['segments']),8)
        self.assertEqual(r['status'],'success')
    def test_resolved_source_anomaly_cooldowns_are_reopened(self):
        tasks=['41210/detached-rent/202008','41210/land-sale/202008']
        self.pipe.fail(tasks[0],s.SourceError('INVALID_RENT'))
        self.pipe.fail(tasks[1],s.SourceError('MISSING_LEGAL_DONG'))
        reopened=o.reopen_resolved_source_anomalies(self.pipe)
        self.assertEqual(reopened,sorted(tasks))
        self.assertTrue(all(task not in self.pipe.state['failures'] for task in tasks))
    def test_local_batch_boundary_is_not_a_failed_month(self):
        class Client:
            def __init__(self,*a):self.calls=1
            def month(self,*a):raise s.SourceError('REQUEST_BUDGET')
        with patch.dict(os.environ,{'MOLIT_API_KEY':'test-not-real'}):
            r=o.collect(self.pipe,self.config,'auto',Client)
        self.assertEqual(r['failed'],0);self.assertEqual(self.pipe.state['failures'],{})
        self.assertEqual(r['status'],'deferred')
    def test_stream_denial_does_not_block_other_streams(self):
        class Client:
            def __init__(self,*a):self.calls=0
            def month(self,stream,*a):
                self.calls+=1
                if stream['id']=='land-sale':raise s.SourceError('403')
                return []
        with patch.dict(os.environ,{'MOLIT_API_KEY':'test-not-real'}):
            r=o.collect(self.pipe,self.config,'backfill',Client)
        self.assertGreater(r['success'],0);self.assertEqual(r['status'],'partial')
    def test_reservation_exists_before_network(self):
        def request(client,*args):
            ledger=s.load(self.pipe.base/'collection-state.json')['requestLedger']
            self.assertEqual(ledger[-1]['requests'],1)
            client.calls+=1
            return 0,[]
        with patch.dict(os.environ,{'MOLIT_API_KEY':'test-not-real'}),patch.object(s.Client,'page',request):
            c=o.BudgetedClient(self.pipe,self.config,8);c.page({'id':'land-sale'},'41210','202611',1)
        self.assertEqual(s.request_budget(self.pipe.state,self.config),7)
    def test_failure_message_never_leaks_key(self):
        class Client:
            def __init__(self,*a):self.calls=1
            def month(self,*a):raise ValueError('secret-should-not-appear')
        with patch.dict(os.environ,{'MOLIT_API_KEY':'secret-should-not-appear'}):
            r=o.collect(self.pipe,self.config,'auto',Client)
        self.assertEqual(r['status'],'failed')
        self.assertNotIn('secret-should-not-appear',json.dumps(r))
    def test_auto_refresh_and_backfill_are_deduplicated(self):
        tasks=list(o.task_queue(self.pipe,'auto'))
        self.assertEqual(len(tasks),len(set(tasks)))
        refresh=set(self.pipe.plan('refresh'))
        self.assertTrue(refresh.intersection(tasks))
        self.assertTrue(any('/' in t for t in tasks))

    def test_scheduled_revalidation_waits_for_full_backfill(self):
        self.assertEqual(list(o.task_queue(self.pipe,'refresh-year')), [])
        self.assertEqual(list(o.task_queue(self.pipe,'audit-history')), [])

    def test_weekly_revalidation_targets_latest_twelve_calendar_months(self):
        with patch.object(o,'current_phase',return_value=None):
            tasks=list(o.task_queue(self.pipe,'refresh-year'))
        months={task.split('/')[2] for task in tasks}
        self.assertTrue(months)
        self.assertEqual(min(months),'202512')
        self.assertEqual(max(months),'202611')
        self.assertEqual(len(months),12)
        self.assertEqual(len(tasks),len(set(tasks)))

    def test_monthly_history_audit_rotates_same_calendar_month_across_years(self):
        with patch.object(o,'current_phase',return_value=None):
            tasks=list(o.task_queue(self.pipe,'audit-history'))
        months={task.split('/')[2] for task in tasks}
        self.assertTrue(months)
        self.assertTrue(all(month.endswith('11') for month in months))
        self.assertIn('200611',months)
        self.assertIn('202611',months)
        self.assertEqual(len(tasks),len(set(tasks)))

if __name__=='__main__':unittest.main()
