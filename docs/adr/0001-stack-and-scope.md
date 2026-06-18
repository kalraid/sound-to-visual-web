# ADR 0001 — 스택·범위·우선순위

## 맥락
음악 파일을 음표로 바꿔 시각화하는 웹앱. 오디오→음표(AMT)는 어렵고 손실이 큰 반면,
MIDI/MusicXML은 음표·성부·길이가 이미 정확. 렌더링은 비교적 쉬움.

## 결정
- **입력**: MIDI 먼저(.mid/.midi + .xml/.musicxml), 오디오는 Phase 2(basic-pitch).
- **스택**: 파이썬 백엔드(FastAPI + music21) + 웹 프론트(Three.js / OpenSheetMusicDisplay / Tone.js).
- **프론트**: 바닐라 JS + Vite(프레임워크 없음).
- **우선순위**: 비주얼 우선(NHK 영상 느낌).
- **배포**: 로컬 개발용만(uvicorn + vite). 인증·호스팅 불필요.
- **브라우저**: 크롬/엣지 최신만(WebGL2·Web Audio 최신 기능 자유 사용).

## 근거
정확한 음표를 공짜로 얻는 MIDI로 먼저 전체 파이프라인·비주얼을 완성해 위험을 제거.
MIR 라이브러리 생태계가 파이썬(music21)에 풍부.

## 대안
- 순수 브라우저 JS: 분석 도구 약함 → 기각.
- 오디오 우선: AMT 정확도 리스크로 MVP에 부적합 → Phase 2로 연기.
