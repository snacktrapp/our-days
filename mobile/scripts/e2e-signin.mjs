#!/usr/bin/env node
/**
 * End-to-end email-code sign-in check for the mobile app. Run before every
 * EAS build upload or OTA update:  npm run e2e:signin
 *
 * Runs the app's real modules (src/lib/auth-flow.ts verify path used by
 * AuthProvider, src/lib/supabase.ts client, src/lib/secure-session.ts storage
 * adapter, src/lib/journal.ts loaders) against the live Supabase project, with
 * expo-secure-store replaced by a double that enforces the 2048-byte limit.
 *
 * Credentials (never printed):
 *   SUPABASE_SERVICE_ROLE_KEY, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, or
 *   SUPABASE_ACCESS_TOKEN (Management API) to fetch both.
 *   E2E_TEST_EMAIL  test account with an active circle (default: the
 *                   Operations account tars-trapp@agentmail.to).
 */
import assert from "node:assert/strict";
import { register } from "node:module";

register("./e2e/loader.mjs", import.meta.url);

const projectRef = "snwmwzbeajfrateksolo";
const supabaseUrl = `https://${projectRef}.supabase.co`;
const testEmail = (process.env.E2E_TEST_EMAIL ?? "tars-trapp@agentmail.to").toLowerCase();
const forbidden = ["trappbrian@gmail.com", "briant@voler.com"];
if (forbidden.includes(testEmail)) {
  console.error("Refusing to run the sign-in test against a personal account.");
  process.exit(2);
}

async function loadKeys() {
  let service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let publishable = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!service || !publishable) {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) throw new Error("Set SUPABASE_ACCESS_TOKEN or both API keys.");
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Management API api-keys: HTTP ${res.status}`);
    const keys = await res.json();
    service ??= keys.find((k) => k.name === "service_role")?.api_key;
    publishable ??= keys.find((k) => k.type === "publishable")?.api_key;
  }
  assert.ok(service && publishable, "API keys missing");
  return { service, publishable };
}

const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok  ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FAIL ${name}\n       ${error?.stack ?? error}`);
  }
}

await step("journal module loads under plain Node", async () => {
  const loaded = await import("../src/lib/journal.ts");
  assert.equal(typeof loaded.loadTimelinePage, "function");
  assert.equal(typeof loaded.photoDeliveryPath, "function");
});

const { service, publishable } = await loadKeys();
process.env.EXPO_PUBLIC_SUPABASE_URL = supabaseUrl;
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishable;
process.env.EXPO_PUBLIC_SITE_URL ??= "https://our-days-neon.vercel.app";

const { createClient } = await import("@supabase/supabase-js");
const secureStore = await import("./e2e/mock-secure-store.mjs");
const { secureSessionStorage, splitUtf8 } = await import("../src/lib/secure-session.ts");
const { verifyEmailCode } = await import("../src/lib/auth-flow.ts");
const { authStorageKey } = await import("../src/lib/config.ts");
const journal = await import("../src/lib/journal.ts");

const admin = createClient(supabaseUrl, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const storageKey = authStorageKey();
const noSleep = async () => {};

async function freshApp(tag) {
  // A new module instance = a new JS runtime after an app restart. The
  // SecureStore double keeps its contents, like the keychain does.
  return import(`../src/lib/supabase.ts?run=${tag}`);
}

async function emailOtp() {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: testEmail,
  });
  if (error) throw error;
  const otp = data.properties?.email_otp;
  assert.match(otp ?? "", /^\d{6}$/u, "email_otp should be six digits (mailer_otp_length)");
  return otp;
}

function resetStore() {
  secureStore.store.clear();
  secureStore.state.failWrites = false;
  secureStore.state.maxValueBytes = 0;
}

const realFetch = globalThis.fetch;
const requestLog = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const res = await realFetch(input, init);
  requestLog.push({ url, status: res.status });
  return res;
};

console.log(`Sign-in e2e against ${projectRef} as ${testEmail}`);

await step("storage adapter: 2048-byte limit, UTF-8 chunking, round trip", async () => {
  resetStore();
  const big = JSON.stringify({ name: "Zoë 👪 ".repeat(400), pad: "x".repeat(3000) });
  await assert.rejects(secureStore.setItemAsync("probe", big), /larger than 2048/u);
  for (const part of splitUtf8(big)) {
    assert.ok(new TextEncoder().encode(part).length <= 1800);
  }
  await secureSessionStorage.setItem("sb-test-auth-token", big);
  assert.equal(await secureSessionStorage.getItem("sb-test-auth-token"), big);
  await secureSessionStorage.setItem("sb-test-auth-token", "small");
  assert.equal(await secureSessionStorage.getItem("sb-test-auth-token"), "small");
  assert.equal(secureStore.store.has("sb-test-auth-token.0"), false, "stale chunks removed");
  await secureSessionStorage.removeItem("sb-test-auth-token");
  assert.equal(await secureSessionStorage.getItem("sb-test-auth-token"), null);
});

