"""백엔드 단위테스트 (ADR 0008). 실행: cd backend && python -m pytest -q
(pytest 없으면: python test_analysis.py)
"""
import os

from analyzer import analyze_score
from classifier import classify

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


if __name__ == "__main__":
    for fn in [test_melody_is_other, test_canon_is_canon,
               test_chorale_is_harmonic, test_timing_and_importance]:
        fn()
        print("PASS", fn.__name__)
    print("all passed")
