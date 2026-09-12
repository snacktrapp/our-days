import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260912144544_notes_reactions_live_moment_read.sql",
  ),
  "utf8",
);
const conversationLoad = readFileSync(
  resolve(root, "src/data/moments.server.ts"),
  "utf8",
);
const activityLoad = readFileSync(
  resolve(root, "src/data/journal-context.server.ts"),
  "utf8",
);

describe("notes and reactions live-moment read contract", () => {
  it("selects notes and reactions with can_read_live_moment instead of primary membership", () => {
    expect(migration).toContain("drop policy moment_notes_select_live_parent");
    expect(migration).toContain(
      "drop policy moment_reactions_select_live_parent",
    );
    expect(migration).toContain(
      "and (select private.can_read_live_moment(moment_id))",
    );
    expect(migration).not.toMatch(
      /moment_notes_select_live_parent[\s\S]*is_active_circle_member\(circle_id\)/,
    );
  });

  it("resolves conversation authors through a private definer gated by live-moment read", () => {
    expect(migration).toContain(
      "create function private.get_moment_conversation(requested_moment_id uuid)",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain(
      "and (select private.can_read_live_moment(moment.id))",
    );
    expect(migration).toContain(
      "from private.get_moment_conversation(get_moment_conversation.moment_id)",
    );
  });

  it("does not pin feed author lookup to the viewer's active circle", () => {
    const authorLookup = conversationLoad.slice(
      conversationLoad.indexOf(
        "export async function loadMomentConversationsByMomentId",
      ),
      conversationLoad.indexOf("export function mapTimelineRow"),
    );
    expect(authorLookup).not.toContain('.eq("circle_id", access.circleId)');
  });

  it("loads Activity notes by visible moment id and keeps circle hrefs", () => {
    expect(activityLoad).toContain('.in("moment_id", conversationMomentIds)');
    expect(activityLoad).toContain(
      "activityMomentHref(note.moment_id, note.circle_id)",
    );
    expect(activityLoad).toContain(
      "activityMomentHref(reaction.moment_id, reaction.circle_id)",
    );
  });
});