let userId = null;
await step("verify code, session persists, restart, first API calls succeed", async () => {
  resetStore();
  const app = await freshApp("signin");
  const supabase = app.getSupabase();
  assert.ok(supabase, "client configured");
  const before = requestLog.length;
  const result = await verifyEmailCode(supabase, testEmail, await emailOtp(), {
    storage: secureSessionStorage,
    storageKey,
    sleep: noSleep,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  userId = result.session.user.id;
  const sessionBytes = new TextEncoder().encode(
    await secureSessionStorage.getItem(storageKey),
  ).length;
  console.log(
    `       session ${sessionBytes} bytes stored in ${
      [...secureStore.store.keys()].filter((k) => k.startsWith(storageKey)).length
    } SecureStore entries (largest ${secureStore.state.maxValueBytes} bytes)`,
  );
  assert.ok(secureStore.state.maxValueBytes <= 2048);
  assert.ok(
    !requestLog.slice(before).some((r) => r.url.includes("/auth/v1/logout")),
    "sign-in must not call /logout",
  );

  const restarted = await freshApp("restart");
  const client2 = restarted.getSupabase();
  const { data } = await client2.auth.getSession();
  assert.equal(data.session?.user.id, userId, "getSession after restart returns the user");

  const circles = await journal.loadCircles(client2, userId);
  assert.ok(circles.length > 0, "loadCircles returns the test circle");
  const page = await journal.loadTimelinePage(client2, {
    circleId: null,
    fallbackCircleId: circles[0].circleId,
  });
  console.log(`       ${circles.length} circle(s), ${page.moments.length} moment(s) on first page`);

  const headers = await restarted.mediaRequestHeaders();
  assert.ok(headers?.Cookie?.startsWith(`${storageKey}`), "media cookie header built");
  const photo = page.moments.find((m) => m.photos.length > 0);
  if (photo) {
    const path = journal.photoDeliveryPath(photo.id, photo.photos[0].id);
    const res = await realFetch(restarted.mediaUrl(path), { headers, redirect: "manual" });
    console.log(`       media ${path.split("?")[0]} -> HTTP ${res.status}`);
    assert.ok(res.status !== 401 && res.status !== 403, `media request rejected: ${res.status}`);
  }
  await client2.auth.signOut({ scope: "local" });
});

await step("transient 401 (PGRST303) right after verify does not sign out", async () => {
  resetStore();
  const app = await freshApp("transient");
  const supabase = app.getSupabase();
  let injected = 0;
  const wrapped = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/rest/v1/circle_memberships") && injected === 0) {
      injected += 1;
      requestLog.push({ url, status: 401 });
      return new Response(
        JSON.stringify({ code: "PGRST303", message: "JWT issued at future", details: null, hint: null }),
        { status: 401, headers: { "content-type": "application/json", "proxy-status": "PostgREST; error=PGRST303" } },
      );
    }
    return wrapped(input, init);
  };
  const before = requestLog.length;
  try {
    const result = await verifyEmailCode(supabase, testEmail, await emailOtp(), {
      storage: secureSessionStorage,
      storageKey,
      sleep: noSleep,
    });
    assert.equal(injected, 1, "fault was injected");
    assert.equal(result.ok, true, result.ok ? "" : result.message);
    assert.ok(!requestLog.slice(before).some((r) => r.url.includes("/auth/v1/logout")));
    const { data } = await supabase.auth.getSession();
    assert.equal(data.session?.user.id, userId);
  } finally {
    globalThis.fetch = wrapped;
  }
  await supabase.auth.signOut({ scope: "local" });
});

