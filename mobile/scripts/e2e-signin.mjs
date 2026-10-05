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

// Set the app config env before the first app module import: config.ts reads
// it once at load, and the offline steps below import journal.ts first.
const { service, publishable } = await loadKeys();
process.env.EXPO_PUBLIC_SUPABASE_URL = supabaseUrl;
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishable;
process.env.EXPO_PUBLIC_SITE_URL ??= "https://our-days-neon.vercel.app";

await step("journal module loads under plain Node", async () => {
  const loaded = await import("../src/lib/journal.ts");
  assert.equal(typeof loaded.loadTimelinePage, "function");
  assert.equal(typeof loaded.photoDeliveryPath, "function");
});

await step("cold open shows the feed once and does not reload after it is visible", async () => {
  const cold = await import("../src/lib/cold-start.ts");
  const mounts = cold.feedMountsOnColdStart([
    { ready: false, signedIn: false },
    { ready: false, signedIn: true },
    { ready: true, signedIn: true },
    { ready: true, signedIn: true },
  ]);
  assert.equal(mounts, 1, "session restore must not enter the feed twice");
  assert.equal(cold.coldStartSurface(false, true), "splash");
  assert.equal(cold.coldStartSurface(true, true), "feed");
  assert.equal(cold.coldStartSurface(true, false), "sign-in");
  assert.equal(
    cold.shouldReloadUpdate({
      dev: false,
      enabled: true,
      available: true,
      isNew: true,
      elapsedMs: 200,
      windowMs: 10_000,
      revealed: true,
    }),
    false,
    "an OTA reload after the feed is visible would launch it again",
  );
  assert.equal(
    cold.shouldReloadUpdate({
      dev: false,
      enabled: true,
      available: true,
      isNew: true,
      elapsedMs: 200,
      windowMs: 10_000,
      revealed: false,
    }),
    true,
  );
});

await step("archived circles stay off Who can see this", async () => {
  const journal = await import("../src/lib/journal.ts");
  const keyboard = await import("../src/lib/composer-keyboard.ts");
  const circles = [
    { circleId: "home", name: "Home", archivedAt: null },
    { circleId: "empty", name: "Empty", archivedAt: "2026-09-23T01:13:39Z" },
  ];
  assert.deepEqual(
    journal.postableCircles(circles).map((circle) => circle.name),
    ["Home"],
  );
  assert.equal(journal.initialAudienceCircleId(circles, "empty"), "home");
  assert.equal(journal.initialAudienceCircleId(circles, "home"), "home");
  assert.equal(keyboard.adjacentComposerField(["body", "place"], "body", 1), "place");
  assert.equal(keyboard.adjacentComposerField(["body", "place"], "place", 1), null);
  assert.equal(keyboard.adjacentComposerField(["body", "place"], "place", -1), "body");
  assert.equal(keyboard.adjacentComposerField(["body", "place"], "body", -1), null);
  assert.equal(
    keyboard.composerSheetHeight({
      windowHeight: 852,
      topGap: 59,
      keyboardInset: 336,
      choosing: false,
    }),
    852 - 59 - 336,
  );
});

await step("photo menu matches the web and people stay in join order", async () => {
  const media = await import("../src/lib/pick-media.ts");
  const roster = await import("../src/lib/roster.ts");
  assert.deepEqual(media.mediaMenuOptions, [
    "Photo Library",
    "Take Photo or Video",
    "Choose Files",
  ]);
  assert.equal(media.mediaSourceForMenuIndex(0), "library");
  assert.equal(media.mediaSourceForMenuIndex(1), "camera");
  assert.equal(media.mediaSourceForMenuIndex(2), "files");
  assert.equal(media.mediaSourceForMenuIndex(3), null);
  assert.deepEqual(
    media.mediaMenuItems.map((item) => item.symbol),
    ["photo.on.rectangle", "camera", "folder"],
  );
  assert.equal(media.mediaSourceForMenuId("library"), "library");
  assert.equal(media.mediaSourceForMenuId("camera"), "camera");
  assert.equal(media.mediaSourceForMenuId("files"), "files");
  assert.equal(media.mediaSourceForMenuId("cancel"), null);
  assert.equal(media.usesNativeMediaMenu("ios", true), true);
  assert.equal(media.usesNativeMediaMenu("ios", false), false);
  assert.equal(media.usesNativeMediaMenu("android", true), false);
  assert.equal(media.usesNativeMediaMenu("web", true), false);
  const bible = await import("../src/lib/bible-picker.ts");
  assert.equal(
    bible.passageSheetMaxHeight({ windowHeight: 852, topInset: 59, keyboardHeight: 336 }),
    852 - 59 - 336 - 8,
  );
  const menu = await import("../src/lib/moment-menu.ts");
  const own = { viewerMembershipIds: ["me"], authorMembershipId: "me" };
  const other = { viewerMembershipIds: ["me"], authorMembershipId: "them" };
  assert.deepEqual(menu.momentOverflowActions({ kind: "thought", canChange: true, ...own }), ["edit", "delete", "report"]);
  assert.deepEqual(menu.momentOverflowActions({ kind: "photo", canChange: true, ...own }), ["edit", "delete", "report"]);
  assert.deepEqual(menu.momentOverflowActions({ kind: "video", canChange: true, ...own }), ["edit", "delete", "report"]);
  assert.deepEqual(menu.momentOverflowActions({ kind: "insight", canChange: true, ...own }), ["delete", "report"]);
  assert.deepEqual(menu.momentOverflowActions({ kind: "thought", canChange: false, ...other }), ["report", "block"]);
  assert.deepEqual(menu.momentOverflowActions({ kind: "thought", canChange: false, pending: true, ...other }), []);
  assert.deepEqual(menu.commentOverflowActions({ canChange: true, ...own }), ["edit", "delete", "report"]);
  assert.deepEqual(menu.commentOverflowActions({ canChange: false, ...other }), ["report", "block"]);
  assert.equal(menu.blockActionTitle("Ada"), "Block Ada");
  const mvhd = new Uint8Array(28);
  mvhd.set([0x6d, 0x76, 0x68, 0x64, 0, 0, 0, 0]);
  new DataView(mvhd.buffer).setUint32(16, 1000);
  new DataView(mvhd.buffer).setUint32(20, 2500);
  assert.equal(media.mp4DurationMs(mvhd), 2500);
  const ordered = roster.orderTaggablePeople([
    { id: "bea", name: "Bea", createdAt: "2026-02-01T00:00:00Z" },
    { id: "ada", name: "Ada", createdAt: "2026-01-01T00:00:00Z" },
  ]);
  assert.deepEqual(
    ordered.map((person) => person.name),
    ["Ada", "Bea"],
  );
});

