"""Strict readers for public RTMS XML/JSON and user-supplied XLSX/CSV.
Workbook parsing uses OOXML streaming, not Excel/LibreOffice or formula execution.
"""
import csv, io, json, re, zipfile, xml.etree.ElementTree as ET
from datetime import date
from decimal import Decimal, InvalidOperation

class SourceError(Exception):
    def __init__(self, code, message=''):
        self.code = str(code)
        super().__init__(message or self.code)


def clean_key(key):
    return re.sub(r'[\s\ufeff]', '', str(key)).lower()


def field(row, *keys):
    lookup = {clean_key(k):str(v).strip() for k,v in row.items() if v is not None}
    for key in keys:
        value=lookup.get(clean_key(key),'')
        if value not in ('', '-', 'null', 'None'): return value
    return ''


def number(value):
    value = str(value or '').strip().replace(',','').replace('㎡','')
    if value in ('','-'): return None
    try:
        result = Decimal(value)
        return float(result) if result.is_finite() else None
    except InvalidOperation: return None


def exact_lot(value):
    # NEVER remove stars or infer a suffix. Display-label suffixes belong to the map parser only.
    match=re.fullmatch(r'(산)?\s*(\d+)(?:\s*-\s*(\d+))?', str(value or '').strip())
    if not match:return ''
    sub=int(match[3] or 0)
    return ('산' if match[1] else '')+str(int(match[2]))+('-'+str(sub) if sub else '')


def api_page(raw):
    text=raw.decode('utf-8-sig') if isinstance(raw,bytes) else raw.lstrip('\ufeff')
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():raise SourceError('INVALID_XML')
    try:
        if text.lstrip().startswith('{'):
            root=json.loads(text);root=root.get('response',root)
            header=root.get('header',{});body=root.get('body',{})
            code=str(header.get('resultCode',''));total=body.get('totalCount')
            raw_rows=body.get('items',{});raw_rows=raw_rows.get('item',[]) if isinstance(raw_rows,dict) else raw_rows
            rows=[raw_rows] if isinstance(raw_rows,dict) else raw_rows or []
        else:
            root=ET.fromstring(text)
            for e in root.iter():e.tag=e.tag.split('}')[-1]
            code=root.findtext('.//resultCode') or root.findtext('.//returnReasonCode') or ''
            total=root.findtext('.//totalCount')
            rows=[{c.tag:c.text or '' for c in e} for e in root.findall('.//item')]
    except (ValueError, ET.ParseError, AttributeError, TypeError) as e:
        raise SourceError('FORMAT_ERROR') from e
    if code not in ('00','000','0000'):raise SourceError(code or 'MISSING_RESULT_CODE')
    if total is None or not str(total).isdigit():raise SourceError('MISSING_TOTAL')
    if not isinstance(rows,list) or any(not isinstance(r,dict) for r in rows):raise SourceError('INVALID_ROWS')
    return int(total),rows


def normalize(row, district, stream, expected_month=None):
    """Return a consistent record without assigning unknown legal-dong codes/coordinates."""
    y=field(row,'dealYear','년');m=field(row,'dealMonth','월');d=field(row,'dealDay','일','계약일')
    ym=field(row,'계약년월','계약연월')
    if ym and not y:
        ym=re.sub(r'\D','',ym);y,m=ym[:4],ym[4:6]
    full=field(row,'계약일자')
    if full and len(re.sub(r'\D','',full))==8:
        digits=re.sub(r'\D','',full);y,m,d=digits[:4],digits[4:6],digits[6:]
    try: day=date(int(y),int(m),int(d)).isoformat()
    except (ValueError,TypeError):raise SourceError('INVALID_CONTRACT_DATE')
    month=day[:7].replace('-','')
    if expected_month and month!=expected_month:raise SourceError('MONTH_MISMATCH')
    returned_sgg=field(row,'sggCd','지역코드')
    if returned_sgg and returned_sgg != district['code']:raise SourceError('REGION_MISMATCH')
    emd=field(row,'umdNm','법정동','읍면동')
    addr=field(row,'시군구','소재지')
    if not emd and addr:
        prefix=district['name']
        if not addr.startswith(prefix+' '):raise SourceError('ADDRESS_SCOPE_MISMATCH')
        emd=addr[len(prefix):].strip()
    if not emd:raise SourceError('MISSING_LEGAL_DONG')
    jibun=field(row,'jibun','지번','번지')
    amount=number(field(row,'dealAmount','거래금액(만원)'))
    deposit=number(field(row,'deposit','depositMoney','보증금(만원)'))
    rent=number(field(row,'monthlyRent','monthlyRentMoney','월세금(만원)','월세(만원)'))
    if stream['deal']=='sale' and (amount is None or amount<=0):raise SourceError('INVALID_PRICE')
    if stream['deal']=='rent' and not ((deposit or 0)>0 or (rent or 0)>0):raise SourceError('INVALID_RENT')
    exclusive=number(field(row,'excluUseAr','excluUseArea','전용면적(㎡)','전용면적'))
    building=number(field(row,'buildingAr','buildAr','totalFloorAr','연면적(㎡)','건물면적(㎡)','건물면적'))
    land=number(field(row,'dealArea','landAr','plottageAr','대지면적(㎡)','거래면적(㎡)','토지면적(㎡)','대지권면적(㎡)'))
    area=exclusive if stream['category'] in ('apartment','rowHouse','officetel','rights') else land if stream['category']=='land' else building
    cancellation=field(row,'cdealType','해제여부')
    cancel_date=field(row,'cdealDay','해제사유발생일')
    cancelled=bool(cancel_date) or cancellation.upper() in ('O','Y','1','해제')
    lot=exact_lot(jibun)
    return {'type':stream['category'],'deal':stream['deal'],'district':district['code'],
            'umdNm':emd,'jibun':jibun,'lot':lot,'exactLotPublic':bool(lot),
            'date':day,'month':month,'amount':amount,'deposit':deposit,'monthlyRent':rent,
            'area':area,'exclusiveArea':exclusive,'buildingArea':building,'landArea':land,
            'unitPrice':amount/area if amount and area and area>0 else None,
            'buildingName':field(row,'aptNm','mhouseNm','offiNm','buildingNm','단지명','건물명','연립다세대'),
            'floor':field(row,'floor','층'),'buildingDong':field(row,'aptDong','동'),
            'buildYear':field(row,'buildYear','건축년도'),'cancelled':cancelled,'cancellationDate':cancel_date,
            'jimok':field(row,'jimok','지목'),'landUse':field(row,'landUse','useArea','용도지역'),
            'dealType':field(row,'dealingGbn','거래유형'),'houseType':field(row,'houseType','주택유형'),
            'road':field(row,'roadNm','도로명'),'sourceId':field(row,'dealNo','거래일련번호')}


