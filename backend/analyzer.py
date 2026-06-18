"""음악 파일(MIDI/MusicXML) → 성부/음표/템포/importance 분석.

타이밍 단일소스(ADR 0002): 절대 startSec/durSec 를 여기서 사전계산한다.
music21 의 secondsMap 이 템포 변화를 반영하므로 변수 템포도 정확히 처리된다.
"""
from __future__ import annotations

import math
from music21 import converter, chord, note, instrument
from music21.musicxml.m21ToXml import GeneralObjectExporter


def _pitch_class_name(pc: int) -> str:
    # 0=도(C) ... 11=시(B). 한국 계명은 참고용.
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return names[pc % 12]


def _is_rhythm_part(part) -> bool:
    """드럼/비음정 트랙 추정 (ADR 0006)."""
    try:
        for inst in part.recurse().getElementsByClass(instrument.Instrument):
            ch = getattr(inst, "midiChannel", None)
            if ch == 9:  # MIDI 채널 10 = 타악기
                return True
            if "percussion" in (inst.instrumentName or "").lower():
                return True
    except Exception:
        pass
    # Unpitched 음표가 있으면 리듬 트랙
    try:
        from music21 import percussion  # noqa
        if part.recurse().getElementsByClass("Unpitched"):
            return True
    except Exception:
        pass
    return False


def _extract_part(part, part_index: int):
    """한 성부 → 음표 리스트. 화음은 최고음을 큐브 높이로(ADR 0003)."""
    flat = part.flatten()
    notes = []
    midis = []
    sounding_ql = 0.0
    unpitched = 0
    for entry in flat.secondsMap:
        el = entry["element"]
        start_sec = entry["offsetSeconds"]
        dur_sec = entry["durationSeconds"]
        chord_midis = None
        if isinstance(el, note.Note):
            top = el.pitch
            name = el.nameWithOctave
        elif isinstance(el, chord.Chord) and len(el.pitches):
            top = max(el.pitches, key=lambda p: p.midi)
            name = top.nameWithOctave
            chord_midis = sorted(int(p.midi) for p in el.pitches if p.midi is not None)
        elif isinstance(el, note.Unpitched):
            # 드럼/타악기 타격: 음높이 없음(ADR 0006 리듬 트랙)
            unpitched += 1
            notes.append({
                "midi": None, "name": "drum", "pitchClass": None,
                "pitchClassName": "", "startBeat": round(float(el.offset), 4),
                "durBeats": round(float(el.quarterLength or 0), 4),
                "startSec": round(float(start_sec), 4),
                "durSec": round(float(dur_sec or 0), 4), "isRest": False,
            })
            continue
        else:
            continue
        if top.midi is None:
            continue
        midis.append(top.midi)
        sounding_ql += float(el.quarterLength or 0)
        notes.append({
            "midi": int(top.midi),
            "name": name,
            "pitchClass": int(top.midi % 12),
            "pitchClassName": _pitch_class_name(top.midi),
            "chordMidis": chord_midis or [int(top.midi)],  # 화음 전체 음(소리·기둥용)
            "startBeat": round(float(el.offset), 4),
            "durBeats": round(float(el.quarterLength or 0), 4),
            "startSec": round(float(start_sec), 4),
            "durSec": round(float(dur_sec or 0), 4),
            "isRest": False,
        })
    notes.sort(key=lambda n: n["startSec"])
    mean_midi = sum(midis) / len(midis) if midis else 0.0
    # 리듬 트랙: 음높이 음표가 없고 타격만 있거나, 타악 채널/악기
    is_rhythm = (len(midis) == 0 and unpitched > 0) or _is_rhythm_part(part)
    return {
        "index": part_index,
        "name": part.partName or f"Part {part_index + 1}",
        "isRhythm": is_rhythm,
        "noteCount": len(notes),
        "meanMidi": mean_midi,
        "soundingQuarterLength": sounding_ql,
        "notes": notes,
    }, midis


def _interval_sequence(notes):
    """연속 음정차열 (이조 불변, ADR 0005 캐논 감지용)."""
    seq = []
    for a, b in zip(notes, notes[1:]):
        seq.append(b["midi"] - a["midi"])
    return seq


def analyze_score(path: str) -> dict:
    score = converter.parse(path)
    parts = list(score.parts) if score.parts else [score]

    extracted = []
    all_midis = []
    total_dur = 0.0
    for i, p in enumerate(parts):
        data, midis = _extract_part(p, i)
        if data["noteCount"] == 0:
            continue  # 빈 트랙(음표 0개)은 성부로 치지 않음
        extracted.append(data)
        all_midis.extend(midis)
        if data["notes"]:
            last = data["notes"][-1]
            total_dur = max(total_dur, last["startSec"] + last["durSec"])

    if not extracted:
        raise ValueError("분석할 음표가 없습니다 (빈 곡이거나 지원하지 않는 형식).")

    pmin = min(all_midis) if all_midis else 60
    pmax = max(all_midis) if all_midis else 72

    # importance: 음표밀도 + 외성(최상/최하) 가중 (ADR 0006)
    pitched = [e for e in extracted if not e["isRhythm"] and e["noteCount"] > 0]
    if pitched:
        max_density = max((e["soundingQuarterLength"] for e in pitched), default=1.0) or 1.0
        highest = max(pitched, key=lambda e: e["meanMidi"])
        lowest = min(pitched, key=lambda e: e["meanMidi"])
        for e in extracted:
            density = (e["soundingQuarterLength"] / max_density) if not e["isRhythm"] else 0.3
            outer = 0.0
            if e is highest:
                outer += 0.5
            if e is lowest:
                outer += 0.35
            e["importance"] = round(density + outer, 4)
    else:
        for e in extracted:
            e["importance"] = 0.3

    ranked = sorted(extracted, key=lambda e: e["importance"], reverse=True)
    for rank, e in enumerate(ranked):
        e["importanceRank"] = rank
        e["isCore"] = rank < 4  # 기본 상위 4개 (프론트 슬라이더로 변경)

    # 정리: 무거운 임시 필드 제거
    for e in extracted:
        e.pop("meanMidi", None)
        e.pop("soundingQuarterLength", None)

    try:
        musicxml = GeneralObjectExporter(score).parse().decode("utf-8")
    except Exception:
        musicxml = None

    return {
        "durationSec": round(total_dur, 3),
        "pitchRange": {"min": int(pmin), "max": int(pmax)},
        "parts": extracted,
        "_intervalSequences": [
            _interval_sequence(e["notes"]) for e in extracted if not e["isRhythm"]
        ],
        "musicxml": musicxml,
    }
