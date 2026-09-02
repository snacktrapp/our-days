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
} from "./ids";
import {
  createLocalWrittenMoment,
  findLocalAccount,
  resetLocalJournalForTests,
  type LocalAccess,
} from "./store";
import { publishVerifiedPhotoMoment } from "./media-coordinator";

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
    expect(moment.media?.displayMimeType).toBe("image/webp");
    expect(moment.media?.sha256).toHaveLength(64);
  });
});
