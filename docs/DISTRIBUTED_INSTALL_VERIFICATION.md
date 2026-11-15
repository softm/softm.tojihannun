# 분산 레포 설치 검증

확인 시각: 2026-11-15T03:16:00.562752+00:00
원본 체크포인트: `f328c729eece4fe45f1b403a1af1fcd62fa5de46`

| 레포 | 담당 | 검증 거래 | 구간 | 게시 산출물(bytes) | 첫 실행 | Pages 확인 |
|---|---|---:|---:|---:|---|---|
| realestate-data-001 | 001 · 서울 A 1 | 120565 | 744 | 6693132 | None | 성공 |
| realestate-data-002 | 002 · 서울 B 1 | 86719 | 597 | 5316220 | success | 성공 |
| realestate-data-003 | 003 · 경기 A 1 | 162706 | 1281 | 11989869 | success | 성공 |
| realestate-data-004 | 004 · 경기 B 1 | 151534 | 1358 | 11307526 | success | 성공 |
| realestate-data-005 | 005 · 인천·강원 1 | 68332 | 1407 | 7853494 | success | 성공 |
| realestate-data-006 | 006 · 충청 1 | 102354 | 1908 | 14128761 | success | 성공 |
| realestate-data-007 | 007 · 호남 1 | 65699 | 1844 | 11265161 | success | 성공 |
| realestate-data-008 | 008 · 부산·울산·제주 1 | 84351 | 1312 | 8507978 | success | 성공 |
| realestate-data-009 | 009 · 대구·경북 1 | 59308 | 1765 | 11133205 | success | 성공 |
| realestate-data-010 | 010 · 경남 1 | 56448 | 1169 | 8660247 | success | 성공 |
| realestate-data-011 | 011 · 서울 A 2 | 99861 | 556 | 5817737 | success | 성공 |
| realestate-data-012 | 012 · 서울 B 2 | 112304 | 551 | 6351955 | success | 성공 |
| realestate-data-013 | 013 · 경기 A 2 | 107557 | 828 | 8237140 | success | 성공 |
| realestate-data-014 | 014 · 경기 B 2 | 98761 | 961 | 10565561 | success | 성공 |
| realestate-data-015 | 015 · 인천·강원 2 | 79944 | 1401 | 7754153 | success | 성공 |
| realestate-data-016 | 016 · 충청 2 | 99410 | 1541 | 12655461 | success | 성공 |
| realestate-data-017 | 017 · 호남 2 | 58607 | 1811 | 10666202 | success | 성공 |
| realestate-data-018 | 018 · 부산·울산·제주 2 | 68589 | 1065 | 7721380 | success | 성공 |
| realestate-data-019 | 019 · 대구·경북 2 | 51776 | 1229 | 8046037 | success | 성공 |
| realestate-data-020 | 020 · 경남 2 | 31851 | 964 | 5810711 | success | 성공 |

검증된 저장소: 20/20
최신 레지스트리 반영: 0/20
전국 원본과 대조된 구간: 24292
거래 합계: 1766676
게시 산출물 합계: 180481930 bytes

검증 내용: 20개 레포 수집 소유권·지역 배정·handover 체크포인트·registry revision·레포별 1GB 한도를 검증.
기존 데이터 삭제: 실행하지 않음. 조회 전환은 storage-registry.json의 serving 값으로 관리하며 Pages 읽기 실패 시 중앙 정적자료로 폴백한다.
현재 단계는 20개 shard가 API 본수집을 소유하며 체크포인트에서 지속 수집한다. Pages shard-status와 published/index.json을 별도로 검증한다.
