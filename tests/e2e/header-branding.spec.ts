import { expect, test } from "./test";

test("captions and conversation use sans-serif while journal prose stays serif", async ({
  page,
}) => {
  await page.goto("/family");
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const selector of [
      ".photo-card .card-copy > p:not(.moment-kicker)",
      ".inline-note-summary li p",
    ]) {
      const copy = page.locator(selector).first();
      await expect(copy).toBeVisible();
      expect(
        await copy.evaluate((element) => getComputedStyle(element).fontFamily),
      ).toContain("sans-serif");
    }
    const note = page.locator(".thought-card blockquote").first();
    expect(
      await note.evaluate((element) => getComputedStyle(element).fontFamily),
    ).toContain("Georgia");
  }
});

test("shared brand header keeps compact geometry and working feed selection", async ({
  page,
}) => {
  for (const [route, label] of [
    ["/family", "All circles"],
    ["/circles", "Circles"],
    ["/settings/family", "Account"],
  ]) {
    await page.goto(route);
    const header = page.locator(".topbar");
    await expect(header.getByRole("img", { name: "Our Days" })).toBeVisible();
    await expect(
      header.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const geometry = await header.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        font: getComputedStyle(element.querySelector("h1")!).fontFamily,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      expect(geometry.height).toBe(56);
      expect(geometry.font).toContain("monospace");
      expect(geometry.overflow).toBe(false);
    }
  }
  await page.goto("/family");
  await page.getByRole("button", { name: "Choose a journal" }).click();
  await page.getByRole("link", { name: "Just me", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Just me");
});
