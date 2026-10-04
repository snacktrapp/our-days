/**
 * App Store safety RPCs shared with the web. Argument names follow CONTRACT.md.
 * A missing function is a plain error for report, block, and deletion. Terms
 * acceptance fails open only when the function does not exist, and nothing
 * sensitive is logged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { siteOrigin } from "./config";

export const TERMS_VERSION = "2026-10-04";

export const reportThanks =
  "Thanks — our team reviews reports within 24 hours.";

export const deletionConfirmCopy =
  "Your account, and the posts, photos, videos, comments, and hearts you added, will be deleted within 7 days. Others' posts stay; your tags and mentions are removed. We'll email you when it's done.";

export const zeroToleranceCopy =
  "Our Days has no tolerance for objectionable content or abusive behavior.";

export const contactEmail = "team@beelinetech.co";

export const reportReasons = [
  { id: "harassment", label: "Harassment" },
  { id: "hate", label: "Hate" },
  { id: "sexual", label: "Sexual content" },
  { id: "violence", label: "Violence" },
  { id: "child_safety", label: "Child safety" },
  { id: "spam", label: "Spam" },
  { id: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof reportReasons)[number]["id"];
export type ReportTargetKind = "moment" | "note";

export type SafetyFailure = Readonly<{
  ok: false;
  message: string;
  missing: boolean;
}>;

export type SafetyResult<T> = Readonly<{ ok: true; data: T } | SafetyFailure>;

type RpcClient = Pick<SupabaseClient, "rpc">;

const plainMessage = {
  report: "That report could not be sent. Try again.",
  block: "That person could not be blocked. Try again.",
  unblock: "That person could not be unblocked. Try again.",
  blocks: "Blocked people could not be loaded. Try again.",
  closure: "Account deletion could not be requested. Try again.",
  closureStatus: "We couldn't check this account yet. You can still request deletion.",
  terms: "The agreement could not be saved. Try again.",
} as const;

export type SafetyMessageKind = keyof typeof plainMessage;

export function plainSafetyMessage(kind: SafetyMessageKind) {
  return plainMessage[kind];
}

function errorParts(error: unknown) {
  if (!error || typeof error !== "object") return { code: "", message: "" };
  const record = error as { code?: unknown; message?: unknown };
  return {
    code: typeof record.code === "string" ? record.code : "",
    message: typeof record.message === "string" ? record.message : "",
  };
}

/** PostgREST PGRST202, or Postgres 42883, when the RPC is not deployed yet. */
export function isMissingFunction(error: unknown) {
  const { code, message } = errorParts(error);
  if (code === "PGRST202" || code === "42883") return true;
  const lower = message.toLowerCase();
  return (
    lower.includes("could not find the function") ||
    /function [\w.]+ does not exist/u.test(lower)
  );
}

function failure(kind: SafetyMessageKind, error: unknown): SafetyFailure {
  return {
    ok: false,
    message: plainSafetyMessage(kind),
    missing: isMissingFunction(error),
  };
}

