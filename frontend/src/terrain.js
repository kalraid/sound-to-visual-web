// 하단 3D 비주얼 (ADR 0009): 채워진 입체 지형 + 성부 고정색 큐브 + 블룸 +
// 선택형 카메라/배경/비트반응. x=시간, y=음높이, z=레인.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { voiceColorHex } from "./colors.js";

const X_PER_SEC = 6;
const Y_HEIGHT = 10;
const LANE_GAP = 8;
const LANE_GAP_SPREAD = 14; // D1: spread 모드 레인 간격
// H3: 분류별 자동 간격 (auto 모드)
const LANE_GAP_CANON = 1.0;    // 캐논 → 거의 공유 Z (sharedTerrain이 리본 겹침 처리)
const LANE_GAP_HARMONIC = 2.5; // 화음 → 좁은 군집
// other → LANE_GAP (8)
const A_WAVE = 2.5;          // D4: 리본 파동 진폭 (Z 단위)
const ω_WAVE = (Math.PI * 2) / 30; // D4: 파동 주기 30초 (한 파장)
const CUBE = 1.0;
const LANE_THICK = 2.4; // 지형 z 두께
const RAIL = 0.12;      // 쉼표(음이 끝난 뒤 다음 음 전까지) 얇은 선 높이
const DRUM_H = 0.7;     // 드럼 타격 블록 높이 (음높이는 없지만 길이는 표현)

// ③ 디오라마 무대화 (Phase B): 곡을 정사각 "구간(Segment)"으로 나눠 스네이크(boustrophedon) 배치.
// 현재는 10초 균등 분할. 음악 내용 기반 "섬(Island)"으로의 교체는 H2b 이후.
const DIO_CELL = 60;          // 섬 한 변(월드 단위) = 한 구간의 진행 거리
const DIO_GAP = 18;           // 섬 사이 간격
const DIO_SEG_DUR = DIO_CELL / X_PER_SEC; // 구간 길이(초): cell 폭에 정확히 맞춤(=10s)

export class Terrain {
  constructor(stageId) {
    this.stage = document.getElementById(stageId);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x05060a, 80, 320);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    this.camera.position.set(-20, 25, 30);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.stage.appendChild(this.renderer.domElement);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(20, 50, 30);
    this.scene.add(dir);

