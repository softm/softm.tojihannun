import io,json,tempfile,unittest,zipfile,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from formats import SourceError,exact_lot,api_page,normalize,table_rows
from collector import Pipeline,STREAMS,month_range
D={'code':'41210','name':'경기도 광명시','sido':'41','sidoName':'경기도','active':True}
REG={'schemaVersion':1,'districts':[D,{'code':'11110','name':'서울특별시 종로구','sido':'11','sidoName':'서울특별시','active':True}]}
ROW={'dealYear':'2020','dealMonth':'8','dealDay':'15','dealAmount':'31,000','excluUseAr':'59.7','floor':'3','umdNm':'광명동','jibun':'158-216','mhouseNm':'선영빌라','cdealDay':'-'}
class Formats(unittest.TestCase):
 def test_lot_disclosure(self):
  self.assertEqual(exact_lot('0158-0216'),'158-216')
  for s in ('1**','158-***','158-216대','158-',''):self.assertEqual(exact_lot(s),'')
 def test_all_categories_and_deals(self):
  self.assertEqual(len({s['category'] for s in STREAMS.values()}),8)
  self.assertEqual(sum(s['deal']=='rent' for s in STREAMS.values()),4)
 def test_api_count_required(self):
  with self.assertRaises(SourceError):api_page('<response><resultCode>000</resultCode></response>')
 def test_xml_and_json(self):
  for raw in ['<response><header><resultCode>000</resultCode></header><body><totalCount>1</totalCount><items><item><jibun>1-2</jibun></item></items></body></response>',json.dumps({'response':{'header':{'resultCode':'00'},'body':{'totalCount':1,'items':{'item':{'jibun':'1-2'}}}}})]:
   count,rows=api_page(raw);self.assertEqual(count,1);self.assertEqual(rows[0]['jibun'],'1-2')
 def test_error_stops_not_zero(self):
  with self.assertRaises(SourceError) as c:api_page('<response><resultCode>22</resultCode></response>')
  self.assertEqual(c.exception.code,'22')
 def test_contract_identity(self):
  r=normalize(ROW,D,STREAMS['rowHouse-sale'],'202008')
  self.assertEqual(r['amount'],31000);self.assertEqual(r['area'],59.7);self.assertFalse(r['cancelled'])
  with self.assertRaises(SourceError):normalize(ROW,D,STREAMS['rowHouse-sale'],'201607')
 def test_cancelled_and_masked(self):
  r=normalize({**ROW,'cdealDay':'2026.10.01','jibun':'1**'},D,STREAMS['rowHouse-sale'])
  self.assertTrue(r['cancelled']);self.assertFalse(r['exactLotPublic'])
 def test_rent_zero_deposit_allowed(self):
  r=normalize({**ROW,'deposit':'0','monthlyRent':'50'},D,STREAMS['rowHouse-rent'])
  self.assertEqual(r['monthlyRent'],50)
 def test_month_plan(self):self.assertEqual(month_range('2026-09-01','2026-11-09'),['202609','202610','202611'])
 def test_csv_export_with_intro(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'a.csv';p.write_text('안내\n시군구,번지,계약년월,계약일,거래금액(만원),전용면적(㎡)\n경기도 광명시 광명동,158-216,202008,15,"31,000",59.7\n',encoding='utf-8-sig')
   rows=list(table_rows(p));self.assertEqual(len(rows),1)
   self.assertEqual(normalize(rows[0],D,STREAMS['rowHouse-sale'])['jibun'],'158-216')
 def test_xlsx_streamed_inline_strings(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'a.xlsx'
   sheet='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
   for n,values in enumerate([['시군구','번지','계약년월','계약일','거래금액(만원)','전용면적(㎡)'],['경기도 광명시 광명동','158-216','202008','15','31000','59.7']],1):
    sheet+=f'<row r="{n}">'+''.join(f'<c r="{chr(65+i)}{n}" t="inlineStr"><is><t>{v}</t></is></c>' for i,v in enumerate(values))+'</row>'
   sheet+='</sheetData></worksheet>'
   with zipfile.ZipFile(p,'w') as z:z.writestr('xl/worksheets/sheet1.xml',sheet)
   self.assertEqual(len(list(table_rows(p))),1)
class Persistence(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.p=Pipeline(self.tmp.name,REG,'2026-11-09');self.row=normalize(ROW,D,STREAMS['rowHouse-sale'])
 def tearDown(self):self.tmp.cleanup()
 def test_preserve_previous_on_failure(self):
  key='41210/rowHouse-sale/202008';self.p.put(key,[self.row],'test');self.p.fail(key,SourceError('429'))
  self.assertEqual(self.p.old_rows(key),[self.row]);self.assertTrue(self.p.state['failures'][key]['preserved'])
 def test_same_looking_transactions_not_lost(self):
  r=self.p.put('41210/rowHouse-sale/202008',[self.row,self.row],'test');self.assertEqual(r['records'],2)
 def test_revalidation_replaces_and_counts_removal(self):
  key='41210/rowHouse-sale/202008';self.p.put(key,[self.row],'test');r=self.p.put(key,[],'test')
  self.assertEqual(r['removed'],1);self.assertEqual(r['records'],0);self.assertEqual(self.p.old_rows(key),[])
 def test_resume_skips_successful_months(self):
  self.p.put('41210/rowHouse-sale/202611',[], 'test')
  tasks=list(self.p.plan('backfill',['41210'],['rowHouse-sale']))
  self.assertNotIn('41210/rowHouse-sale/202611',tasks);self.assertIn('41210/rowHouse-sale/200601',tasks)
 def test_unknown_region_stays_unknown(self):
  self.p.put('41210/rowHouse-sale/202008',[self.row],'test');self.p.publish();m=self.p.status()
  seoul=next(r for r in m['regions'] if r['code']=='11');self.assertIsNone(seoul['records'])
  idx=json.loads((self.p.public/'41210/index.json').read_text());self.assertEqual(idx['coverage']['rowHouse-sale'],['202008'])
 def test_scope_hash_integrity(self):
  key='41210/rowHouse-sale/202008';self.p.put(key,[self.row],'test');self.p.segment_path(key).write_bytes(b'wrong')
  with self.assertRaises(SourceError):self.p.publish()
 def test_xlsx_import_requires_verifiable_scope(self):
  p=Path(self.tmp.name)/'a.scope.json';p.write_text(json.dumps({'file':'a.xlsx'}))
  with self.assertRaises(SourceError):self.p.import_file(p)
if __name__=='__main__':unittest.main()