def xlsx_rows(file):
    with zipfile.ZipFile(file) as z:
        infos=z.infolist()
        if sum(x.file_size for x in infos)>1_500_000_000:raise SourceError('XLSX_EXPANSION_LIMIT')
        if any(x.file_size>800_000_000 for x in infos):raise SourceError('XLSX_PART_LIMIT')
        ss=[];ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        if 'xl/sharedStrings.xml' in z.namelist():
            with z.open('xl/sharedStrings.xml') as f:
                for _,e in ET.iterparse(f,events=('end',)):
                    if e.tag.endswith('}si'):ss.append(''.join(e.itertext()));e.clear()
        sheets=sorted(n for n in z.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml',n))
        if len(sheets)!=1:raise SourceError('MULTI_SHEET_REQUIRES_EXPLICIT_SELECTION')
        with z.open(sheets[0]) as f:
            for _,e in ET.iterparse(f,events=('end',)):
                if not e.tag.endswith('}row'):continue
                row=[]
                for c in e.findall('s:c',ns):
                    address=c.get('r','');col=re.match(r'[A-Z]+',address)
                    if not col:raise SourceError('INVALID_CELL_REF')
                    ci=0
                    for letter in col[0]:ci=ci*26+ord(letter)-64
                    while len(row)<ci:row.append('')
                    if c.find('s:f',ns) is not None:raise SourceError('FORMULA_NOT_ALLOWED_IN_SOURCE')
                    v=c.findtext('s:v',default='',namespaces=ns)
                    if c.get('t')=='s':v=ss[int(v)]
                    elif c.get('t')=='inlineStr':v=''.join(c.find('s:is',ns).itertext())
                    row[ci-1]=v
                yield row;e.clear()


def table_rows(file):
    """Locate the real heading below official export notices. No guessed column offsets."""
    from pathlib import Path
    p=Path(file)
    if p.suffix.lower()=='.xlsx': rows=xlsx_rows(p)
    elif p.suffix.lower()=='.csv':
        raw=p.read_bytes()
        try:text=raw.decode('utf-8-sig')
        except UnicodeDecodeError:text=raw.decode('cp949')
        rows=csv.reader(io.StringIO(text))
    else:raise SourceError('UNSUPPORTED_FILE_USE_XLSX_OR_CSV')
    heading=None
    for i,values in enumerate(rows):
        if heading is None:
            keys=[clean_key(v) for v in values]
            if ('계약년월' in keys or '계약연월' in keys or '계약일자' in keys) and ('시군구' in keys or '법정동' in keys):
                heading=[str(v).strip() for v in values]
                nonempty=[h for h in heading if h]
                if len(nonempty)!=len(set(nonempty)):raise SourceError('DUPLICATE_HEADER')
            elif i>100:raise SourceError('HEADER_NOT_FOUND')
            continue
        if not any(str(x).strip() for x in values):continue
        if len(values)>len(heading):raise SourceError('EXTRA_COLUMNS')
        yield dict(zip(heading,values))
    if heading is None:raise SourceError('HEADER_NOT_FOUND')
