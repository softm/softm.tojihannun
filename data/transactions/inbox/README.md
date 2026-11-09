# 공식 Excel / CSV 일괄 반입

정상적인 다운로드로 확보한 `.xlsx` 또는 `.csv` 파일을 이 폴더에 넣고 같은 이름의 `.scope.json`을 추가합니다. 사이트의 자동 대량 다운로드 제한 때문에 이 수집기는 `rt.molit.go.kr`를 크롤링하지 않습니다.

```json
{"file":"gwangmyeong-rowhouse-2020.xlsx","district":"41210","stream":"rowHouse-sale","start":"2020-01-01","end":"2020-12-31","unfiltered":true,"expectedRows":1234}
```

위 `1234`는 예시이며 실제 파일 행 수로 바꿔야 합니다. `district` 대신 `sido`(예: `41`)를 사용하면 시도 전체 파일을 공식 지역 코드로 분할합니다. 연월 경계가 아닌 부분 기간, 면적/가격/단지 등 필터링된 파일은 전체 구간으로 덮어쓰지 않습니다.

반입 명령: `python3 scripts/rtms/collector.py --mode import`

8개 카테고리와 주거형 4개 전월세의 `stream`은 `scripts/rtms/catalog.json`에 있습니다. 파일은 서비스의 지번별 조회 파일로 가공되며 원본 파일·inbox는 Pages에 배포하지 않습니다. 정규화 실패 시 기존 정상 스냅샷을 덮어쓰지 않습니다. 행의 단순 중복처럼 보이더라도 다른 실제 거래일 수 있으므로 임의로 삭제하지 않습니다.
