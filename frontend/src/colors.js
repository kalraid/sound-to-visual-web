// 색 매핑 (ADR 0004): 표면/음표 = 피치클래스(도~시), 레인 = 성부색

// 12 피치클래스(도=0 ... 시=11)를 색상환으로. 같은 '도'는 어디서나 같은 색.
export function pitchClassColor(pc) {
  const hue = (pc / 12) * 360;
  return `hsl(${hue}, 75%, 60%)`;
}

export function pitchClassHex(pc) {
  const hue = (pc / 12) * 360;
  return hslToHex(hue, 0.75, 0.6);
}

// 성부색 팔레트 (구분 잘 되는 색)
const VOICE_HUES = [205, 25, 130, 285, 55, 340, 170, 100];
export function voiceColorHex(index) {
  const hue = VOICE_HUES[index % VOICE_HUES.length];
  return hslToHex(hue, 0.6, 0.55);
}

export function hslToHex(h, s, l) {
  h /= 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

export const PITCH_CLASS_KO = ["도", "도#", "레", "레#", "미", "파", "파#", "솔", "솔#", "라", "라#", "시"];
