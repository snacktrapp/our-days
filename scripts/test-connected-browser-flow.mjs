import { createHmac, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const supabaseBinary = fileURLToPath(
  new URL("../node_modules/.bin/supabase", import.meta.url),
);
const nextBinary = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);
const appUrl = "http://127.0.0.1:3100";
const fixtureCanaries = [
  "All our days",
  "Avery",
  "Brian",
  "June",
  "Molly",
  "Sam",
  "Sand Harbor",
  "sample-family.jpg",
];

function readLocalStatus() {
  const output = execFileSync(supabaseBinary, ["status", "-o", "env"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (output.trimStart().startsWith("{")) return JSON.parse(output);
  return Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createLocalUserToken(userId, jwtSecret) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    aud: "authenticated",
    exp: issuedAt + 3600,
    iat: issuedAt,
    iss: "supabase-demo",
    role: "authenticated",
    sub: userId,
  });
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function jsonRequest(url, apiKey, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: apiKey,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { body, response };
}

async function findOtp(mailpitUrl, recipient) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const list = await (await fetch(`${mailpitUrl}/api/v1/messages`)).json();
    for (const message of list.messages ?? list.Messages ?? []) {
      const recipients = message.To ?? message.to ?? [];
      const addresses = recipients.map((entry) =>
        typeof entry === "string" ? entry : (entry.Address ?? entry.address),
      );
      if (!addresses.includes(recipient)) continue;

      const messageId = message.ID ?? message.Id ?? message.id;
      const detail = await (
        await fetch(`${mailpitUrl}/api/v1/message/${messageId}`)
      ).json();
      const content = [detail.Text, detail.HTML, detail.Raw]
        .filter((value) => typeof value === "string")
        .join("\n");
      const code = content.match(/\b\d{6}\b/u)?.[0];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The browser-flow OTP did not arrive in Mailpit.");
}

async function recipientMessageCount(mailpitUrl, recipient) {
  const list = await (await fetch(`${mailpitUrl}/api/v1/messages`)).json();
  return (list.messages ?? list.Messages ?? []).filter((message) => {
    const recipients = message.To ?? message.to ?? [];
    return recipients.some((entry) => {
      const address =
        typeof entry === "string" ? entry : (entry.Address ?? entry.address);
      return address === recipient;
    });
  }).length;
}

async function waitForServer(server, readServerLog) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(
        `The connected Next.js server exited with ${server.exitCode}. ${readServerLog()}`,
      );
    }
    try {
      const response = await fetch(`${appUrl}/sign-in`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The connected Next.js server did not become ready.");
}

async function assertPageQuality(page, label) {
  const accessibility = await new AxeBuilder({ page }).analyze();
  const seriousViolations = accessibility.violations.filter((violation) =>
    ["critical", "serious"].includes(violation.impact),
  );
  if (seriousViolations.length > 0) {
    throw new Error(
      `${label} has serious accessibility violations: ${seriousViolations
        .map((violation) => violation.id)
        .join(", ")}.`,
    );
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (hasHorizontalOverflow) {
    throw new Error(`${label} overflows the mobile viewport horizontally.`);
  }
}

async function assertNoCanaries(page, canaries, label) {
  const content = await page.content();
  for (const canary of canaries) {
    if (content.includes(canary)) {
      throw new Error(`${label} exposed a private canary.`);
    }
  }
}

function assertPrivateResponse(response, label) {
  if (!response)
    throw new Error(`${label} did not return a document response.`);
  const headers = response.headers();
  const cacheControl = headers["cache-control"] ?? "";
  if (!cacheControl.includes("private") || !cacheControl.includes("no-store")) {
    throw new Error(`${label} did not preserve private, no-store caching.`);
  }
  if (!(headers["x-robots-tag"] ?? "").includes("noindex")) {
    throw new Error(`${label} did not preserve the private crawler boundary.`);
  }
  if (
    !(headers["content-security-policy"] ?? "").includes(
      "frame-ancestors 'none'",
    )
  ) {
    throw new Error(`${label} did not preserve the nonce CSP boundary.`);
  }
}

function authCookies(cookies) {
  return cookies.filter(
    ({ name }) => name.startsWith("sb-") && name.includes("auth-token"),
  );
}

function invitationIntentCookies(cookies) {
  return cookies.filter(({ name }) => name === "our-days-invitation-intent");
}

function attachPrivateLeakMonitor(page, evidence, responseReads) {
  page.on("request", (request) => {
    const headers = request.headers();
    evidence.push(request.url(), headers.referer ?? "");
  });
  page.on("response", (response) => {
    const contentType = response.headers()["content-type"] ?? "";
    if (!/(?:text|json|javascript|x-component)/iu.test(contentType)) return;
    responseReads.push(
      Promise.race([
        response
          .text()
          .then((body) => evidence.push(body))
          .catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]),
    );
  });
}

async function browserPrivateState(page) {
  return page.evaluate(async () => ({
    cacheNames: "caches" in window ? await window.caches.keys() : [],
    cookie: document.cookie,
    databaseNames:
      "indexedDB" in window && typeof window.indexedDB.databases === "function"
        ? (await window.indexedDB.databases()).map(({ name }) => name ?? "")
        : [],
    dom: document.documentElement.outerHTML,
    historyState: JSON.stringify(window.history.state),
    localStorage: { ...window.localStorage },
    sessionStorage: { ...window.sessionStorage },
    url: window.location.href,
  }));
}

function assertEvidenceExcludes(evidence, canaries, label) {
  const serialized = JSON.stringify(evidence);
  for (const canary of canaries) {
    if (serialized.includes(canary)) {
      throw new Error(`${label} retained a private canary.`);
    }
  }
}

async function assertCrossOriginActionRejected({
  actionRequest,
  canaries,
  mailpitUrl,
  recipient,
}) {
  const requestHeaders = await actionRequest.allHeaders();
  const requestBody = actionRequest.postDataBuffer();
  if (!requestBody || !requestHeaders["next-action"]) {
    throw new Error(
      "The invitation code request did not use the expected Server Action wire format.",
    );
  }

  const replayHeaders = { origin: "https://cross-origin.invalid" };
  for (const name of [
    "accept",
    "content-type",
    "cookie",
    "next-action",
    "next-router-state-tree",
  ]) {
    if (requestHeaders[name]) replayHeaders[name] = requestHeaders[name];
  }

  const messagesBefore = await recipientMessageCount(mailpitUrl, recipient);
  const response = await fetch(actionRequest.url(), {
    body: requestBody,
    headers: replayHeaders,
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const responseBody = await response.text();
  const explicitlyDenied =
    !response.ok ||
    responseBody.includes("This invitation is unavailable.") ||
    responseBody.includes('"status":"denied"');
  if (!explicitlyDenied) {
    throw new Error("A cross-origin Server Action wire replay was not denied.");
  }
  for (const canary of canaries) {
    if (responseBody.includes(canary)) {
      throw new Error(
        "The cross-origin Server Action response exposed a private canary.",
      );
    }
  }
  const messagesAfter = await recipientMessageCount(mailpitUrl, recipient);
  if (messagesAfter !== messagesBefore) {
    throw new Error(
      "A rejected cross-origin Server Action replay generated an email.",
    );
  }
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;

  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  let timeout;
  await Promise.race([
    exited,
    new Promise((resolve) => {
      timeout = setTimeout(resolve, 5_000);
      timeout.unref();
    }),
  ]);
  if (timeout) clearTimeout(timeout);

  if (server.exitCode === null) {
    const killed = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGKILL");
    await killed;
  }
}

function resetDatabase() {
  execFileSync(supabaseBinary, ["db", "reset", "--local"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const status = readLocalStatus();
const apiUrl = status.API_URL;
const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
const jwtSecret = status.JWT_SECRET;
const mailpitUrl = status.MAILPIT_URL ?? status.INBUCKET_URL;

if (
  !apiUrl ||
  !anonKey ||
  !publishableKey ||
  !serviceKey ||
  !jwtSecret ||
  !mailpitUrl
) {
  throw new Error("Local Supabase status omitted a browser integration value.");
}

const connectedEnvironment = {
  ...process.env,
  NEXT_PUBLIC_SITE_URL: appUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  NEXT_PUBLIC_SUPABASE_URL: apiUrl,
  OUR_DAYS_ENVIRONMENT: "local",
  OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: "local",
  OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS: "zzzzzzzzzzzzzzzzzzzz",
  OUR_DAYS_RESOURCE_MODE: "supabase",
};
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error(
    "The connected browser flow must run through the pinned npm script.",
  );
}
if (process.env.OUR_DAYS_CONNECTED_REUSE_BUILD !== "1") {
  execFileSync(process.execPath, [npmCli, "run", "build:webpack"], {
    cwd: projectRoot,
    env: connectedEnvironment,
    stdio: "inherit",
  });
}

const server = spawn(
  process.execPath,
  [nextBinary, "start", "-H", "127.0.0.1", "-p", "3100"],
  {
    cwd: projectRoot,
    env: connectedEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
const serverCanaries = [];
let serverLoggedCanary = false;
const appendServerLog = (chunk) => {
  const text = chunk.toString();
  serverLog = `${serverLog}${text}`.slice(-3000);
  if (serverCanaries.some((canary) => text.includes(canary))) {
    serverLoggedCanary = true;
  }
};
server.stdout.on("data", appendServerLog);
server.stderr.on("data", appendServerLog);

let browser;
let shouldRestoreFixtures = false;

try {
  await waitForServer(server, () => serverLog);
  shouldRestoreFixtures = true;

  const suffix = randomUUID();
  const email = `browser-invite-${suffix}@example.test`;
  const adminHeaders = { authorization: `Bearer ${serviceKey}` };
  const createdUser = await jsonRequest(
    `${apiUrl}/auth/v1/admin/users`,
    serviceKey,
    {
      body: JSON.stringify({ email, email_confirm: true }),
      headers: adminHeaders,
      method: "POST",
    },
  );
  if (!createdUser.response.ok) {
    throw new Error(
      `Browser test provisioning failed (${createdUser.response.status}).`,
    );
  }

  const organizerToken = createLocalUserToken(
    "10000000-0000-4000-8000-000000000001",
    jwtSecret,
  );
  const invitation = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/create_invitation`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: "20000000-0000-4000-8000-000000000001",
        display_name: "Browser Invite",
        email,
      }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  const invitationToken = invitation.body?.[0]?.raw_token;
  if (!invitation.response.ok || !invitationToken) {
    throw new Error(
      `Browser test invitation failed (${invitation.response.status}).`,
    );
  }
  serverCanaries.push(email, invitationToken);

  browser = await chromium.launch({ headless: true });
  const invitedContext = await browser.newContext({
    viewport: { height: 844, width: 390 },
  });
  const invitedPage = await invitedContext.newPage();
  const browserErrors = [];
  const networkEvidence = [];
  const responseReads = [];
  attachPrivateLeakMonitor(invitedPage, networkEvidence, responseReads);
  invitedPage.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  invitedPage.on("pageerror", (error) => browserErrors.push(error.message));
  const invitationResponse = await invitedPage.goto(
    `${appUrl}/invite#${invitationToken}`,
  );
  await invitedPage.getByLabel("Email address").waitFor();
  assertPrivateResponse(invitationResponse, "Invitation entry");
  await invitedPage.waitForFunction(() => window.location.hash === "");
  await assertPageQuality(invitedPage, "Invitation entry");
  await assertNoCanaries(
    invitedPage,
    [...fixtureCanaries, invitationToken],
    "Invitation entry",
  );

  const stagedIntentCookies = invitationIntentCookies(
    await invitedContext.cookies(),
  );
  if (
    stagedIntentCookies.length !== 1 ||
    !stagedIntentCookies[0].httpOnly ||
    !stagedIntentCookies[0].secure ||
    stagedIntentCookies[0].sameSite !== "Strict" ||
    stagedIntentCookies[0].path !== "/invite"
  ) {
    throw new Error(
      "The staged invitation did not use the expected scoped HttpOnly cookie.",
    );
  }

  await invitedPage.getByLabel("Email address").fill(email);
  const actionRequestPromise = invitedPage.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === "POST" && url.pathname === "/invite";
  });
  await invitedPage.getByRole("button", { name: "Email me a code" }).click();
  const actionRequest = await actionRequestPromise;
  await invitedPage.getByLabel("Six-digit code").waitFor();
  const firstOtp = await findOtp(mailpitUrl, email);
  await assertCrossOriginActionRejected({
    actionRequest,
    canaries: [...fixtureCanaries, email, invitationToken, firstOtp],
    mailpitUrl,
    recipient: email,
  });

  const reloadedInvitationResponse = await invitedPage.reload();
  assertPrivateResponse(reloadedInvitationResponse, "Reloaded invitation");
  await invitedPage.getByLabel("Email address").waitFor();
  if (new URL(invitedPage.url()).hash) {
    throw new Error(
      "The invitation secret returned to the visible URL after reload.",
    );
  }
  await assertNoCanaries(
    invitedPage,
    [...fixtureCanaries, invitationToken, firstOtp],
    "Reloaded invitation",
  );
  if (invitationIntentCookies(await invitedContext.cookies()).length !== 1) {
    throw new Error("Reloading the code step lost the staged invitation.");
  }

  await invitedPage.getByLabel("Email address").fill(email);
  await invitedPage.getByRole("button", { name: "Email me a code" }).click();
  await invitedPage.getByLabel("Six-digit code").waitFor();
  const otp = await findOtp(mailpitUrl, email);
  serverCanaries.push(otp);
  await invitedPage.getByLabel("Six-digit code").fill(otp);
  await invitedPage
    .getByRole("button", { name: "Join family journal" })
    .click();
  await invitedPage.waitForURL(`${appUrl}/access-unavailable`);
  await invitedPage.locator("main").waitFor();
  await assertPageQuality(invitedPage, "Authenticated preparation state");
  await assertNoCanaries(
    invitedPage,
    [...fixtureCanaries, email, invitationToken, otp],
    "Authenticated preparation state",
  );
  if (authCookies(await invitedContext.cookies()).length === 0) {
    throw new Error("Invitation acceptance did not establish an Auth cookie.");
  }
  if (invitationIntentCookies(await invitedContext.cookies()).length > 0) {
    throw new Error(
      "Invitation acceptance left the staged invitation cookie behind.",
    );
  }
  await invitedPage.setViewportSize({ height: 350, width: 320 });
  await assertPageQuality(invitedPage, "Short authenticated preparation state");
  await invitedPage.setViewportSize({ height: 844, width: 390 });

  const firstAccountCookie = authCookies(await invitedContext.cookies())
    .map(({ value }) => value)
    .join("");
  const retainedAccountContext = await browser.newContext({
    storageState: await invitedContext.storageState(),
    viewport: { height: 844, width: 390 },
  });
  const retainedAccountPage = await retainedAccountContext.newPage();
  await retainedAccountPage.goto(`${appUrl}/family`);
  await retainedAccountPage.waitForURL(`${appUrl}/access-unavailable`);

  const switchedEmail = `browser-switch-${suffix}@example.test`;
  const switchedUser = await jsonRequest(
    `${apiUrl}/auth/v1/admin/users`,
    serviceKey,
    {
      body: JSON.stringify({ email: switchedEmail, email_confirm: true }),
      headers: adminHeaders,
      method: "POST",
    },
  );
  if (!switchedUser.response.ok) throw new Error("Switch user setup failed.");
  const switchedInvitation = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/create_invitation`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: "20000000-0000-4000-8000-000000000001",
        display_name: "Browser Account Switch",
        email: switchedEmail,
      }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  const switchedToken = switchedInvitation.body?.[0]?.raw_token;
  if (!switchedInvitation.response.ok || !switchedToken) {
    throw new Error("Switch invitation setup failed.");
  }
  serverCanaries.push(switchedEmail, switchedToken);
  await invitedPage.evaluate(async () => {
    window.localStorage.setItem("our-days:account-a-canary", "account-a");
    window.sessionStorage.setItem("our_days:account-a-canary", "account-a");
    if ("caches" in window) await window.caches.open("our-days:account-a");
    if ("indexedDB" in window) {
      await new Promise((resolve, reject) => {
        const request = window.indexedDB.open("our-days:drafts", 1);
        request.addEventListener(
          "success",
          () => {
            request.result.close();
            resolve();
          },
          { once: true },
        );
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
    }
  });
  await invitedPage.goto(`${appUrl}/invite#${switchedToken}`);
  await invitedPage.getByLabel("Email address").fill(switchedEmail);
  await invitedPage.getByRole("button", { name: "Email me a code" }).click();
  const switchedCodeInput = invitedPage.getByLabel("Six-digit code");
  await switchedCodeInput.fill(await findOtp(mailpitUrl, switchedEmail));
  const switchedOtp = await switchedCodeInput.inputValue();
  serverCanaries.push(switchedOtp);
  const switchedBrowserState = await browserPrivateState(invitedPage);
  assertEvidenceExcludes(
    switchedBrowserState,
    ["account-a", "our-days:account-a-canary", "our-days:account-a"],
    "Account-switch browser state",
  );
  await invitedPage
    .getByRole("button", { name: "Join family journal" })
    .click();
  await invitedPage.waitForURL(`${appUrl}/access-unavailable`);
  const switchedAccountCookie = authCookies(await invitedContext.cookies())
    .map(({ value }) => value)
    .join("");
  if (!switchedAccountCookie || switchedAccountCookie === firstAccountCookie) {
    throw new Error("Account switching did not replace the Auth session.");
  }
  if (authCookies(await retainedAccountContext.cookies()).length === 0) {
    throw new Error("The isolated first-account browser lost its own session.");
  }
  const acceptedPrivateCanaries = [
    ...fixtureCanaries,
    email,
    invitationToken,
    otp,
    switchedEmail,
    switchedToken,
    switchedOtp,
  ];
  const acceptedSecretCanaries = [
    ...fixtureCanaries,
    invitationToken,
    otp,
    switchedToken,
    switchedOtp,
  ];

  const unrelatedContext = await browser.newContext({
    viewport: { height: 844, width: 390 },
  });
  const unrelatedPage = await unrelatedContext.newPage();
  unrelatedPage.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  unrelatedPage.on("pageerror", (error) => browserErrors.push(error.message));
  const directUnavailableResponse = await unrelatedPage.goto(
    `${appUrl}/access-unavailable`,
  );
  await unrelatedPage.waitForURL(`${appUrl}/sign-in`);
  assertPrivateResponse(
    directUnavailableResponse,
    "Anonymous access-unavailable response",
  );
  await assertNoCanaries(
    unrelatedPage,
    acceptedPrivateCanaries,
    "Anonymous access-unavailable response",
  );

  const unrelatedResponse = await unrelatedPage.goto(`${appUrl}/family`);
  await unrelatedPage.waitForURL(`${appUrl}/sign-in`);
  await unrelatedPage
    .getByRole("heading", { name: "Open your family journal." })
    .waitFor();
  assertPrivateResponse(unrelatedResponse, "Unrelated family request");
  await assertNoCanaries(
    unrelatedPage,
    acceptedPrivateCanaries,
    "Unrelated browser",
  );
  if (authCookies(await unrelatedContext.cookies()).length > 0) {
    throw new Error("The unrelated browser received an Auth cookie.");
  }

  await invitedPage.goto(`${appUrl}/family`);
  await invitedPage.waitForURL(`${appUrl}/access-unavailable`);
  await invitedPage.evaluate(async () => {
    window.localStorage.setItem("our-days:browser-test-private", "remove-me");
    window.localStorage.setItem("proof:browser-test-unrelated", "keep-me");
    window.sessionStorage.setItem("our_days:selected-circle", "remove-me");
    window.sessionStorage.setItem("unrelated", "keep-me");
    if ("caches" in window) {
      await window.caches.open("our-days:browser-test-private");
      await window.caches.open("proof:browser-test-unrelated");
    }
    if ("indexedDB" in window) {
      await new Promise((resolve, reject) => {
        const request = window.indexedDB.open("our-days:drafts", 1);
        request.addEventListener(
          "success",
          () => {
            request.result.close();
            resolve();
          },
          { once: true },
        );
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
    }
  });
  await invitedPage
    .getByRole("button", { name: "Sign out and use another email" })
    .click();
  await invitedPage.waitForURL(`${appUrl}/sign-in`);
  if (authCookies(await invitedContext.cookies()).length > 0) {
    throw new Error(
      "Local sign-out left an Auth cookie in the invited browser.",
    );
  }
  const signedOutState = await browserPrivateState(invitedPage);
  if (
    "our-days:browser-test-private" in signedOutState.localStorage ||
    "our_days:selected-circle" in signedOutState.sessionStorage ||
    signedOutState.cacheNames.includes("our-days:browser-test-private") ||
    signedOutState.databaseNames.includes("our-days:drafts")
  ) {
    throw new Error("Local sign-out retained account-scoped browser state.");
  }
  if (
    signedOutState.localStorage["proof:browser-test-unrelated"] !== "keep-me" ||
    signedOutState.sessionStorage.unrelated !== "keep-me" ||
    !signedOutState.cacheNames.includes("proof:browser-test-unrelated")
  ) {
    throw new Error("Local sign-out removed unrelated browser state.");
  }
  await assertNoCanaries(
    invitedPage,
    acceptedPrivateCanaries,
    "Signed-out entry",
  );

  await invitedPage.goBack();
  await invitedPage.waitForURL(`${appUrl}/sign-in`);
  await assertNoCanaries(
    invitedPage,
    acceptedPrivateCanaries,
    "Signed-out browser history",
  );

  await Promise.allSettled(responseReads);
  assertEvidenceExcludes(
    networkEvidence,
    acceptedSecretCanaries,
    "Connected request/response evidence",
  );
  assertEvidenceExcludes(
    await browserPrivateState(invitedPage),
    acceptedPrivateCanaries,
    "Signed-out browser state",
  );
  await invitedPage.goto(`${appUrl}/family`);
  await invitedPage.waitForURL(`${appUrl}/sign-in`);
  await assertNoCanaries(
    invitedPage,
    acceptedPrivateCanaries,
    "Signed-out protected route",
  );

  const rejectedEmail = `browser-rejected-${suffix}@example.test`;
  const rejectedUser = await jsonRequest(
    `${apiUrl}/auth/v1/admin/users`,
    serviceKey,
    {
      body: JSON.stringify({ email: rejectedEmail, email_confirm: true }),
      headers: adminHeaders,
      method: "POST",
    },
  );
  if (!rejectedUser.response.ok) {
    throw new Error("Rejected-invitation user provisioning failed.");
  }
  const rejectedInvitation = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/create_invitation`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: "20000000-0000-4000-8000-000000000001",
        display_name: "Rejected Browser Invite",
        email: rejectedEmail,
      }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  const rejectedToken = rejectedInvitation.body?.[0]?.raw_token;
  const rejectedInvitationId = rejectedInvitation.body?.[0]?.invitation_id;
  if (
    !rejectedInvitation.response.ok ||
    !rejectedToken ||
    !rejectedInvitationId
  ) {
    throw new Error("Rejected-invitation setup failed.");
  }

  const rejectedContext = await browser.newContext({
    viewport: { height: 350, width: 320 },
  });
  const rejectedPage = await rejectedContext.newPage();
  const rejectedEvidence = [];
  const rejectedResponseReads = [];
  attachPrivateLeakMonitor(
    rejectedPage,
    rejectedEvidence,
    rejectedResponseReads,
  );
  rejectedPage.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  rejectedPage.on("pageerror", (error) => browserErrors.push(error.message));
  await rejectedPage.goto(`${appUrl}/invite#${rejectedToken}`);
  await rejectedPage.getByLabel("Email address").fill(rejectedEmail);
  await rejectedPage.getByRole("button", { name: "Email me a code" }).click();
  const rejectedCodeInput = rejectedPage.getByLabel("Six-digit code");
  await rejectedCodeInput.waitFor();
  if (
    !(await rejectedCodeInput.evaluate(
      (element) => element === document.activeElement,
    ))
  ) {
    throw new Error(
      "The short-screen invitation code input did not receive focus.",
    );
  }
  const rejectedOtp = await findOtp(mailpitUrl, rejectedEmail);
  const revoked = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/revoke_invitation`,
    anonKey,
    {
      body: JSON.stringify({ invitation_id: rejectedInvitationId }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  if (!revoked.response.ok) {
    throw new Error(
      "The browser failure-path invitation could not be revoked.",
    );
  }
  await rejectedCodeInput.fill(rejectedOtp);
  await rejectedPage
    .getByRole("button", { name: "Join family journal" })
    .click();
  const rejectionState = await Promise.race([
    rejectedPage
      .getByText("This invitation or code is no longer available.")
      .waitFor()
      .then(() => "denied"),
    rejectedPage
      .getByText("This invitation link is incomplete.", { exact: false })
      .waitFor()
      .then(() => "incomplete"),
    rejectedPage
      .getByText("Our Days is temporarily unavailable.")
      .waitFor()
      .then(() => "temporary"),
    rejectedPage
      .getByText("clear this site's browser data", { exact: false })
      .waitFor()
      .then(() => "safety"),
    rejectedPage
      .waitForURL(`${appUrl}/access-unavailable`)
      .then(() => "accepted"),
  ]);
  if (!["denied", "incomplete"].includes(rejectionState)) {
    throw new Error(
      `Revoked invitation reached an unexpected terminal state: ${rejectionState}.`,
    );
  }
  if (
    authCookies(await rejectedContext.cookies()).length > 0 ||
    invitationIntentCookies(await rejectedContext.cookies()).length > 0
  ) {
    throw new Error(
      "Rejected invitation acceptance retained a session or intent.",
    );
  }
  const switchEmailLink = rejectedPage.getByRole("link", {
    name: "Use a different email",
  });
  if (await switchEmailLink.isVisible()) await switchEmailLink.click();
  await rejectedPage
    .getByText("This invitation link is incomplete.", { exact: false })
    .waitFor();
  await rejectedPage
    .getByRole("link", { name: "Sign in as a returning member" })
    .waitFor();
  await rejectedPage.goto(`${appUrl}/family`);
  await rejectedPage.waitForURL(`${appUrl}/sign-in`);
  await Promise.allSettled(rejectedResponseReads);
  assertEvidenceExcludes(
    rejectedEvidence,
    [...fixtureCanaries, rejectedToken, rejectedOtp],
    "Rejected invitation request/response evidence",
  );
  await rejectedContext.close();

  if (browserErrors.length > 0) {
    throw new Error(
      `Connected browser console errors: ${browserErrors.join(" | ")}`,
    );
  }
  if (serverLoggedCanary) {
    throw new Error("The connected production server logged a private canary.");
  }

  await unrelatedContext.close();
  await retainedAccountContext.close();
  await invitedContext.close();
  process.stdout.write(
    "Connected staged invite, OTP, cross-origin denial, A-to-B account isolation, revoked-invite recovery, browser cleanup, membership gate, and local sign-out passed in Chromium.\n",
  );
} finally {
  if (browser) await browser.close();
  await stopServer(server);
  if (shouldRestoreFixtures) resetDatabase();
}
