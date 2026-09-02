import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./test";

async function browserState(page: Page) {
  return page.evaluate(async () => {
    const cacheEntries =
      "caches" in window
        ? await Promise.all(
            (await caches.keys()).sort().map(async (name) => ({
              name,
              requests: (await (await caches.open(name)).keys())
                .map((request) => request.url)
                .sort(),
            })),
          )
        : [];
    return {
      local: { ...localStorage },
      session: { ...sessionStorage },
      databases:
        typeof indexedDB.databases === "function"
          ? (await indexedDB.databases())
              .map(({ name, version }) => ({ name, version }))
              .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
          : [],
      cacheEntries,
      cookie: document.cookie,
      href: location.href,
      historyLength: history.length,
    };
  });
}

test("family settings makes access and invitation boundaries explicit", async ({
  page,
}) => {
  await page.goto("/people");
  await page.getByRole("link", { name: "Family access & invitations" }).click();
  await expect(page).toHaveURL(/\/settings\/family$/u);
  await expect(
    page.getByRole("heading", { name: "Family settings" }),
  ).toBeVisible();
  await expect(page.getByText("Managed profile · No sign-in")).toHaveCount(3);
  await expect(page.getByText("Account · Can sign in")).toHaveCount(2);
  await expect(
    page.getByText(/no accounts or permissions are active/u),
  ).toBeVisible();

  const input = page.getByRole("textbox", { name: "Email address" });
  await input.fill("not-an-email");
  await page.getByRole("button", { name: "Review invitation" }).click();
  await expect(page.locator("#family-invite-error")).toHaveText(
    "Enter a complete email address.",
  );
  await expect(input).toBeFocused();

  await input.fill("  relative@example.com  ");
  await page.getByRole("button", { name: "Review invitation" }).click();
  const inviteHeading = page.getByRole("heading", {
    name: "relative@example.com",
  });
  await expect(inviteHeading).toBeFocused();
  await expect(inviteHeading).toBeInViewport();
  for (const name of ["Back to edit", "Clear preview"] as const) {
    const action = page.getByRole("button", { name });
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport();
  }
  await expect(
    page.getByText(/see its family moments, photos, notes, people/u),
  ).toBeVisible();
  await expect(
    page.getByText(/Our Days did not send email or create an invite/u),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /send/u })).toHaveCount(0);

  await page.getByRole("button", { name: "Back to edit" }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("relative@example.com");

  await page.getByRole("button", { name: "Review invitation" }).click();
  await page.getByRole("button", { name: "Clear preview" }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");

  await page.getByRole("button", { name: "Review access for Molly" }).click();
  const accessHeading = page.getByRole("heading", {
    name: "Review Molly’s access",
  });
  await expect(accessHeading).toBeVisible();
  await expect(accessHeading).toBeFocused();
  await expect(accessHeading).toBeInViewport();
  await expect(
    page.getByText(/Access removal does not delete their account or content/u),
  ).toBeVisible();
  await expect(page.getByText(/No access is changed/u)).toBeVisible();
  await expect(page.getByRole("button", { name: /remove/u })).toHaveCount(0);
});

test("family-setting previews are ephemeral and make no browser-side request", async ({
  page,
}) => {
  await page.goto("/settings/family");
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
  });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const before = await browserState(page);

  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("family+<script>@example.com");
  await page.getByRole("button", { name: "Review invitation" }).click();
  await expect(page.getByText("family+<script>@example.com")).toBeVisible();
  await expect(page.locator("script", { hasText: "example.com" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Back to edit" }).click();
  await page.getByRole("button", { name: "Review access for Molly" }).click();
  await page.getByRole("button", { name: "Close review" }).click();

  expect(requests).toEqual([]);
  expect(await browserState(page)).toEqual(before);

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Email address" }),
  ).toHaveValue("");
  await expect(page.getByText("family+<script>@example.com")).toHaveCount(0);
});

test("family settings remains usable at keyboard height", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 350 });
  await page.goto("/settings/family#invite");
  const input = page.getByRole("textbox", { name: "Email address" });
  await input.scrollIntoViewIfNeeded();
  await input.fill("relative@example.com");
  await page.getByRole("button", { name: "Review invitation" }).click();
  await expect(
    page.getByRole("button", { name: "Clear preview" }),
  ).toBeVisible();
  const shortInviteHeading = page.getByRole("heading", {
    name: "relative@example.com",
  });
  await expect(shortInviteHeading).toBeFocused();
  await expect(shortInviteHeading).toBeInViewport();
  for (const name of ["Back to edit", "Clear preview"] as const) {
    const action = page.getByRole("button", { name });
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport();
  }

  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);

  const inviteAxe = await new AxeBuilder({ page }).analyze();
  expect(
    inviteAxe.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  await page.reload();
  const accessTrigger = page.getByRole("button", {
    name: "Review access for Molly",
  });
  await accessTrigger.scrollIntoViewIfNeeded();
  await accessTrigger.click();
  const accessHeading = page.getByRole("heading", {
    name: "Review Molly’s access",
  });
  await expect(accessHeading).toBeFocused();
  await expect(accessHeading).toBeInViewport();

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("the Account navigation opens settings and its close control returns to People", async ({
  page,
}) => {
  await page.goto("/family");
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/settings\/family$/u);
  await page.getByRole("link", { name: "Back to People" }).click();
  await expect(page).toHaveURL(/\/people$/u);
});
