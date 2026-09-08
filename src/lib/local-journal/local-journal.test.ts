// @vitest-environment node

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import {
  localAlexMembershipId,
  localAlexPersonId,
  localCircleId,
  localFamilyEmail,
  localJordanMembershipId,
  localJordanPersonId,
} from "./ids";
import {
  createLocalCircle,
  createLocalInsightMoment,
  createLocalWrittenMoment,
  findLocalAccount,
  readLocalJournal,
  resetLocalJournalForTests,
  setLocalReaction,
  updateLocalMomentAudience,
  type LocalAccess,
} from "./store";
import {
  publishVerifiedPhotoMoment,
  publishVerifiedVideoMoment,
} from "./media-coordinator";
import { loadLocalJournalContext, loadLocalTimeline } from "./views";

const access: LocalAccess = {
  membershipId: localAlexMembershipId,
  circleId: localCircleId,
  personId: localAlexPersonId,
  role: "organizer",
};

describe("local journal happy path", () => {
  beforeEach(() => {
    vi.stubEnv(
      "OUR_DAYS_LOCAL_JOURNAL_DIR",
      mkdtempSync(join(tmpdir(), "our-days-")),
    );
  });

  afterEach(() => {
    resetLocalJournalForTests();
    vi.unstubAllEnvs();
  });

  it("seeds a synthetic family instead of real household names", async () => {
    const account = await findLocalAccount(localFamilyEmail);
    expect(account?.personId).toBe(localAlexPersonId);
    expect(account).toBeDefined();
  });

  it("saves written moments on the generic path", async () => {
    const momentId = await createLocalWrittenMoment(access, {
      journalPersonId: localAlexPersonId,
      kind: "thought",
      title: "",
      body: "Casey left a pebble on the porch.",
      placeName: "",
      taggedPersonIds: [],
      occurredOn: "2026-08-21",
      occurredAt: null,
      occurredTimezone: null,
    });
    expect(momentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
  });

  it("rejects photo creation on the generic written path", async () => {
    await expect(
      createLocalWrittenMoment(access, {
        journalPersonId: localAlexPersonId,
        kind: "photo",
        title: "",
        body: "should not work",
        placeName: "",
        taggedPersonIds: [],
        occurredOn: "2026-08-21",
        occurredAt: null,
        occurredTimezone: null,
      }),
    ).rejects.toThrow("verified media coordinators");
  });

  it("publishes a photo only through the verified coordinator", async () => {
    const bytes = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: { r: 196, g: 122, b: 88 },
      },
    })
      .jpeg()
      .toBuffer();
    const file = new File([bytes], "porch.jpg", { type: "image/jpeg" });
    const moment = await publishVerifiedPhotoMoment(access, {
      file,
      journalPersonId: localAlexPersonId,
      body: "The last warm hour.",
      placeName: "",
      taggedPersonIds: [],
      occurredOn: "2026-08-21",
      occurredAt: null,
      occurredTimezone: null,
    });
    expect(moment.kind).toBe("photo");
    expect(moment.media?.displayMimeType).toBe("image/jpeg");
    expect(moment.media?.displayRelativePath).toBe(
      moment.media?.originalRelativePath,
    );
    expect(moment.media?.sha256).toHaveLength(64);
    expect(moment.photos).toHaveLength(1);

    const second = await publishVerifiedPhotoMoment(access, {
      file: new File([bytes], "porch-2.jpg", { type: "image/jpeg" }),
      journalPersonId: localAlexPersonId,
      body: "The last warm hour.",
      placeName: "",
      taggedPersonIds: [],
      occurredOn: "2026-08-21",
      occurredAt: null,
      occurredTimezone: null,
      existingMomentId: moment.id,
    });
    expect(second.id).toBe(moment.id);
    expect(second.photos).toHaveLength(2);

    const { reorderLocalMomentPhotos } = await import("./store");
    await reorderLocalMomentPhotos(access, {
      momentId: moment.id,
      photoIds: [second.photos![1]!.id, second.photos![0]!.id],
    });
    const timeline = await loadLocalTimeline(
      access,
      await loadLocalJournalContext(access),
      {
        pages: 1,
      },
    );
    const photoMoment = timeline.entries.find(
      (entry) => entry.entryType === "moment" && entry.moment.id === moment.id,
    );
    expect(
      photoMoment && photoMoment.entryType === "moment"
        ? photoMoment.moment.kind === "photo"
          ? photoMoment.moment.photos?.map((photo) => photo.id)
          : []
        : [],
    ).toEqual([second.photos![1]!.id, second.photos![0]!.id]);
  });

  it("lets Operations post Insights and write with organizer privileges", async () => {
    const operationsAccess: LocalAccess = {
      ...access,
      role: "operations",
    };
    const thoughtId = await createLocalWrittenMoment(operationsAccess, {
      journalPersonId: localAlexPersonId,
      kind: "thought",
      title: "",
      body: "Operations keeps organizer write access.",
      placeName: "",
      taggedPersonIds: [],
      occurredOn: "2026-08-21",
      occurredAt: null,
      occurredTimezone: null,
    });
    expect(thoughtId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );

    const momentId = await createLocalInsightMoment(operationsAccess, {
      quote: "Curiosity is a form of courage.",
      attribution: "The Diary of a CEO",
      sourceUrl: null,
      occurredOn: "2026-08-21",
      occurredAt: null,
      occurredTimezone: null,
    });
    expect(momentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
  });

  it("keeps Just Me on the author's journal only", async () => {
    const jordanAccess: LocalAccess = {
      membershipId: localJordanMembershipId,
      circleId: localCircleId,
      personId: localJordanPersonId,
      role: "member",
    };
    await createLocalWrittenMoment(access, {
      journalPersonId: localAlexPersonId,
      kind: "thought",
      title: "",
      body: "A porch thought just for me.",
      placeName: "",
      taggedPersonIds: [],
      occurredOn: "2026-08-21",
      occurredAt: null,
      occurredTimezone: null,
      audience: "just_me",
    });
    const context = await loadLocalJournalContext(access);
    const family = await loadLocalTimeline(access, context, { pages: 1 });
    const ownJournal = await loadLocalTimeline(access, context, {
      journalPersonId: localAlexPersonId,
      pages: 1,
    });
    const otherJournal = await loadLocalTimeline(access, context, {
      journalPersonId: localJordanPersonId,
      pages: 1,
    });
    const jordanView = await loadLocalTimeline(
      jordanAccess,
      await loadLocalJournalContext(jordanAccess),
      { journalPersonId: localAlexPersonId, pages: 1 },
    );
    const texts = (timeline: Awaited<ReturnType<typeof loadLocalTimeline>>) =>
      timeline.entries.flatMap((entry) =>
        entry.entryType === "moment" ? [entry.moment.text] : [],
      );
    const ownMoment = ownJournal.entries.find(
      (entry) =>
        entry.entryType === "moment" &&
        entry.moment.text === "A porch thought just for me.",
    );
    expect(texts(family)).not.toContain("A porch thought just for me.");
    expect(texts(ownJournal)).toContain("A porch thought just for me.");
    expect(texts(otherJournal)).not.toContain("A porch thought just for me.");
    expect(texts(jordanView)).not.toContain("A porch thought just for me.");
    expect(ownMoment?.entryType).toBe("moment");
    if (ownMoment?.entryType !== "moment") {
      throw new Error("Just Me moment missing from the author's journal");
    }
    expect(ownMoment.moment.showJustMeBadge).toBe(true);
    expect(ownMoment.moment.showAudienceChip).toBe(true);
    expect(ownMoment.moment.audienceChipLabel).toBe("Just me");
    await expect(
      setLocalReaction(jordanAccess, {
        momentId: ownMoment.moment.id,
        reactionId: "held-close",
      }),
    ).rejects.toThrow("That response could not be saved.");
  });

  it("keeps Who else tags on a Just Me moment in the YOU feed", async () => {
    await createLocalWrittenMoment(access, {
      journalPersonId: localAlexPersonId,
      kind: "thought",
      title: "",
      body: "A porch thought with Jordan.",
      placeName: "",
      taggedPersonIds: [localJordanPersonId],
      occurredOn: "2026-08-21",
      occurredAt: null,
      occurredTimezone: null,
      audience: "just_me",
    });
    const context = await loadLocalJournalContext(access);
    const ownJournal = await loadLocalTimeline(access, context, {
      journalPersonId: localAlexPersonId,
      pages: 1,
    });
    const ownMoment = ownJournal.entries.find(
      (entry) =>
        entry.entryType === "moment" &&
        entry.moment.text === "A porch thought with Jordan.",
    );
    expect(ownMoment?.entryType).toBe("moment");
    if (ownMoment?.entryType !== "moment") {
      throw new Error(
        "Just Me tagged moment missing from the author's journal",
      );
    }
    expect(ownMoment.moment.audienceChipLabel).toBe("Just me");
    expect(ownMoment.moment.taggedPeople).toEqual([
      { id: localJordanPersonId, name: "Jordan" },
    ]);
    expect(ownMoment.moment.taggedPeopleLabel).toBe("Jordan");
  });

  it("keeps a Just Me video on the author's journal only", async () => {
    const jordanAccess: LocalAccess = {
      membershipId: localJordanMembershipId,
      circleId: localCircleId,
      personId: localJordanPersonId,
      role: "member",
    };
    const videoBytes = readFileSync("tests/fixtures/synthetic-short.mp4");
    await publishVerifiedVideoMoment(access, {
      file: new File([videoBytes], "wave.mp4", { type: "video/mp4" }),
      journalPersonId: localAlexPersonId,
      body: "A porch clip just for me.",
      placeName: "",
      taggedPersonIds: [],
      occurredOn: "2026-08-21",
      occurredAt: null,
      occurredTimezone: null,
      durationMs: 1_000,
      audience: "just_me",
    });
    const context = await loadLocalJournalContext(access);
    const texts = (timeline: Awaited<ReturnType<typeof loadLocalTimeline>>) =>
      timeline.entries.flatMap((entry) =>
        entry.entryType === "moment" ? [entry.moment.text] : [],
      );
    const family = await loadLocalTimeline(access, context, { pages: 1 });
    const ownJournal = await loadLocalTimeline(access, context, {
      journalPersonId: localAlexPersonId,
      pages: 1,
    });
    const jordanView = await loadLocalTimeline(
      jordanAccess,
      await loadLocalJournalContext(jordanAccess),
      { journalPersonId: localAlexPersonId, pages: 1 },
    );
    const ownMoment = ownJournal.entries.find(
      (entry) =>
        entry.entryType === "moment" &&
        entry.moment.text === "A porch clip just for me.",
    );
    expect(texts(family)).not.toContain("A porch clip just for me.");
    expect(texts(ownJournal)).toContain("A porch clip just for me.");
    expect(texts(jordanView)).not.toContain("A porch clip just for me.");
    expect(ownMoment?.entryType).toBe("moment");
    if (ownMoment?.entryType !== "moment") {
      throw new Error("Just Me video missing from the author's journal");
    }
    expect(ownMoment.moment.kind).toBe("video");
    expect(ownMoment.moment.showJustMeBadge).toBe(true);
  });

  it("shows a multi-circle moment in each selected Home group", async () => {
    const extra = await createLocalCircle(access, "Cousins");
    const extraCircle = (await readLocalJournal()).extraCircles?.find(
      (circle) => circle.id === extra.circleId,
    );
    if (!extraCircle) throw new Error("Cousins circle missing");
    await createLocalWrittenMoment(access, {
      journalPersonId: localAlexPersonId,
      kind: "thought",
      title: "",
      body: "One porch, two circles.",
      placeName: "",
      taggedPersonIds: [],
      occurredOn: "2026-08-21",
      occurredAt: null,
      occurredTimezone: null,
      circleIds: [localCircleId, extra.circleId],
    });
    const extraAccess: LocalAccess = {
      membershipId: extraCircle.membershipId,
      circleId: extraCircle.id,
      personId: extraCircle.personId,
      role: extraCircle.role,
    };
    const homeContext = await loadLocalJournalContext(access);
    const extraContext = await loadLocalJournalContext(extraAccess);
    const texts = (timeline: Awaited<ReturnType<typeof loadLocalTimeline>>) =>
      timeline.entries.flatMap((entry) =>
        entry.entryType === "moment" ? [entry.moment.text] : [],
      );
    const home = await loadLocalTimeline(access, homeContext, { pages: 1 });
    const cousins = await loadLocalTimeline(extraAccess, extraContext, {
      pages: 1,
    });
    expect(texts(home)).toContain("One porch, two circles.");
    expect(texts(cousins)).toContain("One porch, two circles.");

    await createLocalWrittenMoment(access, {
      journalPersonId: extraCircle.personId,
      kind: "thought",
      title: "",
      body: "Cousins only.",
      placeName: "",
      taggedPersonIds: [],
      occurredOn: "2026-08-21",
      occurredAt: null,
      occurredTimezone: null,
      circleIds: [extra.circleId],
    });
    const homeAfter = await loadLocalTimeline(access, homeContext, {
      pages: 1,
    });
    const cousinsAfter = await loadLocalTimeline(extraAccess, extraContext, {
      pages: 1,
    });
    expect(texts(homeAfter)).not.toContain("Cousins only.");
    expect(texts(cousinsAfter)).toContain("Cousins only.");
  });

  it("edits audience from the author's journal and updates both group feeds", async () => {
    const extra = await createLocalCircle(access, "Cousins");
    const extraCircle = (await readLocalJournal()).extraCircles?.find(
      (circle) => circle.id === extra.circleId,
    );
    if (!extraCircle) throw new Error("Cousins circle missing");
    const momentId = await createLocalWrittenMoment(access, {
      journalPersonId: localAlexPersonId,
      kind: "thought",
      title: "",
      body: "Posted once, edited later.",
      placeName: "",
      taggedPersonIds: [],
      occurredOn: "2026-08-21",
      occurredAt: null,
      occurredTimezone: null,
      circleIds: [localCircleId],
    });
    const extraAccess: LocalAccess = {
      membershipId: extraCircle.membershipId,
      circleId: extraCircle.id,
      personId: extraCircle.personId,
      role: extraCircle.role,
    };
    const homeContext = await loadLocalJournalContext(access);
    const extraContext = await loadLocalJournalContext(extraAccess);
    const texts = (timeline: Awaited<ReturnType<typeof loadLocalTimeline>>) =>
      timeline.entries.flatMap((entry) =>
        entry.entryType === "moment" ? [entry.moment.text] : [],
      );
    const ownBefore = await loadLocalTimeline(access, homeContext, {
      journalPersonId: localAlexPersonId,
      pages: 1,
    });
    const ownCard = ownBefore.entries.find(
      (entry) =>
        entry.entryType === "moment" &&
        entry.moment.text === "Posted once, edited later.",
    );
    expect(ownCard?.entryType).toBe("moment");
    if (ownCard?.entryType !== "moment") {
      throw new Error("Author moment missing from the YOU feed");
    }
    expect(ownCard.moment.showAudienceChip).toBe(true);
    expect(ownCard.moment.audienceChipLabel).toBe("1 group");

    await updateLocalMomentAudience(access, {
      momentId,
      revision: ownCard.moment.revision ?? 1,
      audience: "family",
      circleIds: [localCircleId, extra.circleId],
    });
    const ownAfter = await loadLocalTimeline(access, homeContext, {
      journalPersonId: localAlexPersonId,
      pages: 1,
    });
    const cousins = await loadLocalTimeline(extraAccess, extraContext, {
      pages: 1,
    });
    const home = await loadLocalTimeline(access, homeContext, { pages: 1 });
    const edited = ownAfter.entries.find(
      (entry) =>
        entry.entryType === "moment" &&
        entry.moment.text === "Posted once, edited later.",
    );
    expect(edited?.entryType).toBe("moment");
    if (edited?.entryType !== "moment") {
      throw new Error("Edited moment missing from the YOU feed");
    }
    expect(edited.moment.audienceChipLabel).toBe("2 groups");
    expect(texts(home)).toContain("Posted once, edited later.");
    expect(texts(cousins)).toContain("Posted once, edited later.");

    await updateLocalMomentAudience(access, {
      momentId,
      revision: edited.moment.revision ?? 2,
      audience: "just_me",
      circleIds: [],
    });
    const ownPrivate = await loadLocalTimeline(access, homeContext, {
      journalPersonId: localAlexPersonId,
      pages: 1,
    });
    const homePrivate = await loadLocalTimeline(access, homeContext, {
      pages: 1,
    });
    const cousinsPrivate = await loadLocalTimeline(extraAccess, extraContext, {
      pages: 1,
    });
    const privateCard = ownPrivate.entries.find(
      (entry) =>
        entry.entryType === "moment" &&
        entry.moment.text === "Posted once, edited later.",
    );
    expect(privateCard?.entryType).toBe("moment");
    if (privateCard?.entryType !== "moment") {
      throw new Error("Just me moment missing from the YOU feed");
    }
    expect(privateCard.moment.audienceChipLabel).toBe("Just me");
    expect(texts(homePrivate)).not.toContain("Posted once, edited later.");
    expect(texts(cousinsPrivate)).not.toContain("Posted once, edited later.");
  });
});
