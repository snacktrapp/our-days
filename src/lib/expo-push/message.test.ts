import { describe, expect, it } from "vitest";
import { expoNotificationHref, expoNotificationTitle } from "./message";

const row = {
  token: "ExponentPushToken[device00000000000001]",
  actor_name: "Molly",
  moment_id: "moment-1",
  moment_kind: "photo",
  reaction_type: null,
  snippet: "the porch light",
  note_id: "note-1",
};

describe("expo push copy", () => {
  it("uses the web All-circles link and the same sentences", () => {
    expect(expoNotificationHref("moment", row)).toBe("/family?moment=moment-1");
    expect(expoNotificationHref("reaction", row)).toBe("/family?moment=moment-1&thread=1");
    expect(expoNotificationHref("note", row)).toBe(
      "/family?moment=moment-1&note=note-1&thread=1",
    );
    expect(expoNotificationHref("mention", row)).toBe(
      "/family?moment=moment-1&note=note-1&thread=1",
    );
    expect(expoNotificationTitle("note", row)).toBe("Molly commented on your entry.");
    expect(expoNotificationTitle("note_reaction", row)).toBe("Molly loved your comment.");
    expect(expoNotificationTitle("moment", row)).toBe("Molly posted a photo.");
    expect(expoNotificationTitle("mention", row)).toContain("mentioned you.");
  });
});
