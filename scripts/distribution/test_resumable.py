import json, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parent))
import shards as s
import operations as o
from resumable import ResumableMonths, pending_tasks

class ResumeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.district={'code':'41210','name':'경기도 광명시','active':True,'sido':'41','sidoName':'경기도'}
        self.reg={'districts':[self.district]}
        self.pipe=s.Pipeline(self.root,self.reg,asof='2026-11-12')
        self.stream=s.STREAMS['rowHouse-sale'];self.key='41210/rowHouse-sale/202610'
        self.config={'requestBudget':{'perRun':8,'perHour':8,'perDay':160}}
    def tearDown(self):self.tmp.cleanup()
    def client(self, total, budget=8, change_check=False, error_page=None):
        outer=self
        class Fake(ResumableMonths):
            def __init__(self,pipe=None,budget_override=None):
                self.pipe=pipe or outer.pipe;self.calls=0;self.max_requests=budget_override or budget;self.trace=[]
            def page(self,stream,code,month,page):
                if self.calls>=self.max_requests:raise s.SourceError('REQUEST_BUDGET')
                self.calls+=1;self.trace.append(page)
                if page==error_page:raise s.SourceError('NETWORK_TIMEOUT')
                count=min(1000,max(0,total-(page-1)*1000))
                rows=[{'dealYear':2026,'dealMonth':10,'dealDay':1,'sggCd':code,
                       'umdNm':'광명동','jibun':'94-9','dealAmount':str(50000+(page-1)*1000+i),
                       'excluUseAr':'59.7','floor':str(i%10)} for i in range(count)]
                if change_check and page==1 and (self.pipe.state.get('pendingSegments',{}).get(outer.key,{}).get('rows') or 0)>=total:
                    rows[0]['dealAmount']='999999'
                return total,rows
        return Fake
    def test_nine_pages_resume_after_eight_without_starting_over(self):
        first=self.client(8001)()
        with self.assertRaises(s.SourceError) as error:first.month(self.stream,self.district,'202610')
        self.assertEqual(error.exception.code,'REQUEST_BUDGET')
        self.assertEqual(first.trace,list(range(1,9)));self.assertEqual(self.pipe.state['segments'],{})
        self.pipe=s.Pipeline(self.root,self.reg,asof='2026-11-12')
        second=self.client(8001)();rows=second.month(self.stream,self.district,'202610')
        self.assertEqual(second.trace,[9,1]);self.assertEqual(len(rows),8001)
        self.pipe.put(self.key,rows,'public_api');second.finish_segment(self.stream,self.district,'202610')
        self.assertEqual(self.pipe.state['segments'][self.key]['sourceRows'],8001)
        self.assertNotIn(self.key,self.pipe.state['pendingSegments'])
    def test_old_verified_month_remains_on_budget_exit(self):
        self.pipe.put(self.key,[],'public_api');before=self.pipe.state['segments'][self.key]['sha256']
        with self.assertRaises(s.SourceError):self.client(8001)().month(self.stream,self.district,'202610')
        self.assertEqual(self.pipe.state['segments'][self.key]['sha256'],before)
    def test_first_page_recheck_is_budgeted_and_resumable(self):
        first=self.client(2000,budget=2)()
        with self.assertRaises(s.SourceError):first.month(self.stream,self.district,'202610')
        self.assertEqual(first.trace,[1,2])
        second=self.client(2000)();self.assertEqual(len(second.month(self.stream,self.district,'202610')),2000)
        self.assertEqual(second.trace,[1])
    def test_changed_source_discards_pending_not_verified(self):
        self.pipe.put(self.key,[],'public_api');before=self.pipe.state['segments'][self.key]['sha256']
        with self.assertRaises(s.SourceError) as error:self.client(1001,change_check=True)().month(self.stream,self.district,'202610')
        self.assertEqual(error.exception.code,'SOURCE_CHANGED_DURING_PAGING')
        self.assertEqual(self.pipe.state['segments'][self.key]['sha256'],before)
        self.assertNotIn(self.key,self.pipe.state['pendingSegments'])
    def test_network_failure_retains_completed_pages(self):
        with self.assertRaises(s.SourceError):self.client(2001,error_page=2)().month(self.stream,self.district,'202610')
        self.assertEqual(self.pipe.state['pendingSegments'][self.key]['rows'],1000)
        second=self.client(2001)();self.assertEqual(len(second.month(self.stream,self.district,'202610')),2001)
        self.assertEqual(second.trace,[2,3,1])
    def test_tampered_staging_is_rejected_before_network(self):
        with self.assertRaises(s.SourceError):self.client(1001,budget=1)().month(self.stream,self.district,'202610')
        (self.pipe.base/'pending'/self.key/'0001.json.gz').write_bytes(b'broken')
        second=self.client(1001)()
        with self.assertRaises(s.SourceError) as error:second.month(self.stream,self.district,'202610')
        self.assertEqual(error.exception.code,'PENDING_HASH_MISMATCH');self.assertEqual(second.calls,0)
    def test_empty_month_is_complete_not_missing(self):
        client=self.client(0)();self.assertEqual(client.month(self.stream,self.district,'202610'),[])
        self.assertEqual(client.trace,[1])
    def test_partial_scope_gets_priority_without_duplicate_requests(self):
        with self.assertRaises(s.SourceError):self.client(1001,budget=1)().month(self.stream,self.district,'202610')
        tasks=list(o.task_queue(self.pipe,'auto'))
        self.assertEqual(tasks[0],self.key);self.assertEqual(tasks.count(self.key),1)
    def test_operations_reports_partial_pages_and_resumes(self):
        with patch.dict(os.environ,{'MOLIT_API_KEY':'fake-only'}),patch.object(o,'task_queue',lambda *a:iter([self.key])):
            first=o.collect(self.pipe,self.config,'backfill',self.client(8001))
            self.assertEqual(first['pendingPages'],8);self.assertEqual(first['status'],'deferred')
            second=o.collect(self.pipe,self.config,'backfill',self.client(8001))
        self.assertEqual(second['success'],1);self.assertEqual(second['requests'],2)
        self.assertEqual(second['pendingSegments'],0)
        self.assertNotIn('fake-only',json.dumps(self.pipe.state))

if __name__=='__main__':unittest.main()
