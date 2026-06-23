// H2a 공유 지형(ADR 0013) 수치 검증: 캐논에서 후행 성부 지형이 숨겨지는지.
import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.resolve(__dirname, "../../samples");

const visState = async (page) =>
  page.evaluate(() => {
    const t = window.__terrain;
    return t.voices.map((v) => ({
      part: v.partIndex,
      chase: !!v.chase,
      terrainVisible: v.terrain ? v.terrain.visible : null,
    }));
  });

test("공유지형 on → 후행 성부 지형 숨김, off → 복구", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.setInputFiles("#file-input", path.join(SAMPLES, "canon.mid"));
  await expect(page.locator("#category-select")).toHaveValue("canon", { timeout: 15000 });
  // 지형 빌드(voices) 완료 대기
  await page.waitForFunction(() => window.__terrain && window.__terrain.voices.length >= 2,
    null, { timeout: 15000 });

  // 기본(off): 모든 성부 지형 보임
  let st = await visState(page);
  expect(st.length).toBeGreaterThanOrEqual(2);
  expect(st.every((v) => v.terrainVisible === true)).toBe(true);
  const followers = st.filter((v) => v.chase);
  expect(followers.length, "캐논 후행 성부가 1개 이상").toBeGreaterThanOrEqual(1);

  // 공유지형 켜기: 후행(chase) 성부만 지형 숨김
  await page.selectOption("#share-select", "on");
  st = await visState(page);
  for (const v of st) {
    expect(v.terrainVisible).toBe(!v.chase); // chase면 숨김(false)
  }

  // 다시 끄기: 전부 복구
  await page.selectOption("#share-select", "off");
  st = await visState(page);
  expect(st.every((v) => v.terrainVisible === true)).toBe(true);

  // 추격강조 off면 공유지형 on이어도 복구되어야 함
  await page.selectOption("#share-select", "on");
  await page.selectOption("#canon-select", "off");
  st = await visState(page);
  expect(st.every((v) => v.terrainVisible === true)).toBe(true);

  expect(errors, "콘솔 페이지 에러 없음").toEqual([]);
});
