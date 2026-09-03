import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./test";

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "CSP header and enforcement behavior is engine-independent and runs once in Chromium.",
);

const lockedURL = "http://127.0.0.1:3101";

function nonceFrom(policy: string) {
  const nonce = policy.match(/'nonce-([^']+)'/u)?.[1];
  expect(nonce).toMatch(/^[A-Za-z0-9+/_=-]{22,128}$/u);
  return nonce!;
}

test("private HTML receives fresh strict nonces and baseline headers", async ({
  request,
}) => {
  const first = await request.get(`${lockedURL}/sign-in`);
  const second = await request.get(`${lockedURL}/sign-in`);
  const firstPolicy = first.headers()["content-security-policy"] ?? "";
  const secondPolicy = second.headers()["content-security-policy"] ?? "";
  const firstNonce = nonceFrom(firstPolicy);
  const secondNonce = nonceFrom(secondPolicy);

  expect(firstNonce).not.toBe(secondNonce);
  expect(firstPolicy).toContain("script-src-attr 'none'");
  expect(firstPolicy).toContain("style-src-attr 'none'");
  expect(firstPolicy).toContain("frame-ancestors 'none'");
  expect(firstPolicy).toContain("object-src 'none'");
  expect(firstPolicy).toContain("base-uri 'none'");
  expect(firstPolicy).not.toContain("upgrade-insecure-requests");
  expect(firstPolicy).not.toContain("'unsafe-inline'");
  expect(firstPolicy).not.toContain("'unsafe-eval'");
  expect(first.headers()["x-nonce"]).toBeUndefined();
  expect(first.headers()["cache-control"]).toContain("private");
  expect(first.headers()["cache-control"]).toContain("no-store");
  expect(first.headers()["x-content-type-options"]).toBe("nosniff");
  expect(first.headers()["x-frame-options"]).toBe("DENY");
  expect(first.headers()["referrer-policy"]).toBe("no-referrer");
  expect(first.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(first.headers()["cross-origin-resource-policy"]).toBe("same-origin");
  expect(first.headers()["permissions-policy"]).toBe(
    "camera=(self), microphone=(), geolocation=(self)",
  );

  const html = await first.text();
  expect(html).toContain(`name="csp-nonce"`);
  expect(html).toContain(`content="${firstNonce}"`);
  const dynamicStyle = html.match(
    /<style\b[^>]*id="our-days-dynamic-css"[^>]*>/u,
  )?.[0];
  expect(dynamicStyle).toContain(`nonce="${firstNonce}"`);
  const scriptTags = html.match(/<script\b[^>]*>/gu) ?? [];
  expect(scriptTags.length).toBeGreaterThan(0);
  for (const tag of scriptTags) expect(tag).toContain(`nonce="${firstNonce}"`);

  const redirect = await request.get(`${lockedURL}/family`, {
    maxRedirects: 0,
  });
  expect([307, 308]).toContain(redirect.status());
  expect(redirect.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );

  const publicWorker = await request.get(`${lockedURL}/sw.js`);
  expect(publicWorker.status()).toBe(200);
  expect(publicWorker.headers()["content-security-policy"]).toBeUndefined();
  expect(publicWorker.headers()["x-content-type-options"]).toBe("nosniff");
});

test("the production policy blocks an injected inline event handler", async ({
  page,
  expectedConsoleErrors,
}) => {
  await page.goto("/family");
  expectedConsoleErrors.push("Content Security Policy");

  const executed = await page.evaluate(async () => {
    const state = window as typeof window & { __ourDaysCspProbe?: boolean };
    delete state.__ourDaysCspProbe;
    const image = document.createElement("img");
    image.setAttribute(
      "src",
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    );
    image.setAttribute("onload", "window.__ourDaysCspProbe = true");
    document.body.append(image);
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    return state.__ourDaysCspProbe === true;
  });

  expect(executed).toBe(false);
});

test("timeline, memories, and composer render without application style attributes", async ({
  page,
}) => {
  for (const path of ["/family", "/memories"]) {
    await page.goto(path);
    const image = page.locator('img[alt]:not([alt=""])').first();
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("srcset", /\/_next\/image\?/u);
    await expect(image).toHaveAttribute("width", "1200");
    await expect(image).toHaveAttribute("height", "801");
    const crop = await image.evaluate((element) => {
      const imageRect = element.getBoundingClientRect();
      const frameRect = element.parentElement?.getBoundingClientRect();
      return {
        objectFit: getComputedStyle(element).objectFit,
        fillsFrame:
          Boolean(frameRect) &&
          Math.abs(imageRect.width - frameRect!.width) < 0.5 &&
          Math.abs(imageRect.height - frameRect!.height) < 0.5,
      };
    });
    expect(crop).toEqual({ objectFit: "cover", fillsFrame: true });
    if (path === "/family") {
      await expect(image).toHaveAttribute("loading", "eager");
      await expect(image).toHaveAttribute("fetchpriority", "high");
      await expect(image).toHaveAttribute(
        "sizes",
        "(max-width: 520px) 92vw, 410px",
      );
    } else {
      await expect(image).toHaveAttribute("loading", "lazy");
      await expect(image).toHaveAttribute("sizes", "360px");
    }
    const applicationStyles = await page
      .locator("[style]")
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const root = element.getRootNode();
            return !(
              element.closest("next-route-announcer") ||
              (root instanceof ShadowRoot &&
                root.host.matches("next-route-announcer"))
            );
          })
          .map((element) => ({
            tag: element.tagName,
            value: element.getAttribute("style"),
          })),
      );
    expect(applicationStyles).toEqual([]);
  }

  await page.goto("/family");
  await page.getByRole("button", { name: "Add moment" }).click();
  await page.getByRole("button", { name: /^Photo/u }).click();
  await page
    .getByLabel(/Choose photo/u)
    .setInputFiles("public/sample-family.jpg");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByAltText("Selected photo preview")).toBeVisible();
  await expect(page.getByAltText("Selected photo preview")).toHaveAttribute(
    "src",
    /^blob:/u,
  );
  const applicationStyles = await page
    .locator("[style]")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const root = element.getRootNode();
          return !(
            element.closest("next-route-announcer") ||
            (root instanceof ShadowRoot &&
              root.host.matches("next-route-announcer"))
          );
        })
        .map((element) => ({
          tag: element.tagName,
          value: element.getAttribute("style"),
        })),
    );
  expect(applicationStyles).toEqual([]);
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
});

