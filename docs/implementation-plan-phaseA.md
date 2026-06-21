# 구현 계획 — 레퍼런스 "느낌" 토글 (Phase A: ①②④)

## Context
프로젝트 목표는 NHK 명곡앨범플러스 캐논 시각화 2편(파헬벨/바흐)의 "느낌" 재현이다.
영상을 직접 다운로드해 5초 프레임으로 관찰한 결과(→ `docs/reference-videos-digest.md`,
`docs/reference-frames/`), **패러다임은 현재 구현과 동일**하다(음높이=높이, 큐브가 음표를 따라 주행).
차이는 미감 디테일 4가지뿐이며, 이를 **기존/변경 비교 가능한 토글 옵션**으로 도입하기로 확정했다
(ADR 0011). grill-with-docs 결론:
- 이번 구현(Phase A): **① 이산 블록화 · ② 발광 제거 · ④ 트랙 가독성** 3종 토글.
- 다음 단계(Phase B/C): ③ 디오라마 무대화, ADR 0012 캐논 강조(시차추격+거울), 피아노롤 악보.

기대 효과: 가장 큰 "느낌" 요인인 **①스무딩 제거→음표가 개별 블록으로 읽힘**을 즉시 확인 가능.

## 변경 대상 파일
- `frontend/index.html` — 툴바에 토글 드롭다운 3종 추가
- `frontend/src/terrain.js` — 토글 상태 + 지형 빌더/재질/배경 분기 (핵심)
- `frontend/src/main.js` — 드롭다운 → terrain setter 배선
- `docs/adr/0011-reference-feel.md` — 구현된 토글 키 이름 확정 주석(선택)

## 구현 내용

### UI (index.html, 비트반응 select 뒤에 추가)
세 개의 `<select>`를 기존 패턴(`bg-select` 등) 그대로 추가. **기본값은 전부 "기존"**으로 두어
현행과 동일하게 시작 → 사용자가 바꿔가며 비교:
- `shape-select` (지형): `smooth`(기존, 기본) | `stepped`(블록)
- `style-select` (렌더): `glow`(기존, 기본) | `matte`(무광)
- `track-select` (트랙): `wide`(기존, 기본) | `narrow`(좁은 트랙)

### terrain.js
상태 필드 추가: `this.terrainShape='smooth'`, `this.renderStyle='glow'`, `this.trackWidth='wide'`.
setter 추가: `setTerrainShape(v)`, `setRenderStyle(v)`, `setTrackWidth(v)`. 각 setter는 값 저장 후
필요한 재빌드/재적용을 한다(아래). 모두 `load()` 전에 호출돼도, 후에 토글돼도 동작해야 함
(현재 `setCameraMode` 등과 동일한 사용 패턴, `main.js` 참고).

**① 이산 블록화 — `_buildVoice`의 지형 지오메트리 분기 (가장 중요)**
- 현재 `_sampleHeights`는 이동평균(w=2)으로 음표를 언덕으로 뭉갠다(`terrain.js:178-184`).
- `stepped` 모드: 스무딩을 거치지 않고 **음표 단위로 직접 블록 지오메트리 생성**.
  각 음표 → `x0=startSec*X_PER_SEC`, `x1=(startSec+durSec)*X_PER_SEC`, `y=yFor(midi)`
  (리듬은 0.6). 상단 캡(평평) + 전면 벽(y→0) + 음표 사이 수직 라이저(이전 y↔현재 y)로
  계단형 솔리드를 만든다. 기존 `push(x,y,z,nx,ny,nz)` 헬퍼와 동일한 정점 배열 방식 재사용
  (`terrain.js:196-205`). 음높이=높이, 음길이=가로폭 → 스탠스 정확히 유지.
- `smooth` 모드: 기존 `_sampleHeights` 경로 그대로.
- setTerrainShape는 `analysis`가 있으면 `load(this._lastAnalysis, this._lastMaxVoices)` 재호출로
  재빌드(가장 단순·안전). → `load()`에서 인자를 `this._lastAnalysis`/`this._lastMaxVoices`에 보관.

