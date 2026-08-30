import { describe, expect, it } from "vitest";
import type { TimelineViewModel } from "./timeline-view-model";

const model = {
  chrome: {
    accent: "teal",
    title: "A timeline",
    eyebrow: "A family",
    familyMark: [{ id: "person", initial: "P", accent: "teal" }],
  },
  switcher: [{ label: "Family", href: "/family", current: true }],
  entries: [
    { id: "start", entryType: "date-marker", label: "Today" },
    {
      id: "thought-entry",
      entryType: "moment",
      moment: {
        id: "thought",
        kind: "thought",
        personName: "Person",
        personInitial: "P",
        personAccent: "clay",
        displayTime: "9:00 am",
        displayDate: "Aug 1, 2026",
        occurredOn: "2026-08-01",
        kicker: "A thought",
        text: "A quiet moment.",
        noteCount: 0,
      },
    },
    {
      id: "end",
      entryType: "end-message",
      markerLabel: "Earlier",
      message: "Keep going.",
    },
  ],
} as const satisfies TimelineViewModel;

describe("timeline presentation contract", () => {
  it("round-trips through JSON and structuredClone without losing data", () => {
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
    expect(structuredClone(model)).toEqual(model);
  });

  it("uses deterministic unique entry keys", () => {
    const ids = model.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["start", "thought-entry", "end"]);
  });

  it("contains no functions, symbols, bigint values, or Date instances", () => {
    const visit = (value: unknown): void => {
      expect(value).not.toBeInstanceOf(Date);
      expect(["function", "symbol", "bigint"]).not.toContain(typeof value);
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object")
        Object.values(value).forEach(visit);
    };
    visit(model);
  });
});
