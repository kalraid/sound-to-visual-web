// 2D 컬러 피아노롤 (C3, 영상2 스타일 대안 악보).
// x = 시간, y = 음높이(위=고음), 색 = 성부색. 재생 위치 세로선(playhead)을
// 패널 좌측 1/4 지점에 고정하고 노트를 스크롤한다. ScorePanel 과 동일한 인터페이스
// (load / update / reset / setZoom / zoom) 를 제공해 main.js 가 둘을 교체할 수 있게 한다.
import { voiceColorHex } from "./colors.js";

const PLAYHEAD_FRAC = 0.25; // 재생선이 패널 좌측 25% 지점
const DEFAULT_PPS = 90; // 1초당 픽셀(가로 스케일) — setZoom 으로 조절

export class PianoRollPanel {
  constructor(canvasId, panelId) {
    this.canvas = document.getElementById(canvasId);
    this.panel = document.getElementById(panelId);
    this.ctx = this.canvas.getContext("2d");
    this.pps = DEFAULT_PPS;
    this.position = 0;
    this.analysis = null;
    this.midiMin = 48;
    this.midiMax = 84;
    this.ready = false;
    this._dpr = 1;
    this._ro = new ResizeObserver(() => { this._resize(); this._draw(); });
    this._ro.observe(this.panel);
  }

  _resize() {
    const r = this.panel.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    this._dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = r.width + "px";
    this.canvas.style.height = r.height + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  async load(analysis) {
    this.analysis = analysis;
    this.position = 0;
    const rng = analysis.pitchRange || { min: 48, max: 84 };
    // 약간 여백을 줘서 최고/최저음이 경계에 붙지 않게
    this.midiMin = rng.min - 2;
    this.midiMax = rng.max + 2;
    if (this.midiMax - this.midiMin < 12) this.midiMax = this.midiMin + 12;
    this.ready = true;
    this._resize();
    this._draw();
  }

  reset() {
    this.position = 0;
    this._draw();
  }

  get zoom() { return +(this.pps / DEFAULT_PPS).toFixed(2); }

  setZoom(z) {
    this.pps = Math.max(0.3, Math.min(2.0, z)) * DEFAULT_PPS;
    this._draw();
  }

  update(position) {
    this.position = position;
    this._draw();
  }

  _yFor(midi) {
    const h = this.panel.clientHeight;
    const t = (midi - this.midiMin) / (this.midiMax - this.midiMin);
    return h - t * h; // 고음이 위
  }

  _draw() {
    if (!this.ready || this.canvas.style.display === "none") return;
    const ctx = this.ctx;
    const W = this.panel.clientWidth;
    const H = this.panel.clientHeight;
    if (!W || !H) return;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, W, H);

    // 옥타브 가로 그리드(C 음마다 옅은 선)
    ctx.strokeStyle = "#e3e3e8";
    ctx.lineWidth = 1;
    for (let m = Math.ceil(this.midiMin / 12) * 12; m <= this.midiMax; m += 12) {
      const y = Math.round(this._yFor(m)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    const playX = W * PLAYHEAD_FRAC;
    const t0 = this.position - playX / this.pps; // 화면 좌단의 시간
    const t1 = t0 + W / this.pps;
    const rowH = Math.max(3, (H / (this.midiMax - this.midiMin)) - 1);

    const parts = this.analysis.parts || [];
    let vi = -1;
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi];
      if (p.isRhythm) continue; // 음높이 없는 리듬 트랙은 생략
      vi++;
      const col = "#" + voiceColorHex(vi).toString(16).padStart(6, "0");
      for (const n of p.notes) {
        if (n.midi == null) continue;
        const ns = n.startSec, ne = n.startSec + Math.max(0.05, n.durSec);
        if (ne < t0 || ns > t1) continue; // 화면 밖
        const x = (ns - t0) * this.pps;
        const w = Math.max(2, (ne - ns) * this.pps);
        const y = this._yFor(n.midi) - rowH / 2;
        const active = this.position >= ns && this.position < ne;
        ctx.globalAlpha = active ? 1.0 : 0.78;
        ctx.fillStyle = col;
        this._roundRect(ctx, x, y, w, rowH, Math.min(3, rowH / 2));
        ctx.fill();
        if (active) { // 현재 울리는 음 강조 테두리
          ctx.globalAlpha = 1.0;
          ctx.strokeStyle = "#222";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1.0;

    // playhead
    ctx.strokeStyle = "#d23";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playX + 0.5, 0); ctx.lineTo(playX + 0.5, H); ctx.stroke();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
