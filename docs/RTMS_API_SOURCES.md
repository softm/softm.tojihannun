# 국토교통부 실거래가 수집 API 기준

이 문서는 토지한눈 수집기가 사용하는 공식 공공데이터포털 RTMS API의 기준표다. 코드의 `scripts/rtms/catalog.json`과 함께 관리한다.

## 공통 조회 방식

- 제공기관: 국토교통부
- 호스트: `https://apis.data.go.kr/1613000/`
- 기본 조회축: `LAWD_CD`(법정동코드 앞 5자리) + `DEAL_YMD`(계약년월 YYYYMM) + `serviceKey`
- 데이터 포맷: XML
- `pageNo`, `numOfRows`는 현재 공식 필수 요청변수라고 가정하지 않는다. 실제 응답의 totalCount/행수를 검증해 필요할 때만 페이징 지원을 확인한다.

## API 목록

| 내부 stream | 구분 | 공공데이터 ID | 서비스 | 공식 페이지 | Base URL |
|---|---|---:|---|---|---|
| apartment-sale | 아파트 매매 | 15126469 | `RTMSDataSvcAptTrade` | https://www.data.go.kr/data/15126469/openapi.do | `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade` |
| rowHouse-sale | 연립·다세대 매매 | 15126467 | `RTMSDataSvcRHTrade2` | https://www.data.go.kr/data/15126467/openapi.do | `https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade2` |
| detached-sale | 단독·다가구 매매 | 15126465 | `RTMSDataSvcSHTrade` | https://www.data.go.kr/data/15126465/openapi.do | `https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade` |
| officetel-sale | 오피스텔 매매 | 15126464 | `RTMSDataSvcOffiTrade` | https://www.data.go.kr/data/15126464/openapi.do | `https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade` |
| rights-sale | 분양·입주권 매매 | 15126471 | `RTMSDataSvcSilvTrade` | https://www.data.go.kr/data/15126471/openapi.do | `https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade` |
| commercial-sale | 상업·업무 매매 | 15126463 | `RTMSDataSvcNrgTrade` | https://www.data.go.kr/data/15126463/openapi.do | `https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade` |
| land-sale | 토지 매매 | 15126466 | `RTMSDataSvcLandTrade` | https://www.data.go.kr/data/15126466/openapi.do | `https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade` |
| factory-sale | 공장·창고 등 매매 | 15126470 | `RTMSDataSvcInduTrade` | https://www.data.go.kr/data/15126470/openapi.do | `https://apis.data.go.kr/1613000/RTMSDataSvcInduTrade` |
| apartment-rent | 아파트 전월세 | 15126474 | `RTMSDataSvcAptRent` | https://www.data.go.kr/data/15126474/openapi.do | `https://apis.data.go.kr/1613000/RTMSDataSvcAptRent` |
| rowHouse-rent | 연립·다세대 전월세 | 15126473 | `RTMSDataSvcRHRent` | https://www.data.go.kr/data/15126473/openapi.do | `https://apis.data.go.kr/1613000/RTMSDataSvcRHRent` |
| detached-rent | 단독·다가구 전월세 | 15126472 | `RTMSDataSvcSHRent` | https://www.data.go.kr/data/15126472/openapi.do | `https://apis.data.go.kr/1613000/RTMSDataSvcSHRent` |
| officetel-rent | 오피스텔 전월세 | 15126475 | `RTMSDataSvcOffiRent` | https://www.data.go.kr/data/15126475/openapi.do | `https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent` |

## 공식 대량자료

- 공공데이터포털: https://www.data.go.kr/data/3050988/fileData.do
- 국토교통부 자료제공: https://rt.molit.go.kr/pt/xls/xls.do?mobileAt=
- 원본 우선순위: XLSX → CSV

## 운영 원칙

1. 과거 기준자료는 공식 XLSX 대량자료를 우선한다.
2. OpenAPI는 최근 신규·정정·해제 갱신을 기본 역할로 한다.
3. API별 활용신청/트래픽 한도는 공공데이터포털의 해당 API 페이지에서 확인한다.
4. API 주소나 catalog ID를 추측해서 추가하지 않는다.
5. 수집 완료는 응답/파일 행수와 저장 segment의 건수·해시 검증 후에만 인정한다.
