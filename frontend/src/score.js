// 상단 악보 (ADR 0009): 현재 한 줄(시스템)만 크게 보이고 진행 시 다음 줄로 페이지 넘김.
// OSMD 는 폭에 맞춰 시스템을 줄바꿈하므로, 현재 커서가 속한 시스템이 패널 위쪽에
// 오도록 세로 스크롤(translateY)한다.
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

export class ScorePanel {
  constructor(containerId, panelId) {
    this.container = document.getElementById(containerId);
    this.panel = document.getElementById(panelId);
    this.osmd = new OpenSheetMusicDisplay(this.container, {
      autoResize: true,
      backend: "svg",
      drawTitle: false,
      drawPartNames: false,
    });
    this.osmd.zoom = 1.1;
    this.onsets = [];
    this.cursorIndex = -1;
    this.systemTops = []; // 각 시스템 상단 y(px)
    this.ready = false;
  }

  async load(analysis) {
    this.ready = false;
    this.container.style.transform = "translateY(0px)";
    const set = new Set();
    for (const p of analysis.parts) for (const n of p.notes) set.add(Math.round(n.startSec * 1000));
    this.onsets = [...set].map((ms) => ms / 1000).sort((a, b) => a - b);

    if (!analysis.musicxml) {
      this.container.innerHTML =
        '<div style="padding:16px;color:#888">이 파일은 악보(MusicXML)를 생성하지 못했습니다.</div>';
      return;
    }
    try {
      await this.osmd.load(analysis.musicxml);
      this.osmd.render();
      this._measureSystems();
      this._autoFit(); // 한 시스템(모든 성부 줄)이 패널에 다 들어오도록 줌 자동조정
      this.osmd.cursor.show();
      this.cursorIndex = -1;
      this.ready = true;
    } catch (e) {
      this.container.innerHTML =
        `<div style="padding:16px;color:#a55">악보 렌더 실패: ${e.message}</div>`;
    }
  }

  _measureSystems() {
    // OSMD 그래픽 시스템들의 픽셀 상단 y 수집 (10px = 1 OSMD unit, zoom 반영)
    this.systemTops = [];
    try {
      const unit = 10 * this.osmd.zoom;
      const page = this.osmd.GraphicSheet.MusicPages[0];
      for (const sys of page.MusicSystems) {
        const y = sys.PositionAndShape.AbsolutePosition.y * unit;
        this.systemTops.push(y);
      }
    } catch (e) {
      this.systemTops = [0];
    }
  }

  _autoFit() {
    // 한 시스템 높이(px)를 패널 높이에 맞춰 줌 산정 → 모든 성부 줄이 보이게
    const panelH = this.panel.clientHeight;
    let sysH = this.systemTops.length >= 2
      ? this.systemTops[1] - this.systemTops[0]
      : this.container.getBoundingClientRect().height;
    if (!sysH || !panelH) return;
    let fit = (panelH * 0.95 / sysH) * this.osmd.zoom;
    fit = Math.max(0.3, Math.min(1.6, fit));
    if (Math.abs(fit - this.osmd.zoom) > 0.05) {
      this.osmd.zoom = fit;
      this.osmd.render();
      this._measureSystems();
    }
  }

  get zoom() { return this.osmd.zoom; }

  setZoom(z) {
    this.osmd.zoom = z;
    if (!this.ready) return;
    this.osmd.render();
    this.osmd.cursor.show();
    this.osmd.cursor.reset();
    this.cursorIndex = 0; // 다음 update 에서 현재 위치까지 재전진
    this._measureSystems();
  }

  reset() {
    if (!this.ready) return;
    this.osmd.cursor.reset();
    this.cursorIndex = 0;
    this.container.style.transform = "translateY(0px)";
  }

  update(position) {
    if (!this.ready) return;
    let target = 0;
    while (target < this.onsets.length && this.onsets[target] <= position) target++;
    target = Math.max(0, target - 1);

    if (target !== this.cursorIndex) {
      if (target < this.cursorIndex) {
        this.osmd.cursor.reset();
        this.cursorIndex = 0;
      }
      while (this.cursorIndex < target) {
        this.osmd.cursor.next();
        this.cursorIndex++;
      }
      this._pageToCursor();
    }
  }

  _pageToCursor() {
    const el = this.osmd.cursor && this.osmd.cursor.cursorElement;
    if (!el) return;
    const cursorTop = parseFloat(el.style.top || "0");
    // 커서가 속한 시스템의 상단을 찾아 그 줄을 패널 맨 위로
    let top = 0;
    for (const sysTop of this.systemTops) {
      if (sysTop <= cursorTop + 5) top = sysTop;
      else break;
    }
    // 살짝 여백
    this.container.style.transition = "transform 0.35s ease";
    this.container.style.transform = `translateY(${-Math.max(0, top - 8)}px)`;
  }
}