await step("post edit matches the web: draft, photo plan, time, mentions, and revision", async () => {
  const edit = await import("../src/lib/moment-edit.ts");
  const save = await import("../src/lib/moment-edit-save.ts");
  const base = {
    id: "m1",
    kind: "photo",
    canChange: true,
    revision: 3,
    body: "Hi @Ada at the park",
    title: "",
    placeName: "Park",
    latitude: 1,
    longitude: 2,
    occurredOn: "2026-10-01",
    occurredAt: "2026-10-01T16:30:00.000Z",
    occurredTimezone: "America/Los_Angeles",
    timePrecision: "minute",
    taggedPersonIds: ["p1"],
    taggedPeopleLabel: "Ada",
    photos: [
      { id: "a", width: 4, height: 3 },
      { id: "b", width: 4, height: 3 },
      { id: "c", width: 4, height: 3 },
    ],
    mentions: [{ userId: "u1", start: 3, end: 7, label: "@Ada" }],
    audience: "family",
    linkedCircleIds: ["c1"],
  };
  assert.deepEqual(menuFor(edit, base), true);
  assert.equal(edit.canEditMoment({ ...base, kind: "insight" }), false);
  assert.equal(edit.canEditMoment({ ...base, canChange: false }), false);
  const initial = edit.buildEditDraft(base);
  assert.equal(initial.mode, "photo");
  assert.equal(initial.occurredTime, "09:30", "recorded wall clock in the poster's zone");
  assert.deepEqual(initial.photos.map((photo) => photo.existingPhotoId), ["a", "b", "c"]);
  assert.equal(edit.editIsDirty(initial, initial), false);
  const picked = { bytes: new ArrayBuffer(4), mimeType: "image/jpeg", name: "n.jpg", kind: "photo", durationMs: null, previewUri: "x", posterUri: null, poster: null };
  const moved = edit.movePhoto(initial.photos.filter((photo) => photo.key !== "b"), 1, 0);
  const draft = {
    ...initial,
    body: "Hi there @Ada at the park!",
    occurredTime: "07:15",
    photos: [...moved, { key: "new1", picked }],
  };
  assert.equal(edit.editIsDirty(draft, initial), true);
  const plan = edit.photoEditPlan(initial.photos, draft.photos);
  assert.deepEqual(plan.removedIds, ["b"]);
  assert.deepEqual(plan.reorderIds, ["c", "a"]);
  assert.equal(plan.added.length, 1);
  assert.equal(plan.changed, true);
  assert.equal(edit.photoEditPlan(initial.photos, initial.photos).changed, false);
  // Unchanged time keeps the recorded instant and zone; a changed one uses this device.
  assert.deepEqual(edit.editOccurrence(initial, initial, base, "Europe/London"), {
    occurredAt: base.occurredAt,
    occurredTimezone: base.occurredTimezone,
  });
  const changed = edit.editOccurrence(draft, initial, base, "America/New_York");
  assert.equal(changed.occurredTimezone, "America/New_York");
  assert.equal(changed.occurredAt, new Date("2026-10-01T07:15:00").toISOString());
  assert.deepEqual(edit.editOccurrence({ ...draft, occurredTime: "" }, initial, base, "UTC"), {
    occurredAt: null,
    occurredTimezone: null,
  });
  const remapped = edit.remapMentions(base.body, draft.body, base.mentions);
  assert.deepEqual(remapped.map((span) => [span.start, span.end]), [[9, 13]]);
  assert.deepEqual(edit.remapMentions(base.body, "No mention now", base.mentions), []);
  assert.equal(edit.editValidationError({ ...draft, body: "  " }, initial), null, "a photo post may have no note");
  assert.equal(
    edit.editValidationError({ ...edit.buildEditDraft({ ...base, kind: "thought", photos: [] }), body: " " }),
    "Write a thought before saving this moment.",
  );
  assert.equal(
    edit.editValidationError({ ...draft, shareToCircleId: "c2" }, initial),
    "Save your photo changes first, then reopen Edit to share this post.",
  );
  const write = save.editWrite(base, initial, draft, "America/New_York");
  assert.equal(write.ok, true);
  assert.equal(write.edit.revision, 3, "saves against the post's own revision");
  const shown = edit.optimisticEditedMoment(base, draft, changed, "Ada", write.edit.mentions);
  assert.equal(shown.body, "Hi there @Ada at the park!");
  assert.equal(shown.revision, 3, "the optimistic card keeps the old revision until the server answers");
  assert.deepEqual(shown.photos.slice(0, 2).map((photo) => photo.id), ["c", "a"]);

  // Orchestration with a fake server: optimistic, then revision from update_family_moment only.
  const calls = [];
  const fake = (responses) => ({
    rpc: async (name, args) => {
      calls.push([name, args]);
      return responses[name] ?? { data: null, error: null };
    },
  });
  let card = base;
  const reopened = [];
  const noAdd = { ...draft, photos: moved };
  const ok = await save.runMomentEdit(
    fake({ update_family_moment: { data: 4, error: null } }),
    {
      moment: base,
      initial,
      draft: noAdd,
      taggedLabel: "Ada",
      deviceTimeZone: "America/New_York",
      patch: (id, update) => {
        card = update(card);
      },
      reopen: (state) => reopened.push(state),
      loadPhotos: async () => [base.photos[2], base.photos[0]],
      wait: async () => {},
    },
  );
  assert.equal(ok.ok, true, ok.message);
  assert.equal(card.revision, 4);
  assert.equal(card.body, "Hi there @Ada at the park!");
  assert.deepEqual(card.photos.map((photo) => photo.id), ["c", "a"]);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["update_family_moment", "remove_moment_photo", "reorder_moment_photos"],
  );
  assert.equal(reopened.length, 0);
  // Conflict: the card goes back, the sheet reopens with the draft and the web copy.
  card = base;
  let refreshed = 0;
  const conflict = await save.runMomentEdit(
    fake({ update_family_moment: { data: null, error: { code: "PT409", message: "revision conflict" } } }),
    {
      moment: base,
      initial,
      draft: noAdd,
      taggedLabel: "Ada",
      deviceTimeZone: "America/New_York",
      patch: (id, update) => {
        card = update(card);
      },
      reopen: (state) => reopened.push(state),
      refresh: () => {
        refreshed += 1;
      },
      loadPhotos: async () => null,
      wait: async () => {},
    },
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict, true);
  assert.equal(card.body, base.body);
  assert.equal(card.revision, 3);
  assert.equal(reopened[0].error, "This moment changed elsewhere. Reopen it before editing again.");
  assert.equal(reopened[0].draft.body, noAdd.body);
  assert.equal(refreshed, 1);
});

await step("dragging a photo thumb opens a live gap, settles into it, and keeps VoiceOver moves", async () => {
  const reorder = await import("../src/lib/thumb-reorder.ts");
  const fs = await import("node:fs");
  const step = 80;
  assert.equal(reorder.dragSlot(0, 0, 4, step), 0);
  assert.equal(reorder.dragSlot(0, 39, 4, step), 0, "under half a slot stays put");
  assert.equal(reorder.dragSlot(0, 41, 4, step), 1);
  assert.equal(reorder.dragSlot(1, 170, 4, step), 3);
  assert.equal(reorder.dragSlot(1, 900, 4, step), 3, "clamped to the last slot");
  assert.equal(reorder.dragSlot(2, -900, 4, step), 0, "clamped to the first slot");
  // Drag 0 over slot 2: thumbs 1 and 2 slide left one slot, 3 stays.
  assert.deepEqual([0, 1, 2, 3].map((i) => reorder.makeRoomOffset(i, 0, 2, step)), [0, -80, -80, 0]);
  // Drag 3 over slot 1: thumbs 1 and 2 slide right.
  assert.deepEqual([0, 1, 2, 3].map((i) => reorder.makeRoomOffset(i, 3, 1, step)), [0, 80, 80, 0]);
  assert.deepEqual([0, 1, 2].map((i) => reorder.makeRoomOffset(i, 1, 1, step)), [0, 0, 0]);
  const strip = fs.readFileSync(new URL("../src/components/edit-photo-strip.tsx", import.meta.url), "utf8");
  assert.match(strip, /isReduceMotionEnabled/, "Reduce Motion turns springs into instant moves");
  assert.match(strip, /name: "moveLeft", label: "Move left"/);
  assert.match(strip, /name: "moveRight", label: "Move right"/);
  assert.match(strip, /liftHaptic\(\)/);
  assert.match(strip, /slotHaptic\(\)/);
  const haptics = fs.readFileSync(new URL("../src/lib/haptics.ts", import.meta.url), "utf8");
  assert.match(haptics, /import\("expo-haptics"\)\.catch/, "haptics load lazily so older binaries never crash");
});

await step("tapping a post's place opens Apple Maps with the web's URL", async () => {
  const feed = await import("../src/lib/feed-format.ts");
  const fs = await import("node:fs");
  // Same vectors as the web's place-coordinates / moment-place-meta tests.
  assert.equal(
    feed.appleMapsUrl("Sand Harbor, NV, United States", 39.2, -119.93),
    "https://maps.apple.com/?ll=39.2,-119.93&q=Sand%20Harbor&z=12",
  );
  assert.equal(
    feed.appleMapsUrl("Bass Lake", 37.3247, -119.5664),
    "https://maps.apple.com/?ll=37.3247,-119.5664&q=Bass%20Lake&z=12",
  );
  assert.equal(feed.appleMapsUrl("The porch", "35.28", "-120.66"), "https://maps.apple.com/?ll=35.28,-120.66&q=The%20porch&z=12");
  assert.equal(feed.appleMapsUrl("", 35.28, -120.66), "https://maps.apple.com/?ll=35.28,-120.66&q=35.28%2C-120.66&z=12");
  assert.equal(feed.appleMapsUrl("Oak Street School", null, null), null, "a typed name without a pin is not a link");
  assert.equal(feed.appleMapsUrl("Nowhere", 91, 0), null);
  const card = fs.readFileSync(new URL("../src/components/moment-card.tsx", import.meta.url), "utf8");
  assert.match(card, /accessibilityLabel=\{`Open \$\{label\} in Maps`\}/);
  assert.match(card, /Linking\.openURL\(url\)/);
});

function menuFor(edit, moment) {
  return edit.canEditMoment(moment);
}

await step("bible books group by testament and verses are a number list", async () => {
  const picker = await import("../src/lib/bible-picker.ts");
  const groups = picker.bibleBookGroups("");
  assert.deepEqual(
    groups.map((group) => group.testament),
    ["Old Testament", "New Testament"],
  );
  assert.equal(groups[0]?.books[0], "Genesis");
  assert.equal(groups[0]?.books.at(-1), "Malachi");
  assert.equal(groups[1]?.books[0], "Matthew");
  assert.equal(groups[1]?.books.at(-1), "Revelation");
  const john = picker.bibleBookGroups("john");
  assert.deepEqual(john.map((group) => group.testament), ["New Testament"]);
  assert.deepEqual(john[0]?.books, ["John", "1 John", "2 John", "3 John"]);
  assert.deepEqual(picker.bibleBookGroups("zzz"), []);
  const jonah = { book: "Jonah", chapter: null, startVerse: null, endVerse: null };
  assert.deepEqual(picker.bibleNumberChoices("chapter", jonah), [1, 2, 3, 4]);
  assert.equal(
    picker.bibleNumberChoices("start", { ...jonah, chapter: 1 }).length,
    17,
  );
  assert.deepEqual(picker.bibleNumberChoices("end", { ...jonah, chapter: 1 }), []);
});

