import { createHmac, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, firefox, webkit } from "@playwright/test";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const supabaseBinary = fileURLToPath(
  new URL("../node_modules/.bin/supabase", import.meta.url),
);
const nextBinary = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);
const appUrl = "http://127.0.0.1:3100";
const connectedBrowserName =
  process.env.OUR_DAYS_CONNECTED_BROWSER ?? "chromium";
const connectedBrowserType = { chromium, firefox, webkit }[
  connectedBrowserName
];
if (!connectedBrowserType) {
  throw new Error(`Unsupported connected browser: ${connectedBrowserName}`);
}
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

function plainDateInTimeZone(timeZone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const read = (type) => parts.find((part) => part.type === type)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
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

async function readStableDocument(page, read) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes("Execution context was destroyed") &&
        !message.includes("page is navigating")
      ) {
        throw error;
      }
      await page.waitForTimeout(100);
    }
  }
  throw lastError;
}

async function assertNoCanaries(page, canaries, label) {
  const content = await readStableDocument(page, () => page.content());
  for (const canary of canaries) {
    if (content.includes(canary)) {
      throw new Error(`${label} exposed a private canary.`);
    }
  }
}

async function traverseHistoryBy(page, delta) {
  try {
    await page.evaluate((distance) => window.history.go(distance), delta);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("Execution context was destroyed")
    ) {
      throw error;
    }
  }
  await page.waitForTimeout(750);
  await page.waitForLoadState("networkidle").catch(() => undefined);
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
  return readStableDocument(page, () =>
    page.evaluate(async () => {
      let cacheNames = [];
      let cookie = "";
      let databaseNames = [];
      let localStorage = {};
      let sessionStorage = {};
      try {
        if ("caches" in window) cacheNames = await window.caches.keys();
      } catch {}
      try {
        cookie = document.cookie;
      } catch {}
      try {
        if (
          "indexedDB" in window &&
          typeof window.indexedDB.databases === "function"
        ) {
          databaseNames = (await window.indexedDB.databases()).map(
            ({ name }) => name ?? "",
          );
        }
      } catch {}
      try {
        localStorage = { ...window.localStorage };
      } catch {}
      try {
        sessionStorage = { ...window.sessionStorage };
      } catch {}
      return {
        cacheNames,
        cookie,
        databaseNames,
        dom: document.documentElement.outerHTML,
        historyState: JSON.stringify(window.history.state),
        localStorage,
        sessionStorage,
        url: window.location.href,
      };
    }),
  );
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
  const circleTimeZone = "America/Los_Angeles";
  const circleToday = plainDateInTimeZone(circleTimeZone);
  const circleAnniversary = circleToday.slice(5);
  const anniversaryYear =
    circleAnniversary === "02-29" ? 2024 : Number(circleToday.slice(0, 4)) - 4;
  const anniversaryOccurredOn = `${anniversaryYear}-${circleAnniversary}`;
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
  const harborOrganizerToken = createLocalUserToken(
    "10000000-0000-4000-8000-000000000006",
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

  browser = await connectedBrowserType.launch({ headless: true });
  const invitedContext = await browser.newContext({
    timezoneId: "Pacific/Kiritimati",
    viewport: { height: 844, width: 390 },
  });
  const invitedPage = await invitedContext.newPage();
  invitedPage.setDefaultTimeout(10_000);
  invitedPage.setDefaultNavigationTimeout(15_000);
  const browserErrors = [];
  const consoleErrorReads = [];
  let browserPhase = "invitation entry";
  const recordConsoleError = (message) => {
    if (message.type() !== "error") return;
    consoleErrorReads.push(
      Promise.all(
        message.args().map(async (argument) => {
          try {
            return await argument.evaluate((value) => {
              if (typeof value === "string") return value;
              const details = {
                json: (() => {
                  try {
                    return JSON.stringify(value);
                  } catch {
                    return undefined;
                  }
                })(),
                message: value?.message,
                name: value?.name,
                stack: value?.stack,
                string: String(value),
              };
              return JSON.stringify(details);
            });
          } catch {
            return argument.toString();
          }
        }),
      ).then((values) => {
        const location = message.location();
        browserErrors.push(
          `${browserPhase}: ${values.join(" ") || message.text()} @ ${location.url}:${location.lineNumber}`,
        );
      }),
    );
  };
  const networkEvidence = [];
  const responseReads = [];
  attachPrivateLeakMonitor(invitedPage, networkEvidence, responseReads);
  invitedPage.on("console", recordConsoleError);
  invitedPage.on("pageerror", (error) => browserErrors.push(error.message));
  const invitationResponse = await invitedPage.goto(
    `${appUrl}/invite#${invitationToken}`,
  );
  process.stdout.write("Opened the private invitation entry.\n");
  await invitedPage.getByLabel("Email address").waitFor();
  await invitedPage.waitForLoadState("networkidle");
  assertPrivateResponse(invitationResponse, "Invitation entry");
  await invitedPage.waitForFunction(() => window.location.hash === "");
  await assertPageQuality(invitedPage, "Invitation entry");
  await assertNoCanaries(
    invitedPage,
    [...fixtureCanaries, invitationToken],
    "Invitation entry",
  );
  process.stdout.write("Checked invitation entry privacy and accessibility.\n");

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
  const actionResponsePromise = invitedPage.waitForResponse((response) => {
    const request = response.request();
    const url = new URL(request.url());
    return request.method() === "POST" && url.pathname === "/invite";
  });
  await invitedPage.getByRole("button", { name: "Email me a code" }).click();
  const [actionRequest, actionResponse] = await Promise.all([
    actionRequestPromise,
    actionResponsePromise,
  ]);
  await invitedPage.getByLabel("Six-digit code").waitFor();
  if (!actionResponse.ok()) {
    throw new Error(
      `The first sign-in code action failed (${actionResponse.status()}).`,
    );
  }
  const firstOtp = await findOtp(mailpitUrl, email);
  process.stdout.write("Received the first local sign-in code.\n");
  await assertCrossOriginActionRejected({
    actionRequest,
    canaries: [...fixtureCanaries, email, invitationToken, firstOtp],
    mailpitUrl,
    recipient: email,
  });
  process.stdout.write("Rejected the cross-origin action replay.\n");

  await invitedPage.waitForLoadState("networkidle");
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
  process.stdout.write("Preserved the staged invitation across reload.\n");

  await invitedPage.getByLabel("Email address").fill(email);
  const secondCodeResponsePromise = invitedPage.waitForResponse((response) => {
    const request = response.request();
    const url = new URL(request.url());
    return request.method() === "POST" && url.pathname === "/invite";
  });
  await invitedPage.getByRole("button", { name: "Email me a code" }).click();
  await invitedPage.getByLabel("Six-digit code").waitFor();
  const secondCodeResponse = await secondCodeResponsePromise;
  if (!secondCodeResponse.ok()) {
    throw new Error(
      `The replacement sign-in code action failed (${secondCodeResponse.status()}).`,
    );
  }
  const otp = await findOtp(mailpitUrl, email);
  process.stdout.write("Received the replacement local sign-in code.\n");
  serverCanaries.push(otp);
  await invitedPage.getByLabel("Six-digit code").fill(otp);
  await invitedPage
    .getByRole("button", { name: "Join family journal" })
    .click();
  await invitedPage.waitForURL(`${appUrl}/family`);
  await invitedPage.getByRole("heading", { name: "Cedar Circle" }).waitFor();
  process.stdout.write("Accepted the invitation into Cedar Circle.\n");
  browserPhase = "accepted family and creation";
  await assertPageQuality(invitedPage, "Connected family timeline");
  if (authCookies(await invitedContext.cookies()).length === 0) {
    throw new Error("Invitation acceptance did not establish an Auth cookie.");
  }
  if (invitationIntentCookies(await invitedContext.cookies()).length > 0) {
    throw new Error(
      "Invitation acceptance left the staged invitation cookie behind.",
    );
  }
  await invitedPage.setViewportSize({ height: 350, width: 320 });
  await assertPageQuality(invitedPage, "Short connected family timeline");
  await invitedPage.setViewportSize({ height: 844, width: 390 });

  const seededNoteCanary =
    "The delighted laugh afterward is worth remembering.";
  if ((await invitedPage.content()).includes(seededNoteCanary)) {
    throw new Error(
      "The initial timeline serialized a closed family conversation.",
    );
  }
  const familyContextNote = `A connected family note ${suffix}`;
  const editedFamilyContextNote = `An edited family note ${suffix}`;
  serverCanaries.push(familyContextNote, editedFamilyContextNote);
  process.stdout.write("Checking lazy family conversation controls.\n");
  const seededMilestone = invitedPage
    .locator('[data-moment-kind="milestone"]')
    .first();
  await seededMilestone
    .getByRole("button", { name: /^Open private notes/u })
    .click();
  await invitedPage.getByText(seededNoteCanary).waitFor();
  await invitedPage
    .getByRole("textbox", { name: "Your note to the family" })
    .fill(familyContextNote);
  await invitedPage.getByRole("button", { name: "Save note" }).click();
  await invitedPage.getByText(familyContextNote).waitFor();
  await invitedPage.getByRole("button", { name: /^Edit — your note/u }).click();
  const editFamilyNote = invitedPage.getByRole("textbox", {
    name: "Edit your family note",
  });
  await editFamilyNote.fill(editedFamilyContextNote);
  await invitedPage
    .locator("form")
    .filter({ has: editFamilyNote })
    .getByRole("button", { name: "Save note" })
    .click();
  await editFamilyNote.waitFor({ state: "detached" });
  await invitedPage.getByText(editedFamilyContextNote).waitFor();
  await invitedPage
    .getByRole("group", { name: "Your response" })
    .getByRole("button", { name: "Made me smile" })
    .click();
  await invitedPage.getByRole("button", { name: "Save response" }).click();
  await invitedPage.getByText("Response saved.").waitFor();
  await invitedPage
    .getByRole("group", { name: "Your response" })
    .getByRole("button", { name: "Made me smile" })
    .click();
  await invitedPage.getByRole("button", { name: "Save response" }).click();
  await invitedPage.getByText("Response removed.").waitFor();
  invitedPage.once("dialog", (dialog) => dialog.accept());
  const removeOwnNote = invitedPage.getByRole("button", {
    name: /^Remove — your note/u,
  });
  if ((await removeOwnNote.count()) !== 1) {
    const detailButtons = await invitedPage
      .locator(".moment-detail-dialog button[aria-label]")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")),
      );
    throw new Error(
      `The current member lost note-removal authority after a response refresh: ${JSON.stringify(detailButtons)}.`,
    );
  }
  await removeOwnNote.click();
  await invitedPage.getByText("Note removed from this conversation.").waitFor();
  await invitedPage.getByText(editedFamilyContextNote).waitFor({
    state: "detached",
  });
  await invitedPage.setViewportSize({ height: 350, width: 320 });
  await assertPageQuality(invitedPage, "Short connected family conversation");
  await invitedPage.setViewportSize({ height: 844, width: 390 });
  await assertPageQuality(invitedPage, "Connected family conversation");
  await invitedPage.getByRole("button", { exact: true, name: "Close" }).click();
  if ((await invitedPage.content()).includes(editedFamilyContextNote)) {
    throw new Error("Closing moment details left a note body in the DOM.");
  }

  const milestoneMoment = `A connected milestone ${suffix}`;
  const editedMilestoneMoment = `${milestoneMoment} remembered`;
  const locationMoment = `A connected place ${suffix}`;
  serverCanaries.push(milestoneMoment, locationMoment);
  process.stdout.write("Checking connected milestone and place creation.\n");
  await invitedPage.getByRole("button", { name: "Add moment" }).click();
  await invitedPage
    .getByRole("button", { name: /^Milestone A meaningful first$/u })
    .click();
  await invitedPage
    .getByRole("textbox", { exact: true, name: "Milestone" })
    .fill(milestoneMoment);
  await invitedPage
    .getByLabel("What made it meaningful?")
    .fill("A brave first worth remembering.");
  await invitedPage.getByRole("button", { name: /People and place/u }).click();
  await invitedPage.getByRole("checkbox", { name: /A Organizer One/u }).check();
  await invitedPage.getByLabel(/^Place/u).fill("Cedar Park");
  await invitedPage.getByRole("button", { name: "Review moment" }).click();
  await invitedPage.getByRole("button", { name: "Save moment" }).click();
  await invitedPage.getByRole("heading", { name: "Moment saved" }).waitFor();
  await invitedPage.getByRole("button", { name: "Done" }).click();
  await invitedPage.getByText(milestoneMoment).waitFor();

  await invitedPage.getByRole("button", { name: "Add moment" }).click();
  await invitedPage
    .getByRole("button", {
      name: /^A place Somewhere worth returning to$/u,
    })
    .click();
  await invitedPage.getByLabel("Place name").fill(locationMoment);
  await invitedPage
    .getByLabel("What happened here?")
    .fill("The wind made everyone laugh.");
  await invitedPage.getByRole("button", { name: "Review moment" }).click();
  await invitedPage.getByRole("button", { name: "Save moment" }).click();
  await invitedPage.getByRole("heading", { name: "Moment saved" }).waitFor();
  await invitedPage.getByRole("button", { name: "Done" }).click();
  await invitedPage.getByText(locationMoment).waitFor();

  const milestoneCard = invitedPage
    .locator(".moment-card")
    .filter({ hasText: milestoneMoment });
  await milestoneCard.getByRole("button", { name: /^Edit —/u }).click();
  const optionalPlace = invitedPage.getByRole("textbox", {
    name: /^Place Optional$/u,
  });
  if ((await optionalPlace.inputValue()) !== "Cedar Park") {
    throw new Error("Editing a milestone did not preserve its optional place.");
  }
  await invitedPage
    .getByRole("textbox", { exact: true, name: "Milestone" })
    .fill(editedMilestoneMoment);
  await invitedPage.getByRole("button", { name: "Save changes" }).click();
  await invitedPage.getByRole("dialog").waitFor({ state: "detached" });
  const editedMilestoneCard = invitedPage
    .locator(".moment-card")
    .filter({ hasText: editedMilestoneMoment });
  await editedMilestoneCard.getByText("Cedar Park").waitFor();

  const writtenMoment = `A connected browser moment ${suffix}`;
  const editedMoment = `An edited connected browser moment ${suffix}`;
  serverCanaries.push(writtenMoment, editedMoment);
  await invitedPage.getByRole("button", { name: "Add moment" }).click();
  await invitedPage
    .getByRole("button", { name: /^A thought A few words to keep$/u })
    .click();
  await invitedPage.setViewportSize({ height: 350, width: 320 });
  await assertPageQuality(invitedPage, "Short connected moment composer");
  await invitedPage.getByLabel("Your thought").fill(writtenMoment);
  await invitedPage.getByRole("button", { name: "Review moment" }).click();
  await assertPageQuality(invitedPage, "Short connected moment review");
  await invitedPage.setViewportSize({ height: 844, width: 390 });
  await invitedPage.getByRole("button", { name: "Save moment" }).click();
  await invitedPage.getByRole("heading", { name: "Moment saved" }).waitFor();
  const doneButton = invitedPage.getByRole("button", { name: "Done" });
  if (
    !(await doneButton.evaluate(
      (element) => element === document.activeElement,
    ))
  ) {
    throw new Error(
      "Successful creation did not focus its completion control.",
    );
  }
  await doneButton.click();
  await invitedPage.getByText(writtenMoment).waitFor();

  await invitedPage.getByRole("link", { name: "People" }).click();
  browserPhase = "personal edit and trash";
  await invitedPage.getByRole("link", { name: /Browser Invite/u }).click();
  await invitedPage.getByText(writtenMoment).waitFor();
  const personalJournalUrl = invitedPage.url();
  await invitedPage
    .locator(".moment-card")
    .filter({ hasText: writtenMoment })
    .getByRole("button", { name: /^Edit .* moment from/u })
    .click();
  await invitedPage.setViewportSize({ height: 350, width: 320 });
  await assertPageQuality(invitedPage, "Short connected moment editor");
  await invitedPage.setViewportSize({ height: 844, width: 390 });
  await invitedPage.getByLabel("Your thought").fill(editedMoment);
  await invitedPage.getByRole("button", { name: "Save changes" }).click();
  await invitedPage.getByRole("dialog").waitFor({ state: "detached" });
  await invitedPage.getByText(editedMoment).waitFor();
  await invitedPage.waitForFunction(
    () => document.activeElement?.id === "journal-focus-target",
  );
  await invitedPage
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Family" })
    .click();
  await invitedPage.getByText(editedMoment).waitFor();
  invitedPage.once("dialog", (dialog) => dialog.accept());
  await invitedPage
    .locator(".moment-card")
    .filter({ hasText: editedMoment })
    .getByRole("button", { name: /^Move to trash/u })
    .click();
  await invitedPage.getByText(editedMoment).waitFor({ state: "detached" });
  await invitedPage.waitForFunction(
    () => document.activeElement?.id === "journal-focus-target",
  );
  await invitedPage.goto(personalJournalUrl);
  if ((await invitedPage.getByText(editedMoment).count()) !== 0) {
    throw new Error("A trashed moment remained in its personal journal.");
  }
  const trashResponse = await invitedPage.goto(`${appUrl}/trash`);
  assertPrivateResponse(trashResponse, "Connected trash");
  await invitedPage.getByText(editedMoment).waitFor();
  await invitedPage.setViewportSize({ height: 350, width: 320 });
  await assertPageQuality(invitedPage, "Short connected trash");
  await invitedPage.setViewportSize({ height: 844, width: 390 });
  await invitedPage
    .getByRole("button", { name: /^Restore .* moment from/u })
    .click();
  await invitedPage.getByText(editedMoment).waitFor({ state: "detached" });
  await invitedPage.waitForFunction(
    () => document.activeElement?.id === "journal-focus-target",
  );
  await invitedPage.goto(personalJournalUrl);
  await invitedPage.getByText(editedMoment).waitFor();
  await invitedPage.goto(`${appUrl}/family`);
  await invitedPage.getByText(editedMoment).waitFor();
  browserPhase = "pagination traversal";

  const invitedUserToken = createLocalUserToken(createdUser.body.id, jwtSecret);
  const membershipLookup = await jsonRequest(
    `${apiUrl}/rest/v1/circle_memberships?select=id,person_id&user_id=eq.${createdUser.body.id}`,
    anonKey,
    { headers: { authorization: `Bearer ${invitedUserToken}` } },
  );
  const invitedPersonId = membershipLookup.body?.[0]?.person_id;
  const invitedMembershipId = membershipLookup.body?.[0]?.id;
  if (
    !membershipLookup.response.ok ||
    !invitedPersonId ||
    !invitedMembershipId
  ) {
    throw new Error("Connected pagination member lookup failed.");
  }
  const memoryCanary = `An anniversary memory ${suffix}`;
  const memoryWrite = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/create_written_moment`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: "20000000-0000-4000-8000-000000000001",
        journal_person_id: invitedPersonId,
        body: memoryCanary,
        occurred_on: anniversaryOccurredOn,
        occurred_at: `${anniversaryOccurredOn}T23:30:00-07:00`,
        occurred_timezone: circleTimeZone,
      }),
      headers: { authorization: `Bearer ${invitedUserToken}` },
      method: "POST",
    },
  );
  if (!memoryWrite.response.ok) {
    throw new Error("The connected anniversary fixture could not be created.");
  }
  serverCanaries.push(memoryCanary);
  browserPhase = "connected memories";
  const memoriesResponse = await invitedPage.goto(`${appUrl}/memories`);
  assertPrivateResponse(memoriesResponse, "Connected Memories landing");
  await invitedPage.getByRole("heading", { name: "Memories" }).waitFor();
  await invitedPage.getByText("Across the years").waitFor();
  await invitedPage.setViewportSize({ height: 350, width: 320 });
  await assertPageQuality(invitedPage, "Short connected Memories landing");
  await invitedPage.setViewportSize({ height: 844, width: 390 });
  await invitedPage
    .getByRole("link", { name: /Open moments from this day/u })
    .click();
  await invitedPage.waitForURL(`${appUrl}/memories/on-this-day`);
  await invitedPage.getByText(memoryCanary).waitFor();
  if ((await invitedPage.getByText(/Local preview/u).count()) !== 0) {
    throw new Error("Connected On This Day rendered preview-only controls.");
  }
  const memoryArticle = invitedPage
    .locator("article")
    .filter({ hasText: memoryCanary });
  await memoryArticle.getByRole("button", { name: /^Edit/u }).waitFor();
  await memoryArticle
    .getByRole("button", { name: /^Open private notes/u })
    .waitFor();
  await assertPageQuality(invitedPage, "Connected On This Day");
  await invitedPage.goBack();
  await invitedPage.waitForURL(`${appUrl}/memories`);
  await invitedPage
    .getByRole("link", {
      name: `Browse memories from ${anniversaryYear}`,
    })
    .click();
  await invitedPage.waitForURL(`${appUrl}/memories/years/${anniversaryYear}`);
  await invitedPage.getByText(memoryCanary).waitFor();
  await assertPageQuality(invitedPage, "Connected year memories");
  const emptyMemoryResponse = await invitedPage.goto(
    `${appUrl}/memories/years/1998`,
  );
  assertPrivateResponse(emptyMemoryResponse, "Connected empty memory year");
  await invitedPage.getByText("No moments from this year").waitFor();
  if ((await invitedPage.locator(".memory-empty-node").count()) !== 1) {
    throw new Error("The empty memory year lost its quiet timeline node.");
  }
  await assertPageQuality(invitedPage, "Connected empty memory year");

  const paginationPrefix = `Browser pagination ${suffix}`;
  const paginationWrites = await Promise.all(
    Array.from({ length: 42 }, (_, index) =>
      jsonRequest(`${apiUrl}/rest/v1/rpc/create_written_moment`, anonKey, {
        body: JSON.stringify({
          circle_id: "20000000-0000-4000-8000-000000000001",
          journal_person_id: invitedPersonId,
          body: `${paginationPrefix} ${String(index + 1).padStart(2, "0")}`,
          occurred_on: "2010-01-01",
          occurred_at: null,
          occurred_timezone: null,
        }),
        headers: { authorization: `Bearer ${invitedUserToken}` },
        method: "POST",
      }),
    ),
  );
  if (paginationWrites.some(({ response }) => !response.ok)) {
    throw new Error("Connected pagination fixtures could not be created.");
  }
  serverCanaries.push(paginationPrefix);
  const memoryPaginationResponse = await invitedPage.goto(
    `${appUrl}/memories/years/2010`,
  );
  assertPrivateResponse(
    memoryPaginationResponse,
    "Connected memory pagination",
  );
  const memoryEarlierLink = invitedPage.getByRole("link", {
    name: "Show earlier days",
  });
  await memoryEarlierLink.waitFor();
  await memoryEarlierLink.scrollIntoViewIfNeeded();
  const memoryAnchor = invitedPage.locator("article").last();
  const memoryAnchorId = await memoryAnchor.getAttribute("id");
  const memoryAnchorTopBefore = await memoryAnchor.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await memoryEarlierLink.click();
  await invitedPage.waitForURL(/\/memories\/years\/2010\?pages=2&snapshot=/u);
  if (!memoryAnchorId)
    throw new Error("The memory page anchor had no stable ID.");
  const memoryAnchorTopAfter = await invitedPage
    .locator(`[id="${memoryAnchorId}"]`)
    .evaluate((element) => element.getBoundingClientRect().top);
  if (Math.abs(memoryAnchorTopAfter - memoryAnchorTopBefore) > 2) {
    throw new Error(
      "Loading older memories shifted the visible timeline anchor.",
    );
  }
  await assertPageQuality(invitedPage, "Connected memory continuation");
  await invitedPage.goto(`${appUrl}/family`);
  const firstEarlierLink = invitedPage.getByRole("link", {
    name: "Show earlier days",
  });
  await firstEarlierLink.waitFor();
  const firstEarlierHref = await firstEarlierLink.getAttribute("href");
  const firstSnapshot = new URL(firstEarlierHref, appUrl).searchParams.get(
    "snapshot",
  );
  if (!firstSnapshot) {
    throw new Error("The first continuation did not preserve a feed snapshot.");
  }

  const lateHistoricalMoment = `Late historical insertion ${suffix}`;
  const lateWrite = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/create_written_moment`,
    anonKey,
    {
      body: JSON.stringify({
        circle_id: "20000000-0000-4000-8000-000000000001",
        journal_person_id: invitedPersonId,
        body: lateHistoricalMoment,
        occurred_on: "2025-01-01",
        occurred_at: null,
        occurred_timezone: null,
      }),
      headers: { authorization: `Bearer ${invitedUserToken}` },
      method: "POST",
    },
  );
  if (!lateWrite.response.ok) {
    throw new Error(
      "The post-snapshot historical fixture could not be created.",
    );
  }
  serverCanaries.push(lateHistoricalMoment);

  await firstEarlierLink.scrollIntoViewIfNeeded();
  const anchor = invitedPage.locator("article").last();
  const anchorId = await anchor.getAttribute("id");
  const anchorTopBefore = await anchor.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await firstEarlierLink.click();
  await invitedPage.waitForURL(/\/family\?pages=2&snapshot=/u);
  const secondSnapshot = new URL(invitedPage.url()).searchParams.get(
    "snapshot",
  );
  if (secondSnapshot !== firstSnapshot) {
    throw new Error("Loading older days replaced the original feed snapshot.");
  }
  if (!anchorId) throw new Error("The pagination anchor had no stable ID.");
  const anchorTopAfter = await invitedPage
    .locator(`[id="${anchorId}"]`)
    .evaluate((element) => element.getBoundingClientRect().top);
  if (Math.abs(anchorTopAfter - anchorTopBefore) > 2) {
    throw new Error("Loading older days shifted the visible timeline anchor.");
  }
  if ((await invitedPage.getByText(lateHistoricalMoment).count()) !== 0) {
    throw new Error("A post-snapshot historical insert entered the traversal.");
  }

  const secondEarlierLink = invitedPage.getByRole("link", {
    name: "Show earlier days",
  });
  await secondEarlierLink.click();
  await invitedPage.waitForURL(/\/family\?pages=3&snapshot=/u);
  if (
    new URL(invitedPage.url()).searchParams.get("snapshot") !== firstSnapshot
  ) {
    throw new Error("The final continuation lost the original feed snapshot.");
  }
  await invitedPage.getByText(`${paginationPrefix} 01`).waitFor();
  if (
    (await invitedPage
      .getByRole("link", { name: "Show earlier days" })
      .count()) !== 0
  ) {
    throw new Error("The completed traversal still offered another page.");
  }
  await assertPageQuality(invitedPage, "Connected timeline end state");
  const connectedActionNames = await invitedPage
    .locator(".connected-moment-actions button[aria-label]")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
  if (new Set(connectedActionNames).size !== connectedActionNames.length) {
    const duplicates = connectedActionNames.filter(
      (name, index) => connectedActionNames.indexOf(name) !== index,
    );
    throw new Error(
      `Repeated timeline actions did not have unique names: ${JSON.stringify([...new Set(duplicates)])}.`,
    );
  }
  const conversationActionNames = await invitedPage
    .locator(".soft-actions button[aria-label]")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
  if (
    new Set(conversationActionNames).size !== conversationActionNames.length
  ) {
    throw new Error(
      "Repeated timeline response/note controls did not have unique names.",
    );
  }
  const deepSnapshotUrl = invitedPage.url();
  browserPhase = "deep-snapshot mutations";
  const deepCreatedMoment = `Created from a deep snapshot ${suffix}`;
  const deepEditedMoment = `Edited from a deep snapshot ${suffix}`;
  serverCanaries.push(deepCreatedMoment, deepEditedMoment);
  await invitedPage.getByRole("button", { name: "Add moment" }).click();
  await invitedPage
    .getByRole("button", { name: /^A thought A few words to keep$/u })
    .click();
  await invitedPage.getByLabel("Your thought").fill(deepCreatedMoment);
  await invitedPage.getByRole("button", { name: "Review moment" }).click();
  await invitedPage.getByRole("button", { name: "Save moment" }).click();
  await invitedPage.getByRole("heading", { name: "Moment saved" }).waitFor();
  await invitedPage.getByRole("button", { name: "Done" }).click();
  await invitedPage.waitForURL(`${appUrl}/family`);
  await invitedPage.getByText(deepCreatedMoment).waitFor();

  await invitedPage.goto(deepSnapshotUrl);
  const deepEditArticle = invitedPage
    .locator("article")
    .filter({ hasText: editedMoment });
  await deepEditArticle.getByRole("button", { name: /^Edit/u }).click();
  await invitedPage.getByLabel("Your thought").fill(deepEditedMoment);
  await invitedPage.getByRole("button", { name: "Save changes" }).click();
  await invitedPage.waitForURL(`${appUrl}/family`);
  await invitedPage.getByText(deepEditedMoment).waitFor();

  const journalErrorPage = await invitedContext.newPage();
  await journalErrorPage.goto(`${appUrl}/family?pages=26`);
  await journalErrorPage.getByText("Something interrupted the story").waitFor();
  if ((await journalErrorPage.locator(".time-rail").count()) !== 1) {
    throw new Error("Journal error state did not retain the timeline rail.");
  }
  await assertPageQuality(journalErrorPage, "Connected journal error state");
  await journalErrorPage.close();
  const restorationPage = await invitedContext.newPage();
  browserPhase = "scroll restoration";
  restorationPage.on("console", recordConsoleError);
  restorationPage.on("pageerror", (error) => browserErrors.push(error.message));
  await restorationPage.goto(`${appUrl}/family`);
  await restorationPage
    .getByRole("link", { name: "Show earlier days" })
    .click();
  await restorationPage.waitForURL(/\/family\?pages=2&snapshot=/u);
  await restorationPage
    .getByRole("link", { name: "Show earlier days" })
    .click();
  await restorationPage.waitForURL(/\/family\?pages=3&snapshot=/u);
  await restorationPage.getByText(`${paginationPrefix} 01`).waitFor();
  await restorationPage.evaluate(() =>
    window.scrollTo(0, Math.floor(document.body.scrollHeight * 0.62)),
  );
  const deepScrollY = await restorationPage.evaluate(() => window.scrollY);
  await restorationPage.getByRole("link", { name: "People" }).click();
  await restorationPage.waitForURL(`${appUrl}/people`);
  await restorationPage.goBack();
  await restorationPage.waitForURL(/\/family\?pages=3&snapshot=/u);
  await restorationPage.waitForFunction(
    (expected) => Math.abs(window.scrollY - expected) <= 2,
    deepScrollY,
  );
  const restoredScrollY = await restorationPage.evaluate(() => window.scrollY);
  if (Math.abs(restoredScrollY - deepScrollY) > 2) {
    throw new Error("Browser Back did not restore the deep timeline position.");
  }
  await restorationPage.getByText(`${paginationPrefix} 01`).waitFor();
  await restorationPage.close();

  const firstAccountCookie = authCookies(await invitedContext.cookies())
    .map(({ value }) => value)
    .join("");
  const retainedAccountContext = await browser.newContext({
    storageState: await invitedContext.storageState(),
    timezoneId: "Pacific/Kiritimati",
    viewport: { height: 844, width: 390 },
  });
  const retainedAccountPage = await retainedAccountContext.newPage();
  await retainedAccountPage.goto(`${appUrl}/memories/on-this-day`);
  await retainedAccountPage.getByText(memoryCanary).waitFor();

  const switchedEmail = `browser-switch-${suffix}@example.test`;
  browserPhase = "account switch acceptance";
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
        circle_id: "20000000-0000-4000-8000-000000000002",
        display_name: "Browser Account Switch",
        email: switchedEmail,
      }),
      headers: { authorization: `Bearer ${harborOrganizerToken}` },
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
  await invitedPage.waitForURL(`${appUrl}/family`);
  await invitedPage.getByRole("heading", { name: "Harbor Circle" }).waitFor();
  const harborMoment = "A harbor-circle moment stays in its own family.";
  await invitedPage.getByText(harborMoment).waitFor();
  const firstCircleCanaries = [
    milestoneMoment,
    locationMoment,
    editedFamilyContextNote,
    writtenMoment,
    editedMoment,
    paginationPrefix,
    lateHistoricalMoment,
    deepCreatedMoment,
    deepEditedMoment,
    memoryCanary,
  ];
  await assertNoCanaries(
    invitedPage,
    firstCircleCanaries,
    "Cross-family account switch",
  );
  assertEvidenceExcludes(
    await browserPrivateState(invitedPage),
    firstCircleCanaries,
    "Cross-family account-switch browser state",
  );
  browserPhase = "cross-family history probe";
  await traverseHistoryBy(invitedPage, -2);
  await assertNoCanaries(
    invitedPage,
    firstCircleCanaries,
    "Cross-family Back history",
  );
  assertEvidenceExcludes(
    await browserPrivateState(invitedPage),
    firstCircleCanaries,
    "Cross-family Back browser state",
  );
  await traverseHistoryBy(invitedPage, 2);
  await assertNoCanaries(
    invitedPage,
    firstCircleCanaries,
    "Cross-family Forward history",
  );
  assertEvidenceExcludes(
    await browserPrivateState(invitedPage),
    firstCircleCanaries,
    "Cross-family Forward browser state",
  );
  browserPhase = "post-switch family";
  await invitedPage.goto(`${appUrl}/memories`);
  await invitedPage.getByRole("heading", { name: "Memories" }).waitFor();
  await invitedPage.getByText("Across the years").waitFor();
  await assertNoCanaries(
    invitedPage,
    firstCircleCanaries,
    "Cross-family Memories landing",
  );
  await invitedPage.goto(`${appUrl}/family`);
  await invitedPage.getByText(harborMoment).waitFor();
  const switchedAccountCookie = authCookies(await invitedContext.cookies())
    .map(({ value }) => value)
    .join("");
  if (!switchedAccountCookie || switchedAccountCookie === firstAccountCookie) {
    throw new Error("Account switching did not replace the Auth session.");
  }
  if (authCookies(await retainedAccountContext.cookies()).length === 0) {
    throw new Error("The isolated first-account browser lost its own session.");
  }
  const revokedMembership = await jsonRequest(
    `${apiUrl}/rest/v1/rpc/revoke_membership`,
    anonKey,
    {
      body: JSON.stringify({ membership_id: invitedMembershipId }),
      headers: { authorization: `Bearer ${organizerToken}` },
      method: "POST",
    },
  );
  if (!revokedMembership.response.ok) {
    throw new Error("The connected membership could not be revoked.");
  }
  await retainedAccountPage.setViewportSize({ height: 350, width: 320 });
  await retainedAccountPage.goto(`${appUrl}/memories`);
  await retainedAccountPage.waitForURL(`${appUrl}/access-unavailable`);
  await retainedAccountPage
    .getByText("This account does not have family access")
    .waitFor();
  if ((await retainedAccountPage.locator(".time-rail").count()) !== 1) {
    throw new Error("Permission-lost state did not retain the timeline rail.");
  }
  await assertPageQuality(
    retainedAccountPage,
    "Short connected permission-lost state",
  );
  await traverseHistoryBy(retainedAccountPage, -1);
  await assertNoCanaries(
    retainedAccountPage,
    firstCircleCanaries,
    "Revoked-member Back history",
  );
  assertEvidenceExcludes(
    await browserPrivateState(retainedAccountPage),
    firstCircleCanaries,
    "Revoked-member Back browser state",
  );
  await traverseHistoryBy(retainedAccountPage, 1);
  await assertNoCanaries(
    retainedAccountPage,
    firstCircleCanaries,
    "Revoked-member Forward history",
  );
  assertEvidenceExcludes(
    await browserPrivateState(retainedAccountPage),
    firstCircleCanaries,
    "Revoked-member Forward browser state",
  );
  await retainedAccountPage.goto(`${appUrl}/family`);
  await retainedAccountPage.waitForURL(`${appUrl}/access-unavailable`);
  const acceptedPrivateCanaries = [
    ...fixtureCanaries,
    email,
    invitationToken,
    otp,
    switchedEmail,
    switchedToken,
    switchedOtp,
    writtenMoment,
    editedMoment,
    milestoneMoment,
    locationMoment,
    editedFamilyContextNote,
    harborMoment,
    paginationPrefix,
    lateHistoricalMoment,
    deepCreatedMoment,
    deepEditedMoment,
    memoryCanary,
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
  browserPhase = "unrelated browser";
  unrelatedPage.on("console", recordConsoleError);
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

  await invitedPage.goto(`${appUrl}/trash`);
  browserPhase = "sign-out cleanup";
  await invitedPage
    .getByRole("heading", { name: "Recently removed" })
    .waitFor();
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
  browserPhase = "signed-out history";
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
  browserPhase = "revoked invitation";
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
  rejectedPage.on("console", recordConsoleError);
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

  await Promise.allSettled(consoleErrorReads);
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
    `Connected staged invite, OTP, Memories/year/anniversary browsing, stable pagination, lazy notes, reactions, thought/milestone/place creation, edit/trash/restore, cross-origin denial, cross-family account isolation, revoked-invite recovery, browser cleanup, membership gate, and local sign-out passed in ${connectedBrowserName}.\n`,
  );
} finally {
  if (browser) await browser.close();
  await stopServer(server);
  if (shouldRestoreFixtures) resetDatabase();
}
