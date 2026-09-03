import { expect, test } from "./test";

const journals = [
  {
    id: "brian",
    name: "Brian",
    summary: "2 moments · 2022–2026",
    momentIds: ["moment-sunset", "moment-late-summer-2022"],
    dates: ["2026-08-28", "2022-08-28"],
    years: ["Aug 28, 2022"],
  },
  {
    id: "molly",
    name: "Molly",
    summary: "3 moments · 2019–2026",
    momentIds: ["moment-kitchen", "moment-lake", "moment-porch-light-2019"],
    dates: ["2026-08-14", "2026-07-06", "2019-08-28"],
    years: ["Aug 28, 2019"],
  },
  {
    id: "avery",
    name: "Avery",
    summary: "1 moment · 2023",
    momentIds: ["moment-first-day"],
    dates: ["2023-08-21"],
    years: [],
  },
  {
    id: "sam",
    name: "Sam",
    summary: "No moments yet",
    momentIds: [],
    dates: [],
    years: [],
  },
  {
    id: "june",
    name: "June",
    summary: "No moments yet",
    momentIds: [],
    dates: [],
    years: [],
  },
] as const;

test("People links to five distinct, owner-correct life journals", async ({
  page,
}) => {
  await page.goto("/people");
  const journalLinks = page.getByRole("link", { name: /View journal/u });
  await expect(journalLinks).toHaveCount(5);
  expect(
    await journalLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")),
    ),
  ).toEqual(journals.map(({ id }) => `/people/${id}`));

  for (const journal of journals) {
    await page.goto(`/people/${journal.id}`);
    await expect(
      page.getByRole("heading", { name: `${journal.name}’s days` }),
    ).toBeVisible();
    await expect(
      page.getByLabel(`Chronological moments for ${journal.name}`),
    ).toBeVisible();
    await expect(page.getByText(journal.summary)).toBeVisible();
    expect(
      await page
        .locator("[data-moment-kind]")
        .evaluateAll((moments) => moments.map(({ id }) => id)),
    ).toEqual(journal.momentIds);
    expect(
      await page
        .locator("article[data-moment-kind] time")
        .evaluateAll((times) =>
          times.map((time) => time.getAttribute("datetime")),
        ),
    ).toEqual(journal.dates);
    await expect(page.locator(".elapsed-gap")).toHaveCount(0);
    await expect(page.locator(".year-divider")).toHaveText(journal.years);
    await page.locator(".title-switcher summary").click();
    await expect(
      page
        .getByRole("navigation", { name: "Choose a family timeline" })
        .getByRole("link", { name: journal.name, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".time-rail")).toBeVisible();
  }
});

test("managed profiles preserve journal identity and honest empty states", async ({
  page,
}) => {
  await page.goto("/people/avery");
  await expect(page.getByText("Avery", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("First day of school")).toBeVisible();
  await expect(page.getByText(/earliest entry/i)).toBeVisible();
  await expect(page.getByText("The story so far")).toHaveCount(0);
  await expect(page.getByText("No earlier entries.")).toHaveCount(0);
  await expect(page.locator(".timeline-whisper")).toHaveCount(0);

  for (const name of ["Sam", "June"] as const) {
    await page.goto(`/people/${name.toLowerCase()}`);
    await expect(page.locator("[data-moment-kind]")).toHaveCount(0);
    await expect(page.getByText("A story ready to begin")).toBeVisible();
    await expect(
      page.getByText(
        `The first moment your family keeps for ${name} will begin this timeline.`,
      ),
    ).toBeVisible();
  }
});

test("managed journal defaults retain adult recorder truth across client navigation", async ({
  page,
}) => {
  await page.goto("/people/avery");
  await page.getByRole("button", { name: "Add moment" }).click();
  await page.getByRole("button", { name: /Written entry/u }).click();
  await page.getByRole("button", { name: /Details/u }).click();
  await expect(
    page.getByRole("button", { name: /^Journal, Avery/u }),
  ).toBeVisible();
  await expect(page.getByText("Recorded by Brian")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Entry" })
    .fill("Avery tried something new.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("link", { name: "People" }).click();
  await page.locator('a[href="/people/sam"]').click();
  await page.getByRole("button", { name: "Add moment" }).click();
  await page.getByRole("button", { name: /Written entry/u }).click();
  await page.getByRole("button", { name: /Details/u }).click();
  await expect(
    page.getByRole("button", { name: /^Journal, Sam/u }),
  ).toBeVisible();
  await expect(page.getByText("Recorded by Brian")).toBeVisible();
});

test("unknown people use a generic private soft-not-found without enumeration", async ({
  page,
  allowedConsoleErrors,
}) => {
  allowedConsoleErrors.push(
    "Failed to load resource: the server responded with a status of 404",
  );
  const response = await page.goto("/people/not-in-this-family");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toContain("private");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(
    page.getByRole("heading", { name: "That page isn’t here." }),
  ).toBeVisible();
  await expect(
    page.getByText("Your family journal remains private."),
  ).toBeVisible();
  await expect(page.getByText(/Brian|Molly|Avery|Sam|June/u)).toHaveCount(0);
});
