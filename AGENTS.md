# 토지한눈 개발 기준

- 중앙 데이터 현황 기준: https://github.com/softm/softm.github.io/blob/main/projects/development/standards/data/DATA-STATUS-STANDARD.md
- 수집기는 `scripts/rtms/collector.py`. 정적 서비스 데이터와 현황은 수집 성공 자료에서 생성한다.
- 공식 웹사이트의 대량 자동 다운로드 제한을 우회하지 않는다. 확보된 공식 Excel/CSV는 inbox로 반입하고, 자동 수집은 이용 허가된 공공데이터 API만 사용한다. 출처를 서로 바꿔 표시하지 않는다.
- 지도에서 필지를 열 때 전체 기간을 외부 API로 순회하지 않는다.
- 미수집/실패/지번 일부공개를 0건으로 확정하지 않는다. 필지 식별 근거가 없으면 위치를 추정하지 않는다.
- 검사: `npm test`, `python3 -m unittest discover -s scripts/rtms -p 'test_*.py'`, `npm run build`.
- 수집 성공·정적파일 검증·운영 배포 성공을 별도로 보고한다. 본수집 전체 완료와 이번 실행 성공은 다르다.
