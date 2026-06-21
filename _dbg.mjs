import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
const msgs = [];
p.on("console", m => msgs.push(`[${m.type()}] ${m.text()}`));
p.on("pageerror", e => msgs.push(`[pageerror] ${e.message}`));
await p.goto("http://localhost:5173", { waitUntil: "networkidle" });
await p.setInputFiles("#file-input", "test_midi/canon piano+drum.mid");
await p.waitForTimeout(4000);
// 디오라마로
await p.selectOption("#stage-select", "diorama");
await p.waitForTimeout(2500);
// 재생
await p.click("#play-btn");
await p.waitForTimeout(3000);
const dbg = await p.evaluate(() => {
  const t = window.__terrain;
  if (!t) return "no __terrain";
  const cam = t.camera.position;
  const v0 = t.voices[0] && t.voices[0].cube.position;
  return {
    stage: t.stage, dio: t.diorama,
    voices: t.voices.length,
    cam: [cam.x.toFixed(1), cam.y.toFixed(1), cam.z.toFixed(1)],
    cube0: v0 ? [v0.x.toFixed(1), v0.y.toFixed(1), v0.z.toFixed(1)] : null,
    stageGroup: t.stageGroup.children.length,
    terrainVerts: t.voices[0] && t.voices[0].terrain.geometry.attributes.position.count,
  };
});
await p.screenshot({ path: "_dbg.png" });
console.log("DEBUG:", JSON.stringify(dbg, null, 2));
console.log("CONSOLE:\n" + msgs.join("\n"));
await b.close();
