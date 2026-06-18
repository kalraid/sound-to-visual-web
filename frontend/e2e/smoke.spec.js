import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.resolve(__dirname, "../../samples");

test("업로드 → 분류 표시 → 캔버스 렌더 → 재생 진행", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  // 캔버스(Three.js)가 렌더됨
  await expect(page.locator("#stage canvas")).toBeVisible();

  // 캐논 샘플 업로드
  await page.setInputFiles("#file-input", path.join(SAMPLES, "canon.mid"));

  // 분류 라벨이 '캐논'으로 표시될 때까지
  await expect(page.locator("#category")).toContainText("캐논", { timeout: 15000 });

  // 재생 → 시간/탐색바가 전진하는지
  await page.click("#play-btn");
  await page.waitForTimeout(1500);
  const seek = await page.locator("#seek").inputValue();
  expect(Number(seek)).toBeGreaterThan(0);

  expect(errors, "콘솔 페이지 에러 없음").toEqual([]);
});

test("기타/화음 분류 확인", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#file-input", path.join(SAMPLES, "melody.mid"));
  await expect(page.locator("#category")).toContainText("기타", { timeout: 15000 });

  await page.setInputFiles("#file-input", path.join(SAMPLES, "bwv66.mid"));
  await expect(page.locator("#category")).toContainText("화음", { timeout: 15000 });
});
