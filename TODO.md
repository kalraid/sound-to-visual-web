# TODO — 레퍼런스 "느낌" 재현

> 새 세션은 이 파일 + `GOAL.md` + `docs/reference-videos-digest.md` + `docs/adr/0011·0012·0013·0014` 를 먼저 읽고 시작.
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

## Phase C — 캐논 강조(ADR 0012) + 피아노롤  ✅ (C1~C5 완료, 2026-06-22)
> Phase A(①②④)·Phase B(③ 디오라마 1차) 완료·검증됨. Phase C(C1~C5) 모두 구현·검증 완료.
> 참고: `docs/adr/0012-canon-emphasis-same-engine.md`, `docs/adr/0005-classification.md`, `backend/classifier.py`.

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
- [x] **C4. 거울 대칭** ✅ (2026-06-22): 백엔드 `classifier.mirror_detail()` — 역행/전위/역행전위
      감지(음정열 변환 비교, 임계 0.7로 보수적). `analysis.mirror{detected,confidence,pairs[{base,mirror,type,similarity}]}` 노출.
      프론트 `terrain._buildMirror()` — 베이스 성부 지형을 기하 반사한 검은 고스트(opacity 0.38)를
      mirror 성부 레인에 보조 표시. inversion=음높이축(scale.y=-1, y=Y_HEIGHT), retrograde=시간축
      (scale.x=-1, x=2·xc). 접힌 좌표 문제로 **scroll 모드 전용**. 토글 `mirror-select`(기본 on).
      **검증**: 백엔드 샘플에서 거짓양성 없음(canon/melody/bwv66 모두 <0.7). 프론트는 합성 mirror쌍
      주입으로 inversion(sy=-1,py=10,pz=레인이동)·retrograde(sx=-1,px=duration·6)·diorama 게이팅·off
      모두 수치 확인. (실제 거울곡 샘플은 없어 백엔드 감지는 합성 검증.)
- [x] **C5. 분류 오판 보정** ✅ (2026-06-22): 토널 응답 1반음 허용 일치 + 시간지연 게이트(lagSec≥0.3)로
      캐논곡→"화음" 오분류 보완(`_similarity(tol)`, canon_detail kind="tonal"). `classify`는 canon.detected
      1차 기준. 프론트 `category-select` 수동 변경 드롭다운 구현(ADR 0005 약속) — 캐논↔비캐논 전환 시
      추격강조 연동. ADR 0005 개정. 회귀 테스트 4종 통과(melody/canon/bwv66 라벨 유지).

## Phase D — 영상2(바흐 14 canons) 3초 정밀 재분석으로 드러난 격차  ⬅ 다음 세션 시작점
> 근거: `docs/reference-videos-digest.md`「3초 정밀 재분석(2026-06-22)」+ `docs/reference-frames/video2-bach/3s/`.
> 99장(3초 간격) 추출·관찰. 우선순위는 사용자 지목 순.

- [x] **D1. 성부=각자 독립 경로** ✅ (2026-06-23): `lane-sep-select`(기존/분리) 토글 추가 —
      분리 모드는 `LANE_GAP` 8→14 로 확대해 성부별 경로를 시각적으로 명확히 분리.
      `chord-select`(병합/개별) 토글 추가 — 개별 모드는 화음 구성음을 InstancedMesh 구체로
      지형 위에 표시(merged=기존 폴리필러 유지). 모두 재빌드 경로(`_rebuild`) 경유.
      ⚠️ C2 추격(후행→선행 레인 이동)과의 경계는 미해결 — "추격은 같은 트랙, 일반 성부는 분리"
      원칙을 명문화했으나 추격 표현 방식 재검토는 별도 과제로 남김.
- [x] **D2. 거울 반사축 교정** ✅ (2026-06-23): `_buildMirror()` 재작성 — 옆 레인 이동 제거,
      베이스 지형을 같은 x·z에서 `scale.y=-1`로 y=0 아래로 내림(y=h→-h, 검은 수면 반사).
      역행(retrograde) 타입은 추가로 `scale.x=-1`+`position.x=2*xc` 시간축 반사 유지.
      색 0x111111→0x080c1a(더 진한 수면색), opacity 0.38→0.42. scroll 모드 전용 유지.
- [x] **D3. 섹션 장면화 + 라벨 + 카메라 호핑** ✅ (2026-06-23): 구간 분할은 10초 균등 유지
      (백엔드에 마디/섹션 경계 데이터 없음). 각 디오라마 섬 위에 `§N` 캔버스 텍스처 스프라이트
      (`_makeTextSprite`) + `#section-hud` HTML 오버레이 좌상단(`§N / M`). 섬 전환 감지 시
      `_hopFrames=6`으로 lerp 계수 0.06→0.28 급상승(카메라 hop). 스크롤 모드 시 HUD 숨김.
