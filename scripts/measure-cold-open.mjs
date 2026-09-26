/**
 * Cold-open lab: production next start, iPhone 13, dark, cache off,
 * Slow 4G (1.6 Mbps / 750 Kbps / 150 ms) and 4x CPU.
 * OUR_DAYS_LAB_JOURNAL_DELAY_MS stands in for phone-to-database latency.
 *
 * Before: the page awaits journal data before it returns.
 * After: the shell streams while that read is still in flight.
 * The full stylesheet stays render-blocking in both profiles.
 */
import { spawn } from "node:child_process";
import { chromium, devices } from "@playwright/test";

const port = Number(process.env.OUR_DAYS_LAB_PORT ?? 3215);
const origin = `http://127.0.0.1:${port}`;
const runs = 3;
const downloadThroughput = 1.6e6 / 8;
const uploadThroughput = 750e3 / 8;

function labEnv(blocking) {
  const env = {
    ...process.env,
    OUR_DAYS_ENVIRONMENT: "local",
    OUR_DAYS_RESOURCE_MODE: "detached",
    OUR_DAYS_INVITATION_DELIVERY_MODE: "disabled",
    OUR_DAYS_MEDIA_DELIVERY_MODE: "disabled",
    OUR_DAYS_PHOTO_POSTING_MODE: "disabled",
    OUR_DAYS_LOCAL_JOURNAL_MODE: "disabled",
    OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: "",
    OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF: "",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    NEXT_PUBLIC_SITE_URL: origin,
    OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
    OUR_DAYS_LAB: "1",
    OUR_DAYS_LAB_JOURNAL_DELAY_MS: "1500",
  };
  delete env.OUR_DAYS_LAB_BLOCK_BEFORE_SHELL;
  delete env.VERCEL_ENV;
  if (blocking) {
    env.OUR_DAYS_LAB_BLOCK_BEFORE_SHELL = "1";
  }
  return env;
}

function startServer(env) {
  const child = spawn(
    "npm",
    ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(port)],
    { env, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  child.logs = () => logs;
  return child;
}

async function waitForServer(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`next start exited early\n${child.logs()}`);
    }
    try {
      const response = await fetch(`${origin}/sign-in`);
      if (response.status < 500) return;
    } catch {
      // The listener is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`next start did not listen\n${child.logs()}`);
}

function signalGroup(child, signal) {
  if (child.pid == null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process group is already gone.
    }
  }
}

