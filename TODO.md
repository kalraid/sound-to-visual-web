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
- [x] 검증(브라우저, 2026-06-22): 토글 전환·렌더 정상 확인 완료.

## Phase B — ③ 디오라마 무대화 (구현 완료, 1차)  ✅
- [x] 구간 분할: **일정 길이(10s=DIO_SEG_DUR, cell 폭에 맞춤)**. (마디/프레이즈 기반은 추후 개선)
- [x] 구간별 정사각 "섬" 플레이트 + 섬 사이 연결로(`stageGroup`, `_buildDioramaStage`).
- [x] 신규 `stage-select`(scroll|diorama) 토글. 지오메트리/큐브/기둥/카메라 모두 `_worldXZ` 경유.
- [x] **접힌 레이아웃(boustrophedon 스네이크) + 부감 카메라 + 섬 경계**로 1차 구현.
      섬 경계에서 지형 quad 끊음(`a.s!==b.s`). matte/glow 색 반영.
- [x] 검증(브라우저, 2026-06-22): scroll·diorama 모두 정상 렌더 확인 완료.
- [x] **버그 수정(중요)**: Phase B에서 무대 토글 상태를 `this.stage`(= #stage DOM 요소)에 덮어써
      `_resize`가 캔버스를 1×1로 만들어 3D가 전부 안 보였음 → `this.stageMode`로 분리.
      `ResizeObserver`로 초기 레이아웃/리사이즈 견고화(1×1 재발 방지). 커밋 `37da009`.
- [ ] (개선 여지, 선택) 진짜 오쏘 아이소 카메라, 섬-호핑 트랜지션, 마디/프레이즈 기반 분할,
      그리드 바닥 확장(현재 4000×400라 먼 섬이 바닥 밖으로 뜸), 디오라마에서 matte+밝은 배경 기본화 검토.

## Phase C — 캐논 강조(ADR 0012) + 피아노롤  ⬅ 다음 세션 시작점
> Phase A(①②④)·Phase B(③ 디오라마 1차) 완료·검증됨. 다음은 ADR 0012 캐논 강조와 피아노롤.
> 착수 전 `docs/adr/0012-canon-emphasis-same-engine.md` + `backend/classifier.py`(또는 분석 모듈) 확인.

**권장 순서 (작은 것부터, 동일 엔진 원칙 유지)**
- [x] **C1. 백엔드 — 모방 lag 노출** ✅ (2026-06-22): `classifier.canon_detail()` 추가 →
      분석 JSON 최상위에 `canon: {detected, confidence, pairs[]}` 노출.
      pair = `{leader, follower(=parts 인덱스), lagNotes, lagSec, similarity}`.
      `_similarity`가 (ratio, lag) 반환하도록 변경, `_intervalSeqPartIndex`로 seq→성부 매핑.
      `_lag_seconds`로 lag(음표수)→초 환산(중앙값, 템포변화 견고). `app._build_result`가 부착.
      `classify(analysis, canon=None)`로 시그니처 확장(기존 단일인자 테스트 호환). 백엔드 4 테스트 통과.
      ⚠️ lagNotes=0이어도 lagSec은 절대초 차이를 잡음(canon 샘플: lagNotes 0 / lagSec 1.0). C2가 이걸 씀.
- [x] **C2. 시차 추격(프론트)** ✅ (2026-06-22): 캐논 감지 시 '후행' 성부 마커가 '선행' 성부의
      트랙(레인)·능선 위에서 `position - lagSec` 시점을 달려 같은 구조를 추격.
      `terrain._buildChaseMap()`이 `canon.pairs`로 voice별 `chase{leaderVoice,lagSec}` 매핑,
      `update()`가 추격 성부의 cube를 (t, leaderLane, leader음높이)로 재배치. scroll·diorama 공통
      (`_worldXZ` 경유). 토글 `canon-select`(추격강조 on/off, 기본 on). 비캐논/off는 원래 동작 그대로.
      **수치 검증(2026-06-22)**: canon.mid, t=4s → 후행 x=18·z=-8(선행 레인), 선행 x=24·z=-8 →
      같은 트랙 6단위(1s) 뒤 추격 확인. off 시 x=24·z=0(자기 레인) 복귀. 콘솔 에러 없음.
      ⚠️ 백엔드 캐시(`backend/cache/*.json`)는 C1 이전 결과라 canon 필드가 없을 수 있음 → 검증 시 캐시 삭제.
- [x] **C3. 악보 패널 선택형** ✅ (2026-06-22): 신규 `frontend/src/pianoroll.js`(`PianoRollPanel`,
      ScorePanel과 동일 인터페이스 load/update/reset/setZoom/zoom). x=시간/y=음높이/색=성부색,
      playhead 좌측 25% 고정, 현재 음 강조 테두리, 옥타브 그리드, ResizeObserver+dpr.
      `index.html` score-select(osmd|pianoroll) + canvas 추가, `main.js`는 `activeScore()`로 라우팅
      (둘 다 로드, 표시만 토글). 브라우저 검증 완료(2D 캔버스라 스크린샷 유효 — 캐논 시차 육안 확인).
- [ ] **C4. 거울 대칭(가능 시)**: 역행/전위 감지 → 흰 구조 + 검은 거울상 보조 표시(영상2 핵심).
      감지가 어려우면 후순위.
- [ ] **C5. 분류 오판 보정**: 캐논곡이 "화음"으로 분류되는 문제 — `classifier.py`/ADR 0005 개정.

## 시작 방법 (로컬 기동)
- `./start.sh`(루트) → 백엔드 :8000 + 프론트 :5173, 로그는 `backend.log`/`frontend.log`. 종료 `./stop.sh`.
- 검증 자동화: Playwright(`frontend/node_modules`)로 페이지 띄워 `window.__terrain` 노출 후
  렌더러 크기/픽셀 점검 가능. **단, 헤드리스(SwiftShader)는 3D를 새까맣게 렌더하므로
  스크린샷으로 "보이는지" 판단 불가** → `renderer.getSize`·`gl.readPixels`·NDC 투영 같은
  수치 검증을 쓸 것. (이번 1×1 버그도 이 방법으로 잡음.)

## 참고 — 현재 코드 핵심 포인트
- 스무딩 위치: `frontend/src/terrain.js` `_sampleHeights`(이동평균 w=2).
- 큐브는 이미 `_pitchAt`로 음표 단위 스텝(이산) — 지형만 뭉개져 있음.
- 토글 세터 사용 패턴: `terrain.js`의 `setCameraMode` 등 + `main.js:53-56, 89-92`.
- 로컬 기동: 백엔드 `backend/`에서 `python -m uvicorn app:app --port 8000`(uvicorn 직접 호출은
  PATH에 없음 — `python -m` 사용), 프론트 `frontend/`에서 `npm run dev`(5173, /analyze 프록시).
