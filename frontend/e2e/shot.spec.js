import { test } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.resolve(__dirname, "../../samples");

test("screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.setInputFiles("#file-input", path.join(SAMPLES, "bwv66.mid"));
  await page.locator("#category").filter({ hasText: "화음" }).waitFor({ timeout: 15000 });
  await page.click("#play-btn");
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(__dirname, "shot.png") });
  // 우주 배경 + 추격 카메라도 한 장
  await page.selectOption("#bg-select", "space");
  await page.selectOption("#camera-select", "chase");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(__dirname, "shot2.png") });
});
