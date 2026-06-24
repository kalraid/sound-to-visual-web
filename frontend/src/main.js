// 오케스트레이션: 업로드 → /analyze → 악보+지형+오디오 로드 → 단일 루프로 동기.
import { AudioEngine } from "./audio.js";
import { ScorePanel } from "./score.js";
import { PianoRollPanel, MiniRollOverlay } from "./pianoroll.js";
import { Terrain } from "./terrain.js";
import { voiceColorHex } from "./colors.js";

const $ = (id) => document.getElementById(id);

const audio = new AudioEngine();
const score = new ScorePanel("osmd", "score-panel");
const pianoroll = new PianoRollPanel("pianoroll", "score-panel");
const miniRoll = new MiniRollOverlay("mini-roll"); // D5 코너 오버레이
const terrain = new Terrain("stage");
window.__terrain = terrain; // 헤드리스 수치 검증용(3D는 스크린샷 불가 — TODO 참고)

// 악보 패널 선택형(C3): osmd | pianoroll. 둘 다 로드해 두고 표시만 토글.
let scoreMode = "osmd";
const activeScore = () => (scoreMode === "pianoroll" ? pianoroll : score);

let analysis = null;
let maxVoices = 4;
let prevPos = 0;

// --- UI 배선 ---
// E1: 레퍼런스 모드 프리셋 — 전부 신규값이면 레퍼런스 느낌(ADR 0011).
const PRESET_REF = {
  "shape-select": "stepped", "style-select": "matte", "track-select": "narrow",
  "stage-select": "diorama", "lane-sep-select": "auto",
  "canon-select": "on", "share-select": "off", "mirror-select": "on",
  "ribbon-select": "straight", "chord-select": "merged",
  "bg-select": "grid", "beat-select": "drum",
  "camera-select": "overhead", "camdir-select": "right",
  "score-select": "osmd", "corner-roll-select": "off",
};
const PRESET_ORIG = {
  "shape-select": "smooth", "style-select": "glow", "track-select": "wide",
  "stage-select": "scroll", "lane-sep-select": "auto",
  "canon-select": "on", "share-select": "off", "mirror-select": "on",
  "ribbon-select": "straight", "chord-select": "merged",
  "bg-select": "grid", "beat-select": "drum",
  "camera-select": "overhead", "camdir-select": "right",
  "score-select": "osmd", "corner-roll-select": "off",
};

function applyPreset(preset) {
  Object.entries(preset).forEach(([id, val]) => {
    const el = $(id);
    if (el) el.value = val;
    // 각 select의 change 이벤트를 직접 dispatch해 terrain setter 연동
    el && el.dispatchEvent(new Event("change"));
  });
  if (analysis) terrain.load(analysis, maxVoices);
}

$("preset-ref-btn").addEventListener("click", () => applyPreset(PRESET_REF));
$("preset-orig-btn").addEventListener("click", () => applyPreset(PRESET_ORIG));

$("open-btn").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (e) => {
  if (e.target.files[0]) uploadFile(e.target.files[0]);
});

const stage = $("stage");
["dragover", "dragenter"].forEach((ev) =>
  stage.addEventListener(ev, (e) => { e.preventDefault(); })
);
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
});

$("play-btn").addEventListener("click", async () => {
  if (!analysis) return;
  await audio.ensureStarted();
  audio.toggle();
  $("play-btn").textContent = audio.playing ? "⏸ 일시정지" : "▶︎ 재생";
});

$("seek").addEventListener("input", (e) => {
  if (!analysis) return;
  const sec = (e.target.value / 1000) * audio.duration;
  audio.seek(sec);
  activeScore().update(sec);
});

$("rate-select").addEventListener("change", (e) => audio.setRate(parseFloat(e.target.value)));

$("voice-slider").addEventListener("input", (e) => {
  maxVoices = parseInt(e.target.value, 10);
  $("voice-count").textContent = maxVoices;
  if (analysis) terrain.load(analysis, maxVoices);
});

