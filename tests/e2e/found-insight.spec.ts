import { expect, test } from "@playwright/test";
import {
  foundFixtureQuote,
  foundFixtureRejectedQuote,
} from "../../src/features/insights/found-fixture";
import {
  localAlexPersonId,
  localJordanPersonId,
} from "../../src/lib/local-journal/ids";

test("an organizer can post a verified Found quote to Just me", async ({
  page,
  browser,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("family@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByRole("button", { name: "Add", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /YouTube clip/ }).click();
  await page
    .getByRole("textbox", { name: "What are you looking for?" })
    .fill("DHH on the pursuit of excellence on Lex");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByText(foundFixtureQuote)).toBeVisible();
  await expect(page.getByText(foundFixtureRejectedQuote)).toHaveCount(0);
  await expect(page.getByText("Verified from transcript")).toBeVisible();
  await page.getByRole("button", { name: "Use this" }).click();
  await expect(page.getByRole("checkbox", { name: "Just me" })).toBeChecked();
  await expect(page.getByText("Verified from transcript")).toHaveCount(0);
  await page.getByRole("button", { name: "Post", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/people/${localAlexPersonId}`));
  const card = page.locator("article").filter({ hasText: foundFixtureQuote });
  await expect(card).toBeVisible();
  await expect(card.getByText("Verified")).toHaveCount(0);
  await expect(card.getByRole("link", { name: "Listen" })).toHaveAttribute(
    "href",
    /[?&]t=6762(?:&|$)/,
  );

  const jordan = await browser.newContext();
  const jordanPage = await jordan.newPage();
  await jordanPage.goto("/sign-in");
  await jordanPage.getByLabel("Email address").fill("jordan@example.com");
  await jordanPage
    .getByRole("button", { name: "Email me a sign-in link" })
    .click();
  await expect(
    jordanPage.getByRole("button", { name: "Add", exact: true }),
  ).toBeVisible();
  await jordanPage.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    jordanPage.getByRole("button", { name: /YouTube clip/ }),
  ).toHaveCount(0);
  await expect(jordanPage.getByRole("button", { name: /^Found/ })).toHaveCount(
    0,
  );
  await jordanPage.keyboard.press("Escape");
  await jordanPage.goto("/family");
  await expect(jordanPage.getByText(foundFixtureQuote)).toHaveCount(0);
  await jordanPage.goto(`/people/${localJordanPersonId}`);
  await expect(jordanPage.getByText(foundFixtureQuote)).toHaveCount(0);
  const denied = await jordanPage.evaluate(async () => {
    const response = await fetch("/api/insights/found", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "excellence" }),
    });
    return response.status;
  });
  expect(denied).toBe(403);
  await jordan.close();
});