- [x] **D4. 굽이치는 리본 트랙** ✅ (2026-06-23): `ribbon-select`(직선/굽이) 토글 추가.
      `_ribbonZ(timeSec, laneIndex)` = A_WAVE(2.5)·sin(ω·t + φ_i) — 성부별 120° 위상 차로
      각 레인이 독립적으로 굽이침. 지형 지오메트리 루프를 cz0/cz1 per-segment로 교체해
      진짜 사다리꼴 단면 생성. pillars·chordDots·큐브(update) 모두 동일 ribbonZ 적용.
      별도 ADR 없이 _worldXZ 좌표 변환 레이어 내 처리.
- [x] **D5. 피아노롤 코너 오버레이** ✅ (2026-06-23): `MiniRollOverlay` 클래스를 `pianoroll.js`에
      추가 — `#mini-roll` 캔버스(220×110, 좌하단 절대좌표)에 반투명 다크 배경 + 성부색 노트 + 적색
      playhead를 그림. `corner-roll-select`(끄기/켜기) 토글로 canvas display 전환. 상단 패널
      (PianoRollPanel)과 독립적으로 동작(각자 `load`/`update` 호출). pps=40 고정.

## Phase E — UX 완성 (다음 단계 후보)
> 설계 결정 (grill-with-docs, 2026-06-24):
> - E3(키보드 R키)는 E1 프리셋 버튼의 단축키로 통합 — 별도 구현 없음.
> - "기존" 버튼 = 모든 토글 하드코딩 기본값으로 완전 초기화 (undo 아님).
> - E2 그룹 배치: [시각]=지형·렌더·트랙·리본·배경·비트 / [성부]=레인분리·화음·추격·공유·거울 / [무대]=무대·카메라·시점 / [악보]=악보·악보크기·코너롤. 분류·최대성부·파일열기는 항상 노출.
> - 프리셋 버튼 위치: 툴바 맨 앞(파일 열기 옆). 접기 UI: 그룹명 클릭(▶/▼ 인라인 힌트).
> - E4: load() 시 스네이크 배치 범위로 동적 재계산. E5: `_ribbonZ(t - lagSec, leaderLane)` 적용.

- [x] **E1. 레퍼런스 모드 프리셋 버튼** ✅ (2026-06-24): 툴바 맨 앞 "🎬 레퍼런스" / "↺ 기존" 버튼. PRESET_REF(stepped+matte+narrow+diorama+spread), PRESET_ORIG(전체 기본값). `applyPreset()`이 각 select에 change 이벤트 dispatch 후 terrain.load() 재빌드. R키: shape-select 값으로 현재 프리셋 판별 후 토글.
- [x] **E2. 툴바 그룹화** ✅ (2026-06-24): 16개 컨트롤을 `.ctrl-group`으로 묶어 [시각]/[성부]/[무대]/[악보] 4묶음. 그룹 헤더 클릭 → `.group-body.collapsed` 토글(▶/▼ 인라인). 분류·최대성부·파일열기·프리셋은 항상 노출.
- [x] **E3. 키보드 단축키** ✅ (2026-06-24): Space=재생/정지, ←/→=±5초. `keydown` 리스너, input/select 포커스 시 무시. R키는 E1에 통합.
- [x] **E4. 그리드 바닥 확장** ✅ (2026-06-24): `_rebuildGrid()` — `load()` 끝에 호출, 스크롤 모드는 `duration×X_PER_SEC+margin`, 디오라마 모드는 `cols×pitch × rows×pitchZ+laneSpread+margin`으로 동적 재계산. `userData.isGrid/isFloor`로 태깅 후 기존 mesh 제거 후 재생성.
- [x] **E5. C2↔D1 충돌 해결** ✅ (D4에서 기 해결): `update()`의 추격 큐브가 이미 `_ribbonZ(t, leaderLaneIndex)` 적용 — `t`는 `position-lagSec`, `vi`는 leader laneIndex. D4 구현 시 함께 해결됨.

## Phase F — 백엔드 개선 (중기)

- [ ] **F1. 마디(measure) 경계 추출** — music21 `part.measure(n)` 시간 정보를 분석 JSON 노출 → D3 구간 분할을 10초 균등 대신 마디 그룹 단위로 자동 교체(토글 없음, 데이터 있으면 항상 사용).
- [ ] **F2. 성부명 표시** — `part.name`을 툴바·피아노롤에 표시(현재 색으로만 구분).
- [ ] **F3. 캐시 무효화** — 분석 결과에 버전 해시 부착, 파이프라인 변경 시 자동 무효.

