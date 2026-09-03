import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import type { OAuthProvider } from "./oauth-protocol";

export const oauthStateCookieName = "our-days-oauth-state";
const stateMinutes = 10;

export type OAuthStatePayload = Readonly<{
  v: 1;
  provider: OAuthProvider;
  verifier: string;
  nonce: string;
  exp: number;
}>;

function signingSecret() {
  return (
    process.env.OUR_DAYS_OAUTH_STATE_SECRET ||
    process.env.OUR_DAYS_LOCAL_JOURNAL_SECRET ||
    "our-days-oauth-dev"
  );
}

function encodePayload(payload: OAuthStatePayload) {
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
    sameSite: "lax" as const,
    secure:
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") === true,
    maxAge,
  };
}

export function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOAuthStateToken(payload: OAuthStatePayload) {
  const encoded = encodePayload(payload);
  return `${encoded}.${sign(encoded)}`;
}

export function parseOAuthStateToken(value: string | undefined) {
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
    ) as OAuthStatePayload;
    if (
      payload.v !== 1 ||
      (payload.provider !== "google" && payload.provider !== "x") ||
      typeof payload.verifier !== "string" ||
      typeof payload.nonce !== "string" ||
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

export function createOAuthState(provider: OAuthProvider) {
  const { verifier, challenge } = createPkcePair();
  const nonce = randomBytes(24).toString("base64url");
  const payload: OAuthStatePayload = {
    v: 1,
    provider,
    verifier,
    nonce,
    exp: Math.floor(Date.now() / 1000) + stateMinutes * 60,
  };
  return {
    verifier,
    challenge,
    nonce,
    token: createOAuthStateToken(payload),
    cookie: cookieOptions(stateMinutes * 60),
  };
}

export async function readOAuthState() {
  const cookieStore = await cookies();
  return parseOAuthStateToken(cookieStore.get(oauthStateCookieName)?.value);
}

export async function expireOAuthState() {
  const cookieStore = await cookies();
  cookieStore.set(oauthStateCookieName, "", {
    ...cookieOptions(0),
    expires: new Date(0),
  });
}
