# sound-to-visual-web

음악 파일(MIDI/MusicXML)을 넣으면 **캐논 / 화음 / 기타**로 분류하고, 다중 성부 악보를
화면 상단에 띄워 재생하면서, 남은 화면에는 음높이를 **지형(언덕)** 으로 그려
성부별 **큐브가 미끄러지며** 진행하는 시각화 웹앱.

NHK 명곡앨범+ 파헬벨 캐논 시각화 / 바흐 14 canons 시각화에서 영감.

## 구조
- `backend/` — FastAPI + music21 분석(성부/음표/템포/분류/importance)
- `frontend/` — Vite + Three.js(지형/큐브) + OpenSheetMusicDisplay(악보) + Tone.js(재생/시계)
- `samples/` — 테스트용 MIDI
- `docs/` — ADR(결정 기록) + 용어집

## 실행
```bash
# 백엔드
pip install -r backend/requirements.txt
uvicorn backend.app:app --reload --port 8000

# 테스트 샘플 생성
python backend/make_samples.py

# 프론트
cd frontend && npm install && npm run dev
```
브라우저(크롬/엣지 최신)에서 `http://localhost:5173` 접속 → 파일 업로드.

## 로드맵
- MVP: MIDI/MusicXML 업로드 → 분류 + 악보 + 지형/큐브 (비주얼 우선)
- Phase 1.5: 곡이름 검색 → 공개 MIDI DB 자동획득
- Phase 2: 오디오 입력(basic-pitch 채보)

자세한 설계는 `docs/adr/` 참고.