test("ordinary and public-prefix near-miss 404s keep the enforced policy", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push(
    "Failed to load resource: the server responded with a status of 404",
  );
  for (const path of [
    "/not-a-family-route",
    "/sw.js-anything",
    "/_next/image-evil",
    "/_next/static",
    "/_next/image/evil",
    "/favicon.ico",
  ]) {
    const response = await page.goto(path);

    expect(response?.status()).toBe(404);
    expect(response?.headers()["content-security-policy"]).toContain(
      "style-src-attr 'none'",
    );
    await expect(
      page.getByRole("heading", { name: "That page isn’t here." }),
    ).toBeVisible();
  }
});

test("an unhandled route error uses the CSP-compatible global boundary", async ({
  page,
  expectedConsoleErrors,
}) => {
  expectedConsoleErrors.push(
    "Failed to load resource: the server responded with a status of 500",
  );
  expectedConsoleErrors.push("Minified React error #441");
  const response = await page.goto("/quality/global-error");

  expect(response?.status()).toBe(500);
  expect(response?.headers()["cache-control"]).toContain("private");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["content-security-policy"]).toContain(
    "style-src-attr 'none'",
  );
  await expect(
    page.getByRole("heading", { name: "We couldn’t open Our Days." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  const applicationStyles = await page.locator("[style]").count();
  expect(applicationStyles).toBe(0);
  await expect(page.locator("body")).toHaveCSS("display", "grid");

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  const retry = page.getByRole("button", { name: "Try again" });
  await page.keyboard.press("Tab");
  await expect(retry).toBeFocused();
  await retry.click();
  await expect(
    page.getByRole("heading", { name: "We couldn’t open Our Days." }),
  ).toBeVisible();
});