async function call(
  supabase: RpcClient,
  fn: string,
  args?: Record<string, unknown>,
) {
  try {
    return await supabase.rpc(fn, args);
  } catch (error) {
    return { data: null, error };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRows(data: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  return isRecord(data) ? [data] : [];
}

export function isReportReason(value: string): value is ReportReason {
  return reportReasons.some((reason) => reason.id === value);
}

export function legalUrl(path: "privacy" | "terms" | "support") {
  return `${siteOrigin}/${path}`;
}

export function contactUrl() {
  return `mailto:${contactEmail}`;
}

export type TermsGate = "allow" | "prompt";

export function termsGate(input: Readonly<{
  error: unknown;
  rows: readonly { terms_version?: unknown }[] | null;
}>): TermsGate {
  if (input.error && isMissingFunction(input.error)) return "allow";
  const accepted = (input.rows ?? []).some(
    (row) => row.terms_version === TERMS_VERSION,
  );
  return accepted ? "allow" : "prompt";
}

export async function getMyTermsAcceptance(
  supabase: RpcClient,
): Promise<Readonly<{ gate: TermsGate }>> {
  const { data, error } = await call(supabase, "get_my_terms_acceptance");
  return {
    gate: termsGate({
      error,
      rows: error ? null : asRows(data),
    }),
  };
}

export async function acceptTerms(supabase: RpcClient): Promise<SafetyResult<string>> {
  const { data, error } = await call(supabase, "accept_terms", {
    terms_version: TERMS_VERSION,
  });
  if (error) return failure("terms", error);
  return { ok: true, data: typeof data === "string" ? data : "" };
}

export async function reportContent(
  supabase: RpcClient,
  input: Readonly<{
    targetKind: ReportTargetKind;
    targetId: string;
    reason: ReportReason;
    details: string | null;
  }>,
): Promise<SafetyResult<string>> {
  const details = input.details?.trim() ? input.details.trim() : null;
  const { data, error } = await call(supabase, "report_content", {
    target_kind: input.targetKind,
    target_id: input.targetId,
    reason: input.reason,
    details,
  });
  if (error || typeof data !== "string" || data.length === 0) {
    return failure("report", error);
  }
  return { ok: true, data };
}

export async function blockMember(
  supabase: RpcClient,
  membershipId: string,
): Promise<SafetyResult<null>> {
  const { error } = await call(supabase, "block_member", {
    target_membership_id: membershipId,
  });
  if (error) return failure("block", error);
  return { ok: true, data: null };
}

export async function unblockMember(
  supabase: RpcClient,
  membershipId: string,
): Promise<SafetyResult<null>> {
  const { error } = await call(supabase, "unblock_member", {
    target_membership_id: membershipId,
  });
  if (error) return failure("unblock", error);
  return { ok: true, data: null };
}

export type BlockedPerson = Readonly<{
  membershipId: string;
  name: string;
  blockedAt: string;
}>;

export function parseBlocks(data: unknown): readonly BlockedPerson[] {
  return asRows(data).flatMap((row) => {
    if (typeof row.membership_id !== "string" || typeof row.person_display_name !== "string") {
      return [];
    }
    return [
      {
        membershipId: row.membership_id,
        name: row.person_display_name,
        blockedAt: typeof row.blocked_at === "string" ? row.blocked_at : "",
      },
    ];
  });
}

export async function listMyBlocks(
  supabase: RpcClient,
): Promise<SafetyResult<readonly BlockedPerson[]>> {
  const { data, error } = await call(supabase, "list_my_blocks");
  if (error) return failure("blocks", error);
  return { ok: true, data: parseBlocks(data) };
}

export type ClosureRow = Readonly<{
  state: string;
  requestedAt: string | null;
  lastOrganizerCircles: readonly string[];
}>;

export type ClosureView =
  | Readonly<{ kind: "requested"; label: string }>
  | Readonly<{ kind: "last-organizer"; circles: readonly string[]; message: string }>
  | Readonly<{ kind: "confirm"; notice: string | null }>;

const requestedStates = new Set(["requested", "pending", "scheduled"]);

export function parseClosureRow(data: unknown): ClosureRow | null {
  const row = asRows(data)[0];
  if (!row) return null;
  const circles = Array.isArray(row.last_organizer_circles)
    ? row.last_organizer_circles.flatMap((item) =>
        typeof item === "string" && item.trim() ? [item.trim()] : [],
      )
    : [];
  return {
    state: typeof row.state === "string" ? row.state : "",
    requestedAt: typeof row.requested_at === "string" ? row.requested_at : null,
    lastOrganizerCircles: circles,
  };
}

export function deletionRequestedLabel(iso: string | null) {
  if (!iso) return "Deletion requested.";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Deletion requested.";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Deletion requested on ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}.`;
}

export function closureView(input: Readonly<{
  error: unknown;
  row: ClosureRow | null;
}>): ClosureView {
  const circles = input.row?.lastOrganizerCircles ?? [];
  const state = (input.row?.state ?? "").toLowerCase();
  const requestedAt = input.row?.requestedAt ?? null;
  const requested = Boolean(requestedAt) || requestedStates.has(state);
  if (requested && circles.length === 0) {
    return { kind: "requested", label: deletionRequestedLabel(requestedAt) };
  }
  if (circles.length > 0) {
    return {
      kind: "last-organizer",
      circles,
      message: "Choose another organizer for these circles before deleting your account.",
    };
  }
  return {
    kind: "confirm",
    notice: input.error ? plainSafetyMessage("closureStatus") : null,
  };
}

export async function getMyAccountClosureStatus(
  supabase: RpcClient,
): Promise<Readonly<{ view: ClosureView }>> {
  const { data, error } = await call(supabase, "get_my_account_closure_status");
  return { view: closureView({ error, row: error ? null : parseClosureRow(data) }) };
}

const lastOrganizerFallback =
  "Choose another organizer for each circle you organize before deleting your account.";

export async function requestAccountClosure(
  supabase: RpcClient,
  requestKey: string,
): Promise<SafetyResult<string>> {
  const { data, error } = await call(supabase, "request_account_closure", {
    request_key: requestKey,
  });
  if (error || typeof data !== "string" || data.length === 0) {
    if (errorParts(error).code === "23514") {
      return { ok: false, message: lastOrganizerFallback, missing: false };
    }
    return failure("closure", error);
  }
  return { ok: true, data };
}

export function freshRequestKey() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function authorHidden(
  authorMembershipId: string | undefined,
  hiddenAuthorIds: readonly string[],
) {
  return (
    typeof authorMembershipId === "string" &&
    authorMembershipId.length > 0 &&
    hiddenAuthorIds.includes(authorMembershipId)
  );
}

export function withoutBlockedAuthor<
  T extends {
    authorMembershipId?: string;
    notes?: readonly { authorMembershipId?: string }[];
  },
>(moments: readonly T[], membershipId: string): T[] {
  if (!membershipId) return [...moments];
  return moments.flatMap((moment) => {
    if (moment.authorMembershipId === membershipId) return [];
    if (!moment.notes) return [moment];
    const notes = moment.notes.filter((note) => note.authorMembershipId !== membershipId);
    if (notes.length === moment.notes.length) return [moment];
    return [{ ...moment, notes }];
  });
}
