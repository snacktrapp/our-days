import { expect, test } from "./test";

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "HTTP privacy boundary behavior is engine-independent and runs once in Chromium.",
);

const lockedURL = "http://127.0.0.1:3101";
const previewURL = "http://127.0.0.1:3100";
const detailCanary = "The quiet ride home was my favorite part.";
const fixtureText = [
  "Brian",
  "Molly",
  "Avery",
  "Sam",
  "June",
  "Sand Harbor",
  "All our days",
  "Nothing from this day yet",
  "March 4",
  "/sample-family.jpg",
  detailCanary,
  "I can still hear everyone laughing by the water.",
  "I wrote this down because I knew I would miss the noise.",
  "Those wet shoes stayed by the door for days.",
  "That brave wave still gets me.",
  "First day of school",
];
const privateRoutes = [
  "/family",
  "/trash",
  "/people",
  "/people/brian",
  "/people/molly",
  "/people/avery",
  "/people/sam",
  "/people/june",
  "/people/not-in-this-family",
  "/settings/family",
  "/memories",
  "/memories/on-this-day",
  "/memories/milestones",
  "/memories/years/2023",
  "/memories/years/1900",
  "/journal",
  "/quality/global-error",
  "/quality/memories-empty",
  "/quality/video-feasibility",
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
    ["/people/brian", await captureNavigation("/people", "/people/brian")],
    ["/people/molly", await captureNavigation("/people", "/people/molly")],
    ["/people/avery", await captureNavigation("/people", "/people/avery")],
    ["/people/sam", await captureNavigation("/people", "/people/sam")],
    ["/people/june", await captureNavigation("/people", "/people/june")],
    [
      "/settings/family",
      await captureNavigation("/family", "/settings/family"),
    ],
    ["/memories", await captureNavigation("/family", "/memories")],
    [
      "/memories/on-this-day",
      await captureNavigation("/memories", "/memories/on-this-day"),
    ],
    [
      "/memories/milestones",
      await captureNavigation("/memories", "/memories/milestones"),
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
  capturedRequests.set(
    "/people/not-in-this-family",
    capturedRequests.get("/people/molly")!,
  );
  // `/journal` is a guarded compatibility redirect and intentionally has no
  // visible link. Reuse the genuine browser-generated envelope captured from
  // a sibling private route while targeting `/journal` on the locked server.
  capturedRequests.set("/journal", capturedRequests.get("/family")!);
  capturedRequests.set("/trash", capturedRequests.get("/family")!);
  capturedRequests.set(
    "/quality/global-error",
    capturedRequests.get("/family")!,
  );
  capturedRequests.set(
    "/quality/memories-empty",
    capturedRequests.get("/family")!,
  );
  capturedRequests.set(
    "/quality/video-feasibility",
    capturedRequests.get("/family")!,
  );

  const previewFamilyRequest = capturedRequests.get("/family")!;
  const previewResponse = await request.get(
    `${previewURL}/family${previewFamilyRequest.search}`,
    { headers: previewFamilyRequest.headers },
  );
  expect(previewResponse.status()).toBe(200);
  expect(previewResponse.headers()["content-type"]).toContain(
    "text/x-component",
  );
  expect(await previewResponse.text()).toContain(detailCanary);

  const previewUnknownRequest = capturedRequests.get(
    "/people/not-in-this-family",
  )!;
  const previewUnknownResponse = await request.get(
    `${previewURL}/people/not-in-this-family${previewUnknownRequest.search}`,
    { headers: previewUnknownRequest.headers },
  );
  expect(previewUnknownResponse.status()).toBe(200);
  expect(previewUnknownResponse.headers()["content-type"]).toContain(
    "text/x-component",
  );
  expect(previewUnknownResponse.headers()["cache-control"]).toContain(
    "private",
  );
  expect(previewUnknownResponse.headers()["cache-control"]).toContain(
    "no-store",
  );
  expect(previewUnknownResponse.headers()["x-robots-tag"]).toContain("noindex");
  const previewUnknownBody = await previewUnknownResponse.text();
  expect(previewUnknownBody).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
  for (const value of fixtureText)
    expect(previewUnknownBody).not.toContain(value);

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
