import { expect, test } from "./test";

test("timeline media fixture is available without journal authentication", async ({
  page,
}) => {
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/media/") ||
      request.url().includes("supabase")
    ) {
      mediaRequests.push(request.url());
    }
  });

  const response = await page.goto("/quality/timeline-media");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toContain("private");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");

  await expect(
    page.getByRole("heading", { name: "Inline timeline media" }),
  ).toBeVisible();

  const photo = page.getByAltText(
    "A child laughing outside in warm evening light",
  );
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((image) => image.closest("button"))).toBeNull();
  await photo.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const video = page.getByLabel("Video in Brian’s journal from Aug 28, 2026");
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).toHaveAttribute("playsinline", "");
  await expect(page.getByRole("button", { name: /full screen/iu })).toHaveCount(
    0,
  );
  expect(mediaRequests).toEqual([]);
});
