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
from classifier import canon_detail, classify, mirror_detail

ALLOWED = {".mid", ".midi", ".xml", ".musicxml", ".mxl"}
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

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
    category = classify(analysis, canon)
    analysis.pop("_intervalSequences", None)  # 내부 전용
    analysis.pop("_intervalSeqPartIndex", None)
    analysis["canon"] = canon
    analysis["mirror"] = mirror
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
    cache_path = os.path.join(CACHE_DIR, f"{digest}.json")
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
