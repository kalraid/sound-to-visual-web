"""예제 MIDI 목록을 분류해 examples/manifest.json 으로 저장.

backend/examples/ 안의 .mid/.midi 파일을 모두 분석·분류하여
[{filename, label, labelEn, confidence, durationSec, parts}] 목록을 만든다.
프론트의 "예제" 드롭다운이 이 manifest 를 읽어 미리 목록을 띄운다.

코드 변경(파이프라인) 후 분류를 갱신하려면:  python make_examples.py
"""
from __future__ import annotations

import json
import os

from analyzer import analyze_score
from classifier import canon_detail, classify

EX_DIR = os.path.join(os.path.dirname(__file__), "examples")
MANIFEST = os.path.join(EX_DIR, "manifest.json")
EXTS = (".mid", ".midi")


def build() -> list[dict]:
    items = []
    for fname in sorted(os.listdir(EX_DIR)):
        if not fname.lower().endswith(EXTS):
            continue
        path = os.path.join(EX_DIR, fname)
        try:
            a = analyze_score(path)
            canon = canon_detail(a)
            cat = classify(a, canon)
            items.append({
                "filename": fname,
                "label": cat["label"],
                "labelEn": cat["labelEn"],
                "confidence": cat["confidence"],
                "canonConfidence": canon["confidence"],
                "durationSec": round(a.get("durationSec", 0), 1),
                "parts": len(a.get("parts", [])),
            })
            print(f"  {cat['labelEn']:9} {fname}")
        except Exception as e:  # 파싱 실패한 파일은 목록에서 제외
            print(f"  SKIP {fname}: {e}")
    return items


if __name__ == "__main__":
    items = build()
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"\n{len(items)}개 → {MANIFEST}")
