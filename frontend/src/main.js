// 오케스트레이션: 업로드 → /analyze → 악보+지형+오디오 로드 → 단일 루프로 동기.
import { AudioEngine } from "./audio.js";
import { ScorePanel } from "./score.js";
import { Terrain } from "./terrain.js";

const $ = (id) => document.getElementById(id);

const audio = new AudioEngine();
const score = new ScorePanel("osmd", "score-panel");
const terrain = new Terrain("stage");

let analysis = null;
let maxVoices = 4;
let prevPos = 0;

// --- UI 배선 ---
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
  score.update(sec);
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
let zoomTimer = null;
$("score-zoom").addEventListener("input", (e) => {
  $("score-zoom-val").textContent = e.target.value;
  clearTimeout(zoomTimer); // 디바운스: 드래그 끝난 뒤 한 번만 재렌더(끊김 방지)
  zoomTimer = setTimeout(() => score.setZoom(parseFloat(e.target.value)), 180);
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
  terrain.stage = $("stage-select").value;
  terrain.load(analysis, maxVoices);
  await score.load(analysis);
  // 자동맞춤된 줌을 슬라이더에 반영
  const z = score.zoom.toFixed(1);
  $("score-zoom").value = z;
  $("score-zoom-val").textContent = z;
  audio.load(analysis);
  prevPos = 0;
  $("play-btn").textContent = "▶︎ 재생";
  setStatus(`${file.name} — 성부 ${analysis.parts.length}개, ${fmt(analysis.durationSec)}`);
}

function showCategory(cat) {
  $("category").textContent = `${cat.label} (${Math.round(cat.confidence * 100)}%)`;
}

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
    score.update(pos);
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