await step("post and comment hearts are optimistic and roll back like the web; double tap hearts a comment", async () => {
  const c = await import("../src/lib/conversation-state.ts");
  const note = {
    id: "n1", authorName: "Molly", authorAccent: "sage", body: "hi", createdAt: "2026-10-03T16:00:00Z",
    heartCount: 1, heartedByViewer: false, heartNames: ["Molly"], canChange: false, revision: 3, mentions: [],
  };
  const hearted = c.withNoteHeart([note], "n1", "TARS", true);
  assert.deepEqual(hearted[0].heartNames, ["Molly", "TARS"]);
  assert.equal(hearted[0].heartCount, 2);
  assert.equal(hearted[0].heartedByViewer, true);
  assert.equal(c.withNoteHeart(hearted, "n1", "TARS", true)[0].heartCount, 2, "a second heart never double-counts");
  assert.equal(hearted[0].revision, 3, "a heart never changes the comment's revision");
  const rolled = c.revertNoteHeart(hearted, note);
  assert.equal(rolled[0].heartCount, 1);
  assert.equal(rolled[0].heartedByViewer, false);
  assert.equal(rolled[0].revision, 3);

  const loved = c.withViewerLove([{ id: "r1", personName: "Molly", reactionId: "held-close", isCurrentMember: false }], "TARS", "m1", true);
  assert.deepEqual(loved.map((r) => r.personName), ["Molly", "TARS"]);
  assert.deepEqual(c.withViewerLove(loved, "TARS", "m1", false).map((r) => r.personName), ["Molly"]);

  const saved = c.newNote({ id: "n2", authorName: "TARS", authorAccent: "sky", body: "hey @Molly", mentions: [{ userId: "u", name: "Molly", start: 4, end: 10 }] });
  assert.equal(saved.mentions[0].active, true);
  assert.equal(saved.canChange, true);

  assert.equal(c.isNoteDoubleTap({ noteId: "n1", t: 0, x: 10, y: 10 }, { noteId: "n1", t: 250, x: 20, y: 20 }), true);
  assert.equal(c.isNoteDoubleTap({ noteId: "n1", t: 0, x: 10, y: 10 }, { noteId: "n1", t: 320, x: 10, y: 10 }), false);
  assert.equal(c.isNoteDoubleTap({ noteId: "n1", t: 0, x: 10, y: 10 }, { noteId: "n2", t: 100, x: 10, y: 10 }), false);
  assert.equal(c.isNoteDoubleTap(null, { noteId: "n1", t: 100, x: 10, y: 10 }), false);

  // The sheet posts on one tap: no Done bar in the comment sheet.
  const fs = await import("node:fs");
  const sheet = fs.readFileSync(new URL("../src/components/comment-sheet.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(sheet, /KeyboardDoneBar/);
  assert.match(sheet, /onPressIn=\{submit\}/);
});

await step("album frame is the tallest photo capped at 3:4 and swipes lock within 45°", async () => {
  const album = await import("../src/lib/album-frame.ts");
  // Fixed frame: tallest stored photo, never taller than width × 4/3.
  assert.equal(album.albumFrameHeight(390, [{ width: 1200, height: 800 }, { width: 900, height: 1600 }]), 520);
  assert.equal(album.albumFrameHeight(390, [{ width: 1200, height: 800 }, { width: 1000, height: 1000 }]), 390);
  // No stored sizes: the web 4:3 placeholder, then the first loaded photo.
  assert.equal(album.albumFrameHeight(390, [{}, {}]), 293);
  assert.equal(album.albumFrameHeight(390, [{}, {}], 2), 520);
  // 8 px slop, then horizontal only within 45°.
  assert.equal(album.swipeAxis(7, -7), null);
  assert.equal(album.swipeAxis(-12, 11), "x");
  assert.equal(album.swipeAxis(11, 12), "y");
  assert.equal(album.albumSwipeStep(-album.albumSwipeThresholdPx, 0), -1);
  assert.equal(album.albumSwipeStep(20, 0), 0);
  assert.equal(album.wrapIndex(-1, 3), 2);
});

await step("a short quick flick on a grab bar closes the sheet", async () => {
  const sheet = await import("../src/lib/sheet-dismiss.ts");
  // ~30 pt in ~48 ms: well short of the 72 pt drag threshold.
  const flick = [
    { y: 100, t: 0 },
    { y: 106, t: 16 },
    { y: 117, t: 32 },
    { y: 130, t: 48 },
  ];
  const v = sheet.releaseVelocity(flick, 52);
  assert.ok(v >= sheet.sheetDismissVelocity, `flick speed ${v}`);
  assert.equal(sheet.sheetDismissShouldCommit({ dy: 30, velocityY: v }), true);
  // Same distance, but the finger rested before lifting.
  assert.equal(sheet.releaseVelocity(flick, 200), 0);
  // A jittery tap never closes, however fast.
  assert.equal(sheet.sheetDismissShouldCommit({ dy: 10, velocityY: 3000 }), false);
  // A slow short drag springs back.
  assert.equal(sheet.sheetDismissShouldCommit({ dy: 40, velocityY: 150 }), false);
});

await step("sheet drag springs back when short and confirms unsaved text", async () => {
  const sheet = await import("../src/lib/sheet-dismiss.ts");
  assert.equal(sheet.canStartSheetDismiss(40, true), true);
  assert.equal(sheet.canStartSheetDismiss(40, false), false);
  assert.equal(sheet.canStartSheetDismiss(0, false), true);
  assert.equal(sheet.sheetDismissShouldCommit({ dy: 20, velocityY: 0 }), false);
  assert.equal(sheet.sheetDismissShouldCommit({ dy: sheet.sheetDismissThresholdPx, velocityY: 0 }), true);
  assert.equal(sheet.sheetDismissShouldCommit({ dy: 24, velocityY: sheet.sheetDismissVelocity }), true);
  assert.equal(
    sheet.sheetDismissShouldCommit({ dy: 120, velocityY: -sheet.sheetDismissVelocity }),
    false,
  );
  const initial = {
    body: "",
    title: "",
    sourceUrl: "",
    place: "",
    tags: "",
    photo: false,
    verse: "",
    occurredOn: "2026-09-30",
    occurredTime: "22:00",
    justMe: false,
    circleId: "home",
  };
  assert.equal(sheet.sheetHasUnsavedChanges(initial, initial), false);
  assert.equal(sheet.sheetHasUnsavedChanges({ ...initial, body: "A note" }, initial), true);
});

await step("a circle name is required and create starts from a circle you belong to", async () => {
  const circles = await import("../src/lib/circles.ts");
  assert.equal(circles.circleNameError("  "), "A circle name is required.");
  assert.equal(circles.circleNameError("a".repeat(81)), "Use 80 characters or fewer.");
  assert.equal(circles.circleNameError("  Family  "), null);
  const archived = {
    membershipId: "m",
    circleId: "home",
    personId: "p",
    role: "member",
    name: "Home",
    timeZone: "UTC",
    archivedAt: "2026-01-01",
  };
  const live = {
    membershipId: "m2",
    circleId: "kin",
    personId: "p",
    role: "organizer",
    name: "Kin",
    timeZone: "UTC",
    archivedAt: null,
  };
  assert.equal(circles.createCircleSourceId([archived, live]), "kin");
  assert.equal(circles.createCircleSourceId([archived]), "");
  const directory = await import("../src/lib/circle-directory.ts");
  const built = directory.buildCircleDirectory({
    people: [
      { id: "you", display_name: "Brian", profile_kind: "account", accent_token: "sky", circle_id: "home" },
      { id: "molly", display_name: "Molly", profile_kind: "account", accent_token: "clay", circle_id: "home" },
      { id: "tars", display_name: "TARS", profile_kind: "account", accent_token: "slate", circle_id: "home" },
      { id: "avery", display_name: "Avery", profile_kind: "managed", accent_token: "gold", circle_id: "home" },
    ],
    memberships: [
      { id: "m-you", person_id: "you", role: "organizer", directory_kind: "journal", circle_id: "home" },
      { id: "m-molly", person_id: "molly", role: "member", directory_kind: "journal", circle_id: "home" },
      { id: "m-tars", person_id: "tars", role: "operations", directory_kind: "operations", circle_id: "home" },
    ],
    guardians: [],
    pending: [{ emailRequestId: "req", displayName: "Ada" }],
    canRename: true,
  });
  assert.equal(directory.familyFacingCount(built.members), 3);
  assert.equal(directory.memberSubtitle(built.members[0]), "Organizer");
  assert.equal(directory.memberSubtitle(built.members[1]), undefined);
  assert.equal(directory.memberSubtitle(built.members[2]), "Operations");
  assert.equal(directory.memberSubtitle(built.members[3]), "Managed journal");
  assert.equal(directory.memberShowsMore(built.members[0], "m-you", true), false);
  assert.equal(directory.memberShowsMore(built.members[1], "m-you", true), true);
  assert.equal(directory.memberShowsMore(built.members[3], "m-you", true), true);
  assert.equal(directory.memberShowsMore(built.members[1], "m-you", false), false);
  assert.equal(directory.addFromCircleLabel(["Kin"]), "Add someone from Kin");
  assert.equal(directory.addFromCircleLabel(["Kin", "Home"]), "Add someone from another circle");
  assert.equal(directory.peopleCountLabel(5), "5 people");
});

await step("a video post shows its poster, then plays, and pauses offscreen", async () => {
  const playback = await import("../src/lib/video-playback.ts");
  const journal = await import("../src/lib/journal.ts");
  const momentId = "11111111-1111-4111-8111-111111111111";
  assert.equal(journal.videoPosterPath(momentId), `/api/media/videos/${momentId}/poster`);
  assert.equal(playback.videoDeliveryPath(momentId), `/api/media/videos/${momentId}`);
  assert.equal(playback.videoAspectRatio(1080, 1920), 1080 / 1920);
  assert.equal(playback.videoAspectRatio(undefined, undefined), 16 / 9);
  assert.equal(
    playback.insightClipStartSeconds("https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120"),
    120,
  );
  assert.equal(
    playback.insightClipStartSeconds("https://www.youtube.com/watch?v=abc&t=1m30s"),
    90,
  );
  assert.equal(
    playback.insightClipStartSeconds("https://www.youtube.com/watch?v=abc&t=1h2m3s"),
    3723,
  );
  assert.equal(
    playback.insightClipStartSeconds("https://www.youtube.com/embed/abc?start=45"),
    45,
  );
  assert.equal(playback.insightClipStartSeconds("https://example.com/clip.mp4#t=12.5"), 12.5);
  assert.equal(playback.insightClipStartSeconds("https://example.com/clip.mp4#t=10,20"), 10);
  assert.equal(playback.insightClipStartSeconds("https://example.com/no-time"), 0);
  const insight = {
    kind: "insight",
    sourceUrl: "https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120",
  };
  // The stored Insight video is the excerpt; t= is attribution for the full source.
  assert.equal(playback.clipStartSeconds(insight), 0);
  assert.equal(
    playback.clipStartSeconds({ kind: "video", sourceUrl: insight.sourceUrl }),
    0,
  );
  const poster = playback.videoPlaybackPlan({
    started: false,
    onScreen: true,
    startSeconds: 120,
  });
  assert.equal(poster.showPoster, true);
  assert.equal(poster.playing, false);
  assert.equal(poster.startSeconds, 120);
  const playing = playback.videoPlaybackPlan({
    started: true,
    onScreen: true,
    startSeconds: 120,
  });
  assert.equal(playing.showPoster, false);
  assert.equal(playing.playing, true);
  const paused = playback.videoPlaybackPlan({
    started: true,
    onScreen: false,
    startSeconds: 120,
  });
  assert.equal(paused.paused, true);
  assert.equal(paused.playing, false);
  const returned = playback.videoPlaybackPlan({
    started: true,
    onScreen: true,
    startSeconds: 120,
    resumed: false,
  });
  assert.equal(returned.playing, false);
  assert.equal(returned.paused, true);
  assert.equal(playback.videoSurfaceAction({ started: false, onScreen: true }), "play");
  assert.equal(playback.videoSurfaceAction({ started: true, onScreen: false }), "play");
  assert.equal(
    playback.videoSurfaceAction({ started: true, onScreen: true, resumed: false }),
    "play",
  );
  assert.equal(playback.usesNativePlaybackControls("ios"), true);
  assert.equal(playback.usesNativePlaybackControls("web"), false);
  assert.equal(
    playback.videoSurfaceAction({ started: true, onScreen: true, nativeControls: true }),
    "native",
  );
  assert.equal(playback.videoSurfaceAction({ started: true, onScreen: true }), "pause");
});

await step("Just me stays off circle feeds, invitations parse, and YouTube is an Insight", async () => {
  const feed = await import("../src/lib/feed-format.ts");
  const invites = await import("../src/lib/invites.ts");
  const youtube = await import("../src/lib/youtube-insight.ts");
  assert.equal(feed.momentListedInFeed({ audience: "just_me", feed: "personal" }), true);
  assert.equal(feed.momentListedInFeed({ audience: "just_me", feed: "all" }), true);
  assert.equal(feed.momentListedInFeed({ audience: "just_me", feed: "circle" }), false);
  assert.equal(feed.audienceChipLabel({ audience: "just_me" }), "Just me");
  const token = "a".repeat(40);
  assert.equal(invites.invitationTokenFromLink(`https://our-days.example/invite#${token}`), token);
  assert.equal(invites.invitationTokenFromLink(`ourdays://invite?token=${token}`), token);
  assert.equal(invites.invitationTokenFromLink("https://our-days.example/invite"), null);
  assert.equal(
    invites.invitationRedirectUrl("https://our-days-neon.vercel.app"),
    "https://our-days-neon.vercel.app/auth/callback",
  );
  assert.equal(invites.defaultInviteCircleId(["home", "test"], "test"), "test");
  assert.equal(invites.defaultInviteCircleId(["home", "test"], null), "");
  assert.equal(invites.defaultInviteCircleId(["home", "test"], "not-organizer"), "");
  assert.equal(invites.defaultInviteCircleId(["test"], null), "test");
  const clip = "https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120";
  assert.equal(youtube.loneYoutubeClip(clip), clip);
  assert.equal(youtube.loneYoutubeClip("A note https://www.youtube.com/watch?v=abc"), null);
  assert.equal(youtube.youtubeInsightAttribution("", clip), "YouTube");
  assert.equal(feed.insightSourceLabel(clip), "Listen");
});

await step("push taps open All circles on the post or comment, and permission waits", async () => {
  const push = await import("../src/lib/push-landing.ts");
  assert.equal(push.requestsPushPermissionAtColdLaunch, false);
  const token = "ExponentPushToken[e2eOperationsDevice0001]";
  assert.equal(push.validExpoPushToken(token), true);
  assert.equal(push.validExpoPushToken("https://push.example/web"), false);
  const href = push.pushHrefForLanding("moment-1", { noteId: "note-1", thread: true });
  assert.equal(href, "/family?moment=moment-1&note=note-1&thread=1");
  assert.deepEqual(push.landingFromPushData({ href }), {
    momentId: "moment-1",
    noteId: "note-1",
    openThread: true,
  });
  assert.equal(
    push.landingFromPushData({ href: "/family?moment=post-9" })?.openThread,
    false,
  );
  assert.equal(push.landingFromPushData({}), null);
});

await step("a share becomes a photo, video, or link and still needs a circle", async () => {
  const share = await import("../src/lib/share-entry.ts");
  const photo = share.draftFromShareIntent({
    type: "media",
    files: [{ path: "file:///tmp/porch.jpg", mimeType: "image/jpeg", fileName: "porch.jpg" }],
  });
  assert.equal(photo?.kind, "photo");
  assert.equal(share.shareNeedsJpeg(photo), false);
  const heic = share.draftFromShareIntent({
    type: "media",
    files: [{ path: "file:///tmp/IMG_0001.HEIC", mimeType: "image/heic", fileName: "IMG_0001.HEIC" }],
  });
  assert.equal(heic?.kind, "photo");
  assert.equal(share.shareNeedsJpeg(heic), true, "HEIC from Photos is re-encoded as JPEG before upload");
  const heicNoMime = share.draftFromShareIntent({
    type: "media",
    files: [{ path: "file:///tmp/IMG_0002.heic", fileName: "IMG_0002.heic" }],
  });
  assert.equal(share.shareNeedsJpeg(heicNoMime), true);
  const video = share.draftFromShareIntent({
    type: "media",
    files: [{
      path: "file:///tmp/clip.mov",
      mimeType: "video/quicktime",
      fileName: "clip.mov",
      duration: 4000,
    }],
  });
  assert.equal(video?.kind, "video");
  if (video?.kind === "video") assert.equal(video.durationMs, 4000);
  const link = share.draftFromShareIntent({
    type: "weburl",
    webUrl: "https://example.com/story",
    text: "https://example.com/story",
  });
  assert.equal(link?.kind, "link");
  assert.equal(share.draftFromShareIntent({ text: "  ", files: [] }), null);
  assert.equal(share.shareCircleChosen(""), false);
  assert.equal(share.shareCircleChosen("circle-1"), true);
});


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

await step("card time keeps the poster's zone label even with Hermes formatToParts", async () => {
  const time = await import("../src/lib/moment-time.ts");
  const original = Intl.DateTimeFormat.prototype.formatToParts;
  // Hermes on iOS splits the formatted string on punctuation, so "GMT-7" is a "GMT" part.
  Intl.DateTimeFormat.prototype.formatToParts = function (date) {
    return this.format(date)
      .split(/([^\p{L}\p{N}]+)/u)
      .filter(Boolean)
      .map((value) => ({ type: /^[\p{L}\p{N}]+$/u.test(value) ? (value === "GMT" ? "timeZoneName" : "literal") : "literal", value }));
  };
  try {
    const header = (occurredTimezone, viewerTimeZone) =>
      time.formatRecordedMomentHeader({
        occurredOn: "2026-10-01",
        occurredAt: "2026-10-01T17:45:00Z",
        occurredTimezone,
        viewerTimeZone,
        viewerYear: 2026,
      });
    assert.equal(header("UTC", "America/Los_Angeles"), "Oct 1 · 5:45 PM UTC");
    assert.equal(header("America/New_York", "America/Los_Angeles"), "Oct 1 · 1:45 PM New York");
    assert.equal(header("America/Los_Angeles", "America/Los_Angeles"), "Oct 1 · 10:45 AM");
    assert.equal(header("America/Vancouver", "America/Los_Angeles"), "Oct 1 · 10:45 AM");
    assert.equal(header("Asia/Kolkata", "America/Los_Angeles"), "Oct 1 · 11:15 PM Kolkata");
  } finally {
    Intl.DateTimeFormat.prototype.formatToParts = original;
  }
});

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

await step("operations user posts a test-circle note, sees it on All circles, edits it, then deletes it", async () => {
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
  const listed = page.moments.find((moment) => moment.body.includes(body));
  assert.equal(listed.revision, 1, "the feed carries the revision the ••• menu edits against");
  const edited = await posts.updateWrittenMoment(supabase, {
    momentId: created.momentId,
    revision: listed.revision,
    body: `${body} edited`,
    occurredOn: listed.occurredOn,
    occurredAt: listed.occurredAt,
    occurredTimezone: listed.occurredTimezone,
  });
  assert.equal(edited.ok, true, edited.ok ? "" : edited.message);
  assert.equal(edited.revision, 2);
  const stale = await posts.updateWrittenMoment(supabase, {
    momentId: created.momentId,
    revision: 1,
    body: `${body} stale`,
    occurredOn: listed.occurredOn,
  });
  assert.equal(stale.ok, false, "an edit against an old revision is refused");
  const trashed = await posts.trashWrittenMoment(supabase, created.momentId, edited.revision);
  assert.equal(trashed.ok, true, trashed.ok ? "" : trashed.message);
  await supabase.auth.signOut({ scope: "local" });
});

await step("sheets over the feed keep taps with the keyboard up, and sign-out stays on this iPhone", async () => {
  const fs = await import("node:fs");
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("../src/app/journal.tsx"), /<FlatList[^>]*?keyboardShouldPersistTaps="handled"/s);
  assert.match(read("../src/components/settings-screen.tsx"), /<ScrollView\s+keyboardShouldPersistTaps="handled"/);
  // Post edit lives in the add sheet now (web: the composer in edit mode).
  assert.match(read("../src/components/add-sheet.tsx"), /<KeyboardAvoidingView/);
  assert.doesNotMatch(read("../src/components/moment-menu.tsx"), /<TextInput/);
  assert.doesNotMatch(read("../src/components/keyboard-form.tsx"), /<InputAccessoryView/);
  assert.match(read("../src/components/keyboard-form.tsx"), />\s*Done\s*</);
  assert.doesNotMatch(read("../src/components/comment-sheet.tsx"), /KeyboardDoneBar/);
  // Grab-bar dismiss: the responder sits on the sheet's Animated.View, not on a bare header View.
  for (const file of ["../src/components/comment-sheet.tsx"]) {
    assert.match(read(file), /<Animated\.View\s+\{\.\.\.sheetProps\}/);
    assert.match(read(file), /<View \{\.\.\.chromeProps\}>/);
    assert.doesNotMatch(read(file), /\{\.\.\.panHandlers\}/);
  }
  // Each edit mounts a fresh sheet (keyed), so it always starts at rest with the post's own values.
  assert.match(read("../src/app/journal.tsx"), /key=\{editing\.key\}/);
  // Header drag uses raw touches; PanResponder moves never reach a sheet inside a Modal on iOS.
  assert.match(read("../src/components/sheet-drag.tsx"), /onTouchMove: \(event: ChromeTouch\)/);
  assert.doesNotMatch(read("../src/components/keyboard-form.tsx"), /Previous field/);
  assert.match(read("../src/components/auth-provider.tsx"), /auth\.signOut\(\{ scope: "local" \}\)/);
});

await step("mentions banner keeps the web Got it dismiss", async () => {
  const fs = await import("node:fs");
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const banner = read("../src/components/journal-banner.tsx");
  const journal = read("../src/app/journal.tsx");
  assert.match(banner, /ctaLabel: "Got it"/);
  assert.match(banner, /glyph: "@"/);
  assert.match(banner, /They'll get a notice so they don't miss it\./);
  assert.equal((banner.match(/onPress=\{onDismiss\}/g) ?? []).length, 2);
  assert.match(journal, /const mentionsKey = "our-days:mentions-announcement"/);
  assert.match(journal, /writePref\(mentionsStoreKey, "dismissed"\)/);
  assert.match(journal, /getItemAsync\(mentionsStoreKey\)/);
  // The native key must be one SecureStore accepts, or the dismissal is lost on iPhone.
  const nativeKey = journal.match(/const mentionsStoreKey = [^?]+\? mentionsKey : "([^"]+)"/)?.[1];
  assert.ok(nativeKey, "native mentions key");
  const secure = await import("./e2e/mock-secure-store.mjs");
  await secure.setItemAsync(nativeKey, "dismissed");
  assert.equal(await secure.getItemAsync(nativeKey), "dismissed");
  await assert.rejects(secure.setItemAsync("our-days:mentions-announcement", "dismissed"));
  assert.match(journal, /value === "dismissed"/);
});

