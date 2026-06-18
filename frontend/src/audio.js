// 오디오 + 공통 시계 (ADR 0002): 하나의 음악 시계가 소리와 화면을 모두 구동.
// Transport 대신 직접 시계를 돌려 seek/배속/단일소스를 단순하게 보장한다.
import * as Tone from "tone";

// Web Audio 출력 지연 보정용 고정 오프셋(초). 양수면 소리를 살짝 앞당겨 화면과 맞춤.
const LATENCY_OFFSET = 0.03;

export class AudioEngine {
  constructor() {
    this.synth = null;
    this.parts = [];
    this.duration = 0;
    this.position = 0; // 음악 시간(초)
    this.rate = 1;
    this.playing = false;
    this._lastWall = 0; // 직전 실벽시계(Tone.now)
    this._cursors = []; // 성부별 다음 발음 인덱스
  }

  async ensureStarted() {
    await Tone.start();
    if (!this.synth) {
      this.synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.4 },
      }).toDestination();
      this.synth.volume.value = -8;
    }
  }

  load(analysis) {
    this.parts = analysis.parts.map((p) => p.notes);
    this.duration = analysis.durationSec || 0;
    this.seek(0);
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this._lastWall = Tone.now();
    this._resetCursors();
  }

  pause() {
    this.playing = false;
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(sec) {
    this.position = Math.max(0, Math.min(sec, this.duration));
    this._lastWall = Tone.now();
    this._resetCursors();
  }

  setRate(rate) {
    this.rate = rate;
  }

  _resetCursors() {
    // 각 성부에서 현재 position 이후 첫 음표로 커서 이동(seek 대응)
    this._cursors = this.parts.map((notes) => {
      let i = 0;
      while (i < notes.length && notes[i].startSec < this.position) i++;
      return i;
    });
  }

  // 매 프레임 호출 → position 갱신 + 도래한 음표 발음. 반환: 현재 position(초)
  update() {
    if (!this.playing) return this.position;
    const now = Tone.now();
    const dt = (now - this._lastWall) * this.rate;
    this._lastWall = now;
    const prev = this.position;
    this.position = Math.min(this.position + dt, this.duration);

    if (this.synth) this._triggerBetween(prev, this.position);

    if (this.position >= this.duration) this.playing = false;
    return this.position;
  }

  _triggerBetween(from, to) {
    for (let pi = 0; pi < this.parts.length; pi++) {
      const notes = this.parts[pi];
      let i = this._cursors[pi];
      while (i < notes.length && notes[i].startSec < to) {
        const n = notes[i];
        if (n.startSec >= from && n.midi != null) {
          const dur = Math.max(0.05, n.durSec / this.rate);
          // 화음 전체 음 재생 (chordMidis), 없으면 단음
          const freqs = (n.chordMidis && n.chordMidis.length ? n.chordMidis : [n.midi])
            .map((m) => Tone.Frequency(m, "midi").toFrequency());
          try {
            this.synth.triggerAttackRelease(freqs, dur, Tone.now());
          } catch (e) {
            /* 동시 다발 발음 시 일부 드롭 허용 */
          }
        }
        i++;
      }
      this._cursors[pi] = i;
    }
  }

  // 새 음 시작을 화면이 감지할 수 있게: [from,to) 구간에 시작한 음표 인덱스 목록
  notesStartedBetween(from, to) {
    const hits = [];
    for (let pi = 0; pi < this.parts.length; pi++) {
      const notes = this.parts[pi];
      for (let i = 0; i < notes.length; i++) {
        if (notes[i].startSec >= from && notes[i].startSec < to) {
          hits.push({ part: pi, note: notes[i] });
        }
      }
    }
    return hits;
  }
}
