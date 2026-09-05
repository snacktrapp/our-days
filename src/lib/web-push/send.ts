import "server-only";

import { createPrivateKey, hkdfSync, sign } from "node:crypto";
import {
  decodeUrlSafeBase64,
  encodeUrlSafeBase64,
  webPushIsConfigured,
  webPushVapidPrivateKey,
  webPushVapidPublicKey,
  webPushVapidSubject,
} from "./keys";

export type WebPushSubscriptionKeys = Readonly<{
  endpoint: string;
  p256dh: string;
  auth: string;
}>;

export type WebPushPayload = Readonly<{
  title: string;
  url: string;
  tag?: string;
}>;

export type WebPushSendResult = Readonly<{
  ok: boolean;
  status: number;
  stale: boolean;
}>;

function hkdfSha256(salt: Buffer, ikm: Buffer, info: Buffer, length: number) {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

function vapidPublicPoint() {
  const publicKey = webPushVapidPublicKey();
  if (!publicKey) throw new Error("Web Push is unavailable.");
  const bytes = decodeUrlSafeBase64(publicKey);
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error("Web Push is unavailable.");
  }
  return bytes;
}

function vapidPrivateJwk() {
  const privateKey = webPushVapidPrivateKey();
  const publicPoint = vapidPublicPoint();
  if (!privateKey) throw new Error("Web Push is unavailable.");
  const d = decodeUrlSafeBase64(privateKey);
  if (d.length !== 32) throw new Error("Web Push is unavailable.");
  return {
    crv: "P-256" as const,
    d: encodeUrlSafeBase64(d),
    ext: true,
    kty: "EC" as const,
    x: encodeUrlSafeBase64(publicPoint.subarray(1, 33)),
    y: encodeUrlSafeBase64(publicPoint.subarray(33, 65)),
  };
}

function signVapidJwt(audience: string) {
  const header = encodeUrlSafeBase64(
    Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })),
  );
  const payload = encodeUrlSafeBase64(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: webPushVapidSubject(),
      }),
    ),
  );
  const unsigned = `${header}.${payload}`;
  const key = createPrivateKey({ format: "jwk", key: vapidPrivateJwk() });
  const signature = sign("sha256", Buffer.from(unsigned), {
    dsaEncoding: "ieee-p1363",
    key,
  });
  return `${unsigned}.${encodeUrlSafeBase64(signature)}`;
}

function audienceForEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  return url.origin;
}

async function encryptPayload(
  subscription: WebPushSubscriptionKeys,
  payload: string,
) {
  const userPublic = decodeUrlSafeBase64(subscription.p256dh);
  const userAuth = decodeUrlSafeBase64(subscription.auth);
  if (userPublic.length !== 65 || userPublic[0] !== 0x04) {
    throw new Error("Push subscription is invalid.");
  }
  if (userAuth.length !== 16) throw new Error("Push subscription is invalid.");

  const localKey = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const localPublicRaw = Buffer.from(
    await crypto.subtle.exportKey("raw", localKey.publicKey),
  );
  const userKey = await crypto.subtle.importKey(
    "raw",
    userPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = Buffer.from(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: userKey },
      localKey.privateKey,
      256,
    ),
  );
  const ikm = hkdfSha256(
    userAuth,
    sharedSecret,
    Buffer.concat([Buffer.from("WebPush: info\0"), userPublic, localPublicRaw]),
    32,
  );
  const salt = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
  const contentEncryptionKey = hkdfSha256(
    salt,
    ikm,
    Buffer.from("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = hkdfSha256(
    salt,
    ikm,
    Buffer.from("Content-Encoding: nonce\0"),
    12,
  );
  const padded = Buffer.concat([
    Buffer.from(payload, "utf8"),
    Buffer.from([2]),
  ]);
  const importedCek = await crypto.subtle.importKey(
    "raw",
    contentEncryptionKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertext = Buffer.from(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      importedCek,
      padded,
    ),
  );
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([
    salt,
    recordSize,
    Buffer.from([localPublicRaw.length]),
    localPublicRaw,
    ciphertext,
  ]);
}

export async function sendWebPush(
  subscription: WebPushSubscriptionKeys,
  payload: WebPushPayload,
): Promise<WebPushSendResult> {
  if (!webPushIsConfigured()) return { ok: false, status: 0, stale: false };
  if (!subscription.endpoint.startsWith("https://")) {
    return { ok: false, status: 0, stale: true };
  }

  const body = await encryptPayload(
    subscription,
    JSON.stringify({
      title: payload.title,
      url: payload.url,
      tag: payload.tag,
    }),
  );
  const publicKey = webPushVapidPublicKey();
  if (!publicKey) return { ok: false, status: 0, stale: false };
  const jwt = signVapidJwt(audienceForEndpoint(subscription.endpoint));
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body,
  });
  if (response.ok || response.status === 201) {
    return { ok: true, status: response.status, stale: false };
  }
  return {
    ok: false,
    status: response.status,
    stale: response.status === 404 || response.status === 410,
  };
}
