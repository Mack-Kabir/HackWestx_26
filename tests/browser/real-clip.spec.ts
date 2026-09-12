import { test, expect } from "@playwright/test";
test("provided front-squat clip exposes all five cycles", async ({ page }) => {
  test.skip(
    !process.env.SQUAT_CLIP,
    "Set SQUAT_CLIP to the local user-provided video.",
  );
  await page.goto("/");
  await page
    .getByLabel("Upload squat video")
    .setInputFiles(process.env.SQUAT_CLIP!);
  await page.getByRole("button", { name: "Analyze clip" }).click();
  await expect(
    page.getByRole("button", { name: "Export session JSON" }),
  ).toBeEnabled({ timeout: 110000 });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export session JSON" }).click();
  await (await downloaded).saveAs("test-results/real-clip-analysis.json");
  await page.screenshot({ path: "test-results/real-clip.png", fullPage: true });
  await expect(page.getByRole("button", { name: /REP 0/ })).toHaveCount(5);
  await page.getByRole("button", { name: /REP 05/ }).click();
  await expect(page.locator(".contact-sheet img")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /REP 05/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
