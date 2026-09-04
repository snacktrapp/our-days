// @vitest-environment node

import { mkdtempSync } from "node:fs";
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
  createLocalInsightMoment,
  createLocalWrittenMoment,
  findLocalAccount,
  resetLocalJournalForTests,
  setLocalReaction,
  type LocalAccess,
} from "./store";
import { publishVerifiedPhotoMoment } from "./media-coordinator";
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
    await expect(
      setLocalReaction(jordanAccess, {
        momentId: ownMoment.moment.id,
        reactionId: "held-close",
      }),
    ).rejects.toThrow("That response could not be saved.");
  });
});