**② 발광 제거 — 재질/블룸/배경/조명 분기**
- `glow`(기존): 현행 그대로(emissive, bloom.strength 0.9, 어두운 배경).
- `matte`: `applyRenderStyle()`에서
  - `this.bloom.strength = 0` (업데이트 루프의 `0.9 + beatBoost*0.9`도 style 가드로 0 유지)
  - 지형/큐브 머티리얼 `emissive`를 거의 0, `roughness↑(~0.9)`, `metalness↓(~0)`
  - 배경을 중립 밝은 회색(예: `0x9a9a9a`)으로, ambient 강도↑/그리드 약화
  - 선택: `renderer.shadowMap.enabled=true` + DirectionalLight `castShadow` + 바닥 `receiveShadow`로
    soft contact shadow(레퍼런스의 핵심 무드). 부하 시 생략 가능 — 우선 배경/무광부터.
- 토글 시 머티리얼 속성만 갱신하면 되므로 재빌드 없이 즉시 적용 가능(머티리얼 핸들은 voices[]에 보관됨).
- 주의: 기존 `setBackgroundMode`와 충돌 → matte일 때는 style이 배경을 덮어쓰고, glow로 돌아오면
  현재 `bgMode`를 재적용.

**④ 트랙 가독성 — 레인 두께/불투명도 분기**
- `narrow`: 지형 z 두께 `LANE_THICK`를 줄이고(예: 2.4→1.0), 지형 머티리얼 `opacity`를 불투명(1.0)으로.
- `wide`(기존): 현행(2.4, 0.9/0.45).
- 두께는 지오메트리에 박혀 있으므로(`z0/z1` 계산, `terrain.js:194`) **재빌드 필요** → ①과 같은
  `load()` 재호출 경로 공유. 불투명도만이면 머티리얼 갱신으로 충분하나, 두께 변경 위해 재빌드.

### main.js (배선, 기존 패턴과 동일 `terrain.js:53-56`)
- `$("shape-select").addEventListener("change", e => terrain.setTerrainShape(e.target.value))`
- `style`, `track` 동일.
- `uploadFile`의 초기 적용 블록(`main.js:89-92`)에 세 setter의 초기값 적용 추가.

## 비-목표 (이번 제외, 다음 단계)
- ③ 디오라마 무대화(구간 분할 + 아이소메트릭 + 섬 배치) — Phase B
- ADR 0012 캐논 강조(시차추격/거울) + 백엔드 모방 lag 노출 — Phase C
- 피아노롤 악보 선택형 — Phase C

## 검증 (Verification)
1. 백엔드(`backend`에서 `python -m uvicorn app:app --port 8000`)·프론트(`frontend`에서 `npm run dev`)
   기동 — 이미 로컬에 떠 있음.
2. 브라우저 http://localhost:5173 에서 `test_midi/canon piano+drum.mid` 업로드.
3. 토글 검증:
   - 지형 `smooth`→`stepped`: 능선이 **계단형 블록**으로 바뀌고 개별 음표가 읽히는지.
   - 렌더 `glow`→`matte`: 발광/블룸이 사라지고 무광 + 밝은 중립 배경으로 바뀌는지.
   - 트랙 `wide`→`narrow`: 지형이 좁고 불투명한 "길"로 바뀌는지.
   - 전부 기존값일 때 현행과 픽셀상 동일한지(회귀 없음).
4. 큐브 주행·재생·seek가 모든 토글 조합에서 정상인지(공통 시계 유지, `main.js` 루프).
5. 콘솔 에러 없음 + 토글 전환 시 메모리/지오메트리 dispose 누수 없음(`clear()` 경유 재빌드).

## 위험·완화
- 재빌드 토글(①④) 잦은 전환 시 GC 부하 → `load()`가 `clear()`로 기존 지오메트리 dispose하므로 누수 없음.
- matte 그림자(shadowMap)는 부하·설정 복잡 → 1차는 배경+무광 머티리얼만, 그림자는 여유 시.