await step("PGRST303 on the first request to every endpoint is retried by the app client", async () => {
  // Shape of Brian's failures (1:01:58 and 1:44:36 PM PT): verify 200, then
  // the first REST calls get 401 PGRST303 while a parallel one passes.
  resetStore();
  const app = await freshApp("pgrst303");
  const supabase = app.getSupabase();
  const seen = new Set();
  let injected = 0;
  const wrapped = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const path = new URL(url).pathname;
    if (path.startsWith("/rest/v1/") && !seen.has(path)) {
      seen.add(path);
      injected += 1;
      requestLog.push({ url, status: 401 });
      return new Response(
        JSON.stringify({ code: "PGRST303", details: null, hint: null, message: "JWT issued at future" }),
        { status: 401, headers: { "content-type": "application/json", "proxy-status": "PostgREST; error=PGRST303" } },
      );
    }
    return wrapped(input, init);
  };
  const before = requestLog.length;
  try {
    let sleeps = 0;
    const result = await verifyEmailCode(supabase, testEmail, await emailOtp(), {
      storage: secureSessionStorage,
      storageKey,
      sleep: async () => {
        sleeps += 1;
      },
    });
    assert.equal(result.ok, true, result.ok ? "" : result.message);
    assert.equal(sleeps, 0, "circle check passed on its first auth-flow attempt (fetch-level retry)");
    const [circles] = await Promise.all([
      journal.loadCircles(supabase, result.session.user.id),
      supabase.from("circles").select("id").limit(1).throwOnError(),
    ]);
    assert.ok(circles.length > 0);
    assert.ok(injected >= 2, `injected ${injected} PGRST303 responses`);
    assert.ok(!requestLog.slice(before).some((r) => r.url.includes("/auth/v1/logout")));
    console.log(`       ${injected} injected PGRST303 responses, all retried; no /logout`);
  } finally {
    globalThis.fetch = wrapped;
  }
  await supabase.auth.signOut({ scope: "local" });
});

await step("operations user posts a test-circle note, sees it on All circles, then deletes it", async () => {
  resetStore();
  const app = await freshApp("post-note");
  const supabase = app.getSupabase();
  const result = await verifyEmailCode(supabase, testEmail, await emailOtp(), {
    storage: secureSessionStorage,
    storageKey,
    sleep: noSleep,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  const posts = await import("../src/lib/posts.ts");
  const { circleToday } = await import("../src/lib/dates.ts");
  const circles = await journal.loadCircles(supabase, result.session.user.id);
  const circleName = process.env.E2E_TEST_CIRCLE_NAME ?? "TARS e2e test";
  const circle = circles.find((item) => item.name === circleName);
  assert.ok(circle, `circle "${circleName}" was not found; refusing to post into another circle`);
  const body = `E2E note ${Date.now()}`;
  const created = await posts.createWrittenMoment(supabase, {
    journalPersonId: circle.personId,
    circleId: circle.circleId,
    body,
    occurredOn: circleToday(circle.timeZone),
    audience: "family",
    circleIds: [circle.circleId],
  });
  assert.equal(created.ok, true, created.ok ? "" : created.message);
  const page = await journal.loadTimelinePage(supabase, {
    circleId: null,
    viewerMembershipIds: circles.map((item) => item.membershipId),
  });
  assert.ok(
    page.moments.some((moment) => moment.body.includes(body)),
    "new note should appear on All circles",
  );
  const trashed = await posts.trashWrittenMoment(supabase, created.momentId, 1);
  assert.equal(trashed.ok, true, trashed.ok ? "" : trashed.message);
  await supabase.auth.signOut({ scope: "local" });
});

await step("OTA runtime is 0.2.0 so build 5 cannot receive this JS", async () => {
  const fs = await import("node:fs");
  const appJson = JSON.parse(fs.readFileSync(new URL("../app.json", import.meta.url), "utf8"));
  const easJson = JSON.parse(fs.readFileSync(new URL("../eas.json", import.meta.url), "utf8"));
  assert.equal(appJson.expo.runtimeVersion?.policy, "appVersion");
  assert.equal(
    appJson.expo.version,
    "0.2.0",
    "runtime follows the app version; 0.2.0 must not be delivered to build 5",
  );
  assert.match(appJson.expo.updates?.url ?? "", /^https:\/\/u\.expo\.dev\//u);
  assert.equal(easJson.build.production.channel, "production");
});

await step("wrong code returns a visible error", async () => {
  resetStore();
  const app = await freshApp("wrong");
  const result = await verifyEmailCode(app.getSupabase(), testEmail, "000000", {
    storage: secureSessionStorage,
    storageKey,
    sleep: noSleep,
  });
  assert.equal(result.ok, false);
  assert.ok(result.message.length > 10);
  console.log(`       message: ${result.message}`);
});

await step("SecureStore write failure returns a visible error", async () => {
  resetStore();
  const app = await freshApp("storefail");
  const supabase = app.getSupabase();
  secureStore.state.failWrites = true;
  const result = await verifyEmailCode(supabase, testEmail, await emailOtp(), {
    storage: secureSessionStorage,
    storageKey,
    sleep: noSleep,
  });
  secureStore.state.failWrites = false;
  assert.equal(result.ok, false);
  console.log(`       message: ${result.message}`);
  // The server-side session from this verify was never stored; it expires
  // with the refresh token like any abandoned sign-in.
});

resetStore();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
