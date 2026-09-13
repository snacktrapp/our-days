import { describe, expect, it } from "vitest";
import {
  isFatalJournalHomeError,
  isRecoverableJournalNavigationError,
  isTransientFamilySessionError,
} from "./family-session-error";

describe("family session error classification", () => {
  it("treats abort and cancelled navigations as recoverable remount failures", () => {
    expect(
      isRecoverableJournalNavigationError(
        Object.assign(new Error("The operation was aborted."), {
          name: "AbortError",
        }),
      ),
    ).toBe(true);
    expect(
      isRecoverableJournalNavigationError({
        message: "navigation cancelled",
      }),
    ).toBe(true);
    expect(
      isTransientFamilySessionError({
        name: "AbortError",
        message: "The user aborted a request.",
      }),
    ).toBe(true);
  });

  it("treats Next redirect messages as control flow so refresh helpers do not swallow them", () => {
    expect(isFatalJournalHomeError(new Error("NEXT_REDIRECT:/sign-in"))).toBe(
      true,
    );
    expect(
      isFatalJournalHomeError(
        Object.assign(new Error("Redirect"), { digest: "NEXT_REDIRECT" }),
      ),
    ).toBe(true);
  });

  it("still treats required journal integrity failures as fatal", () => {
    expect(isFatalJournalHomeError(new Error("Circle is unavailable"))).toBe(
      true,
    );
    expect(
      isFatalJournalHomeError(new Error("Member profile is unavailable")),
    ).toBe(true);
    expect(isFatalJournalHomeError({ message: "JWT expired" })).toBe(false);
    expect(
      isFatalJournalHomeError({ code: "PGRST301", message: "JWT expired" }),
    ).toBe(false);
  });
});