$("camera-select").addEventListener("change", (e) => terrain.setCameraMode(e.target.value));
$("camdir-select").addEventListener("change", (e) => terrain.setCameraSide(e.target.value));
$("bg-select").addEventListener("change", (e) => terrain.setBackgroundMode(e.target.value));
$("beat-select").addEventListener("change", (e) => terrain.setBeatMode(e.target.value));
$("shape-select").addEventListener("change", (e) => terrain.setTerrainShape(e.target.value));
$("style-select").addEventListener("change", (e) => terrain.setRenderStyle(e.target.value));
$("track-select").addEventListener("change", (e) => terrain.setTrackWidth(e.target.value));
$("stage-select").addEventListener("change", (e) => terrain.setStage(e.target.value));
$("canon-select").addEventListener("change", (e) => terrain.setCanonEmphasis(e.target.value === "on"));
$("share-select").addEventListener("change", (e) => terrain.setSharedTerrain(e.target.value));
$("mirror-select").addEventListener("change", (e) => terrain.setMirrorEmphasis(e.target.value === "on"));
$("lane-sep-select").addEventListener("change", (e) => terrain.setLaneSep(e.target.value));
$("chord-select").addEventListener("change", (e) => terrain.setChordDetail(e.target.value));
$("ribbon-select").addEventListener("change", (e) => terrain.setRibbonMode(e.target.value));
$("corner-roll-select").addEventListener("change", (e) => {
  $("mini-roll").style.display = e.target.value === "on" ? "" : "none";
});
$("score-select").addEventListener("change", (e) => {
  scoreMode = e.target.value;
  const usePiano = scoreMode === "pianoroll";
  $("osmd").style.display = usePiano ? "none" : "";
  $("pianoroll").style.display = usePiano ? "block" : "none";
  // 현재 패널 줌 슬라이더 동기화 + 현재 위치로 갱신
  const z = activeScore().zoom;
  $("score-zoom").value = z;
  $("score-zoom-val").textContent = z;
  activeScore().update(prevPos);
});
let zoomTimer = null;
$("score-zoom").addEventListener("input", (e) => {
  $("score-zoom-val").textContent = e.target.value;
  clearTimeout(zoomTimer); // 디바운스: 드래그 끝난 뒤 한 번만 재렌더(끊김 방지)
  zoomTimer = setTimeout(() => activeScore().setZoom(parseFloat(e.target.value)), 180);
});

// --- 업로드 & 로드 ---
async function uploadFile(file) {
  setStatus(`분석 중: ${file.name} ...`);
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/analyze", { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || res.statusText);
    }
    analysis = await res.json();
  } catch (e) {
    setStatus(`실패: ${e.message}`);
    return;
  }
  $("drop-hint").style.display = "none";
  showCategory(analysis.category);
  showVoiceNames(analysis.parts);
  // 최대 성부 = 전체 트랙 수(드럼 포함). 기본값은 전부 표시.
  const total = analysis.parts.length;
  $("voice-slider").max = Math.max(1, total);
  maxVoices = total;
  $("voice-slider").value = maxVoices;
  $("voice-count").textContent = maxVoices;

  terrain.setCameraMode($("camera-select").value);
  terrain.setCameraSide($("camdir-select").value);
  terrain.setBackgroundMode($("bg-select").value);
  terrain.setBeatMode($("beat-select").value);
  // 토글 초기값 적용(재빌드 유발 setter 대신 상태만 세팅 후 load 한 번)
  terrain.terrainShape = $("shape-select").value;
  terrain.renderStyle = $("style-select").value;
  terrain.trackWidth = $("track-select").value;
  terrain.stageMode = $("stage-select").value;
  terrain.canonEmphasis = $("canon-select").value === "on";
  terrain.sharedTerrain = $("share-select").value;
  terrain.mirrorEmphasis = $("mirror-select").value === "on";
  terrain.laneSep = $("lane-sep-select").value;
  terrain.chordDetail = $("chord-select").value;
  terrain.ribbonMode = $("ribbon-select").value;
  terrain.load(analysis, maxVoices);
  await score.load(analysis);
  await pianoroll.load(analysis);
  await miniRoll.load(analysis);
  // 활성 패널의 줌을 슬라이더에 반영
  const z = activeScore().zoom.toFixed(1);
  $("score-zoom").value = z;
  $("score-zoom-val").textContent = z;
  audio.load(analysis);
  prevPos = 0;
  $("play-btn").textContent = "▶︎ 재생";
  setStatus(`${file.name} — 성부 ${analysis.parts.length}개, ${fmt(analysis.durationSec)}`);
}

