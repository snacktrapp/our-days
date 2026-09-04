import { describe, expect, it } from "vitest";
import {
  canCreateInsight,
  familyMembershipRoleLabel,
  hasOrganizerPrivilege,
  isOperationsMembership,
  isOperationsRole,
  journalContextLabel,
  journalDirectoryRoleLabel,
  parseCircleMembershipRole,
  presentedMembershipRole,
} from "./circle-roles";

describe("circle membership roles", () => {
  it("treats Operations as organizer-equivalent privileges, not a journal person", () => {
    expect(isOperationsRole("operations")).toBe(true);
    expect(isOperationsRole("organizer")).toBe(false);
    expect(
      isOperationsMembership({
        role: "organizer",
        directoryKind: "operations",
      }),
    ).toBe(true);
    expect(
      isOperationsMembership({ role: "organizer", directoryKind: "journal" }),
    ).toBe(false);
    expect(hasOrganizerPrivilege("operations")).toBe(true);
    expect(hasOrganizerPrivilege("organizer")).toBe(true);
    expect(hasOrganizerPrivilege("member")).toBe(false);
    expect(canCreateInsight("operations")).toBe(true);
    expect(canCreateInsight("organizer")).toBe(true);
    expect(canCreateInsight("member")).toBe(false);
  });

  it("labels Operations distinctly from family members", () => {
    expect(familyMembershipRoleLabel("operations")).toBe("Operations");
    expect(journalDirectoryRoleLabel("account", "operations")).toBe(
      "Operations",
    );
    expect(journalDirectoryRoleLabel("managed", "operations")).toBe(
      "Managed profile · No sign-in",
    );
    expect(journalContextLabel(false, "account", "operations")).toBe(
      "Operations",
    );
    expect(journalContextLabel(true, "account", "operations")).toBe("You");
    expect(parseCircleMembershipRole("operations")).toBe("operations");
    expect(parseCircleMembershipRole("owner")).toBeNull();
    expect(
      presentedMembershipRole({
        role: "organizer",
        directoryKind: "operations",
      }),
    ).toBe("operations");
  });
});
