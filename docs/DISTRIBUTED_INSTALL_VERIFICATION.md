# 분산 레포 설치 검증

확인 시각: 2026-11-14T18:40:09.128995+00:00
원본 체크포인트: `f328c729eece4fe45f1b403a1af1fcd62fa5de46`

| 레포 | 담당 | 검증 거래 | 구간 | 게시 산출물(bytes) | 첫 실행 | Pages 확인 |
|---|---|---:|---:|---:|---|---|
| realestate-data-001 | 001 · 서울 A 1 | 83983 | 573 | 4855452 | success | 성공 |
| realestate-data-002 | 002 · 서울 B 1 | 61071 | 443 | 3817357 | success | 성공 |
| realestate-data-003 | 003 · 경기 A 1 | 108854 | 948 | 8383598 | success | 성공 |
| realestate-data-004 | 004 · 경기 B 1 | 105862 | 1027 | 8186135 | success | 성공 |
| realestate-data-005 | 005 · 인천·강원 1 | 48140 | 1030 | 5659220 | success | 성공 |
| realestate-data-006 | 006 · 충청 1 | 75597 | 1481 | 10620655 | success | 성공 |
| realestate-data-007 | 007 · 호남 1 | 50231 | 1451 | 8875664 | success | 성공 |
| realestate-data-008 | 008 · 부산·울산·제주 1 | 55248 | 980 | 5977134 | success | 성공 |
| realestate-data-009 | 009 · 대구·경북 1 | 42639 | 1374 | 8202195 | success | 성공 |
| realestate-data-010 | 010 · 경남 1 | 35901 | 843 | 5943004 | success | 성공 |
| realestate-data-011 | 011 · 서울 A 2 | 64619 | 412 | 3993198 | success | 성공 |
| realestate-data-012 | 012 · 서울 B 2 | 72458 | 411 | 4372799 | success | 성공 |
| realestate-data-013 | 013 · 경기 A 2 | 69115 | 605 | 5683630 | success | 성공 |
| realestate-data-014 | 014 · 경기 B 2 | 63202 | 691 | 7129512 | success | 성공 |
| realestate-data-015 | 015 · 인천·강원 2 | 53777 | 1031 | 5501680 | success | 성공 |
| realestate-data-016 | 016 · 충청 2 | 65983 | 1106 | 8667666 | success | 성공 |
| realestate-data-017 | 017 · 호남 2 | 45146 | 1434 | 8464763 | success | 성공 |
| realestate-data-018 | 018 · 부산·울산·제주 2 | 43462 | 767 | 5250116 | success | 성공 |
| realestate-data-019 | 019 · 대구·경북 2 | 32243 | 874 | 5497623 | success | 성공 |
| realestate-data-020 | 020 · 경남 2 | 20717 | 701 | 4011642 | success | 성공 |

검증된 저장소: 20/20
전국 원본과 대조된 구간: 18182
거래 합계: 1198248
게시 산출물 합계: 129093043 bytes

검증 내용: 20개 레포 수집 소유권·지역 배정·handover 체크포인트·registry revision·레포별 1GB 한도를 검증.
기존 데이터 삭제: 실행하지 않음. 조회 전환은 storage-registry.json의 serving 값으로 관리하며 Pages 읽기 실패 시 중앙 정적자료로 폴백한다.
현재 단계는 20개 shard가 API 본수집을 소유하며 체크포인트에서 지속 수집한다. Pages shard-status와 published/index.json을 별도로 검증한다.
