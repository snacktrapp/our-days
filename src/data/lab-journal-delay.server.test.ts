import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  labBlocksShellOnJournalData,
  labJournalDataDelay,
} from "./lab-journal-delay.server";

describe("lab journal delay", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stays off in production unless the lab script opts in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("OUR_DAYS_LAB", "");
    vi.stubEnv("OUR_DAYS_LAB_JOURNAL_DELAY_MS", "2000");
    vi.stubEnv("OUR_DAYS_LAB_BLOCK_BEFORE_SHELL", "1");
    const started = Date.now();
    await labJournalDataDelay();
    expect(Date.now() - started).toBeLessThan(200);
    expect(labBlocksShellOnJournalData()).toBe(false);
  });

  it("stays off on Vercel production even when the lab flag is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("OUR_DAYS_LAB", "1");
    vi.stubEnv("OUR_DAYS_LAB_BLOCK_BEFORE_SHELL", "1");
    expect(labBlocksShellOnJournalData()).toBe(false);
  });

  it("waits when the lab script opts in outside Vercel production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("OUR_DAYS_LAB", "1");
    vi.stubEnv("OUR_DAYS_LAB_JOURNAL_DELAY_MS", "30");
    vi.stubEnv("OUR_DAYS_LAB_BLOCK_BEFORE_SHELL", "1");
    expect(labBlocksShellOnJournalData()).toBe(true);
    const started = Date.now();
    await labJournalDataDelay();
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });
});
