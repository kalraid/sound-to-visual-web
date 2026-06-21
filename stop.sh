#!/usr/bin/env bash
# 백엔드(:8000) + 프론트(:5173) 포트를 점유한 프로세스를 종료.
# 사용: 루트에서  ./stop.sh
for port in 8000 5173; do
  # Git Bash(Windows): netstat 로 LISTENING PID 추출 후 taskkill
  pids="$(netstat -ano 2>/dev/null | grep -E "[:.]$port[^0-9].*LISTENING" | awk '{print $NF}' | sort -u)"
  if [ -z "$pids" ]; then
    echo "포트 $port : 실행 중인 리스너 없음"
    continue
  fi
  for procId in $pids; do
    if taskkill //PID "$procId" //F >/dev/null 2>&1; then
      echo "포트 $port : 종료됨 (PID $procId)"
    else
      echo "포트 $port : PID $procId 종료 실패"
    fi
  done
done
rm -f "$(dirname "${BASH_SOURCE[0]}")/.backend.pid" "$(dirname "${BASH_SOURCE[0]}")/.frontend.pid"
echo "완료."
