"""캐논 / 화음 / 기타 분류 (ADR 0005) + 캐논 모방 lag (C1) + 거울 대칭 (C4).

- 기타: 단성(성부 1개 또는 동시 발음 거의 없음)
- 화음: 다성
- 캐논: 성부 간 음정 간격열의 시간지연 자기유사성(이조 허용)

`canon_detail`: 성부쌍 모방 지연(lag) 노출 → 프론트 C2 시차 추격.
`mirror_detail`: 역행/전위(거울 대칭) 관계 노출 → 프론트 C4 거울상.

C5 보정: 토널 응답(조성 답句, 음정이 1반음 차로 변형)을 정확 일치만으로는 놓쳐
캐논곡이 '화음'으로 오분류되던 문제 → 1반음 허용(tonal) 일치 + 시간지연 게이트로 보완.
"""
from __future__ import annotations

import math

# 거짓양성 방지용 임계 — _similarity 와 공유
_MIN_LEN = 6
_MIN_OVERLAP_FLOOR = 8
_MAX_LAG = 64
_TONAL_TOL = 1            # 토널 응답 허용 오차(반음)
_TONAL_MIN_RATIO = 0.78   # 토널 일치로 캐논 인정할 최소 비율
_TONAL_MIN_LAGSEC = 0.3   # 토널 캐논은 실제 시간지연이 있어야(화음 동시발음과 구분)

# 자기 유사도(H1, ADR 0013) — 같은 성부 내 반복 주기 감지
_SELF_SIM_THRESHOLD = 0.8  # 구조 단위로 인정할 최소 반복 일치율
_MIN_PERIOD = 4            # 최소 반복 주기(음표 수) — 우연한 짧은 반복 배제


def _similarity(a, b, tol: int = 0):
    """두 음정 간격열의 lag 슬라이딩 최대 일치율 (이조 불변).

    a[i] ≈ b[i+lag] (|차| <= tol) 정렬을 찾는다 → a 선행, b 가 lag 만큼 후행.
    반환: (best_ratio, best_lag). 짧은 꼬리끼리 우연히 맞는 거짓양성을 막기 위해
    충분히 긴 겹침만 인정한다.
    """
    if len(a) < _MIN_LEN or len(b) < _MIN_LEN:
        return 0.0, 0
    min_overlap = max(_MIN_OVERLAP_FLOOR, int(0.5 * min(len(a), len(b))))
    best, best_lag = 0.0, 0
    max_lag = min(len(b) - min_overlap, _MAX_LAG)
    for lag in range(0, max_lag + 1):
        bb = b[lag:]
        n = min(len(a), len(bb))
        if n < min_overlap:
            break
        match = sum(1 for i in range(n) if abs(a[i] - bb[i]) <= tol)
        ratio = match / n
        if ratio > best:
            best, best_lag = ratio, lag
    return best, best_lag


def _polyphony_ratio(parts) -> float:
    """동시 발음(겹침) 비율 추정."""
    pitched = [p for p in parts if not p.get("isRhythm") and p["notes"]]
    if len(pitched) < 2:
        return 0.0
    spans = []
    for p in pitched:
        for n in p["notes"][:200]:
            spans.append((n["startSec"], n["startSec"] + n["durSec"]))
    spans.sort()
    overlaps = 0
    for i in range(1, len(spans)):
        if spans[i][0] < spans[i - 1][1]:
            overlaps += 1
    return overlaps / max(1, len(spans))