await step("edit, heart a few times, then delete your own test-circle comment (build 15 PT409)", async () => {
  resetStore();
  const app = await freshApp("comment-delete");
  const supabase = app.getSupabase();
  const result = await verifyEmailCode(supabase, testEmail, await emailOtp(), {
    storage: secureSessionStorage,
    storageKey,
    sleep: noSleep,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  const posts = await import("../src/lib/posts.ts");
  const conversation = await import("../src/lib/conversation.ts");
  const state = await import("../src/lib/conversation-state.ts");
  const { circleToday } = await import("../src/lib/dates.ts");
  const circles = await journal.loadCircles(supabase, result.session.user.id);
  const circleName = process.env.E2E_TEST_CIRCLE_NAME ?? "TARS e2e test";
  const circle = circles.find((item) => item.name === circleName);
  assert.ok(circle, `circle "${circleName}" was not found; refusing to post into another circle`);
  const created = await posts.createWrittenMoment(supabase, {
    journalPersonId: circle.personId,
    circleId: circle.circleId,
    body: `E2E delete-comment post ${Date.now()}`,
    occurredOn: circleToday(circle.timeZone),
    audience: "family",
    circleIds: [circle.circleId],
  });
  assert.equal(created.ok, true, created.ok ? "" : created.message);
  try {
    const noted = await conversation.createMomentNote(supabase, { momentId: created.momentId, body: "Co" });
    assert.equal(noted.ok, true, noted.ok ? "" : noted.message);
    const load = async () => {
      const page = await journal.loadTimelinePage(supabase, {
        circleId: circle.circleId,
        viewerMembershipIds: [circle.membershipId],
      });
      return page.moments.find((item) => item.id === created.momentId);
    };
    let notes = (await load()).notes;
    let note = notes.find((item) => item.id === noted.noteId);
    const edited = await conversation.updateMomentNote(supabase, { noteId: note.id, revision: note.revision, body: "Coo" });
    assert.equal(edited.ok, true, edited.ok ? "" : edited.message);
    notes = notes.map((item) => (item.id === note.id ? { ...item, body: "Coo", revision: edited.revision } : item));
    // Heart, un-heart, heart, like a phone session; apply exactly what the app does.
    let heartRevision = 0;
    for (const hearted of [true, false, true, false, true]) {
      note = notes.find((item) => item.id === noted.noteId);
      notes = state.withNoteHeart(notes, note.id, "TARS", hearted);
      const res = await conversation.setMomentNoteHeart(supabase, { noteId: note.id, hearted });
      assert.equal(res.ok, true, res.ok ? "" : res.message);
      heartRevision = res.heartRevision ?? heartRevision;
    }
    note = notes.find((item) => item.id === noted.noteId);
    assert.equal(note.revision, edited.revision, "hearts must not touch the comment revision");
    assert.notEqual(heartRevision, note.revision, "setup: the heart row revision differs from the comment's");
    // Build 15 sent the heart revision here and got PT409.
    const stale = await conversation.trashMomentNote(supabase, { noteId: note.id, revision: heartRevision });
    assert.equal(stale.ok, false, "the heart revision is the stale value build 15 sent");
    const trashed = await conversation.trashMomentNote(supabase, { noteId: note.id, revision: note.revision });
    assert.equal(trashed.ok, true, trashed.ok ? "" : trashed.message);
    const after = await load();
    assert.equal(after.notes.some((item) => item.id === noted.noteId), false, "deleted comment is gone from the feed");
  } finally {
    const trashed = await posts.trashWrittenMoment(supabase, created.momentId, 1);
    assert.equal(trashed.ok, true, trashed.ok ? "" : trashed.message);
  }
});

await step("comment and heart a test-circle post, then clean up", async () => {
  resetStore();
  const app = await freshApp("comment-heart");
  const supabase = app.getSupabase();
  const result = await verifyEmailCode(supabase, testEmail, await emailOtp(), {
    storage: secureSessionStorage,
    storageKey,
    sleep: noSleep,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  const posts = await import("../src/lib/posts.ts");
  const conversation = await import("../src/lib/conversation.ts");
  const { circleToday } = await import("../src/lib/dates.ts");
  const circles = await journal.loadCircles(supabase, result.session.user.id);
  const circleName = process.env.E2E_TEST_CIRCLE_NAME ?? "TARS e2e test";
  const circle = circles.find((item) => item.name === circleName);
  assert.ok(circle, `circle "${circleName}" was not found; refusing to post into another circle`);
  const body = `E2E heart post ${Date.now()}`;
  const comment = `E2E comment ${Date.now()}`;
  const created = await posts.createWrittenMoment(supabase, {
    journalPersonId: circle.personId,
    circleId: circle.circleId,
    body,
    occurredOn: circleToday(circle.timeZone),
    audience: "family",
    circleIds: [circle.circleId],
  });
  assert.equal(created.ok, true, created.ok ? "" : created.message);
  try {
    const noted = await conversation.createMomentNote(supabase, {
      momentId: created.momentId,
      body: comment,
    });
    assert.equal(noted.ok, true, noted.ok ? "" : noted.message);
    const loved = await conversation.setMomentNoteHeart(supabase, {
      noteId: noted.noteId,
      hearted: true,
    });
    assert.equal(loved.ok, true, loved.ok ? "" : loved.message);
    const reaction = await conversation.setMomentReaction(supabase, {
      momentId: created.momentId,
      reactionId: "held-close",
    });
    assert.equal(reaction.ok, true, reaction.ok ? "" : reaction.message);
    const page = await journal.loadTimelinePage(supabase, {
      circleId: circle.circleId,
      viewerMembershipIds: [circle.membershipId],
    });
    const moment = page.moments.find((item) => item.id === created.momentId);
    assert.ok(moment, "test post should be on the circle feed");
    const saved = moment.notes.find((note) => note.body === comment);
    assert.ok(saved, "comment should be on the test post");
    assert.equal(saved.heartedByViewer, true);
    assert.ok(
      moment.reactions.some(
        (item) => item.reactionId === "held-close" && item.isCurrentMember,
      ),
    );
    const unreacted = await conversation.setMomentReaction(supabase, {
      momentId: created.momentId,
      reactionId: null,
    });
    assert.equal(unreacted.ok, true, unreacted.ok ? "" : unreacted.message);
    const unloved = await conversation.setMomentNoteHeart(supabase, {
      noteId: noted.noteId,
      hearted: false,
    });
    assert.equal(unloved.ok, true, unloved.ok ? "" : unloved.message);
    const trashedNote = await conversation.trashMomentNote(supabase, {
      noteId: noted.noteId,
      revision: saved.revision,
    });
    assert.equal(trashedNote.ok, true, trashedNote.ok ? "" : trashedNote.message);
  } finally {
    const trashed = await posts.trashWrittenMoment(supabase, created.momentId, 1);
    assert.equal(trashed.ok, true, trashed.ok ? "" : trashed.message);
    await supabase.auth.signOut({ scope: "local" });
  }
});

await step("edit a test-circle photo post: text, time, remove, add, reorder, stale revision refused", async () => {
  resetStore();
  const app = await freshApp("post-edit");
  const supabase = app.getSupabase();
  const result = await verifyEmailCode(supabase, testEmail, await emailOtp(), {
    storage: secureSessionStorage,
    storageKey,
    sleep: noSleep,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  const posts = await import("../src/lib/posts.ts");
  const edit = await import("../src/lib/moment-edit.ts");
  const save = await import("../src/lib/moment-edit-save.ts");
  const { circleToday } = await import("../src/lib/dates.ts");
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const circles = await journal.loadCircles(supabase, result.session.user.id);
  const circleName = process.env.E2E_TEST_CIRCLE_NAME ?? "TARS e2e test";
  const circle = circles.find((item) => item.name === circleName);
  assert.ok(circle, `circle "${circleName}" was not found; refusing to post into another circle`);
  // Node has no XMLHttpRequest; the app's resumable upload uses it on iOS.
  globalThis.XMLHttpRequest ??= class {
    upload = {};
    #headers = {};
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(key, value) {
      this.#headers[key] = value;
    }
    getResponseHeader(key) {
      return this.response?.headers.get(key) ?? null;
    }
    send(body) {
      realFetch(this.url, { method: this.method, headers: this.#headers, body: body ?? undefined })
        .then(async (response) => {
          this.response = response;
          this.status = response.status;
          await response.arrayBuffer();
          this.onload?.();
        })
        .catch(() => this.onerror?.());
    }
  };
  const jpeg = (color) => {
    const file = `/tmp/e2e-edit-${color}.jpg`;
    execFileSync("python3", [
      "-c",
      `from PIL import Image; Image.new("RGB", (64, 48), "${color}").save("${file}", quality=90)`,
    ]);
    const bytes = fs.readFileSync(file);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  };
  const body = `E2E edit ${Date.now()}`;
  const today = circleToday(circle.timeZone);
  const created = await posts.uploadPhotoMoment(supabase, {
    bytes: jpeg("red"),
    mimeType: "image/jpeg",
    circleId: circle.circleId,
    journalPersonId: circle.personId,
    body,
    occurredOn: today,
    occurredAt: new Date(Math.floor(Date.now() / 60000) * 60000).toISOString(),
    occurredTimezone: circle.timeZone,
    audience: "family",
    circleIds: [circle.circleId],
  });
  assert.equal(created.ok, true, created.ok ? "" : created.message);
  const momentId = created.momentId;
  const waitPhotos = async (count) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const photos = await journal.loadMomentPhotos(supabase, momentId);
      if (photos && photos.length === count) return photos;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error(`the post never showed ${count} photos`);
  };
  const findMoment = async () => {
    const page = await journal.loadTimelinePage(supabase, {
      circleId: circle.circleId,
      viewerMembershipIds: [circle.membershipId],
    });
    return page.moments.find((moment) => moment.id === momentId);
  };
  try {
    await waitPhotos(1);
    const extra = await posts.attachExtraPhotos(supabase, momentId, [{ bytes: jpeg("blue"), mimeType: "image/jpeg" }]);
    assert.equal(extra.ok, true, extra.message);
    const [red, blue] = await waitPhotos(2);
    let moment = await findMoment();
    assert.ok(moment, "the photo post is on the test circle feed");
    assert.equal(moment.photos.length, 2);
    const startRevision = moment.revision;

    // Edit 1 through the same path the sheet uses: text, time, drop red, add green.
    const initial = edit.buildEditDraft(moment);
    assert.ok(initial, "a photo post opens in Edit");
    const green = jpeg("green");
    const draft = {
      ...initial,
      body: `${body} edited`,
      occurredTime: "07:15",
      photos: [
        ...initial.photos.filter((photo) => photo.existingPhotoId !== red.id),
        {
          key: "green",
          picked: {
            bytes: green,
            mimeType: "image/jpeg",
            name: "green.jpg",
            kind: "photo",
            durationMs: null,
            previewUri: "",
            posterUri: null,
            poster: null,
          },
        },
      ],
    };
    let card = moment;
    const reopened = [];
    const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const saved = await save.runMomentEdit(supabase, {
      moment,
      initial,
      draft,
      taggedLabel: moment.taggedPeopleLabel,
      deviceTimeZone,
      patch: (id, update) => {
        card = update(card);
      },
      reopen: (state) => reopened.push(state),
      loadPhotos: (id) => journal.loadMomentPhotos(supabase, id),
    });
    assert.equal(saved.ok, true, saved.message);
    assert.equal(reopened.length, 0, reopened[0]?.error);
    assert.equal(saved.revision, startRevision + 1, "only update_family_moment moves the revision");
    assert.equal(card.revision, saved.revision);
    assert.equal(card.body, `${body} edited`);
    const afterAdd = await waitPhotos(2);
    assert.equal(afterAdd[0].id, blue.id, "blue stays first");
    assert.notEqual(afterAdd[1].id, red.id, "red was removed and green added at the end");
    moment = await findMoment();
    assert.equal(moment.body, `${body} edited`);
    assert.equal(moment.revision, saved.revision, "photo steps did not touch the post revision");
    assert.equal(edit.recordedLocalTime(moment.occurredAt, moment.occurredTimezone), "07:15");
    assert.equal(moment.occurredTimezone, deviceTimeZone);

    // Edit 2: drag green before blue.
    const second = edit.buildEditDraft(moment);
    const reordered = await save.saveMomentEdit(supabase, {
      moment,
      initial: second,
      draft: { ...second, photos: edit.movePhoto(second.photos, 1, 0) },
      deviceTimeZone,
    });
    assert.equal(reordered.ok, true, reordered.message);
    const order = await journal.loadMomentPhotos(supabase, momentId);
    assert.deepEqual(order.map((photo) => photo.id), [afterAdd[1].id, blue.id]);

    // A save against the revision the sheet opened with before edit 2 is refused.
    const stale = await save.saveMomentEdit(supabase, {
      moment,
      initial: second,
      draft: { ...second, body: `${body} stale` },
      deviceTimeZone,
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.conflict, true);
    assert.equal(stale.message, "This moment changed elsewhere. Reopen it before editing again.");
    moment = await findMoment();
    assert.equal(moment.body, `${body} edited`, "the stale save changed nothing");
    const trashed = await posts.trashWrittenMoment(supabase, momentId, moment.revision);
    assert.equal(trashed.ok, true, trashed.ok ? "" : trashed.message);
  } catch (error) {
    const current = await findMoment().catch(() => null);
    if (current) await posts.trashWrittenMoment(supabase, momentId, current.revision);
    throw error;
  } finally {
    await supabase.auth.signOut({ scope: "local" });
  }
});

await step("inline upload: pending card merges into the feed, posts to the test circle, failed upload keeps Retry/Remove (build 20)", async () => {
  const pending = await import("../src/lib/pending-uploads.ts");
  pending.resetPendingForTests();
  // Pure merge: a pending post sits at its date in a newest-first feed and
  // disappears once the feed has the real post.
  const real = (id, occurredOn, occurredAt = null) => ({ id, occurredOn, occurredAt });
  const job = (id, occurredOn, occurredAt, momentId = null) => ({
    id,
    mode: "post",
    momentId,
    post: {
      circleId: "c1",
      journalPersonId: "p1",
      body: "hi",
      occurredOn,
      occurredAt,
      occurredTimezone: null,
      placeName: "",
      taggedPersonIds: [],
      audience: "family",
      circleIds: ["c1"],
    },
    media: [{ kind: "photo", mimeType: "image/jpeg", name: "a.jpg", durationMs: null, uri: "file:///a.jpg", posterUri: null }],
    progress: 0.4,
    state: "uploading",
    error: null,
    createdAt: new Date().toISOString(),
  });
  const author = { name: "TARS", initial: "T", accent: "slate" };
  const feed = [real("m3", "2026-10-03"), real("m2", "2026-09-30"), real("m1", "2026-09-01")];
  const merged = pending.mergePending(
    feed,
    [job("a", "2026-10-01", null), job("b", "2026-10-04", null), job("x", "2026-10-02", null)],
    { listed: (post) => post.circleId === "c1", author },
  );
  assert.deepEqual(
    merged.map((item) => item.id),
    ["pending:b", "m3", "pending:x", "pending:a", "m2", "m1"],
  );
  assert.equal(merged[0].pending.state, "uploading");
  assert.equal(merged[0].canChange, false, "no ••• menu on a card still uploading");
  assert.equal(
    pending.mergePending(feed, [job("done", "2026-10-03", null, "m3")], { listed: () => true, author }).length,
    3,
    "a finished post the feed already has is not shown twice",
  );
  assert.equal(
    pending.mergePending(feed, [job("other", "2026-10-03", null)], { listed: () => false, author }).length,
    3,
    "a post for another circle stays off this feed",
  );

  // Restore: an upload still running when the app closed comes back failed, with its bytes.
  const disk = new Map();
  const memoryStorage = {
    jobs: [],
    async save(jobs) {
      this.jobs = jobs;
    },
    async load() {
      return this.jobs;
    },
    async putBytes(jobId, index, payload) {
      disk.set(`${jobId}/${index}`, payload);
      return { uri: `file:///pending/${jobId}/${index}.bin`, posterUri: null };
    },
    async readBytes(jobId, index) {
      return disk.get(`${jobId}/${index}`) ?? null;
    },
    async drop(jobId) {
      for (const key of [...disk.keys()]) if (key.startsWith(`${jobId}/`)) disk.delete(key);
    },
  };
  memoryStorage.jobs = [job("left", "2026-10-03", null)];

  resetStore();
  const app = await freshApp("inline-upload");
  const supabase = app.getSupabase();
  const result = await verifyEmailCode(supabase, testEmail, await emailOtp(), {
    storage: secureSessionStorage,
    storageKey,
    sleep: noSleep,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  await pending.restorePending(memoryStorage, supabase);
  const restored = pending.listPending().find((item) => item.id === "left");
  assert.equal(restored?.state, "failed");
  assert.equal(restored?.error, pending.interruptedCopy);
  pending.removePending("left");
  assert.equal(pending.listPending().length, 0);

  const posts = await import("../src/lib/posts.ts");
  const { circleToday } = await import("../src/lib/dates.ts");
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const circles = await journal.loadCircles(supabase, result.session.user.id);
  const circleName = process.env.E2E_TEST_CIRCLE_NAME ?? "TARS e2e test";
  const circle = circles.find((item) => item.name === circleName);
  assert.ok(circle, `circle "${circleName}" was not found; refusing to post into another circle`);
  globalThis.XMLHttpRequest ??= class {
    upload = {};
    #headers = {};
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(key, value) {
      this.#headers[key] = value;
    }
    getResponseHeader(key) {
      return this.response?.headers.get(key) ?? null;
    }
    send(body) {
      realFetch(this.url, { method: this.method, headers: this.#headers, body: body ?? undefined })
        .then(async (response) => {
          this.response = response;
          this.status = response.status;
          await response.arrayBuffer();
          this.onload?.();
        })
        .catch(() => this.onerror?.());
    }
  };
  const jpeg = (color) => {
    const file = `/tmp/e2e-inline-${color}.jpg`;
    execFileSync("python3", [
      "-c",
      `from PIL import Image; Image.new("RGB", (64, 48), "${color}").save("${file}", quality=90)`,
    ]);
    const bytes = fs.readFileSync(file);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  };
  const picked = (color) => ({
    bytes: jpeg(color),
    mimeType: "image/jpeg",
    name: `${color}.jpg`,
    kind: "photo",
    durationMs: null,
    previewUri: `file:///tmp/e2e-inline-${color}.jpg`,
    posterUri: null,
    poster: null,
  });
  const body = `E2E inline upload ${Date.now()}`;
  const seen = [];
  const stop = pending.subscribePending(() => {
    const current = pending.listPending()[0];
    if (current) seen.push(current.state);
  });
  const queued = await pending.queuePost(
    supabase,
    {
      circleId: circle.circleId,
      journalPersonId: circle.personId,
      body,
      occurredOn: circleToday(circle.timeZone),
      occurredAt: new Date(Math.floor(Date.now() / 60000) * 60000).toISOString(),
      occurredTimezone: circle.timeZone,
      placeName: "",
      taggedPersonIds: [],
      audience: "family",
      circleIds: [circle.circleId],
    },
    [picked("orange"), picked("purple")],
  );
  assert.equal(pending.listPending()[0]?.id, queued.id, "the card is in the feed before the upload ends");
  const finished = await queued.done;
  stop();
  let momentId = finished?.momentId;
  try {
    assert.equal(finished?.state, "done", finished?.error ?? "");
    assert.equal(finished.progress, 1);
    assert.ok(seen.includes("uploading"));
    assert.ok(momentId);
    let photos = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      photos = await journal.loadMomentPhotos(supabase, momentId);
      if (photos?.length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    assert.equal(photos?.length, 2, "both photos are on the post");
    const page = await journal.loadTimelinePage(supabase, {
      circleId: circle.circleId,
      viewerMembershipIds: [circle.membershipId],
    });
    const listed = page.moments.find((item) => item.id === momentId);
    assert.ok(listed, "the published post is on the test circle feed");
    assert.equal(listed.body, body);
    assert.equal(
      pending.mergePending(page.moments, pending.listPending(), { listed: () => true, author }).filter((item) => item.pending)
        .length,
      0,
      "the pending card gives way to the real post",
    );
    pending.settlePending([queued.id]);

    // Failure: adding to a post that is gone fails on its card and keeps Retry/Remove.
    const moment = { id: "00000000-0000-4000-8000-000000000000", circleId: circle.circleId, journalPersonId: circle.personId, occurredOn: listed.occurredOn, audience: "family" };
    const bad = await pending.queueAddPhotos(supabase, moment, [picked("gray")]);
    const failed = await bad.done;
    assert.equal(failed?.state, "failed");
    assert.ok(failed?.error);
    await pending.retryPending(bad.id, supabase);
    assert.equal(pending.listPending().find((item) => item.id === bad.id)?.state, "failed", "Retry reruns and fails again");
    pending.removePending(bad.id);
    assert.equal(pending.listPending().length, 0, "Remove clears it");
    const open = await posts.trashWrittenMoment(supabase, momentId, listed.revision);
    assert.equal(open.ok, true, open.ok ? "" : open.message);
    momentId = null;
  } finally {
    if (momentId) {
      const page = await journal.loadTimelinePage(supabase, { circleId: circle.circleId, viewerMembershipIds: [circle.membershipId] }).catch(() => null);
      const current = page?.moments.find((item) => item.id === momentId);
      if (current) await posts.trashWrittenMoment(supabase, momentId, current.revision);
    }
    pending.resetPendingForTests();
    await supabase.auth.signOut({ scope: "local" });
  }
});

await step("test circle video poster is readable and playback starts from its offset", async () => {
  resetStore();
  const app = await freshApp("video-smoke");
  const supabase = app.getSupabase();
  const result = await verifyEmailCode(supabase, testEmail, await emailOtp(), {
    storage: secureSessionStorage,
    storageKey,
    sleep: noSleep,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  const playback = await import("../src/lib/video-playback.ts");
  const circles = await journal.loadCircles(supabase, result.session.user.id);
  const circleName = process.env.E2E_TEST_CIRCLE_NAME ?? "TARS e2e test";
  const circle = circles.find((item) => item.name === circleName);
  assert.ok(circle, `circle "${circleName}" was not found; refusing to read another circle`);
  let cursor;
  let snapshotAt;
  let found;
  for (let pageIndex = 0; pageIndex < 5 && !found; pageIndex += 1) {
    const page = await journal.loadTimelinePage(supabase, {
      circleId: circle.circleId,
      cursor,
      snapshotAt,
      viewerMembershipIds: [circle.membershipId],
    });
    found = page.moments.find(
      (moment) => moment.kind === "video" || (moment.kind === "insight" && moment.hasVideo),
    );
    cursor = page.cursor;
    snapshotAt = page.snapshotAt;
    if (!page.hasMore) break;
  }
  if (!found) {
    console.log(`       ${circleName} has no video post to smoke`);
    await supabase.auth.signOut({ scope: "local" });
    return;
  }
  const startSeconds = playback.clipStartSeconds(found);
  const posterPlan = playback.videoPlaybackPlan({
    started: false,
    onScreen: true,
    startSeconds,
  });
  const playingPlan = playback.videoPlaybackPlan({
    started: true,
    onScreen: true,
    startSeconds,
  });
  assert.equal(posterPlan.showPoster, true);
  assert.equal(playingPlan.playing, true);
  assert.equal(playingPlan.startSeconds, 0);
  assert.equal(journal.videoPosterPath(found.id), `/api/media/videos/${found.id}/poster`);
  assert.equal(playback.videoDeliveryPath(found.id), `/api/media/videos/${found.id}`);
  const headers = await app.mediaRequestHeaders();
  assert.ok(headers?.Cookie, "media cookie header built");
  if (found.hasPoster) {
    const poster = await realFetch(app.mediaUrl(journal.videoPosterPath(found.id)), {
      headers,
      redirect: "manual",
    });
    await poster.body?.cancel();
    console.log(`       poster ${journal.videoPosterPath(found.id)} -> HTTP ${poster.status}`);
    assert.ok(poster.status !== 401 && poster.status !== 403, `poster rejected: ${poster.status}`);
  }
  const video = await realFetch(app.mediaUrl(playback.videoDeliveryPath(found.id)), {
    headers: { ...headers, Range: "bytes=0-1" },
    redirect: "manual",
  });
  await video.body?.cancel();
  const { resolveVideoSource } = await import("../src/lib/video-source.ts");
  const direct = await resolveVideoSource(supabase, found.id, { url: app.mediaUrl, headers });
  assert.equal(direct.via, "storage", "native playback should read a signed Storage URL");
  assert.equal(direct.headers, undefined, "a signed Storage URL needs no cookie");
  for (const range of ["bytes=0-1", "bytes=-4096"]) {
    const part = await realFetch(direct.uri, { headers: { Range: range } });
    await part.body?.cancel();
    console.log(
      `       storage ${range} -> HTTP ${part.status} ${part.headers.get("content-type")} ${part.headers.get("content-range")}`,
    );
    assert.equal(part.status, 206, `storage range ${range}`);
    assert.match(part.headers.get("content-type") ?? "", /^video\//u);
  }
  console.log(
    `       video ${playback.videoDeliveryPath(found.id)} -> HTTP ${video.status}, start ${startSeconds}s`,
  );
  assert.ok(video.status !== 401 && video.status !== 403, `video rejected: ${video.status}`);
  await supabase.auth.signOut({ scope: "local" });
});

await step("Operations push token registers and is removed", async () => {
  const operationsEmail = "tars-trapp@agentmail.to";
  assert.equal(
    testEmail,
    operationsEmail,
    "push token registration runs only for the Operations account",
  );
  resetStore();
  const app = await freshApp("expo-push");
  const supabase = app.getSupabase();
  const result = await verifyEmailCode(supabase, testEmail, await emailOtp(), {
    storage: secureSessionStorage,
    storageKey,
    sleep: noSleep,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  const token = "ExponentPushToken[e2eOperationsDevice0001]";
  const saved = await supabase.rpc("save_expo_push_token", { requested_token: token });
  assert.equal(
    saved.error,
    null,
    saved.error
      ? `save_expo_push_token failed (${saved.error.message}). Apply supabase/migrations/20261001120000_expo_push_tokens.sql`
      : "",
  );
  try {
    const again = await supabase.rpc("save_expo_push_token", { requested_token: token });
    assert.equal(again.error, null, again.error?.message ?? "");
    assert.equal(again.data, saved.data, "the same device token stays one row");
  } finally {
    const removed = await supabase.rpc("delete_expo_push_token", { requested_token: token });
    assert.equal(removed.error, null, removed.error?.message ?? "");
    assert.equal(removed.data, true);
    await supabase.auth.signOut({ scope: "local" });
  }
});

await step("OTA runtime is 0.5.0 so build 9 (runtime 0.4.0) cannot receive this JS", async () => {
  const fs = await import("node:fs");
  const appJson = JSON.parse(fs.readFileSync(new URL("../app.json", import.meta.url), "utf8"));
  const easJson = JSON.parse(fs.readFileSync(new URL("../eas.json", import.meta.url), "utf8"));
  assert.equal(appJson.expo.runtimeVersion?.policy, "appVersion");
  assert.equal(
    appJson.expo.version,
    "0.5.0",
    "runtime follows the app version; 0.5.0 JS (expo-notifications, share extension) must not be delivered to build 9",
  );
  assert.match(appJson.expo.updates?.url ?? "", /^https:\/\/u\.expo\.dev\//u);
  assert.equal(easJson.build.production.channel, "production");
  assert.equal(easJson.build.preview.autoIncrement, true);
  assert.equal(easJson.build.production.autoIncrement, true);
});

await step("safety RPCs fail with a plain message, and terms fails open only if the function is missing", async () => {
  const safety = await import("../src/lib/safety.ts");
  const fs = await import("node:fs");
  const missing = {
    code: "PGRST202",
    message: "Could not find the function public.report_content in the schema cache",
  };
  const client = {
    rpc: async () => ({ data: null, error: missing }),
  };
  const reported = await safety.reportContent(client, {
    targetKind: "moment",
    targetId: "00000000-0000-4000-8000-000000000001",
    reason: "spam",
    details: "details stay off the error",
  });
  assert.equal(reported.ok, false);
  assert.equal(reported.missing, true);
  assert.match(reported.message, /could not be sent/i);
  assert.doesNotMatch(reported.message, /PGRST|schema|details stay/i);
  const blocked = await safety.blockMember(client, "00000000-0000-4000-8000-000000000002");
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /could not be blocked/i);
  const deleted = await safety.requestAccountClosure(client, "00000000-0000-4000-8000-000000000003");
  assert.equal(deleted.ok, false);
  assert.match(deleted.message, /could not be requested/i);
  assert.equal(safety.termsGate({ error: missing, rows: null }), "allow");
  assert.equal(safety.termsGate({ error: { code: "42501", message: "permission denied for user" }, rows: null }), "prompt");
  assert.equal(safety.termsGate({ error: null, rows: [] }), "prompt");
  assert.equal(
    safety.termsGate({ error: null, rows: [{ terms_version: safety.TERMS_VERSION }] }),
    "allow",
  );
  assert.equal(
    safety.termsGate({ error: null, rows: [{ terms_version: "2020-01-01" }] }),
    "prompt",
  );
  const source = fs.readFileSync(new URL("../src/lib/safety.ts", import.meta.url), "utf8");
  assert.equal(source.includes("console."), false);
  const clientSource = fs.readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");
  assert.match(clientSource, /storage: secureSessionStorage/);
  assert.match(safety.freshRequestKey(), /^[0-9a-f-]{36}$/iu);
  const hidden = safety.withoutBlockedAuthor(
    [
      { id: "mine", authorMembershipId: "me", notes: [{ authorMembershipId: "them" }] },
      { id: "theirs", authorMembershipId: "them", notes: [] },
    ],
    "them",
  );
  assert.deepEqual(hidden.map((moment) => moment.id), ["mine"]);
  assert.equal(hidden[0].notes.length, 0);
  assert.equal(safety.closureView({ error: missing, row: null }).kind, "confirm");
  assert.equal(
    safety.closureView({
      error: null,
      row: { state: "", requestedAt: null, lastOrganizerCircles: ["The Rivera Family (Demo)"] },
    }).kind,
    "last-organizer",
  );
});

await step("password sign-in uses the same client storage when a test password is set", async () => {
  const email = process.env.E2E_PASSWORD_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    console.log("       skipped (set E2E_PASSWORD_EMAIL and E2E_PASSWORD)");
    return;
  }
  if (forbidden.includes(email.toLowerCase())) {
    throw new Error("Refusing password sign-in against a personal account.");
  }
  resetStore();
  const app = await freshApp("password");
  const { signInWithPassword } = await import("../src/lib/auth-flow.ts");
  const result = await signInWithPassword(app.getSupabase(), email, password);
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  const stored = [...secureStore.store.values()].join("");
  assert.ok(stored.includes("access_token"), "password session was not written to secure storage");
  await app.getSupabase().auth.signOut({ scope: "local" });
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
