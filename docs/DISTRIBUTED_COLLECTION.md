# 지역별 분산 수집 구조 v1

## 구성

- 기존 웹·중앙 현황: `softm/softm.tojihannun`, `data-status.html`.
- 데이터 저장소: `softm/realestate-data-001` ~ `010`.
- 공통 엔진: `scripts/distribution/shards.py`; 기존 `scripts/rtms/collector.py`를 재사용.
- 지역별 워크플로: 각 저장소 `.github/workflows/collect.yml` → 커밋 SHA로 고정된 공통 `realestate-shard.yml` 호출.
- 중앙 배정: `data/transactions/storage-registry.json`. 현행·폐지 코드 구분을 유지하며 모든 현행 시군구를 중복 없이 배정한다.
- 키는 각 저장소 Actions Secret `MOLIT_API_KEY`만 사용한다. 중앙 인증키를 읽거나 복사하지 않는다. 각 워크플로는 자기 저장소에만 쓰므로 교차 저장소 PAT가 필요 없다.

## 첫 실행과 기존 자료

첫 push는 bootstrap 모드로 실행한다. 고정된 원본 커밋의 지역별 gzip 세그먼트를 해시·행수로 확인해 복제한다. 원본을 삭제하거나 과거 수집을 처음부터 다시 시작하지 않는다. 실패·재시도·API 대기 상태도 이어받는다.

초기 `collectionOwner=legacy`, `serving=legacy`이다. 이는 데이터 사본 준비 단계이며 새 레포가 API 본수집을 시작했다는 뜻이 아니다. 기존 수집·서비스는 계속 사용한다.

## 용량과 배포

- Pages 게시 파일 합계의 절대 상한: 1,000,000,000 bytes. 인덱스·상태 JSON·HTML도 합산한다.
- 900,000,000 bytes 이상: 다음 본수집 중지 및 `split-plan.json` 생성.
- 1GB 이상 또는 50MB 이상 단일 파일: 게시 차단. 기존 정상 배포를 덮어쓰지 않는다.
- 서비스 payload는 gzip만 게시한다. 비압축 JSON과 gzip을 중복 게시하지 않는다.
- `시군구/유형/계약월/법정동-조각.json.gz`와 작은 JSON 인덱스로 구성한다.
- 원본 체크포인트·인증키·수집기 소스는 Pages에 게시하지 않는다. Git 이력 크기는 게시 용량과 별도이다.
- Pages 미설정이어도 검증된 상태·원본 복제는 커밋된다. Pages 설정 후 bootstrap/build를 다시 실행하면 게시한다.
- GitHub 다중 사이트 사용 정책·대역폭 제한은 별도이며 용량 분할로 서비스 허용이나 영구 무료가 보장되지는 않는다.

## API 본수집 활성화 전제

1. 대상 레포 Settings → Pages → Source를 GitHub Actions로 설정한다.
2. Settings → Secrets and variables → Actions → Secrets에 `MOLIT_API_KEY`를 등록한다.
3. 기존 중앙 실행이 종료된 상태에서 해당 shard `collectionOwner`를 `paused`로 바꾸고, 종료 후 최종 중앙 데이터 커밋을 `handoverCommit`으로 기록한다.
4. bootstrap을 실행하여 최종 체크포인트 해시·건수 및 `migration-receipt.json`의 sourceCommit을 검증한다.
5. 새로운 Pages의 gzip·인덱스·CORS를 검증하고 클라이언트 조회 전환을 준비한다. v1 설치만으로 기존 거래 조회 주소를 바꾸지 않는다.
6. `collectionOwner=shard`로 이관한다. 기존 수집기는 해당 지역을 제외하며, 신규 수집기는 일치한 최종 체크포인트가 없으면 실행을 거부한다.
7. 대상 레포 Actions Variable `COLLECTION_ENABLED=true`로 시간당 예약 실행을 활성화한다. 직접 Run workflow → auto/backfill/refresh도 담당 이관 전에는 API를 호출하지 않는다.
8. 조회 전환이 검증된 뒤에만 `serving=pages`로 바꾼다. 기존 JSON 삭제와 Git 이력 재작성은 별도 승인·검증 작업이다.

초기 요청 예산은 레포당 실행/시간당 8회, 일 160회로 보수적으로 제한한다. 실제 활용승인 한도와 큰 계약월의 페이지 수를 확인한 뒤 조정한다. 동일 키를 여러 레포에서 써도 원본 API 할당량은 늘지 않는다. 워크플로 동시 실행은 레포별 직렬화되며 중앙·지역별 중복 수집은 담당 이관 상태로 막는다.

## 현황 집계

중앙 화면은 10개 레포의 작은 `shard-status.json`만 읽는다. Pages와 저장소 사본 확인을 구분하며, API 실행 상태·복제 완료·게시 성공을 서로 바꿔 표시하지 않는다. 사본 수치를 전국 합계에 중복 더하지 않는다. 수집 담당과 조회 이관이 끝난 지역만 기존 지역 집계를 대체한다.

## 검증

`npm test`; `python3 -m unittest discover -s scripts/rtms -p 'test_*.py'`; `python3 -m unittest discover -s scripts/distribution -p 'test_*.py'`; `npm run build`.

전체 서비스 전환이 아니라 안전한 분산 수집 기반 설치 단계이다. 추가 레포 자동 생성, 900MB 도달 시 자동 담당 이동, 기존 데이터 삭제는 이 단계에서 수행하지 않는다.