def _lag_seconds(leader, follower, lag_notes: int) -> float:
    """모방 lag(음표 수)를 실제 시간차(초)로 환산(중앙값, 템포변화 견고)."""
    ln, fn = leader["notes"], follower["notes"]
    diffs = []
    for k in range(min(len(ln), len(fn) - lag_notes, 64)):
        j = k + lag_notes
        if 0 <= j < len(fn):
            diffs.append(fn[j]["startSec"] - ln[k]["startSec"])
    if not diffs:
        return 0.0
    diffs.sort()
    return round(diffs[len(diffs) // 2], 3)


def _seqs_and_idx(analysis):
    seqs = analysis.get("_intervalSequences", [])
    idxs = analysis.get("_intervalSeqPartIndex", list(range(len(seqs))))
    return seqs, idxs


def canon_detail(analysis: dict) -> dict:
    """성부쌍 모방 관계 → {detected, confidence, pairs[]}.

    각 pair: {leader, follower(=parts 인덱스), lagNotes, lagSec, similarity, kind}.
    kind = "exact" | "tonal". similarity 내림차순. confidence = 최대 채택 유사도.
    """
    seqs, idxs = _seqs_and_idx(analysis)
    parts = analysis["parts"]
    pitched_count = sum(1 for p in parts if not p.get("isRhythm") and p["notes"])

    pairs = []
    best_conf = 0.0
    for i in range(len(seqs)):
        for j in range(i + 1, len(seqs)):
            # 정확 일치(이조 캐논) — 방향(선행/후행) 결정에 사용
            r_ij, lag_ij = _similarity(seqs[i], seqs[j], 0)
            r_ji, lag_ji = _similarity(seqs[j], seqs[i], 0)
            if r_ij >= r_ji:
                exact, lag, lead_i, fol_i = r_ij, lag_ij, idxs[i], idxs[j]
            else:
                exact, lag, lead_i, fol_i = r_ji, lag_ji, idxs[j], idxs[i]
            best_conf = max(best_conf, exact)
            lag_sec = _lag_seconds(parts[lead_i], parts[fol_i], lag)

            # 토널 응답 보정(C5): 1반음 허용 일치 + 실제 시간지연
            tonal, tlag = _similarity(seqs[i], seqs[j], _TONAL_TOL) if r_ij >= r_ji \
                else _similarity(seqs[j], seqs[i], _TONAL_TOL)
            tonal_ok = (tonal >= _TONAL_MIN_RATIO and lag_sec >= _TONAL_MIN_LAGSEC)

            if exact >= 0.5:
                kind, score = "exact", exact
            elif tonal_ok:
                kind, score = "tonal", tonal
                best_conf = max(best_conf, tonal)
            else:
                continue
            pairs.append({
                "leader": lead_i, "follower": fol_i,
                "lagNotes": lag, "lagSec": lag_sec,
                "similarity": round(score, 3), "kind": kind,
            })

    pairs.sort(key=lambda p: p["similarity"], reverse=True)
    detected = best_conf >= 0.6 and pitched_count >= 2 and bool(pairs)
    return {"detected": detected, "confidence": round(best_conf, 3), "pairs": pairs}


def mirror_detail(analysis: dict) -> dict:
    """거울 대칭(역행/전위) 관계 → {detected, pairs[]} (C4).

    - inversion(전위): 음정 부호 반전.        b' = [-x for x in b]
    - retrograde(역행): 뒤집고 부호 반전.      b' = [-x for x in reversed(b)]
    - retrograde-inversion: 뒤집기만(전위의 역행). b' = list(reversed(b))
    각 pair: {base, mirror(=parts 인덱스), type, similarity}.
    """
    seqs, idxs = _seqs_and_idx(analysis)
    transforms = {
        "inversion": lambda b: [-x for x in b],
        "retrograde": lambda b: [-x for x in reversed(b)],
        "retrograde-inversion": lambda b: list(reversed(b)),
    }
    pairs = []
    best = 0.0
    for i in range(len(seqs)):
        for j in range(i + 1, len(seqs)):
            best_t, best_r = None, 0.0
            for name, fn in transforms.items():
                r, _ = _similarity(seqs[i], fn(seqs[j]), 0)
                if r > best_r:
                    best_r, best_t = r, name
            best = max(best, best_r)
            if best_r >= 0.7:  # 거울 관계는 보수적으로(거짓양성 회피)
                pairs.append({
                    "base": idxs[i], "mirror": idxs[j],
                    "type": best_t, "similarity": round(best_r, 3),
                })
    pairs.sort(key=lambda p: p["similarity"], reverse=True)
    return {"detected": bool(pairs), "confidence": round(best, 3), "pairs": pairs}


def _best_period(seq) -> tuple[int, float]:
    """interval 시퀀스의 자기 유사도 최대 반복 주기 → (period_notes, ratio).

    seq[i] == seq[i+p] 정렬을 찾는다. 충분한 겹침(>= 한 주기)을 가진 후보 중
    일치율이 가장 높은 p 를 반환. 반복이 없으면 (0, 0.0).
    """
    n = len(seq)
    if n < 2 * _MIN_PERIOD:
        return 0, 0.0
    best_p, best_r = 0, 0.0
    for p in range(_MIN_PERIOD, n // 2 + 1):
        m = n - p
        match = sum(1 for i in range(m) if seq[i] == seq[i + p])
        ratio = match / m
        if ratio > best_r:
            best_r, best_p = ratio, p
    return best_p, best_r


def _period_seconds(notes, period_notes: int) -> float:
    """반복 주기(음표 수)를 실제 시간(초)으로 환산(중앙값, 템포변화 견고)."""
    diffs = [notes[i + period_notes]["startSec"] - notes[i]["startSec"]
             for i in range(len(notes) - period_notes)]
    if not diffs:
        span = notes[-1]["startSec"] + notes[-1]["durSec"] - notes[0]["startSec"]
        return round(span, 3)
    diffs.sort()
    return round(diffs[len(diffs) // 2], 3)


def structural_units(analysis: dict) -> list:
    """성부별 자기 유사도 → 구조 단위(섬) 목록 (H1, ADR 0013).

    같은 성부 내에서 음정열이 period 음표마다 반복되면(일치율 >= 임계) 그 성부를
    period 단위로 분할한다. 같은 반복 패턴의 모든 인스턴스는 동일 unitId 를 공유한다.
    각 항목: {part, unitId, startSec, endSec, period}. period 는 한 반복의 길이(초).
    반복이 없는 성부는 단위를 만들지 않는다(빈 목록은 10초 균등 분할 폴백).
    """
    seqs, idxs = _seqs_and_idx(analysis)
    parts = analysis["parts"]
    units = []
    uid = 0
    for seq, pidx in zip(seqs, idxs):
        period_notes, ratio = _best_period(seq)
        if period_notes == 0 or ratio < _SELF_SIM_THRESHOLD:
            continue
        notes = parts[pidx]["notes"]
        period_sec = _period_seconds(notes, period_notes)
        for start in range(0, len(notes), period_notes):
            seg = notes[start:start + period_notes]
            if not seg:
                continue
            units.append({
                "part": pidx,
                "unitId": uid,
                "startSec": round(seg[0]["startSec"], 3),
                "endSec": round(seg[-1]["startSec"] + seg[-1]["durSec"], 3),
                "period": period_sec,
            })
        uid += 1
    return units


# ---------- I4 (ADR 0015): 화성 진행 주기 감지 ----------
# 롤러코스터 lap을 구동할 "반복 코드 진행 주기"를 템플릿 없이 감지한다.
# 음표의 절대초·pitchClass만 사용(music21 재파싱 불필요).
_HARM_MIN_PERIOD_SEC = 1.5   # 진행 주기 최소(초) — 우연한 짧은 반복 배제
_HARM_SIM_THRESHOLD = 0.72   # 진행 반복으로 인정할 최소 평균 유사도(베이스 가중 기준)


def _chord_windows(analysis: dict):
    """곡을 등간격 시간창으로 나눠 창별 12차원 피치클래스 가중 벡터열 생성.

    각 창의 벡터[pc] = 그 창에서 pc 음이 울린 시간(겹침) 합. L2 정규화.
    반환: (vectors[list[list[12]]], window_sec).
    """
    dur = analysis.get("durationSec", 0) or 0
    if dur <= 0:
        return [], 0.0
    # 목표 ~창 수에 맞춰 창 길이 결정(긴 곡도 O(n^2) 감당). 0.4~1.0초.
    window_sec = min(1.0, max(0.4, dur / 600))
    n = max(1, int(math.ceil(dur / window_sec)))
    vecs = [[0.0] * 12 for _ in range(n)]
    for p in analysis["parts"]:
        if p.get("isRhythm"):
            continue
        for note in p["notes"]:
            pc = note.get("pitchClass")
            if pc is None:
                continue
            s = note["startSec"]
            e = s + max(0.0, note.get("durSec", 0.0))
            # 베이스 가중: 화성은 저음이 주도 → 낮은 음일수록 가중↑(midi48≈2.0, midi84≈0.4).
            midi = note.get("midi", 60) or 60
            w = 0.4 + 1.6 * max(0.0, min(1.0, (84 - midi) / 36))
            i0 = int(s // window_sec)
            i1 = int(e // window_sec)
            for i in range(max(0, i0), min(n - 1, i1) + 1):
                ws = i * window_sec
                we = ws + window_sec
                overlap = min(e, we) - max(s, ws)
                if overlap > 0:
                    vecs[i][pc] += overlap * w
    # L2 정규화(빈 창은 0 벡터 유지)
    for v in vecs:
        norm = math.sqrt(sum(x * x for x in v))
        if norm > 0:
            for k in range(12):
                v[k] /= norm
    return vecs, window_sec


def _cos(a, b) -> float:
    return sum(x * y for x, y in zip(a, b))  # 이미 정규화됨 → 내적=코사인


def _progression_period(vecs, window_sec: float):
    """피치클래스 벡터열의 자기 유사도 최대 반복 주기 → (period_windows, ratio).

    period p 마다 vec[i]·vec[i+p] 평균(빈 창 쌍 제외)을 최대화하는 p 탐색.
    """
    n = len(vecs)
    min_p = max(1, int(round(_HARM_MIN_PERIOD_SEC / window_sec)))
    if n < 2 * min_p:
        return 0, 0.0
    best_p, best_r = 0, 0.0
    for p in range(min_p, n // 2 + 1):
        total, cnt = 0.0, 0
        for i in range(n - p):
            a, b = vecs[i], vecs[i + p]
            if any(a) and any(b):  # 둘 다 음이 있는 창만 비교
                total += _cos(a, b)
                cnt += 1
        if cnt < (n - p) * 0.5:  # 겹침이 충분한 후보만
            continue
        ratio = total / cnt if cnt else 0.0
        if ratio > best_r:
            best_r, best_p = ratio, p
    return best_p, best_r


def harmony_detail(analysis: dict) -> dict:
    """반복 코드 진행 주기 → {detected, progressionPeriodSec, confidence, windowSec}.

    롤러코스터 전역 회전(lap)을 구동(ADR 0015 / I4). 특정 템플릿(파헬벨) 매칭은 하지 않음.
    """
    vecs, window_sec = _chord_windows(analysis)
    if not vecs:
        return {"detected": False, "progressionPeriodSec": 0.0, "confidence": 0.0, "windowSec": 0.0}
    period_w, ratio = _progression_period(vecs, window_sec)
    detected = period_w > 0 and ratio >= _HARM_SIM_THRESHOLD
    return {
        "detected": detected,
        "progressionPeriodSec": round(period_w * window_sec, 3) if period_w else 0.0,
        "confidence": round(ratio, 3),
        "windowSec": round(window_sec, 3),
    }


def classify(analysis: dict, canon: dict | None = None) -> dict:
    parts = analysis["parts"]
    pitched = [p for p in parts if not p.get("isRhythm") and p["notes"]]

    if canon is None:
        canon = canon_detail(analysis)
    canon_conf = canon["confidence"]
    poly = _polyphony_ratio(parts)

    if len(pitched) <= 1 and poly < 0.15:
        return {"label": "기타", "confidence": round(1.0 - poly, 3),
                "labelEn": "other"}

    # C5: canon.detected 가 토널 보정을 포함하므로 detected 를 1차 기준으로 사용.
    if canon.get("detected") and len(pitched) >= 2:
        return {"label": "캐논", "confidence": round(canon_conf, 3),
                "labelEn": "canon"}

    return {"label": "화음", "confidence": round(min(1.0, poly + 0.3), 3),
            "labelEn": "harmonic"}
