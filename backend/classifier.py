"""캐논 / 화음 / 기타 분류 (ADR 0005).

- 기타: 단성(성부 1개 또는 동시 발음 거의 없음)
- 화음: 다성
- 캐논: 성부 간 음정 간격열의 시간지연 자기유사성(이조 허용)
"""
from __future__ import annotations


def _similarity(a, b) -> float:
    """두 음정 간격열의 lag 슬라이딩 최대 일치율 (이조 불변).

    짧은 꼬리끼리 우연히 100% 맞는 거짓양성을 막기 위해, 충분히 긴 겹침만 인정한다.
    """
    if len(a) < 6 or len(b) < 6:
        return 0.0
    # 의미 있는 겹침 길이: 최소 8, 그리고 짧은 쪽의 50% 이상
    min_overlap = max(8, int(0.5 * min(len(a), len(b))))
    best = 0.0
    max_lag = min(len(b) - min_overlap, 64)
    for lag in range(0, max_lag + 1):
        bb = b[lag:]
        n = min(len(a), len(bb))
        if n < min_overlap:
            break
        match = sum(1 for i in range(n) if a[i] == bb[i])
        best = max(best, match / n)
    return best


def _polyphony_ratio(parts) -> float:
    """동시 발음(겹침) 비율 추정."""
    pitched = [p for p in parts if not p.get("isRhythm") and p["notes"]]
    if len(pitched) < 2:
        return 0.0
    # 성부가 여러 개면 다성으로 본다(시간 겹침 표본 검사)
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


def classify(analysis: dict) -> dict:
    parts = analysis["parts"]
    seqs = analysis.get("_intervalSequences", [])
    pitched = [p for p in parts if not p.get("isRhythm") and p["notes"]]

    # 캐논: 성부쌍 음정열 유사도 최대값
    canon_conf = 0.0
    for i in range(len(seqs)):
        for j in range(len(seqs)):
            if i == j:
                continue
            canon_conf = max(canon_conf, _similarity(seqs[i], seqs[j]))

    poly = _polyphony_ratio(parts)

    if len(pitched) <= 1 and poly < 0.15:
        return {"label": "기타", "confidence": round(1.0 - poly, 3),
                "labelEn": "other"}

    if canon_conf >= 0.6 and len(pitched) >= 2:
        return {"label": "캐논", "confidence": round(canon_conf, 3),
                "labelEn": "canon"}

    return {"label": "화음", "confidence": round(min(1.0, poly + 0.3), 3),
            "labelEn": "harmonic"}
