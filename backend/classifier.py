"""캐논 / 화음 / 기타 분류 (ADR 0005) + 캐논 모방 lag 노출 (ADR 0012 / C1).

- 기타: 단성(성부 1개 또는 동시 발음 거의 없음)
- 화음: 다성
- 캐논: 성부 간 음정 간격열의 시간지연 자기유사성(이조 허용)

`canon_detail`은 분류와 별개로, 성부쌍의 모방 지연(lag)을 분석 JSON에 노출한다.
프론트(C2 시차 추격)가 같은 트랙 위에서 마커를 lag만큼 시차 정렬하는 데 쓴다.
"""
from __future__ import annotations

# 거짓양성 방지용 임계 — _similarity 와 공유
_MIN_LEN = 6
_MIN_OVERLAP_FLOOR = 8
_MAX_LAG = 64


def _similarity(a, b):
    """두 음정 간격열의 lag 슬라이딩 최대 일치율 (이조 불변).

    a[i] == b[i+lag] 인 정렬을 찾는다 → a 가 선행(leader), b 가 lag 만큼 후행(follower).
    반환: (best_ratio, best_lag). 의미 있는 겹침이 없으면 (0.0, 0).
    짧은 꼬리끼리 우연히 100% 맞는 거짓양성을 막기 위해 충분히 긴 겹침만 인정한다.
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
        match = sum(1 for i in range(n) if a[i] == bb[i])
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
    """모방 lag(음표 수)를 실제 시간차(초)로 환산.

    follower 의 note[k+lag] 가 leader 의 note[k] 와 같은 소재를 연주하므로
    그 시작초 차이의 중앙값을 lag 시간으로 본다(템포 변화에 견고하도록 median).
    """
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


def canon_detail(analysis: dict) -> dict:
    """성부쌍 모방 관계를 분석 → {detected, confidence, pairs[]}.

    각 pair: {leader, follower(=parts 인덱스), lagNotes, lagSec, similarity}.
    similarity 내림차순. confidence = 최대 유사도.
    """
    seqs = analysis.get("_intervalSequences", [])
    idxs = analysis.get("_intervalSeqPartIndex", list(range(len(seqs))))
    parts = analysis["parts"]
    pitched_count = sum(
        1 for p in parts if not p.get("isRhythm") and p["notes"]
    )

    pairs = []
    best_conf = 0.0
    for i in range(len(seqs)):
        for j in range(i + 1, len(seqs)):
            r_ij, lag_ij = _similarity(seqs[i], seqs[j])  # i 선행
            r_ji, lag_ji = _similarity(seqs[j], seqs[i])  # j 선행
            if r_ij >= r_ji:
                ratio, lag, lead_i, fol_i = r_ij, lag_ij, idxs[i], idxs[j]
            else:
                ratio, lag, lead_i, fol_i = r_ji, lag_ji, idxs[j], idxs[i]
            best_conf = max(best_conf, ratio)
            if ratio < 0.5:
                continue  # 약한 쌍은 노출하지 않음
            pairs.append({
                "leader": lead_i,
                "follower": fol_i,
                "lagNotes": lag,
                "lagSec": _lag_seconds(parts[lead_i], parts[fol_i], lag),
                "similarity": round(ratio, 3),
            })

    pairs.sort(key=lambda p: p["similarity"], reverse=True)
    detected = best_conf >= 0.6 and pitched_count >= 2
    return {
        "detected": detected,
        "confidence": round(best_conf, 3),
        "pairs": pairs,
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

    if canon_conf >= 0.6 and len(pitched) >= 2:
        return {"label": "캐논", "confidence": round(canon_conf, 3),
                "labelEn": "canon"}

    return {"label": "화음", "confidence": round(min(1.0, poly + 0.3), 3),
            "labelEn": "harmonic"}