async function stopServer(child) {
  if (child.exitCode != null) return;
  signalGroup(child, "SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      signalGroup(child, "SIGKILL");
      resolve();
    }, 4_000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await fetch(origin, { signal: AbortSignal.timeout(300) });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function bytesBeforeStall(sentAt, chunks) {
  let cursor = sentAt;
  let flushed = 0;
  for (const chunk of chunks) {
    if (chunk.t - cursor >= 0.8) return flushed;
    flushed += chunk.n;
    cursor = chunk.t;
  }
  return sentAt == null ? 0 : flushed;
}

async function sample(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput,
    uploadThroughput,
    latency: 150,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  let documentId;
  let sentAt;
  const chunks = [];
  cdp.on("Network.requestWillBeSent", (event) => {
    if (event.type !== "Document") return;
    if (!event.request.url.startsWith(`${origin}/family`)) return;
    documentId = event.requestId;
    sentAt = event.timestamp;
  });
  cdp.on("Network.dataReceived", (event) => {
    if (event.requestId !== documentId) return;
    chunks.push({ t: event.timestamp, n: event.dataLength });
  });

  await page.addInitScript(() => {
    const marks = [];
    window.__coldOpenMarks = marks;
    const note = (name) => {
      if (marks.some((mark) => mark.name === name)) return;
      marks.push({ name, t: performance.now() });
    };
    const scan = () => {
      if (document.querySelector(".topbar")) note("shell");
      if (document.querySelector("article.moment")) note("post");
    };
    const arm = (target) => {
      scan();
      new MutationObserver(scan).observe(target, {
        childList: true,
        subtree: true,
      });
    };
    if (document.documentElement) arm(document.documentElement);
    else {
      const wait = new MutationObserver(() => {
        if (!document.documentElement) return;
        wait.disconnect();
        arm(document.documentElement);
      });
      wait.observe(document, { childList: true });
    }
    const tick = () => {
      scan();
      if (marks.length < 2) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.goto(`${origin}/family`, {
    waitUntil: "commit",
    timeout: 60_000,
  });
  await page.waitForSelector("article.moment", { timeout: 30_000 });
  await page.waitForTimeout(400);
  const switcherOpened = await page.evaluate(async () => {
    const button = document.querySelector(
      'button[aria-label="Choose a journal"]',
    );
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return button.getAttribute("aria-expanded") === "true";
  });
  const reading = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const paints = Object.fromEntries(
      performance
        .getEntriesByType("paint")
        .map((entry) => [entry.name, entry.startTime]),
    );
    const marks = window.__coldOpenMarks ?? [];
    const shell = document.querySelector(".timeline-pull-shell");
    const fiber = shell
      ? Object.keys(shell).some(
          (key) =>
            key.startsWith("__reactFiber") ||
            key.startsWith("__reactInternalInstance"),
        )
      : false;
    return {
      paints,
      ttfb: navigation ? navigation.responseStart : null,
      marks,
      url: location.href,
      pullShell: Boolean(shell),
      hydrated: fiber,
      switcher: Boolean(
        document.querySelector(".title-switcher, .title-lockup"),
      ),
      switcherOpened: false,
    };
  });
  reading.switcherOpened = switcherOpened;
  await cdp.detach();
  const mark = (name) =>
    reading.marks.find((entry) => entry.name === name)?.t ?? null;
  return {
    url: reading.url,
    firstPaint: reading.paints["first-paint"] ?? null,
    firstContentfulPaint: reading.paints["first-contentful-paint"] ?? null,
    ttfb: reading.ttfb,
    shellVisible: mark("shell"),
    firstPostVisible: mark("post"),
    bytesBeforeDataWait: bytesBeforeStall(sentAt, chunks),
    pullShell: reading.pullShell,
    hydrated: reading.hydrated,
    switcher: reading.switcher,
    switcherOpened: reading.switcherOpened,
  };
}

async function measureProfile(browser, blocking) {
  const child = startServer(labEnv(blocking));
  try {
    await waitForServer(child);
    const document = await fetch(`${origin}/family`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    const html = await document.text();
    const stylesheetTags =
      html.match(/<link\b[^>]*\brel="stylesheet"[^>]*>/g) ?? [];
    const iphone = { ...devices["iPhone 13"] };
    delete iphone.defaultBrowserType;
    const context = await browser.newContext({
      ...iphone,
      colorScheme: "dark",
      serviceWorkers: "block",
    });
    const samples = [];
    for (let index = 0; index < runs + 1; index += 1) {
      const page = await context.newPage();
      const reading = await sample(page);
      await page.close();
      if (index > 0) samples.push(reading);
    }
    await context.close();
    const field = (name) => median(samples.map((reading) => reading[name]));
    return {
      status: document.status,
      blockingStylesheet: stylesheetTags.some(
        (tag) =>
          tag.includes('data-precedence="next"') &&
          !tag.includes('media="print"'),
      ),
      stylesheetTags,
      samples,
      median: {
        firstPaint: field("firstPaint"),
        firstContentfulPaint: field("firstContentfulPaint"),
        ttfb: field("ttfb"),
        shellVisible: field("shellVisible"),
        firstPostVisible: field("firstPostVisible"),
        bytesBeforeDataWait: field("bytesBeforeDataWait"),
      },
      last: samples.at(-1),
    };
  } finally {
    await stopServer(child);
  }
}

const browser = await chromium.launch();
try {
  const before = await measureProfile(browser, true);
  const after = await measureProfile(browser, false);
  console.log(JSON.stringify({ before, after }, null, 2));
} finally {
  await browser.close();
}
