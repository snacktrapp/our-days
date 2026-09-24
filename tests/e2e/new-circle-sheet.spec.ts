import { expect, test } from "./test";

test("new circle sheet shows a visible name field and a styled button", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "webkit-mobile",
    "iPhone WebKit is the family device",
  );
  await page.goto("/circles");
  await page
    .getByRole("button", { name: "Create a circle", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Create a circle" });
  const name = dialog.getByLabel("Name", { exact: true });
  const create = dialog.getByRole("button", {
    name: "Create circle",
    exact: true,
  });
  await expect(
    dialog.getByRole("heading", { name: "Create a circle" }),
  ).toBeVisible();
  await expect(name).toBeVisible();
  await expect(create).toBeVisible();
  await expect(create).toBeDisabled();
  const field = await name.boundingBox();
  expect(field!.height).toBeGreaterThan(32);
  expect(field!.width).toBeGreaterThan(120);
  const styles = await name.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      fontSize: Number.parseFloat(computed.fontSize),
      borderTopWidth: Number.parseFloat(computed.borderTopWidth),
      background: computed.backgroundColor,
    };
  });
  expect(styles.fontSize).toBeGreaterThanOrEqual(16);
  expect(styles.borderTopWidth).toBeGreaterThan(0);
  expect(styles.background).not.toBe("rgba(0, 0, 0, 0)");
  const buttonBackground = await create.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(buttonBackground).not.toBe("rgba(0, 0, 0, 0)");
  await name.fill("Cousins");
  await expect(create).toBeEnabled();
  await page.screenshot({
    path: "/opt/cursor/artifacts/new-circle-sheet.png",
  });
});
