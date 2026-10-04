import type { SupabaseClient } from "@supabase/supabase-js";

import type { CircleMembership } from "./journal";
import { postableCircles } from "./journal";

/** Name the create_circle RPC accepts: trimmed, 1–80 characters. */
export function circleNameError(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "A circle name is required.";
  if (trimmed.length > 80) return "Use 80 characters or fewer.";
  return null;
}

/**
 * create_circle copies the creator’s profile from a circle they already
 * belong to. The earliest active circle is that source. None means create
 * cannot run, so the control stays off the screen.
 */
export function createCircleSourceId(circles: readonly CircleMembership[]) {
  return postableCircles(circles)[0]?.circleId ?? "";
}

export async function createCircle(
  supabase: SupabaseClient,
  name: string,
  sourceCircleId: string,
): Promise<{ ok: true; circleId: string } | { ok: false; message: string }> {
  const invalid = circleNameError(name);
  if (invalid) return { ok: false, message: invalid };
  if (!sourceCircleId) return { ok: false, message: "That circle could not be created." };
  const { data, error } = await supabase.rpc("create_circle", {
    circle_name: name.trim(),
    source_circle_id: sourceCircleId,
  });
  if (error || typeof data !== "string") {
    return { ok: false, message: "That circle could not be created." };
  }
  return { ok: true, circleId: data };
}
