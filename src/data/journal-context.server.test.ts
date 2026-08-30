// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: vi.fn(),
}));

import { plainToday } from "./journal-context.server";

describe("circle calendar date", () => {
  it("uses the circle timezone when one instant spans two local dates", () => {
    const instant = new Date("2026-08-30T07:30:00.000Z");
    expect(plainToday("America/Los_Angeles", instant)).toBe("2026-08-30");
    expect(plainToday("Pacific/Kiritimati", instant)).toBe("2026-08-30");

    const boundary = new Date("2026-08-30T06:30:00.000Z");
    expect(plainToday("America/Los_Angeles", boundary)).toBe("2026-08-29");
    expect(plainToday("Pacific/Kiritimati", boundary)).toBe("2026-08-30");
  });
});
