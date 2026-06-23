"""백엔드 단위테스트 (ADR 0008). 실행: cd backend && python -m pytest -q
(pytest 없으면: python test_analysis.py)
"""
import os

from analyzer import analyze_score
from classifier import classify, structural_units

SAMPLES = os.path.join(os.path.dirname(os.path.dirname(__file__)), "samples")


def _analyze(name):
    a = analyze_score(os.path.join(SAMPLES, f"{name}.mid"))
    return a, classify(a)


def test_melody_is_other():
    a, c = _analyze("melody")
    assert c["labelEn"] == "other"
    assert len(a["parts"]) == 1
    assert a["parts"][0]["notes"], "음표가 추출되어야 함"


def test_canon_is_canon():
    a, c = _analyze("canon")
    assert c["labelEn"] == "canon"
    assert len(a["parts"]) == 2


def test_chorale_is_harmonic():
    a, c = _analyze("bwv66")
    assert c["labelEn"] == "harmonic"
    assert len(a["parts"]) >= 3


def test_timing_and_importance():
    a, _ = _analyze("bwv66")
    # 절대초가 단조 증가, importance/isCore 존재
    for p in a["parts"]:
        assert "importance" in p and "isCore" in p
        starts = [n["startSec"] for n in p["notes"]]
        assert starts == sorted(starts)
    assert a["pitchRange"]["min"] < a["pitchRange"]["max"]
    assert a["musicxml"]


def test_structural_units_schema():
    # 자기 유사도 구조 단위(H1): 깨지지 않고 스키마가 유효해야 함.
    # (샘플은 강한 반복이 없어 빈 목록일 수 있음 — 그 경우도 정상.)
    for name in ["melody", "canon", "bwv66"]:
        a = analyze_score(os.path.join(SAMPLES, f"{name}.mid"))
        units = structural_units(a)
        assert isinstance(units, list)
        for u in units:
            assert set(u) >= {"part", "unitId", "startSec", "endSec", "period"}
            assert u["endSec"] >= u["startSec"]
            assert u["period"] > 0
        # 같은 unitId 는 같은 성부에 속해야 함(성부 내 반복 패턴)
        by_uid = {}
        for u in units:
            by_uid.setdefault(u["unitId"], set()).add(u["part"])
        assert all(len(parts) == 1 for parts in by_uid.values())


if __name__ == "__main__":
    for fn in [test_melody_is_other, test_canon_is_canon,
               test_chorale_is_harmonic, test_timing_and_importance,
               test_structural_units_schema]:
        fn()
        print("PASS", fn.__name__)
    print("all passed")
