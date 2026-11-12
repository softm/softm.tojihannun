# 분산 레포 설치 검증

확인 시각: 2026-11-12T18:15:00.378000+00:00
원본 체크포인트: `f328c729eece4fe45f1b403a1af1fcd62fa5de46`

| 레포 | 담당 | 검증 거래 | 구간 | 게시 산출물(bytes) | 첫 실행 | Pages 확인 |
|---|---|---:|---:|---:|---|---|
| realestate-data-001 | 001 · 서울 A 1 | 19255 | 320 | 2100967 | success | 성공 |
| realestate-data-002 | 002 · 서울 B 1 | 12222 | 208 | 1304492 | success | 성공 |
| realestate-data-003 | 003 · 경기 A 1 | 22650 | 362 | 2604773 | success | 성공 |
| realestate-data-004 | 004 · 경기 B 1 | 13873 | 299 | 1881034 | success | 성공 |
| realestate-data-005 | 005 · 인천·강원 1 | 10285 | 375 | 2035911 | success | 성공 |
| realestate-data-006 | 006 · 충청 1 | 13609 | 488 | 3274569 | success | 성공 |
| realestate-data-007 | 007 · 호남 1 | 8716 | 368 | 2391277 | success | 성공 |
| realestate-data-008 | 008 · 부산·울산·제주 1 | 18078 | 496 | 2683258 | success | 성공 |
| realestate-data-009 | 009 · 대구·경북 1 | 8541 | 375 | 2372992 | success | 성공 |
| realestate-data-010 | 010 · 경남 1 | 8862 | 330 | 2233136 | success | 성공 |
| realestate-data-011 | 011 · 서울 A 2 | 27373 | 221 | 1963450 | success | 성공 |
| realestate-data-012 | 012 · 서울 B 2 | 32556 | 221 | 2181835 | success | 성공 |
| realestate-data-013 | 013 · 경기 A 2 | 22889 | 285 | 2335557 | success | 성공 |
| realestate-data-014 | 014 · 경기 B 2 | 20398 | 318 | 2791459 | success | 성공 |
| realestate-data-015 | 015 · 인천·강원 2 | 11876 | 353 | 1682132 | success | 성공 |
| realestate-data-016 | 016 · 충청 2 | 17450 | 416 | 2846862 | success | 성공 |
| realestate-data-017 | 017 · 호남 2 | 3745 | 318 | 1462874 | success | 성공 |
| realestate-data-018 | 018 · 부산·울산·제주 2 | 11275 | 295 | 1800412 | success | 성공 |
| realestate-data-019 | 019 · 대구·경북 2 | 387 | 88 | 494050 | None | 성공 |
| realestate-data-020 | 020 · 경남 2 | 7704 | 320 | 1716791 | success | 성공 |

검증된 저장소: 20/20
전국 원본과 대조된 구간: 6456
거래 합계: 291744
게시 산출물 합계: 42157831 bytes

검증 내용: 20개 레포 수집 소유권·지역 배정·handover 체크포인트·registry revision·레포별 1GB 한도를 검증.
기존 데이터 삭제: 실행하지 않음. 기존 실거래 조회 경로 변경: 실행하지 않음.
현재 단계는 20개 shard가 API 본수집을 소유하며 체크포인트에서 지속 수집하는 운영 구조다. Pages 게시 성공은 수집 성공과 별도이다.
