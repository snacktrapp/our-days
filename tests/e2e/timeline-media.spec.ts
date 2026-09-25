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

test.describe("poster timezone", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("a Rome moment shows the poster clock for a Pacific viewer", async ({
    page,
  }) => {
    await page.goto("/quality/timeline-media");
    const post = page.locator("article").filter({ hasText: "Lunch in Rome." });
    for (const viewport of [
      { width: 375, height: 667 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const lines = post.locator(".moment-when-line");
      await expect(lines).toHaveCount(1);
      await expect(lines).toHaveText("Sep 24 · 1:15 PM Rome");
      await expect(post.getByText("your time")).toHaveCount(0);
      const headerFont = await lines.evaluate(
        (node) => getComputedStyle(node).fontFamily,
      );
      expect(headerFont).toContain("ui-monospace");
      expect(headerFont).toContain("SFMono-Regular");
      expect(headerFont).toContain("monospace");
      const box = await post.locator(".moment-when").boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
  });

  test("comment timestamps use the post header mono on one author line", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/family");
    const card = page.locator('[data-moment-kind="photo"]').first();
    const header = card.locator(".moment-when-line");
    const stamp = card.locator(".inline-note-when").first();
    await expect(header).toBeVisible();
    await expect(stamp).toBeVisible();
    await expect(page.getByText("your time")).toHaveCount(0);
    const fonts = await card.evaluate((node) => {
      const headerNode = node.querySelector(".moment-when-line");
      const stampNode = node.querySelector(".inline-note-when");
      const headerStyle = headerNode ? getComputedStyle(headerNode) : null;
      const stampStyle = stampNode ? getComputedStyle(stampNode) : null;
      return {
        header: headerStyle?.fontFamily ?? "",
        stamp: stampStyle?.fontFamily ?? "",
        headerSize: headerStyle?.fontSize ?? "",
        stampSize: stampStyle?.fontSize ?? "",
        headerTracking: headerStyle?.letterSpacing ?? "",
        stampTracking: stampStyle?.letterSpacing ?? "",
        headerLeading: headerStyle?.lineHeight ?? "",
        stampLeading: stampStyle?.lineHeight ?? "",
      };
    });
    expect(fonts.header).toContain("ui-monospace");
    expect(fonts.stamp).toBe(fonts.header);
    expect(fonts.stampSize).toBe(fonts.headerSize);
    expect(fonts.stampTracking).toBe(fonts.headerTracking);
    expect(fonts.stampLeading).toBe(fonts.headerLeading);
    const chip = card.locator(".connection .audience-chip-face");
    await expect(chip).toBeVisible();
    const recorded = await card.evaluate((node) => {
      const read = (selector: string) => {
        const element = node.querySelector(selector);
        return element ? getComputedStyle(element).fontFamily : "";
      };
      return {
        header: read(".moment-when-line"),
        chip: read(".connection .audience-chip-face"),
        author: read(".inline-note-author strong"),
        names: read(".inline-reaction-summary li"),
      };
    });
    expect(recorded.chip).toBe(recorded.header);
    expect(recorded.author).toBe(recorded.names);
    expect(recorded.author).not.toBe(recorded.header);
    const row = card.locator(".inline-note-row").first();
    await row.getByRole("button", { name: "Love this comment" }).click();
    const count = row.getByRole("button", {
      name: "1 person loves this comment",
    });
    await expect(count).toBeVisible();
    const countFont = await count.evaluate((node) => {
      const style = getComputedStyle(node);
      return { family: style.fontFamily, size: style.fontSize };
    });
    expect(countFont.family).toBe(recorded.header);
    expect(countFont.size).toBe(fonts.headerSize);
    const centered = await row.evaluate((note) => {
      const glyph = note.querySelector(".inline-note-heart .heart-glyph");
      const countNode = note.querySelector(".inline-note-heart-count");
      if (!glyph || !countNode) return 99;
      const glyphBox = glyph.getBoundingClientRect();
      const countBox = countNode.getBoundingClientRect();
      return Math.abs(
        glyphBox.top +
          glyphBox.height / 2 -
          (countBox.top + countBox.height / 2),
      );
    });
    expect(centered).toBeLessThanOrEqual(1);
    await count.click();
    const loved = row.locator(".inline-note-loved");
    await expect(loved).toBeVisible();
    const lovedFont = await loved.evaluate(
      (node) => getComputedStyle(node).fontFamily,
    );
    expect(lovedFont).toBe(recorded.names);
    expect(lovedFont).not.toBe(recorded.header);
    const singleLine = await card
      .locator(".inline-note-row")
      .first()
      .evaluate((row) => {
        const author = row.querySelector(".inline-note-author");
        if (!author) return false;
        const inFlow = [...author.children].filter(
          (child) => getComputedStyle(child).position !== "absolute",
        );
        const tops = inFlow.map((child) => child.getBoundingClientRect().top);
        return (
          author.getClientRects().length === 1 &&
          Math.max(...tops) - Math.min(...tops) < 2
        );
      });
    expect(singleLine).toBe(true);
  });
});