function showCategory(cat) {
  $("category-select").value = cat.labelEn;
  $("category-conf").textContent = `(${Math.round(cat.confidence * 100)}%)`;
}

// F2: 성부명을 컬러 칩으로 표시 (음정 성부만)
function showVoiceNames(parts) {
  const el = $("voice-names");
  el.innerHTML = "";
  let vi = 0;
  for (const p of parts) {
    if (p.isRhythm) continue;
    const col = "#" + String(voiceColorHex(vi).toString(16)).padStart(6, "0");
    const chip = document.createElement("span");
    chip.style.cssText = `background:${col}22;color:${col};border:1px solid ${col}66;
      padding:1px 7px;border-radius:10px;font-size:11px;white-space:nowrap;`;
    chip.textContent = p.name || `Part ${vi + 1}`;
    el.appendChild(chip);
    vi++;
  }
}

// C5: 분류 오판 수동 보정(ADR 0005). 라벨을 캐논으로 바꾸면 추격 강조를 켜고,
// 비캐논으로 바꾸면 끈다(자동 감지 결과를 사용자가 덮어쓴다).
$("category-select").addEventListener("change", (e) => {
  const isCanon = e.target.value === "canon";
  $("canon-select").value = isCanon ? "on" : "off";
  terrain.setCanonEmphasis(isCanon);
  $("category-conf").textContent = "(수동)";
});

// E3: 키보드 단축키 — Space=재생/정지, ←/→=±5초.
document.addEventListener("keydown", async (e) => {
  if (!analysis) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "Space") {
    e.preventDefault();
    await audio.ensureStarted();
    audio.toggle();
    $("play-btn").textContent = audio.playing ? "⏸ 일시정지" : "▶︎ 재생";
  } else if (e.code === "ArrowLeft") {
    e.preventDefault();
    audio.seek(Math.max(0, audio.position - 5));
  } else if (e.code === "ArrowRight") {
    e.preventDefault();
    audio.seek(Math.min(audio.duration, audio.position + 5));
  } else if (e.code === "KeyR") {
    e.preventDefault();
    // 현재 레퍼런스 프리셋이면 기존으로, 아니면 레퍼런스로 토글
    const isRef = $("shape-select").value === "stepped";
    applyPreset(isRef ? PRESET_ORIG : PRESET_REF);
  }
});

// 비트 반응 (ADR 0009): 선택 모드에 따라 장면 펄스
function maybePulse(hits) {
  const mode = $("beat-select").value;
  if (mode === "none" || !hits.length) return;
  if (mode === "all") { terrain.pulse(); return; }
  // drum/강박: 리듬 트랙 타격 or 2성부 이상 동시 시작
  const anyDrum = hits.some((h) => analysis.parts[h.part]?.isRhythm);
  const times = hits.map((h) => Math.round(h.note.startSec * 100));
  const simultaneous = new Set(times).size < times.length; // 같은 순간 여러 음
  if (anyDrum || simultaneous) terrain.pulse();
}

function setStatus(s) { $("status").textContent = s; }
function fmt(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// E2: 그룹 헤더 클릭 → 그룹 바디 접기/펼치기
document.querySelectorAll(".group-hdr").forEach((btn) => {
  btn.addEventListener("click", () => {
    const body = btn.nextElementSibling;
    const collapsed = body.classList.toggle("collapsed");
    btn.textContent = btn.textContent.replace(/[▶▼]/, collapsed ? "▶" : "▼");
  });
});

// --- 단일 렌더 루프 (공통 시계) ---
let lastFrame = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  if (analysis) {
    const pos = audio.update();
    if (pos > prevPos) {
      const hits = audio.notesStartedBetween(prevPos, pos);
      for (const h of hits) terrain.flashByPart(h.part);
      maybePulse(hits);
    }
    terrain.update(pos, dt);
    activeScore().update(pos);
    miniRoll.update(pos);
    $("seek").value = audio.duration ? Math.round((pos / audio.duration) * 1000) : 0;
    $("time").textContent = `${fmt(pos)} / ${fmt(audio.duration)}`;
    if (!audio.playing && pos >= audio.duration && audio.duration > 0) {
      $("play-btn").textContent = "▶︎ 재생";
    }
    prevPos = pos;
  } else {
    terrain.renderStatic();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
