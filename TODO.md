# TODO — 레퍼런스 "느낌" 재현

> 새 세션은 이 파일 + `GOAL.md` + `docs/reference-videos-digest.md` + `docs/adr/0011·0012` 를 먼저 읽고 시작.
> 핵심 합의: **현재 스탠스(음높이=높이, 큐브가 음표 따라 주행)는 유지.** 레퍼런스도 같은 패러다임이며
> 차이는 미감 디테일뿐. 각 차이를 **기존/변경 비교 가능한 토글**로 도입한다. 색(성부색)은 유지.

## 배경 자료 (이미 완료)
- 레퍼런스 영상 2편을 yt-dlp로 받아 OpenCV로 5초 프레임 추출·직접 관찰.
  - 영상1 파헬벨(NHK): https://www.youtube.com/watch?v=5Q-c7BS1wpM
  - 영상2 바흐 14 canons: https://www.youtube.com/watch?v=mdI7UM7Xubw
- 대표 프레임: `docs/reference-frames/video1-pachelbel/`, `video2-bach/`
- 분석/격차: `docs/reference-videos-digest.md`, 목표/결정: `GOAL.md`
- 결정 기록: `docs/adr/0011-reference-feel.md`(토글 4종), `docs/adr/0012-canon-emphasis-same-engine.md`

## 차이 4 포인트 (느낌의 정체)
1. **① 이산 블록화** — 음표를 양자화된 계단/블록으로(스무딩 제거). **가장 큰 효과.**
2. **② 발광 제거** — 블룸 끄고 무광 재질 + soft shadow + 중립 밝은 배경.
3. **③ 디오라마 무대화** — 구간별 경계 섬 + 아이소메트릭 부감(무한 스크롤 탈피).
4. **④ 트랙 가독성** — 넓은 반투명 지형 → 좁고 불투명한 트랙.

각 토글 기본값 = "기존"(전부 기존이면 현행과 동일, 전부 신규면 레퍼런스 느낌).

---

## Phase A — 토글 ①②④ (구현 완료)  ✅
상세 구현 계획: `docs/implementation-plan-phaseA.md` 참고.

- [x] `index.html` 툴바에 select 3종 추가(비트반응 뒤), 기본값=기존:
  - `shape-select`: smooth(기본) | stepped
  - `style-select`: glow(기본) | matte
  - `track-select`: wide(기본) | narrow
- [x] `terrain.js`:
  - [x] 상태/세터: `setTerrainShape/setRenderStyle/setTrackWidth`
  - [x] `load()`가 `this._lastAnalysis/_lastMaxVoices` 보관(토글 시 재빌드용)
  - [x] **①** `_steppedHeights`로 계단형(평평한 캡+수직 라이저), `smooth`는 `_sampleHeights` 유지.
  - [x] **②** `applyRenderStyle()` — matte: bloom 0, emissive≈0, roughness↑,
        배경 중립회색(0x9a9a9a)+fog, ambient↑. glow 복귀 시 `bgMode` 재적용. (shadowMap은 보류)
  - [x] **④** `narrow`: `_laneThick()`(2.4→1.0) + 지형 opacity 1.0 → 재빌드 경로 공유.
- [x] `main.js`: select 3종 이벤트 배선 + `uploadFile` 초기값 적용.
- [ ] 검증(브라우저): `canon piano+drum.mid` 업로드 → 각 토글 전환 확인, 전부 기존=현행과 동일,
      큐브 주행/재생/seek 정상, 콘솔 에러·dispose 누수 없음. ← 다음 세션 수동 확인

## Phase B — ③ 디오라마 무대화 (구현 완료, 1차)  ✅
- [x] 구간 분할: **일정 길이(10s=DIO_SEG_DUR, cell 폭에 맞춤)**. (마디/프레이즈 기반은 추후 개선)
- [x] 구간별 정사각 "섬" 플레이트 + 섬 사이 연결로(`stageGroup`, `_buildDioramaStage`).
- [x] 신규 `stage-select`(scroll|diorama) 토글. 지오메트리/큐브/기둥/카메라 모두 `_worldXZ` 경유.
- [x] **접힌 레이아웃(boustrophedon 스네이크) + 부감 카메라 + 섬 경계**로 1차 구현.
      섬 경계에서 지형 quad 끊음(`a.s!==b.s`). matte/glow 색 반영.
- [ ] 검증(브라우저): diorama 토글 시 섬 배치/큐브 섬 통과/카메라 추적, scroll 회귀 없음. ← 수동 확인
- [ ] (개선 여지) 진짜 오쏘 아이소 카메라, 섬-호핑 트랜지션, 마디/프레이즈 분할, 그리드 바닥 확장.

## Phase C — 캐논 강조(ADR 0012) + 피아노롤
- [ ] 백엔드: 성부쌍 **모방 lag**를 분석 JSON에 노출(현 `classifier`의 lag 유사도 활용).
- [ ] **시차 추격**: 같은 트랙 위에서 마커 출발/주행을 lag만큼 시차 정렬(캐논 분류 시만).
- [ ] **거울 대칭(가능 시)**: 역행/전위 감지 → 거울상 구조 보조 표시.
- [ ] 비캐논(화음/기타)은 **동일 엔진**에서 강조 레이어만 off.
- [ ] **악보 패널 선택형**: 기존 OSMD(오선보) | 2D 컬러 피아노롤(영상2 스타일). `score.js` 확장.
- [ ] 분류 오판 보정(캐논곡이 "화음"으로 분류됨) — `classifier.py`/ADR 0005 개정.

## 참고 — 현재 코드 핵심 포인트
- 스무딩 위치: `frontend/src/terrain.js` `_sampleHeights`(이동평균 w=2).
- 큐브는 이미 `_pitchAt`로 음표 단위 스텝(이산) — 지형만 뭉개져 있음.
- 토글 세터 사용 패턴: `terrain.js`의 `setCameraMode` 등 + `main.js:53-56, 89-92`.
- 로컬 기동: 백엔드 `backend/`에서 `python -m uvicorn app:app --port 8000`(uvicorn 직접 호출은
  PATH에 없음 — `python -m` 사용), 프론트 `frontend/`에서 `npm run dev`(5173, /analyze 프록시).