## Phase H — 공유 섬 + 순환 횡단 (ADR 0013, 영상1 핵심 — ADR 0014 우선)

- [x] **H1. 자기 유사도 분석 (backend)** ✅ (2026-06-23): `classifier.structural_units()` 추가 —
      `_best_period()`로 성부별 음정열 자기상관(seq[i]==seq[i+p]) 최대 반복 주기 감지(임계 0.8,
      최소 4음 `_MIN_PERIOD`). `_period_seconds()`로 주기(음표수)→초 환산(중앙값). 성부를 주기
      단위로 분할, 같은 반복 패턴은 동일 unitId 공유. `analysis.structuralUnits: [{part, unitId,
      startSec, endSec, period}]` 노출(`app._build_result`, `_intervalSequences` pop 이전 호출).
      반복 없는 성부/곡은 빈 목록 → H2에서 10초 균등 분할 폴백. 백엔드 5 테스트 통과
      (`test_structural_units_schema` 추가). 합성 검증: 4음×4반복 → period 4(ratio 1.0)·2.0s·unitId 공유.
      ⚠️ 기존 캐시(`backend/cache/*.json`)엔 structuralUnits 없음 → H2 검증 시 캐시 삭제(F3 참조).
- [~] **H2. 순환 섬 렌더링** (H2a 완료 / H2b → 마지막 단계로 이동)
  - [x] **H2a. 공유 지형** ✅ (2026-06-23): `share-select`(끄기/켜기) 토글 추가 —
        캐논+추격강조 켜짐일 때 후행(chase) 성부의 독립 terrain·pillars·chordDots 를
        `visible=false`로 숨겨 선행 성부 지형을 '공유'(큐브는 C2로 이미 선행 레인 주행).
        `_applySharedTerrain()`(가시성만, 재빌드 X), load·setCanonEmphasis·setSharedTerrain에서 호출.
        비캐논/추격off/공유off면 전부 복구. Playwright 수치 검증(`e2e/shared-terrain.spec.js`):
        off=전부 보임, on=후행만 숨김(terrainVisible===!chase), 복구·콘솔무에러 확인.
- [ ] **H3. Z 유사도 배치** — 음악적 유사도 → Z 거리 레이아웃.
      캐논=Z 완전 공유, 화음=좁은 클러스터(gap≈1.5), 무관=넓은 분리(LANE_GAP 유지).
      **구현 방식**: 카테고리 일괄 적용(`classify()` 출력 기준). 성부쌍별 동적 계산은 H1 structuralUnits 강화 이후 검토.

## Phase G — 조형 고도화 (장기, Phase H 이후)
> ADR 0014: 영상1 스타일 우선 확정 → Phase H 완료 후 검토.

- [ ] **G1. 섹션별 고유 3D 조형** — 피치 분포·리듬 밀도로 섬마다 다른 형태(미로·막대숲·계단). 현재 슬래브 대체.
- [ ] **G2. 직교 3평면 반사(No.13 스타일)** — 두 벽+바닥 코너에 흰/검 부조 동시 배치. (영상2 클라이맥스, 낮은 우선순위)
- [ ] **G3. 주제 타이틀 오프닝** — 영상2 스타일 "A B C D..." 주제 큐브 한 줄 제시 씬. (영상2 스타일, 낮은 우선순위)

## 마지막 단계 — 실 캐논 MIDI 필요 (현재 미확보)
> 캐논 선율 성부에서 structuralUnits가 감지되는 실제 악보 MIDI 확보 후 진행.
> (현재 `samples/pachelbel_canon.mid`는 합성본 — bass 성부 only, 캐논 violin 성부 structuralUnits 없음)

- [ ] **H2b. 순환 횡단 + 섬 단위 지형 재빌드** — 큐브 x=`((t-voiceStart)%period)*X_PER_SEC`.
      곡 전체 길이 지형을 섬 단위로 재빌드해야 순환이 자연스러움(분량 큼).
      period 소스: `canon.pairs[*].lagSec`. structuralUnits 교체는 캐논 성부 감지 시.
- [ ] **H4. 구간 재방문 (A-B-A)** — 비캐논 형식 재방문은 복사본 방식.
      H1 `structuralUnits`로 A-B-A 재방문 구간 감지, 카메라가 섬 고정 좌표로 이동.
      실 MIDI에서 A-B-A structuralUnits 감지 확인 필요.
- [ ] **H5. 지형 업그레이드 애니메이션** _(선택, 별도 ADR 필요)_ — 변주 재방문 시 terrain morph.
      H2b 완료 후 추가 설계. GPU 버텍스 인터폴레이션 필요.

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
