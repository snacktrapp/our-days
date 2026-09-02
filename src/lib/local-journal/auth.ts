import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { findLocalAccount, readLocalJournal, type LocalAccess } from "./store";
import { localCircleId } from "./ids";

const cookieName = "our-days-local-session";
const sessionDays = 14;

type SessionPayload = Readonly<{
  v: 1;
  email: string;
  membershipId: string;
  personId: string;
  role: "organizer" | "member";
  exp: number;
}>;

function signingSecret() {
  return process.env.OUR_DAYS_LOCAL_JOURNAL_SECRET || "our-days-local-dev";
}

function encodePayload(payload: SessionPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function sign(encoded: string) {
  return createHmac("sha256", signingSecret())
    .update(encoded)
    .digest("base64url");
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "strict" as const,
    secure:
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") === true,
    maxAge,
  };
}

function parseSession(value: string | undefined): SessionPayload | null {
  if (!value) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (
      payload.v !== 1 ||
      typeof payload.email !== "string" ||
      typeof payload.membershipId !== "string" ||
      typeof payload.personId !== "string" ||
      (payload.role !== "organizer" && payload.role !== "member") ||
      typeof payload.exp !== "number" ||
      payload.exp * 1000 <= Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function createLocalJournalSession(email: string) {
  const account = await findLocalAccount(email);
  if (!account) return null;
  const document = await readLocalJournal();
  const membership = document.memberships.find(
    (candidate) => candidate.id === account.membershipId,
  );
  if (!membership) return null;
  const payload: SessionPayload = {
    v: 1,
    email,
    membershipId: account.membershipId,
    personId: account.personId,
    role: membership.role,
    exp: Math.floor(Date.now() / 1000) + sessionDays * 24 * 60 * 60,
  };
  const encoded = encodePayload(payload);
  const cookieStore = await cookies();
  cookieStore.set(
    cookieName,
    `${encoded}.${sign(encoded)}`,
    cookieOptions(sessionDays * 24 * 60 * 60),
  );
  return {
    membershipId: account.membershipId,
    circleId: localCircleId,
    personId: account.personId,
    role: membership.role,
  } satisfies LocalAccess;
}

export async function readLocalJournalAccess(): Promise<LocalAccess | null> {
  const cookieStore = await cookies();
  const payload = parseSession(cookieStore.get(cookieName)?.value);
  if (!payload) return null;
  const account = await findLocalAccount(payload.email);
  if (
    !account ||
    account.membershipId !== payload.membershipId ||
    account.personId !== payload.personId
  ) {
    return null;
  }
  return {
    membershipId: payload.membershipId,
    circleId: localCircleId,
    personId: payload.personId,
    role: payload.role,
  };
}

export async function expireLocalJournalSession() {
  const cookieStore = await cookies();
  cookieStore.set(cookieName, "", {
    ...cookieOptions(0),
    expires: new Date(0),
  });
}
