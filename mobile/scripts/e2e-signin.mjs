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
  assert.deepEqual(menu.momentOverflowActions("thought"), ["edit", "delete"]);
  assert.deepEqual(menu.momentOverflowActions("photo"), ["delete"]);
  assert.deepEqual(menu.momentOverflowActions("insight"), ["delete"]);
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
  const bumped = c.withNoteRevision(hearted, "n1", 4);
  assert.equal(bumped[0].revision, 4);
  const rolled = c.revertNoteHeart(bumped, note);
  assert.equal(rolled[0].heartCount, 1);
  assert.equal(rolled[0].heartedByViewer, false);
  assert.equal(rolled[0].revision, 4, "rollback keeps unrelated fields");

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
  assert.match(read("../src/components/moment-menu.tsx"), /<KeyboardAvoidingView/);
  assert.doesNotMatch(read("../src/components/keyboard-form.tsx"), /<InputAccessoryView/);
  assert.match(read("../src/components/keyboard-form.tsx"), />\s*Done\s*</);
  assert.doesNotMatch(read("../src/components/comment-sheet.tsx"), /KeyboardDoneBar/);
  assert.doesNotMatch(read("../src/components/moment-menu.tsx"), /KeyboardDoneBar/);
  // Grab-bar dismiss: the responder sits on the sheet's Animated.View, not on a bare header View.
  for (const file of ["../src/components/comment-sheet.tsx", "../src/components/moment-menu.tsx"]) {
    assert.match(read(file), /<Animated\.View\s+\{\.\.\.sheetProps\}/);
    assert.match(read(file), /<View \{\.\.\.chromeProps\}>/);
    assert.doesNotMatch(read(file), /\{\.\.\.panHandlers\}/);
  }
  // The edit-post menu stays mounted, so each edit must start with the sheet at rest.
  assert.match(read("../src/components/moment-menu.tsx"), /if \(editing\) translateY\.setValue\(0\)/);
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
