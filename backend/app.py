"""FastAPI 백엔드: POST /analyze (MIDI/MusicXML 업로드) → 분석 JSON.

타이밍 단일소스(ADR 0002) + 파일 해시 캐시(ADR 0006).
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from analyzer import analyze_score
from classifier import canon_detail, classify, mirror_detail, structural_units

ALLOWED = {".mid", ".midi", ".xml", ".musicxml", ".mxl"}
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# F3: 파이프라인 버전 해시 — analyzer.py + classifier.py 내용 기반.
# 코드 변경 시 자동으로 바뀌어 구 캐시를 무시한다.
def _pipeline_hash() -> str:
    h = hashlib.sha1()
    for fname in ("analyzer.py", "classifier.py"):
        fpath = os.path.join(os.path.dirname(__file__), fname)
        try:
            h.update(open(fpath, "rb").read())
        except OSError:
            pass
    return h.hexdigest()[:8]

PIPELINE_HASH = _pipeline_hash()

app = FastAPI(title="sound-to-visual-web")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 로컬 개발용 (ADR 0001)
    allow_methods=["*"],
    allow_headers=["*"],
)


def _build_result(path: str) -> dict:
    analysis = analyze_score(path)
    canon = canon_detail(analysis)    # 성부쌍 모방 lag (ADR 0012 / C1)
    mirror = mirror_detail(analysis)  # 역행/전위 거울 대칭 (C4)
    units = structural_units(analysis)  # 자기 유사도 구조 단위 (ADR 0013 / H1)
    category = classify(analysis, canon)
    analysis.pop("_intervalSequences", None)  # 내부 전용
    analysis.pop("_intervalSeqPartIndex", None)
    analysis["canon"] = canon
    analysis["mirror"] = mirror
    analysis["structuralUnits"] = units
    analysis["category"] = category
    return analysis


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED:
        raise HTTPException(400, f"지원하지 않는 형식: {ext or '없음'} (허용: {sorted(ALLOWED)})")

    data = await file.read()
    if not data:
        raise HTTPException(400, "빈 파일입니다.")

    digest = hashlib.sha1(data).hexdigest()
    cache_path = os.path.join(CACHE_DIR, f"{digest}_{PIPELINE_HASH}.json")
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            return JSONResponse(json.load(f))

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        result = _build_result(tmp_path)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:  # 파싱 실패 등
        raise HTTPException(422, f"분석 실패: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    return JSONResponse(result)
