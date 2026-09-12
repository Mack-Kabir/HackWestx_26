import { test, expect } from "@playwright/test";
test("provided front-squat clip exposes all five cycles", async ({ page }) => {
  test.skip(
    !process.env.SQUAT_CLIP,
    "Set SQUAT_CLIP to the local user-provided video.",
  );
  let coachingRequest: {
    keyframes: Array<{ label: string; time: number }>;
  } | null = null;
  await page.route("**/api/coach", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { configured: true } });
    coachingRequest = route.request().postDataJSON();
    return route.fulfill({
      json: {
        exercise: "squat",
        confidence: "medium",
        summary: "Fixture response for keyframe request validation.",
        cues: [],
        limitations: ["Fixture response; no provider call was made."],
      },
    });
  });
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
  await expect(page.getByRole("button", { name: /REP 0/ })).toHaveCount(5);
  await page.getByRole("button", { name: "Get Gemini coaching" }).click();
  await expect(page.getByText(/Gemini review · squat/)).toBeVisible();
  expect(coachingRequest).not.toBeNull();
  expect(coachingRequest!.keyframes).toHaveLength(6);
  for (let rep = 1; rep <= 5; rep += 1)
    expect(
      coachingRequest!.keyframes.some(
        (frame) => frame.label === `Rep ${rep} · bottom`,
      ),
    ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Keep a public receipt" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/real-clip.png", fullPage: true });
  await expect(
    page.getByText(
      "No compatible browser wallet was found. Your movement review is still complete.",
    ),
  ).toBeVisible();
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
