# 분산 레포 설치 검증

확인 시각: 2026-11-19T04:05:46.086904+00:00
원본 체크포인트: `f328c729eece4fe45f1b403a1af1fcd62fa5de46`

| 레포 | 담당 | 검증 거래 | 구간 | 게시 산출물(bytes) | 첫 실행 | Pages 확인 |
|---|---|---:|---:|---:|---|---|
| realestate-data-001 | 001 · 서울 A 1 | 2782440 | 19285 | 194721433 | success | 성공 |
| realestate-data-002 | 002 · 서울 B 1 | 2175390 | 16530 | 168725518 | success | 성공 |
| realestate-data-003 | 003 · 경기 A 1 | 4399636 | 35815 | 425675618 | success | 성공 |
| realestate-data-004 | 004 · 경기 B 1 | 4572737 | 41325 | 444857665 | success | 성공 |
| realestate-data-005 | 005 · 인천·강원 1 | 2360428 | 38570 | 338573463 | success | 성공 |
| realestate-data-006 | 006 · 충청 1 | 3551642 | 55100 | 676234570 | success | 성공 |
| realestate-data-007 | 007 · 호남 1 | 3070176 | 57855 | 646047710 | success | 성공 |
| realestate-data-008 | 008 · 부산·울산·제주 1 | 2568832 | 33060 | 302744482 | success | 성공 |
| realestate-data-009 | 009 · 대구·경북 1 | 2561941 | 52345 | 602129811 | success | 성공 |
| realestate-data-010 | 010 · 경남 1 | 2286871 | 33060 | 457405407 | success | 성공 |
| realestate-data-011 | 011 · 서울 A 2 | 2813561 | 16530 | 201301031 | success | 성공 |
| realestate-data-012 | 012 · 서울 B 2 | 3297819 | 16530 | 226755263 | success | 성공 |
| realestate-data-013 | 013 · 경기 A 2 | 3150198 | 24795 | 320053075 | success | 성공 |
| realestate-data-014 | 014 · 경기 B 2 | 3085039 | 27550 | 414858384 | success | 성공 |
| realestate-data-015 | 015 · 인천·강원 2 | 2821060 | 41325 | 345471213 | success | 성공 |
| realestate-data-016 | 016 · 충청 2 | 3201942 | 44080 | 578491494 | success | 성공 |
| realestate-data-017 | 017 · 호남 2 | 2892123 | 57855 | 635995356 | success | 성공 |
| realestate-data-018 | 018 · 부산·울산·제주 2 | 2352441 | 30305 | 311582243 | success | 성공 |
| realestate-data-019 | 019 · 대구·경북 2 | 2469419 | 35815 | 466029860 | success | 성공 |
| realestate-data-020 | 020 · 경남 2 | 1409750 | 27550 | 320733869 | success | 성공 |

검증된 저장소: 20/20
최신 레지스트리 반영: 20/20
전국 원본과 대조된 구간: 705280
거래 합계: 57823445
게시 산출물 합계: 8078387465 bytes

검증 내용: 20개 레포 수집 소유권·지역 배정·handover 체크포인트·registry revision·레포별 1GB 한도를 검증.
기존 데이터 삭제: 실행하지 않음. 조회 전환은 storage-registry.json의 serving 값으로 관리하며 Pages 읽기 실패 시 중앙 정적자료로 폴백한다.
현재 단계는 20개 shard가 API 본수집을 소유하며 체크포인트에서 지속 수집한다. Pages shard-status와 published/index.json을 별도로 검증한다.
