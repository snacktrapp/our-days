import { expect, test } from "./test";

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "HTTP privacy boundary behavior is engine-independent and runs once in Chromium.",
);

const lockedURL = "http://127.0.0.1:3101";
const fixtureText = [
  "Brian",
  "Molly",
  "Avery",
  "Sand Harbor",
  "All our days",
  "Nothing from this day yet",
  "March 4",
  "/sample-family.jpg",
];
const privateRoutes = [
  "/family",
  "/people",
  "/people/molly",
  "/memories",
  "/memories/on-this-day",
  "/memories/years/2023",
  "/memories/years/1900",
  "/journal",
  "/quality/global-error",
  "/quality/memories-empty",
];

function isRscNavigationRequest(url: string, headers: Record<string, string>) {
  return new URL(url).searchParams.has("_rsc") && headers.rsc === "1";
}

test("preview-disabled production routes fail closed with private headers", async ({
  page,
  request,
}) => {
  for (const path of ["/", "/sign-in"]) {
    const response = await request.get(`${lockedURL}${path}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("private");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    const body = await response.text();
    for (const value of fixtureText) expect(body).not.toContain(value);
  }

  for (const path of privateRoutes) {
    const response = await request.get(`${lockedURL}${path}`, {
      maxRedirects: 0,
    });
    expect([307, 308]).toContain(response.status());
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.text();
    for (const value of fixtureText) expect(body).not.toContain(value);
  }

  await page.goto(`${lockedURL}/family`);
  await expect(page).toHaveURL(`${lockedURL}/sign-in`);
  await expect(
    page.getByRole("heading", { name: "Our Days is invitation only." }),
  ).toBeVisible();
});

test("browser-generated RSC navigations fail closed without private prefetch", async ({
  page,
  request,
}) => {
  const observedRscRequests: string[] = [];
  page.on("request", (browserRequest) => {
    if (
      isRscNavigationRequest(browserRequest.url(), browserRequest.headers())
    ) {
      observedRscRequests.push(browserRequest.url());
    }
  });

  const captureNavigation = async (from: string, to: string) => {
    const requestCountBeforeDocumentLoad = observedRscRequests.length;
    await page.goto(from, { waitUntil: "networkidle" });
    expect(
      observedRscRequests,
      `private links on ${from} must not prefetch RSC payloads before interaction`,
    ).toHaveLength(requestCountBeforeDocumentLoad);

    const navigationRequestPromise = page.waitForRequest((browserRequest) => {
      const url = new URL(browserRequest.url());
      return (
        url.pathname === to &&
        isRscNavigationRequest(browserRequest.url(), browserRequest.headers())
      );
    });
    await page.locator(`a[href="${to}"]`).first().click();
    const navigationRequest = await navigationRequestPromise;
    await expect(page).toHaveURL(new RegExp(`${to.replace("/", "\\/")}$`));

    const capturedURL = new URL(navigationRequest.url());
    const capturedHeaders = await navigationRequest.allHeaders();
    expect(capturedHeaders.rsc).toBe("1");
    expect(capturedHeaders["next-router-state-tree"]).toBeTruthy();
    expect(capturedHeaders["next-url"]).toBeTruthy();
    expect(capturedURL.searchParams.get("_rsc")).toBeTruthy();

    return {
      search: capturedURL.search,
      headers: {
        rsc: capturedHeaders.rsc,
        "next-router-state-tree": capturedHeaders["next-router-state-tree"],
        "next-url": capturedHeaders["next-url"],
      },
    };
  };

  const capturedRequests = new Map([
    ["/family", await captureNavigation("/people", "/family")],
    ["/people", await captureNavigation("/family", "/people")],
    ["/people/molly", await captureNavigation("/family", "/people/molly")],
    ["/memories", await captureNavigation("/family", "/memories")],
    [
      "/memories/on-this-day",
      await captureNavigation("/memories", "/memories/on-this-day"),
    ],
    [
      "/memories/years/2023",
      await captureNavigation("/memories", "/memories/years/2023"),
    ],
  ]);
  // Reuse the genuine browser envelope captured for the valid dynamic route
  // against an invalid year. The locked server must guard before validation.
  capturedRequests.set(
    "/memories/years/1900",
    capturedRequests.get("/memories/years/2023")!,
  );
  // `/journal` is a guarded compatibility redirect and intentionally has no
  // visible link. Reuse the genuine browser-generated envelope captured from
  // a sibling private route while targeting `/journal` on the locked server.
  capturedRequests.set("/journal", capturedRequests.get("/family")!);
  capturedRequests.set(
    "/quality/global-error",
    capturedRequests.get("/family")!,
  );
  capturedRequests.set(
    "/quality/memories-empty",
    capturedRequests.get("/family")!,
  );

  for (const path of privateRoutes) {
    const capturedRequest = capturedRequests.get(path)!;
    const response = await request.get(
      `${lockedURL}${path}${capturedRequest.search}`,
      { headers: capturedRequest.headers, maxRedirects: 0 },
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/x-component");
    expect(response.headers()["cache-control"]).toContain("private");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");

    const body = await response.text();
    expect(body, `${path} must return an RSC redirect digest`).toContain(
      "NEXT_REDIRECT",
    );
    expect(body, `${path} must redirect to the locked entry`).toContain(
      "/sign-in",
    );
    for (const value of fixtureText) expect(body).not.toContain(value);
  }
});