    // 후처리: 블룸
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.6, 0.2);
    this.composer.addPass(this.bloom);

    this.voices = [];
    this.particles = [];
    this.bgGroup = new THREE.Group();
    this.scene.add(this.bgGroup);

    this.pitchMin = 60; this.pitchMax = 72; this.duration = 0;
    this.cameraMode = "overhead";
    this.beatBoost = 0;

    // 레퍼런스 "느낌" 토글 (ADR 0011, Phase A). 기본값 = 기존.
    this.terrainShape = "smooth"; // smooth | stepped
    this.renderStyle = "glow";    // glow | matte
    this.trackWidth = "wide";     // wide | narrow
    this.stageMode = "scroll";    // scroll | diorama (※ this.stage 는 DOM 요소이므로 이름 분리)
    this.diorama = null;          // 레이아웃 메타(load 시 계산)
    // 캐논 강조 — 시차 추격 (ADR 0012 / C2). 캐논 분류 시에만 동작하는 가산 레이어.
    this.canonEmphasis = true;    // grill 확정: 기본 켜짐. 비캐논이면 자동 무효.
    this.canon = null;            // analysis.canon (load 시 보관)
    // H2a 캐논 공유 지형 (ADR 0013): 후행 성부의 독립 지형을 숨기고 선행 지형을 공유.
    this.sharedTerrain = "off";   // off(기존) | on(캐논 후행 지형 숨김)
    this.structuralUnits = [];    // analysis.structuralUnits (H1, 현재는 보관만)
    // 거울 대칭 강조 — 역행/전위 (C4). 검은 거울상 구조를 보조 표시. scroll 모드에서만.
    this.mirrorEmphasis = true;
    this.mirror = null;           // analysis.mirror (load 시 보관)
    // D1: 성부 경로 분리 + 화음 개별 표시
    this.laneSep = "auto";        // auto(분류기반) | tight(LANE_GAP=8) | spread(14)
    this.chordDetail = "merged";  // merged(기존) | individual(화음음 개별 구체)
    // D4: 리본 파동 경로
    this.ribbonMode = "straight"; // straight(기존) | wave(사인파 굽이)
    this._lastAnalysis = null;
    this._lastMaxVoices = 0;
    // D3: 섹션 전환 추적 (카메라 호핑 + HUD)
    this._lastSeg = -1;
    this._hopFrames = 0;

    this.stageGroup = new THREE.Group(); // 디오라마 섬 플레이트 + 연결로
    this.scene.add(this.stageGroup);
    this.mirrorGroup = new THREE.Group(); // C4 거울상 고스트 지형
    this.scene.add(this.mirrorGroup);
    this.cornerGroup = new THREE.Group(); // G2 직교 3평면 반사
    this.scene.add(this.cornerGroup);
    this.cornerReflect = false;
    this.themeGroup = new THREE.Group(); // G3 주제 타이틀 오프닝
    this.scene.add(this.themeGroup);
    this.showingTheme = false;

    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);
    // 생성자 시점엔 stage가 아직 0×0(레이아웃 전)이라 _resize만으로는 1×1로 굳는다.
    // ResizeObserver로 초기 레이아웃 확정 + 이후 크기 변화에 모두 반응.
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(this._resize);
      this._ro.observe(this.stage);
    }

    this.setBackgroundMode("grid");
    this._resize();
  }

  _resize() {
    const w = this.stage.clientWidth || 1, h = this.stage.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  yFor(midi) {
    const span = Math.max(1, this.pitchMax - this.pitchMin);
    return ((midi - this.pitchMin) / span) * Y_HEIGHT;
  }

  // ---------- 배경/바닥 ----------
  setBackgroundMode(mode) {
    this.bgMode = mode;
    while (this.bgGroup.children.length) {
      const c = this.bgGroup.children.pop();
      c.geometry && c.geometry.dispose();
      this.bgGroup.add; // noop
      this.bgGroup.remove(c);
    }
    if (mode === "space") {
      this.scene.background = new THREE.Color(0x03040a);
      this._addStars();
    } else if (mode === "solid") {
      this.scene.background = new THREE.Color(0x0b0d12);
    } else {
      // grid: 그라데이션 + 그리드 바닥
      this.scene.background = this._gradientTexture();
      this._addGrid();
    }
  }

  _gradientTexture() {
    const c = document.createElement("canvas");
    c.width = 16; c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#0a0f24");
    grad.addColorStop(0.6, "#0a0a16");
    grad.addColorStop(1, "#04040a");
    g.fillStyle = grad; g.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _addGrid() { this._rebuildGrid(); }

  // E4: load() 후 곡 길이·디오라마 배치에 맞춰 바닥 크기를 동적 재계산.
  _rebuildGrid() {
    if (this.bgMode !== "grid") return;
    // 기존 grid/floor 제거
    const toRemove = this.bgGroup.children.filter(
      (c) => c.userData.isGrid || c.userData.isFloor
    );
    toRemove.forEach((c) => { c.geometry && c.geometry.dispose(); this.bgGroup.remove(c); });

    let w, d, cx, cz;
    if (this.stageMode === "diorama" && this.diorama) {
      const L = this.diorama;
      const rows = Math.ceil(L.nSegs / L.cols);
      const laneSpread = (this._laneCount || 1) * this._laneGap();
      w = L.cols * L.pitch + L.cell + 200;
      d = rows * L.pitchZ + L.cell + laneSpread + 200;
      cx = L.cols * L.pitch / 2;
      cz = rows * L.pitchZ / 2 - laneSpread / 2;
    } else {
      const totalX = (this.duration || 0) * X_PER_SEC;
      const laneSpread = (this._laneCount || 1) * this._laneGap();
      w = Math.max(totalX + 200, 4000);
      d = Math.max(laneSpread + 100, 400);
      cx = totalX / 2;
      cz = -laneSpread / 2;
    }
    const divisions = Math.min(Math.round(Math.max(w, d) / 5), 800);
    const grid = new THREE.GridHelper(Math.max(w, d), divisions, 0x2a3a66, 0x141d33);
    grid.position.set(cx, -0.02, cz);
    grid.userData.isGrid = true;
    this.bgGroup.add(grid);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color: 0x070a14, roughness: 0.4, metalness: 0.6 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, -0.05, cz);
    floor.userData.isFloor = true;
    this.bgGroup.add(floor);
  }

  _addStars() {
    const N = 1200;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 1200;
      pos[i * 3 + 1] = Math.random() * 300 + 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 800 - 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x99aaff, size: 1.2 }));
    this.bgGroup.add(stars);
  }

  setCameraMode(mode) { this.cameraMode = mode; }
  setCameraSide(side) { this.cameraSide = side; } // 'right'(앞) | 'left'(뒤)
  setBeatMode(mode) { this.beatMode = mode; }

  // ---------- 레퍼런스 느낌 토글 (Phase A) ----------
  _laneThick() { return this.trackWidth === "narrow" ? 1.0 : LANE_THICK; }
  _terrainOpacity(isRhythm) {
    if (this.trackWidth === "narrow") return 1.0;
    return isRhythm ? 0.45 : 0.9;
  }
  _rebuild() {
    if (this._lastAnalysis) this.load(this._lastAnalysis, this._lastMaxVoices);
  }
  // ①④ 지오메트리에 박힌 토글 → 재빌드
  setTerrainShape(v) { this.terrainShape = v; this._rebuild(); }
  setTrackWidth(v) { this.trackWidth = v; this._rebuild(); }
  // ② 머티리얼/배경/블룸만 → 재빌드 없이 즉시 적용
  setRenderStyle(v) { this.renderStyle = v; this.applyRenderStyle(); }
  // ③ 디오라마: 지오메트리/레이아웃 박힘 → 재빌드
  setStage(v) { this.stageMode = v; this._rebuild(); }
  // C2 시차 추격: 마커 위치만 바꾸므로 재빌드 불필요(update가 매 프레임 읽음).
  setCanonEmphasis(on) { this.canonEmphasis = on; this._applySharedTerrain(); }
  // H2a 공유 지형: 가시성만 토글 → 재빌드 불필요.
  setSharedTerrain(v) { this.sharedTerrain = v; this._applySharedTerrain(); }
  // 후행(chase) 성부의 독립 지형/기둥/도트를 숨겨 선행 성부 지형을 '공유'하게 한다.
  // 큐브는 C2(_buildChaseMap + update)로 이미 선행 레인을 주행하므로 가시성만 끈다.
  // 공유 off거나 추격강조 off거나 비캐논이면 전부 원상복구.
  _applySharedTerrain() {
    const share = this.sharedTerrain === "on" && this.canonEmphasis;
    for (const v of this.voices) {
      const vis = !(share && !!v.chase); // chase 있으면 후행 성부 → 숨김
      if (v.terrain) v.terrain.visible = vis;
      if (v.pillars) v.pillars.visible = vis;
      if (v.chordDots) v.chordDots.visible = vis;
    }
  }
  // C4 거울 대칭: 고스트 지형 재구성.
  setMirrorEmphasis(on) { this.mirrorEmphasis = on; this._buildMirror(); }
  // D1: 레인 분리 + 화음 표시 — 지오메트리 박힘 → 재빌드
  setLaneSep(v) { this.laneSep = v; this._rebuild(); }
  setChordDetail(v) { this.chordDetail = v; this._rebuild(); }
  setRibbonMode(v) { this.ribbonMode = v; this._rebuild(); }
  setCornerReflect(on) { this.cornerReflect = on; this._buildCornerReflect(); }
  _laneGap() {
    if (this.laneSep === "spread") return LANE_GAP_SPREAD;
    if (this.laneSep === "tight") return LANE_GAP;
    // H3: "auto" — 분류(category) 기반 자동 간격
    const cat = this._lastAnalysis?.category?.labelEn;
    if (cat === "canon") return LANE_GAP_CANON;
    if (cat === "harmonic") return LANE_GAP_HARMONIC;
    return LANE_GAP;
  }
  // D4: 레인 기준 z에서의 사인파 오프셋. laneIndex별로 위상 120° 차이 → 서로 독립적으로 굽이침.
  _ribbonZ(timeSec, laneIndex) {
    if (this.ribbonMode !== "wave") return 0;
    return A_WAVE * Math.sin(ω_WAVE * timeSec + laneIndex * (Math.PI * 2 / 3));
  }

  // ---------- ③ 디오라마 레이아웃 ----------
  _computeDiorama() {
    let segDur = DIO_SEG_DUR;
    // F1: 마디 경계 데이터가 있으면 마디 그룹 단위로 자동 교체 (토글 없음).
    const measures = this._lastAnalysis?.measures;
    if (measures?.length > 1 && this.duration > 0) {
      const avgMeasureDur = this.duration / measures.length;
      const measuresPerSeg = Math.max(1, Math.round(DIO_SEG_DUR / avgMeasureDur));
      segDur = measuresPerSeg * avgMeasureDur;
    }
    const nSegs = Math.max(1, Math.ceil((this.duration || segDur) / segDur));
    const cols = Math.max(1, Math.ceil(Math.sqrt(nSegs)));
    this.diorama = { segDur, nSegs, cols, cell: DIO_CELL, pitch: DIO_CELL + DIO_GAP, pitchZ: DIO_CELL + DIO_GAP };
  }

  // 구간 s의 셀 좌하단 기준점(스네이크: 홀수 행은 좌우 반전)
  _cellBase(s) {
    const L = this.diorama;
    const row = Math.floor(s / L.cols);
    let col = s % L.cols;
    if (row % 2 === 1) col = L.cols - 1 - col;
    return { baseX: col * L.pitch, baseZ: row * L.pitchZ, row, reversed: row % 2 === 1 };
  }

  // 1D 시간축(초) + 레인 z → 접힌 월드 좌표. y는 불변.
  _worldXZ(timeSec, laneZ) {
    const L = this.diorama;
    const s = Math.min(Math.max(0, Math.floor(timeSec / L.segDur)), L.nSegs - 1);
    const { baseX, baseZ, reversed } = this._cellBase(s);
    const localX = (timeSec - s * L.segDur) * X_PER_SEC; // 0..cell
    const wx = reversed ? baseX + (L.cell - localX) : baseX + localX;
    return { wx, wz: baseZ + laneZ, s };
  }

  // 구간 경계 점(진행 방향 진입/탈출 모서리)
  _edgePoint(s, atEnd) {
    const L = this.diorama;
    const { baseX, baseZ, reversed } = this._cellBase(s);
    const localX = atEnd ? L.cell : 0;
    const wx = reversed ? baseX + (L.cell - localX) : baseX + localX;
    return { x: wx, z: baseZ };
  }

  // G1: 섬별 음표 밀도 + 음역 계산 → 3 형태 분류
  _computeSegStats() {
    const L = this.diorama;
    const parts = this._lastAnalysis?.parts || [];
    const stats = Array.from({ length: L.nSegs }, () => ({ count: 0, minM: 127, maxM: 0 }));
    for (const p of parts) {
      if (p.isRhythm) continue;
      for (const n of p.notes) {
        if (n.midi == null) continue;
        const si = Math.min(L.nSegs - 1, Math.floor(n.startSec / L.segDur));
        stats[si].count++;
        if (n.midi < stats[si].minM) stats[si].minM = n.midi;
        if (n.midi > stats[si].maxM) stats[si].maxM = n.midi;
      }
    }
    const maxCount = Math.max(1, ...stats.map((s) => s.count));
    return stats.map((s) => ({
      density: s.count / maxCount,
      pitchRange: s.count > 0 ? s.maxM - s.minM : 0,
    }));
  }

  _buildDioramaStage() {
    // 기존 무대 오브젝트 제거
    while (this.stageGroup.children.length) {
      const c = this.stageGroup.children.pop();
      c.geometry && c.geometry.dispose();
      c.material && c.material.dispose();
      this.stageGroup.remove(c);
    }
    if (this.stageMode !== "diorama" || !this.diorama) return;
    const L = this.diorama;
    const matte = this.renderStyle === "matte";
    const laneSpan = Math.max(this._laneGap(), (this._laneCount - 1) * this._laneGap());
    const plateMat = new THREE.MeshStandardMaterial({
      color: matte ? 0xcfcfcf : 0x39435f, roughness: matte ? 0.95 : 0.6,
      metalness: matte ? 0.0 : 0.2,
      emissive: matte ? 0x000000 : 0x10141f, // 어두운 배경에서도 섬이 보이게
    });
    const pathMat = new THREE.MeshStandardMaterial({
      color: matte ? 0xe6e6e6 : 0x556089, roughness: matte ? 0.95 : 0.5, metalness: 0.0,
      emissive: matte ? 0x000000 : 0x1a2030,
    });
    const segStats = this._computeSegStats();
    const depth = Math.max(8, laneSpan + LANE_GAP);
    // 섬 플레이트 — G1: 밀도·음역으로 형태 결정
    for (let s = 0; s < L.nSegs; s++) {
      const { baseX, baseZ } = this._cellBase(s);
      const cx = baseX + L.cell / 2;
      const cz = baseZ - laneSpan / 2;
      const { density, pitchRange } = segStats[s];
      if (density > 0.65 && pitchRange > 12) {
        // 막대숲(pillar forest): 음표가 많고 음역이 넓음
        this._addSegPillars(cx, cz, L.cell, depth, density, matte);
      } else if (density > 0.3) {
        // 계단(steps): 중간 밀도
        this._addSegSteps(cx, cz, L.cell, depth, matte, plateMat);
      } else {
        // 슬래브(slab): 음표 희소
        const plate = new THREE.Mesh(new THREE.BoxGeometry(L.cell + 4, 1.2, depth), plateMat);
        plate.position.set(cx, -0.8, cz);
        this.stageGroup.add(plate);
      }
    }
    // 섬 사이 연결로
    for (let s = 0; s + 1 < L.nSegs; s++) {
      const a = this._edgePoint(s, true), b = this._edgePoint(s + 1, false);
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const path = new THREE.Mesh(
        new THREE.BoxGeometry(len + 2, 0.8, LANE_THICK * 2.2), pathMat
      );
      path.position.set((a.x + b.x) / 2, -0.6, (a.z + b.z) / 2);
      path.rotation.y = -Math.atan2(dz, dx);
      this.stageGroup.add(path);
    }
    // D3: 섬마다 §N 라벨 스프라이트
    for (let s = 0; s < L.nSegs; s++) {
      const { baseX, baseZ } = this._cellBase(s);
      const spr = this._makeTextSprite(`§${s + 1}`, matte ? "#222" : "#c8d0ff");
      spr.position.set(baseX + L.cell / 2, Y_HEIGHT + 5, baseZ - laneSpan / 2);
      this.stageGroup.add(spr);
    }
    this._lastSeg = -1; // 재빌드 시 hop 기준 초기화
  }

  // G1: 막대숲 — 5×3 기둥 배열, 높이는 density 비례
  _addSegPillars(cx, cz, cellW, depth, density, matte) {
    const cols = 5, rows = 3;
    const pW = cellW / (cols * 2.2);
    const pD = depth / (rows * 2.5);
    const maxH = 3.5 + density * 4;
    const mat = new THREE.MeshStandardMaterial({
      color: matte ? 0xb0b8c8 : 0x5560a0,
      roughness: matte ? 0.9 : 0.5, metalness: matte ? 0.0 : 0.35,
      emissive: matte ? 0x000000 : 0x0a1030,
    });
    const baseMat = new THREE.MeshStandardMaterial({
      color: matte ? 0xd0d4dc : 0x39435f, roughness: 0.8, metalness: 0.1
    });
    // 바닥 슬래브
    const base = new THREE.Mesh(new THREE.BoxGeometry(cellW + 4, 0.6, depth), baseMat);
    base.position.set(cx, -0.6, cz);
    this.stageGroup.add(base);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const h = maxH * (0.4 + Math.sin(r * 1.7 + c * 0.9) * 0.3 + density * 0.3);
        const px = cx - cellW / 2 + (c + 0.7) * (cellW / (cols + 0.4));
        const pz = cz - depth / 2 + (r + 0.7) * (depth / (rows + 0.4));
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(pW, h, pD), mat);
        pillar.position.set(px, h / 2 - 0.3, pz);
        this.stageGroup.add(pillar);
      }
    }
  }

  // G1: 계단 — x 방향으로 4단 점층 상승
  _addSegSteps(cx, cz, cellW, depth, matte, plateMat) {
    const steps = 4;
    const sw = cellW / steps;
    const mat = plateMat; // 재질 공유
    for (let i = 0; i < steps; i++) {
      const h = 0.6 + i * 0.7;
      const ox = cx - cellW / 2 + (i + 0.5) * sw;
      const step = new THREE.Mesh(new THREE.BoxGeometry(sw - 0.4, h, depth), mat);
      step.position.set(ox, h / 2 - 0.3, cz);
      this.stageGroup.add(step);
    }
  }

  // D3: 섹션 번호를 캔버스 텍스처로 그린 스프라이트 반환
  _makeTextSprite(text, color = "#c8d0ff") {
    const canvas = document.createElement("canvas");
    canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(6, 8, 116, 48);
    ctx.fillStyle = color;
    ctx.font = "bold 34px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(12, 6, 1);
    return spr;
  }

  applyRenderStyle() {
    const matte = this.renderStyle === "matte";
    // 블룸: matte면 0 (update 루프도 style 가드)
    this.bloom.strength = matte ? 0 : 0.9;
    // 배경/조명
    if (matte) {
      // 중립 밝은 회색 무대 + ambient 강화
      this.scene.background = new THREE.Color(0x9a9a9a);
      this.scene.fog = new THREE.Fog(0x9a9a9a, 120, 480);
      while (this.bgGroup.children.length) {
        const c = this.bgGroup.children.pop();
        c.geometry && c.geometry.dispose();
        this.bgGroup.remove(c);
      }
    } else {
      this.scene.fog = new THREE.Fog(0x05060a, 80, 320);
      this.setBackgroundMode(this.bgMode); // glow 복귀 시 현재 배경 재적용
    }
    if (this.ambient) this.ambient.intensity = matte ? 0.95 : 0.5;
    // 머티리얼: 지형/큐브 발광 제거 + 무광
    for (const v of this.voices) {
      const tmat = v.terrain && v.terrain.material;
      if (tmat) {
        tmat.emissive.copy(matte ? new THREE.Color(0x000000) : new THREE.Color(v.color).multiplyScalar(0.25));
        tmat.roughness = matte ? 0.95 : 0.4;
        tmat.metalness = matte ? 0.0 : 0.2;
        tmat.needsUpdate = true;
      }
      if (v.mat) {
        v.mat.emissive.copy(matte ? new THREE.Color(0x111111) : new THREE.Color(v.color).multiplyScalar(0.4));
        v.mat.roughness = matte ? 0.85 : 0.25;
        v.mat.metalness = matte ? 0.0 : 0.3;
        v.mat.needsUpdate = true;
      }
    }
    this._buildDioramaStage(); // ③ 섬 플레이트/연결로(렌더 스타일 색 반영)
  }

  // ---------- 로드 ----------
  clear() {
    for (const v of this.voices) {
      v.terrain && this.scene.remove(v.terrain);
      v.terrain && v.terrain.geometry.dispose();
      v.cube && this.scene.remove(v.cube);
      v.pillars && this.scene.remove(v.pillars);
      v.chordDots && this.scene.remove(v.chordDots);
    }
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.voices = []; this.particles = [];
  }

  load(analysis, maxVoices) {
    this._lastAnalysis = analysis;
    this._lastMaxVoices = maxVoices;
    this.clear();
    this.pitchMin = analysis.pitchRange.min;
    this.pitchMax = analysis.pitchRange.max;
    this.duration = analysis.durationSec;
    this._computeDiorama();

    // 전체 트랙(드럼 포함)에서 중요도 상위 maxVoices개 선택
    const selected = analysis.parts
      .filter((p) => p.notes.length)
      .sort((a, b) => a.importanceRank - b.importanceRank)
      .slice(0, maxVoices);
    // 음정 성부 먼저, 드럼은 아래 레인으로
    selected.sort((a, b) => (a.isRhythm === b.isRhythm ? a.importanceRank - b.importanceRank : a.isRhythm ? 1 : -1));
    selected.forEach((part, i) => this._buildVoice(part, i, part.isRhythm));
    this._mainVoice = this.voices.find((v) => !v.isRhythm) || this.voices[0] || null;
    this._laneCount = this.voices.length;
    this.canon = analysis.canon || null;
    this.mirror = analysis.mirror || null;
    this.structuralUnits = analysis.structuralUnits || [];
    this._buildChaseMap();
    this.applyRenderStyle(); // 재빌드 후 렌더 스타일 + 디오라마 무대 재적용
    this._buildMirror();     // C4 거울상 고스트(applyRenderStyle 뒤: 베이스 지형 머티리얼 확정 후)
    this._applySharedTerrain(); // H2a: 공유 지형(후행 지형 숨김) — chase 맵 확정 후
    this._rebuildGrid();     // E4: 바닥 크기를 곡 길이·성부 수에 맞춰 동적 재계산
    this._buildCornerReflect(); // G2 직교 3평면
  }

  // C4+D2: 역행/전위로 감지된 거울 대칭쌍 → 베이스 성부 지형을 바닥 아래로 뒤집은
  // '검은 수면 반사' 고스트. 같은 x·z에 겹쳐 y=0 아래로 내림(scale.y=-1 → y=h → -h).
  // 역행(retrograde)은 시간축도 반사. 접힌 좌표가 깨지므로 scroll 모드에서만.
  _buildMirror() {
    while (this.mirrorGroup.children.length) {
      const c = this.mirrorGroup.children.pop();
      c.material && c.material.dispose();
      this.mirrorGroup.remove(c);
    }
    const m = this.mirror;
    if (!this.mirrorEmphasis || !m || !m.detected || this.stageMode === "diorama") return;
    const byPart = (pi) => this.voices.find((v) => v.partIndex === pi);
    const xc = (this.duration * X_PER_SEC) / 2;
    for (const pr of m.pairs) {
      const base = byPart(pr.base);
      if (!base || !base.terrain) continue;
      const ghost = new THREE.Mesh(
        base.terrain.geometry, // 지오메트리 공유 — 변환은 scale/position으로
        new THREE.MeshStandardMaterial({
          color: 0x080c1a, transparent: true, opacity: 0.42,
          roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide, depthWrite: false,
        })
      );
      // 수면 반사: y=0 기준으로 아래로 뒤집음 (scale.y=-1 → 지형 y=h가 -h로)
      ghost.scale.y = -1;
      // 역행: 시간축도 반사
      const retro = pr.type === "retrograde" || pr.type === "retrograde-inversion";
      if (retro) { ghost.scale.x = -1; ghost.position.x = 2 * xc; }
      ghost.userData.mirrorOf = pr;
      this.mirrorGroup.add(ghost);
    }
  }

  // G2: 직교 3평면 반사(No.13 스타일) — scroll 모드에서만 활성.
  // 뒤벽(XY: 시간×음높이=피아노롤), 옆벽(YZ: 음높이×레인), 바닥(XZ: 시간×레인)에
  // 캔버스 텍스처 투영. 성부색 반투명 바 형태.
  _buildCornerReflect() {
    while (this.cornerGroup.children.length) {
      const c = this.cornerGroup.children.pop();
      c.material?.map?.dispose();
      c.material?.dispose();
      c.geometry?.dispose();
      this.cornerGroup.remove(c);
    }
    if (!this.cornerReflect || this.stageMode === "diorama" || !this._lastAnalysis) return;
    const parts = this._lastAnalysis.parts || [];
    const dur = this.duration || 60;
    const totalX = dur * X_PER_SEC;
    const laneCount = this._laneCount || 1;
    const gap = this._laneGap();
    const laneSpan = Math.max(gap, (laneCount - 1) * gap);
    const pMin = (this._lastAnalysis.pitchRange?.min || 48) - 2;
    const pMax = (this._lastAnalysis.pitchRange?.max || 84) + 2;
    const pitchSpan = Math.max(1, pMax - pMin);
    const wallH = Y_HEIGHT + 6;
    const wallZOff = -(laneSpan + gap * 2.5);
    const wallXOff = -(gap * 2);

    const drawNotes = (canvas, w, h, xFn, yFn, nwFn, nhFn) => {
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#06080f";
      ctx.fillRect(0, 0, w, h);
      let vi = -1;
      for (const p of parts) {
        if (p.isRhythm) continue;
        vi++;
        const col = "#" + voiceColorHex(vi).toString(16).padStart(6, "0");
        ctx.fillStyle = col;
        for (const n of p.notes) {
          if (n.midi == null) continue;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(xFn(n, vi), yFn(n, vi), Math.max(2, nwFn(n)), Math.max(2, nhFn(n, vi)));
        }
      }
      ctx.globalAlpha = 1;
    };

    const PX = 1024, PY = 512;
    const pxPerSec = PX / dur;
    const pxPerMidi = PY / pitchSpan;
    const pxPerLane = PY / Math.max(1, laneCount);

    // 뒤벽: 시간(x) × 음높이(y) — 피아노롤 투영
    const cvBack = document.createElement("canvas");
    cvBack.width = PX; cvBack.height = PY;
    drawNotes(cvBack, PX, PY,
      (n) => n.startSec * pxPerSec,
      (n) => PY - (n.midi - pMin + 1) * pxPerMidi,
      (n) => n.durSec * pxPerSec,
      () => Math.max(3, pxPerMidi - 1),
    );
    const backPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(totalX, wallH),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvBack), transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    backPlane.position.set(totalX / 2, wallH / 2 - 1, wallZOff);
    this.cornerGroup.add(backPlane);

    // 바닥: 시간(x) × 레인(z) — 레인 배치 투영
    const cvFloor = document.createElement("canvas");
    cvFloor.width = PX; cvFloor.height = PY;
    drawNotes(cvFloor, PX, PY,
      (n) => n.startSec * pxPerSec,
      (_n, vi) => vi * pxPerLane,
      (n) => n.durSec * pxPerSec,
      () => Math.max(3, pxPerLane - 2),
    );
    const floorPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(totalX, laneSpan + gap * 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvFloor), transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    floorPlane.rotation.x = -Math.PI / 2;
    floorPlane.position.set(totalX / 2, -1.1, -(laneSpan + gap) / 2);
    this.cornerGroup.add(floorPlane);

    // 옆벽: 레인(z) × 음높이(y) — 화성 단면 투영
    const cvSide = document.createElement("canvas");
    cvSide.width = PY; cvSide.height = PY;
    drawNotes(cvSide, PY, PY,
      (_n, vi) => vi * pxPerLane,
      (n) => PY - (n.midi - pMin + 1) * pxPerMidi,
      (_n, vi) => Math.max(3, pxPerLane - 2),  // eslint-disable-line no-unused-vars
      () => Math.max(3, pxPerMidi - 1),
    );
    const sidePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(laneSpan + gap * 2, wallH),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvSide), transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
    );
    sidePlane.rotation.y = Math.PI / 2;
    sidePlane.position.set(wallXOff, wallH / 2 - 1, -(laneSpan + gap) / 2);
    this.cornerGroup.add(sidePlane);
  }

  // C2: 각 성부가 어떤 캐논쌍의 '후행'인지 → 선행 성부 트랙 위에서 lagSec 만큼 뒤를
  // 따라가도록 매핑. 캐논 미감지 시 비활성. lag≈0(시간차 없음)은 추격이 안 보이니 제외.
  _buildChaseMap() {
    for (const v of this.voices) v.chase = null;
    const c = this.canon;
    if (!c || !c.detected || !c.pairs) return;
    for (const v of this.voices) {
      let best = null;
      for (const pr of c.pairs) {
        if (pr.follower !== v.partIndex || pr.lagSec <= 0.05) continue;
        const leaderVoice = this.voices.find((x) => x.partIndex === pr.leader);
        if (leaderVoice && leaderVoice !== v && (!best || pr.similarity > best.sim)) {
          best = { leaderVoice, lagSec: pr.lagSec, sim: pr.similarity };
        }
      }
      v.chase = best; // {leaderVoice, lagSec, sim} | null
    }
  }

  _sampleHeights(notes, isRhythm) {
    // 시간축을 잘게 샘플 → 음이 울리는 구간만 음높이, 쉼표는 얇은 레일 → 이동평균으로 언덕화.
    // (이전엔 쉼표에 직전 음높이를 유지해 선이 안 내려갔음 — 길이/쉼표 정보가 사라졌다.)
    const step = Math.max(0.03, this.duration / 4000);
    const xs = [], ys = [];
    let idx = 0;
    for (let t = 0; t <= this.duration; t += step) {
      while (idx + 1 < notes.length && notes[idx + 1].startSec <= t) idx++;
      const n = notes[idx];
      let y = RAIL; // 쉼표 기본값 = 얇은 선
      if (n && t >= n.startSec && t <= n.startSec + (n.durSec || 0.1)) {
        y = isRhythm ? DRUM_H : Math.max(RAIL, this.yFor(n.midi)); // 음 지속 구간만 높이
      }
      xs.push(t * X_PER_SEC);
      ys.push(y);
    }
    // 이동평균
    const sm = ys.slice();
    const w = 2;
    for (let i = 0; i < ys.length; i++) {
      let s = 0, c = 0;
      for (let k = -w; k <= w; k++) { const j = i + k; if (j >= 0 && j < ys.length) { s += ys[j]; c++; } }
      sm[i] = s / c;
    }
    return { xs, ys: sm };
  }

  // ① 이산 블록: 음표마다 평평한 캡(가로폭=음길이) + 수직 라이저. 쉼표는 얇은 레일.
  _steppedHeights(notes, isRhythm) {
    const xs = [], ys = [];
    const pt = (t, y) => { xs.push(t * X_PER_SEC); ys.push(y); };
    let cursor = 0; // 직전까지 그린 시각(초)
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const s = Math.max(n.startSec, cursor);
      const e = Math.max(s, n.startSec + (n.durSec || 0.1));
      const h = isRhythm ? DRUM_H : Math.max(RAIL, this.yFor(n.midi));
      if (n.startSec > cursor + 1e-3) {
        // 쉼표 구간: 얇은 레일로 진행하다 음표 시작에서 수직 상승
        pt(cursor, RAIL); pt(n.startSec, RAIL); pt(n.startSec, h);
      } else {
        // 직전 음과 이어짐(레가토): 캡 높이에서 새 높이로 수직 전환
        pt(s, h);
      }
      pt(e, h);   // 평평한 캡 = 음 길이
      cursor = e;
    }
    if (cursor < this.duration - 1e-3) { pt(cursor, RAIL); pt(this.duration, RAIL); } // 끝 쉼표
    return { xs, ys };
  }

  // 시각 t에 울리고 있는 음표(없으면 null) — 마커 높이를 지형(레일/캡)과 맞추는 데 사용.
  _noteAt(notes, t) {
    let lo = 0, hi = notes.length - 1, idx = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (notes[m].startSec <= t) { idx = m; lo = m + 1; } else hi = m - 1;
    }
    if (idx < 0) return null;
    const n = notes[idx];
    return t <= n.startSec + (n.durSec || 0.1) ? n : null;
  }

  _heightAt(notes, t, isRhythm) {
    const n = this._noteAt(notes, t);
    if (!n) return RAIL; // 쉼표 → 얇은 선 위
    return isRhythm ? DRUM_H : Math.max(RAIL, this.yFor(n.midi));
  }

  _buildVoice(part, laneIndex, isRhythm) {
    const laneZ = -laneIndex * this._laneGap();
    const color = voiceColorHex(part.index);
    const { xs, ys } = this.terrainShape === "stepped"
      ? this._steppedHeights(part.notes, isRhythm)
      : this._sampleHeights(part.notes, isRhythm);

    // 채워진 입체 지형: 상단 캡 + 전면 벽 (라인 아래를 바닥까지 채움)
    const thick = this._laneThick();
    const dioOn = this.stageMode === "diorama" && this.diorama;
    const positions = [], normals = [];
    const push = (x, y, z, nx, ny, nz) => { positions.push(x, y, z); normals.push(nx, ny, nz); };
    for (let i = 0; i + 1 < xs.length; i++) {
      const y0 = ys[i], y1 = ys[i + 1];
      // D4: 리본 파동 — 각 세그먼트 양끝의 z 중심을 독립 계산(wave면 사인 오프셋 부가).
      const rz0 = this._ribbonZ(xs[i] / X_PER_SEC, laneIndex);
      const rz1 = this._ribbonZ(xs[i + 1] / X_PER_SEC, laneIndex);
      let wx0, wx1, cz0, cz1;
      if (dioOn) {
        const a = this._worldXZ(xs[i] / X_PER_SEC, laneZ + rz0);
        const b = this._worldXZ(xs[i + 1] / X_PER_SEC, laneZ + rz1);
        if (a.s !== b.s) continue; // 섬 경계에서 끊음
        wx0 = a.wx; wx1 = b.wx; cz0 = a.wz; cz1 = b.wz;
      } else {
        wx0 = xs[i]; wx1 = xs[i + 1];
        cz0 = laneZ + rz0; cz1 = laneZ + rz1;
      }
      // 세그먼트 양끝 z 엣지(a=뒤쪽, b=카메라쪽)
      const za0 = cz0 - thick / 2, zb0 = cz0 + thick / 2;
      const za1 = cz1 - thick / 2, zb1 = cz1 + thick / 2;
      // 상단 캡 (사다리꼴 → 삼각형 2개)
      push(wx0, y0, za0, 0, 1, 0); push(wx0, y0, zb0, 0, 1, 0); push(wx1, y1, zb1, 0, 1, 0);
      push(wx0, y0, za0, 0, 1, 0); push(wx1, y1, zb1, 0, 1, 0); push(wx1, y1, za1, 0, 1, 0);
      // 전면 벽 (카메라쪽 b 엣지)
      push(wx0, y0, zb0, 0, 0, 1); push(wx0, 0, zb0, 0, 0, 1); push(wx1, 0, zb1, 0, 0, 1);
      push(wx0, y0, zb0, 0, 0, 1); push(wx1, 0, zb1, 0, 0, 1); push(wx1, y1, zb1, 0, 0, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color).multiplyScalar(0.25),
      roughness: 0.4, metalness: 0.2, transparent: true,
      opacity: this._terrainOpacity(isRhythm), side: THREE.DoubleSide,
    });
    const terrain = new THREE.Mesh(geo, mat);
    this.scene.add(terrain);

    // 큐브: 성부 고정색 (ADR 0009)
    const cubeMat = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color).multiplyScalar(0.4),
      roughness: 0.25, metalness: 0.3,
    });
    const cube = new THREE.Mesh(new THREE.BoxGeometry(CUBE, CUBE, CUBE), cubeMat);
    this.scene.add(cube);

    // 화음 반투명 기둥 (최저~최고음) — InstancedMesh 로 한 번에 (ADR 0009)
    let pillars = null;
    if (!isRhythm) {
      const chords = part.notes.filter((n) => n.chordMidis && n.chordMidis.length > 1);
      if (chords.length) {
        pillars = new THREE.InstancedMesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial({
            color, transparent: true, opacity: 0.16,
            emissive: new THREE.Color(color).multiplyScalar(0.15), depthWrite: false,
          }),
          chords.length
        );
        const m = new THREE.Matrix4(), q = new THREE.Quaternion();
        chords.forEach((n, i) => {
          const lo = this.yFor(Math.min(...n.chordMidis));
          const hi = this.yFor(Math.max(...n.chordMidis));
          const h = Math.max(0.4, hi - lo);
          const w = Math.max(0.4, (n.durSec || 0.2) * X_PER_SEC);
          const tMid = n.startSec + (n.durSec || 0.2) / 2;
          const wz = laneZ + this._ribbonZ(tMid, laneIndex);
          const p = dioOn ? this._worldXZ(tMid, wz) : { wx: n.startSec * X_PER_SEC + w / 2, wz };
          m.compose(new THREE.Vector3(p.wx, (lo + hi) / 2, p.wz), q,
            new THREE.Vector3(w * 0.9, h, thick * 0.7));
          pillars.setMatrixAt(i, m);
        });
        pillars.instanceMatrix.needsUpdate = true;
        this.scene.add(pillars);
      }
    }

    // D1 화음 개별 마커: 음표마다 화음 구성음 각각을 작은 구체로 표시.
    let chordDots = null;
    if (!isRhythm && this.chordDetail === "individual") {
      const dotData = [];
      for (const n of part.notes) {
        const midis = n.chordMidis && n.chordMidis.length > 1 ? n.chordMidis : [n.midi];
        const tMid = n.startSec + (n.durSec || 0.1) / 2;
        for (const midi of midis) {
          dotData.push({ t: tMid, y: Math.max(RAIL, this.yFor(midi)) });
        }
      }
      if (dotData.length) {
        chordDots = new THREE.InstancedMesh(
          new THREE.SphereGeometry(0.22, 6, 4),
          new THREE.MeshStandardMaterial({
            color, emissive: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.2,
          }),
          dotData.length
        );
        const mx = new THREE.Matrix4();
        dotData.forEach((d, idx) => {
          const dwz = laneZ + this._ribbonZ(d.t, laneIndex);
          const p = dioOn ? this._worldXZ(d.t, dwz) : { wx: d.t * X_PER_SEC, wz: dwz };
          mx.setPosition(p.wx, d.y + 0.22, p.wz);
          chordDots.setMatrixAt(idx, mx);
        });
        chordDots.instanceMatrix.needsUpdate = true;
        this.scene.add(chordDots);
      }
    }

    this.voices.push({
      partIndex: part.index, notes: part.notes, laneZ, laneIndex, terrain, cube, pillars, chordDots,
      mat: cubeMat, color, isRhythm, flash: 0,
    });
  }

  flashByPart(partIndex) {
    const v = this.voices.find((x) => x.partIndex === partIndex);
    if (v) { v.flash = 1; this._spawnParticles(v); }
  }

  pulse() { this.beatBoost = 1; }

  _spawnParticles(v) {
    const { x, y, z } = v.cube.position;
    const geo = new THREE.SphereGeometry(0.14, 6, 6);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: v.color }));
      m.position.set(x, y, z);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 6 + 2, (Math.random() - 0.5) * 5);
      this.scene.add(m);
      this.particles.push({ mesh: m, vel, life: 1 });
    }
  }

  update(position, dt) {
    // D3: 스크롤 모드 전환 시 섹션 HUD 숨김
    const hud = document.getElementById("section-hud");
    if (hud) hud.style.display = (this.stageMode === "diorama") ? "" : "none";
    const dioOn = this.stageMode === "diorama" && this.diorama;
    for (const v of this.voices) {
      // C2 시차 추격: 후행 성부는 선행 성부의 트랙(레인) 위에서 lagSec 만큼 뒤 시점을
      // 달려 같은 구조를 '추격'한다. 비캐논/토글 off면 자기 트랙·현재시각 그대로.
      const chase = this.canonEmphasis ? v.chase : null;
      const t = chase ? Math.max(0, position - chase.lagSec) : position;
      const laneZ = chase ? chase.leaderVoice.laneZ : v.laneZ;
      const vi = chase ? chase.leaderVoice.laneIndex : v.laneIndex; // D4 ribbon phase
      const notesForY = chase ? chase.leaderVoice.notes : v.notes;
      const isR = chase ? chase.leaderVoice.isRhythm : v.isRhythm;
      // D4: 리본 파동 오프셋 적용 — 큐브가 지형 리본과 함께 z방향으로 굽이침.
      const effectiveLaneZ = laneZ + this._ribbonZ(t, vi);
      // 마커도 지형과 일치: 음 지속 중엔 캡 높이, 쉼표엔 얇은 레일 위.
      const y = this._heightAt(notesForY, t, isR);
      const p = dioOn ? this._worldXZ(t, effectiveLaneZ) : { wx: t * X_PER_SEC, wz: effectiveLaneZ };
      v.cube.position.set(p.wx, y + CUBE / 2, p.wz);
      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt * 3);
        v.mat.emissive.setScalar(this.renderStyle === "matte" ? v.flash * 0.15 : 0.4 + v.flash * 0.6);
        v.cube.scale.setScalar(1 + v.flash * 0.7);
      }
    }

    for (const p of this.particles) {
      p.life -= dt * 1.5; p.vel.y -= dt * 9;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.material.transparent = true;
      p.mesh.material.opacity = Math.max(0, p.life);
    }
    this.particles = this.particles.filter((p) => {
      if (p.life <= 0) { this.scene.remove(p.mesh); return false; } return true;
    });

    // 비트 반응 → 블룸 부스트
    if (this.beatBoost > 0) this.beatBoost = Math.max(0, this.beatBoost - dt * 2.5);
    this.bloom.strength = this.renderStyle === "matte" ? 0 : 0.9 + this.beatBoost * 0.9;

    this._updateCamera(position);
    this.composer.render();
  }

  _updateCamera(position) {
    // ③ 디오라마: 아이소메트릭 부감으로 현재 섬을 따라간다
    if (this.stageMode === "diorama" && this.diorama) {
      const seg = Math.min(
        Math.max(0, Math.floor(position / this.diorama.segDur)),
        this.diorama.nSegs - 1
      );
      // D3: 섬 전환 감지 → 카메라 hop (lerp 계수 급상승, 2프레임 유지)
      if (seg !== this._lastSeg) {
        this._hopFrames = 6; // 약 0.1s(60fps 기준) 동안 빠른 lerp
        this._lastSeg = seg;
        // 섹션 HUD 갱신
        const hud = document.getElementById("section-hud");
        if (hud) hud.textContent = `§${seg + 1} / ${this.diorama.nSegs}`;
      }
      if (this._hopFrames > 0) this._hopFrames--;
      const lerpF = (this._hopFrames > 0) ? 0.28 : 0.06;
      const w = this._mainVoice
        ? this._worldXZ(position, this._mainVoice.laneZ)
        : this._worldXZ(position, 0);
      const desired = new THREE.Vector3(w.wx - 18, 34, w.wz + 30);
      const look = new THREE.Vector3(w.wx + 8, 3, w.wz - 4);
      this.camera.position.lerp(desired, lerpF);
      this.camera.lookAt(look);
      return;
    }
    const x = position * X_PER_SEC;
    const main = this._mainVoice ? this._mainVoice.cube.position : new THREE.Vector3(x, 5, 0);
    const midZ = -((this._laneCount - 1) * this._laneGap()) / 2;
    let desired, look;
    if (this.cameraMode === "chase") {
      desired = new THREE.Vector3(x - 14, main.y + 6, this._mainVoice ? this._mainVoice.laneZ + 10 : 12);
      look = new THREE.Vector3(x + 12, Y_HEIGHT * 0.4, this._mainVoice ? this._mainVoice.laneZ : 0);
    } else if (this.cameraMode === "side") {
      desired = new THREE.Vector3(x, Y_HEIGHT * 0.6, 42);
      look = new THREE.Vector3(x, Y_HEIGHT * 0.5, midZ);
    } else {
      // overhead 3/4 부감
      desired = new THREE.Vector3(x - 20, Y_HEIGHT + 18, 34);
      look = new THREE.Vector3(x + 8, Y_HEIGHT * 0.4, midZ);
    }
    // 시점 좌/우: 레인 중심선(midZ) 기준으로 카메라를 반대편으로 반사
    if (this.cameraSide === "left") {
      desired = desired.clone();
      desired.z = 2 * midZ - desired.z;
      desired.x = 2 * x - desired.x; // 진행 반대쪽에서 바라보게
    }
    this.camera.position.lerp(desired, 0.08);
    this.camera.lookAt(look);
  }

  // G3: 첫 N음을 'A B C D …' 라벨 큐브 한 줄로 제시 — 분석 직후 표시, 재생 시 제거.
  buildThemeOpening() {
    this.clearThemeOpening();
    if (!this._lastAnalysis) return;
    const mainPart = this._lastAnalysis.parts.find((p) => !p.isRhythm);
    if (!mainPart) return;
    const notes = mainPart.notes.filter((n) => n.midi != null).slice(0, 8);
    if (!notes.length) return;

    const matte = this.renderStyle === "matte";
    const SPACING = 14;
    const totalW = (notes.length - 1) * SPACING;
    const startX = -(totalW + 30); // 곡 시작(x=0) 왼쪽에 배치
    const labels = "ABCDEFGH";
    const pMin = this._lastAnalysis.pitchRange?.min ?? 48;
    const pMax = this._lastAnalysis.pitchRange?.max ?? 84;
    const pSpan = Math.max(1, pMax - pMin);

    notes.forEach((n, i) => {
      const col = new THREE.Color(voiceColorHex(0));
      const h = Math.max(2, ((n.midi - pMin) / pSpan) * Y_HEIGHT + 1);
      const mat = new THREE.MeshStandardMaterial({
        color: matte ? 0xdddddd : col,
        emissive: matte ? 0x000000 : col,
        emissiveIntensity: matte ? 0 : 0.25,
        roughness: matte ? 0.9 : 0.5, metalness: matte ? 0 : 0.2,
      });
      const cube = new THREE.Mesh(new THREE.BoxGeometry(CUBE * 2.5, h, CUBE * 2.5), mat);
      cube.position.set(startX + i * SPACING, h / 2, 0);
      this.themeGroup.add(cube);
      const spr = this._makeTextSprite(labels[i] || String(i + 1), matte ? "#222" : "#c8d0ff");
      spr.position.set(startX + i * SPACING, h + 5, 0);
      this.themeGroup.add(spr);
    });
    this.showingTheme = true;
    // 카메라를 주제 행 정면으로 맞춤
    const cx = startX + totalW / 2;
    this.camera.position.set(cx, 22, 55);
    this.camera.lookAt(cx, 5, 0);
  }

  clearThemeOpening() {
    while (this.themeGroup.children.length) {
      const c = this.themeGroup.children.pop();
      c.geometry?.dispose();
      c.material?.dispose();
      this.themeGroup.remove(c);
    }
    this.showingTheme = false;
  }

  renderStatic() { this.composer.render(); }
}
