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
const CUBE = 1.0;
const LANE_THICK = 2.4; // 지형 z 두께

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

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
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

    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);

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

  _addGrid() {
    const grid = new THREE.GridHelper(2000, 400, 0x2a3a66, 0x141d33);
    grid.position.y = -0.02;
    this.bgGroup.add(grid);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 400),
      new THREE.MeshStandardMaterial({ color: 0x070a14, roughness: 0.4, metalness: 0.6 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.05;
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

  // ---------- 로드 ----------
  clear() {
    for (const v of this.voices) {
      v.terrain && this.scene.remove(v.terrain);
      v.terrain && v.terrain.geometry.dispose();
      v.cube && this.scene.remove(v.cube);
      v.pillars && this.scene.remove(v.pillars);
    }
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.voices = []; this.particles = [];
  }

  load(analysis, maxVoices) {
    this.clear();
    this.pitchMin = analysis.pitchRange.min;
    this.pitchMax = analysis.pitchRange.max;
    this.duration = analysis.durationSec;

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
  }

  _sampleHeights(notes, isRhythm) {
    // 시간축을 잘게 샘플 → 음높이 유지(쉼표는 직전) → 이동평균으로 언덕화
    const step = Math.max(0.03, this.duration / 4000);
    const xs = [], ys = [];
    let idx = 0;
    for (let t = 0; t <= this.duration; t += step) {
      while (idx + 1 < notes.length && notes[idx + 1].startSec <= t) idx++;
      const n = notes[idx];
      const y = isRhythm ? 0.6 : (n ? this.yFor(n.midi) : 0);
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

  _buildVoice(part, laneIndex, isRhythm) {
    const laneZ = -laneIndex * LANE_GAP;
    const color = voiceColorHex(part.index);
    const { xs, ys } = this._sampleHeights(part.notes, isRhythm);

    // 채워진 입체 지형: 상단 캡 + 전면 벽 (라인 아래를 바닥까지 채움)
    const z0 = laneZ - LANE_THICK / 2, z1 = laneZ + LANE_THICK / 2;
    const positions = [], normals = [];
    const push = (x, y, z, nx, ny, nz) => { positions.push(x, y, z); normals.push(nx, ny, nz); };
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1], y0 = ys[i], y1 = ys[i + 1];
      // 상단 캡 (위 방향)
      push(x0, y0, z0, 0, 1, 0); push(x0, y0, z1, 0, 1, 0); push(x1, y1, z1, 0, 1, 0);
      push(x0, y0, z0, 0, 1, 0); push(x1, y1, z1, 0, 1, 0); push(x1, y1, z0, 0, 1, 0);
      // 전면 벽 (카메라쪽 z1)
      push(x0, y0, z1, 0, 0, 1); push(x0, 0, z1, 0, 0, 1); push(x1, 0, z1, 0, 0, 1);
      push(x0, y0, z1, 0, 0, 1); push(x1, 0, z1, 0, 0, 1); push(x1, y1, z1, 0, 0, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color).multiplyScalar(0.25),
      roughness: 0.4, metalness: 0.2, transparent: true,
      opacity: isRhythm ? 0.45 : 0.9, side: THREE.DoubleSide,
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
          const x = n.startSec * X_PER_SEC + w / 2;
          m.compose(new THREE.Vector3(x, (lo + hi) / 2, laneZ), q,
            new THREE.Vector3(w * 0.9, h, LANE_THICK * 0.7));
          pillars.setMatrixAt(i, m);
        });
        pillars.instanceMatrix.needsUpdate = true;
        this.scene.add(pillars);
      }
    }

    this.voices.push({
      partIndex: part.index, notes: part.notes, laneZ, terrain, cube, pillars,
      mat: cubeMat, color, isRhythm, flash: 0,
    });
  }

  _pitchAt(notes, position) {
    let lo = 0, hi = notes.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].startSec <= position) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx < 0) return notes.length ? notes[0].midi : null;
    return notes[idx].midi;
  }

  flashByPart(partIndex) {
    const v = this.voices.find((x) => x.partIndex === partIndex);
    if (v) { v.flash = 1; this._spawnParticles(v); }
  }

  pulse() { this.beatBoost = 1; }

  _spawnParticles(v) {
    const { x, y } = v.cube.position;
    const geo = new THREE.SphereGeometry(0.14, 6, 6);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: v.color }));
      m.position.set(x, y, v.laneZ);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 6 + 2, (Math.random() - 0.5) * 5);
      this.scene.add(m);
      this.particles.push({ mesh: m, vel, life: 1 });
    }
  }

  update(position, dt) {
    for (const v of this.voices) {
      const x = position * X_PER_SEC;
      const midi = this._pitchAt(v.notes, position);
      const y = v.isRhythm ? 0.6 : (midi != null ? this.yFor(midi) : 0);
      v.cube.position.set(x, y + CUBE / 2, v.laneZ);
      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt * 3);
        v.mat.emissive.setScalar(0.4 + v.flash * 0.6);
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
    this.bloom.strength = 0.9 + this.beatBoost * 0.9;

    this._updateCamera(position);
    this.composer.render();
  }

  _updateCamera(position) {
    const x = position * X_PER_SEC;
    const main = this._mainVoice ? this._mainVoice.cube.position : new THREE.Vector3(x, 5, 0);
    const midZ = -((this._laneCount - 1) * LANE_GAP) / 2;
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

  renderStatic() { this.composer.render(); }
}
