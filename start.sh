#!/usr/bin/env bash
# 백엔드(FastAPI, :8000) + 프론트(Vite, :5173)를 백그라운드로 기동.
# 사용: 루트에서  ./start.sh   (로그: backend.log / frontend.log, 종료: ./stop.sh)
set -e
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "백엔드 기동 중... http://localhost:8000"
( cd "$root/backend" && python -m uvicorn app:app --port 8000 ) > "$root/backend.log" 2>&1 &
echo $! > "$root/.backend.pid"

echo "프론트 기동 중... http://localhost:5173"
( cd "$root/frontend" && npm run dev ) > "$root/frontend.log" 2>&1 &
echo $! > "$root/.frontend.pid"

echo "완료. 브라우저에서 http://localhost:5173 접속하세요."
echo "로그: backend.log / frontend.log,  종료하려면  ./stop.sh"
