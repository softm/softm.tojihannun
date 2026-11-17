# 분산 레포 설치 검증

확인 시각: 2026-11-17T08:57:43.399485+00:00
원본 체크포인트: `f328c729eece4fe45f1b403a1af1fcd62fa5de46`

| 레포 | 담당 | 검증 거래 | 구간 | 게시 산출물(bytes) | 첫 실행 | Pages 확인 |
|---|---|---:|---:|---:|---|---|
| realestate-data-001 | 001 · 서울 A 1 | 2780914 | 19285 | 157973278 | None | 성공 |
| realestate-data-002 | 002 · 서울 B 1 | 2174000 | 16529 | 135567267 | success | 성공 |
| realestate-data-003 | 003 · 경기 A 1 | 4397662 | 35815 | 330618152 | success | 성공 |
| realestate-data-004 | 004 · 경기 B 1 | 4432673 | 39863 | 335513258 | None | 성공 |
| realestate-data-005 | 005 · 인천·강원 1 | 2359449 | 38569 | 255684359 | success | 성공 |
| realestate-data-006 | 006 · 충청 1 | 3309961 | 50499 | 455981502 | None | 성공 |
| realestate-data-007 | 007 · 호남 1 | 2773354 | 52514 | 423941790 | None | 성공 |
| realestate-data-008 | 008 · 부산·울산·제주 1 | 2567847 | 33060 | 234062223 | success | 성공 |
| realestate-data-009 | 009 · 대구·경북 1 | 2336766 | 48094 | 397554388 | success | 성공 |
| realestate-data-010 | 010 · 경남 1 | 2286101 | 33060 | 336316990 | success | 성공 |
| realestate-data-011 | 011 · 서울 A 2 | 2812287 | 16530 | 163306290 | success | 성공 |
| realestate-data-012 | 012 · 서울 B 2 | 3296164 | 16530 | 185446083 | success | 성공 |
| realestate-data-013 | 013 · 경기 A 2 | 3148326 | 24793 | 247113466 | success | 성공 |
| realestate-data-014 | 014 · 경기 B 2 | 3083649 | 27549 | 414670410 | success | 성공 |
| realestate-data-015 | 015 · 인천·강원 2 | 2819785 | 41324 | 265081777 | success | 성공 |
| realestate-data-016 | 016 · 충청 2 | 3118851 | 42619 | 411983190 | success | 성공 |
| realestate-data-017 | 017 · 호남 2 | 2745687 | 55370 | 440108354 | None | 성공 |
| realestate-data-018 | 018 · 부산·울산·제주 2 | 2351295 | 30304 | 237755138 | success | 성공 |
| realestate-data-019 | 019 · 대구·경북 2 | 2468829 | 35814 | 344428731 | failure | 성공 |
| realestate-data-020 | 020 · 경남 2 | 1409279 | 27550 | 234717908 | success | 성공 |

검증된 저장소: 20/20
최신 레지스트리 반영: 0/20
전국 원본과 대조된 구간: 685671
거래 합계: 56672879
게시 산출물 합계: 6007824554 bytes

검증 내용: 20개 레포 수집 소유권·지역 배정·handover 체크포인트·registry revision·레포별 1GB 한도를 검증.
기존 데이터 삭제: 실행하지 않음. 조회 전환은 storage-registry.json의 serving 값으로 관리하며 Pages 읽기 실패 시 중앙 정적자료로 폴백한다.
현재 단계는 20개 shard가 API 본수집을 소유하며 체크포인트에서 지속 수집한다. Pages shard-status와 published/index.json을 별도로 검증한다.
