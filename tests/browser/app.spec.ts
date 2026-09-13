import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("sample analysis, timeline, export, and mobile layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Review your squat." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Explore a motion replay." }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Explore a sample" }).click();
  await expect(page.getByText("SYNTHETIC LANDMARK SAMPLE")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Keep a public receipt" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /REP 0/ })).toHaveCount(3);
  await page.getByRole("button", { name: /REP 02/ }).click();
  expect(Number(await page.getByRole("slider").inputValue())).toBeGreaterThan(
    5,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export session JSON" }).click();
  expect((await download).suggestedFilename()).toBe("formchain-analysis.json");
  await page.screenshot({ path: "test-results/sample.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test("malformed and oversized API input are rejected", async ({ request }) => {
  expect(
    (await request.post("/api/coach", { data: { duration: -1 } })).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/coach", { data: "x".repeat(2_000_001) })
    ).status(),
  ).toBe(413);
  expect(
    (await request.post("/api/motion", { data: { duration: 30 } })).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/motion", {
        data: { duration: 4, variant: "front-squat" },
      })
    ).status(),
  ).toBe(503);
});

test("the motion section explains its limits and opens a local BVH", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Explore a motion replay." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate with Kimodo" }),
  ).toBeDisabled();
  await page
    .getByLabel("Import BVH animation")
    .setInputFiles("tests/fixtures/simple-squat.bvh");
  await expect(
    page.locator("canvas[aria-label='3D skeletal motion viewer']"),
  ).toBeVisible();
  await expect(page.getByText(/Imported animation/)).toBeVisible();
  await page.getByRole("button", { name: "Play replay" }).click();
  await expect(
    page.getByRole("button", { name: "Pause replay" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("real video decoding and MediaPipe inference reject an empty scene", async ({
  page,
}) => {
  await page.goto("/");
  // A generated blank video tests the real decoder/model path without using private gym footage.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(15),
      recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    const complete = new Promise<Blob>((resolve) => {
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    });
    recorder.start();
    const interval = setInterval(() => {
      ctx.fillStyle = "#202820";
      ctx.fillRect(0, 0, 320, 240);
    }, 60);
    await new Promise((resolve) => setTimeout(resolve, 3300));
    recorder.stop();
    clearInterval(interval);
    stream.getTracks().forEach((t) => t.stop());
    return Array.from(new Uint8Array(await (await complete).arrayBuffer()));
  });
  await page.getByLabel("Upload squat video").setInputFiles({
    name: "blank.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(bytes),
  });
  await page.getByRole("button", { name: "Analyze clip" }).click();
  await expect(page.getByText("Body tracked in 0% of frames")).toBeVisible({
    timeout: 100000,
  });
  await expect(page.getByRole("button", { name: /REP 0/ })).toHaveCount(0);
});
