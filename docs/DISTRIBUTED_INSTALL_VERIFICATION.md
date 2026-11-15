# 분산 레포 설치 검증

확인 시각: 2026-11-15T06:23:00.754105+00:00
원본 체크포인트: `f328c729eece4fe45f1b403a1af1fcd62fa5de46`

| 레포 | 담당 | 검증 거래 | 구간 | 게시 산출물(bytes) | 첫 실행 | Pages 확인 |
|---|---|---:|---:|---:|---|---|
| realestate-data-001 | 001 · 서울 A 1 | 912371 | 4888 | 44253475 | None | 성공 |
| realestate-data-002 | 002 · 서울 B 1 | 858497 | 4997 | 46173597 | None | 성공 |
| realestate-data-003 | 003 · 경기 A 1 | 726020 | 4920 | 48232260 | None | 성공 |
| realestate-data-004 | 004 · 경기 B 1 | 740615 | 5537 | 49177162 | None | 성공 |
| realestate-data-005 | 005 · 인천·강원 1 | 338048 | 5645 | 34787875 | None | 성공 |
| realestate-data-006 | 006 · 충청 1 | 409392 | 6201 | 50841929 | None | 성공 |
| realestate-data-007 | 007 · 호남 1 | 280924 | 6199 | 43260123 | None | 성공 |
| realestate-data-008 | 008 · 부산·울산·제주 1 | 212152 | 2952 | 19752837 | success | 성공 |
| realestate-data-009 | 009 · 대구·경북 1 | 250872 | 6178 | 42370132 | None | 성공 |
| realestate-data-010 | 010 · 경남 1 | 319014 | 5503 | 45723801 | None | 성공 |
| realestate-data-011 | 011 · 서울 A 2 | 969926 | 4504 | 49439266 | None | 성공 |
| realestate-data-012 | 012 · 서울 B 2 | 1032964 | 4073 | 49874088 | None | 성공 |
| realestate-data-013 | 013 · 경기 A 2 | 767976 | 5018 | 53045024 | None | 성공 |
| realestate-data-014 | 014 · 경기 B 2 | 325831 | 2918 | 33116719 | success | 성공 |
| realestate-data-015 | 015 · 인천·강원 2 | 375042 | 5640 | 33584285 | None | 성공 |
| realestate-data-016 | 016 · 충청 2 | 436684 | 5706 | 50852696 | None | 성공 |
| realestate-data-017 | 017 · 호남 2 | 247290 | 6159 | 40299077 | None | 성공 |
| realestate-data-018 | 018 · 부산·울산·제주 2 | 138480 | 1891 | 14390234 | success | 성공 |
| realestate-data-019 | 019 · 대구·경북 2 | 317997 | 5811 | 43838366 | None | 성공 |
| realestate-data-020 | 020 · 경남 2 | 202340 | 5306 | 35752403 | None | 성공 |

검증된 저장소: 20/20
최신 레지스트리 반영: 20/20
전국 원본과 대조된 구간: 100046
거래 합계: 9862435
게시 산출물 합계: 828765349 bytes

검증 내용: 20개 레포 수집 소유권·지역 배정·handover 체크포인트·registry revision·레포별 1GB 한도를 검증.
기존 데이터 삭제: 실행하지 않음. 조회 전환은 storage-registry.json의 serving 값으로 관리하며 Pages 읽기 실패 시 중앙 정적자료로 폴백한다.
현재 단계는 20개 shard가 API 본수집을 소유하며 체크포인트에서 지속 수집한다. Pages shard-status와 published/index.json을 별도로 검증한다.
