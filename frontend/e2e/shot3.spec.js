import { test } from "@playwright/test";
import path from "path";

const FILE = "d:/sources/sount-to-visual-web/test_midi/canon piano+drum.mid";

test("user file", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.setInputFiles("#file-input", FILE);
  await page.locator("#status").filter({ hasText: "성부" }).waitFor({ timeout: 20000 });
  await page.click("#play-btn");
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(import.meta.dirname, "user.png") });
  // 좌(뒤) 시점 + 악보 크게
  await page.selectOption("#camdir-select", "left");
  await page.fill("#score-zoom", "1.6");
  await page.dispatchEvent("#score-zoom", "input");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(import.meta.dirname, "user_left.png") });
});
