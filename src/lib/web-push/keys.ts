const urlSafeBase64Pattern = /^[A-Za-z0-9_-]+={0,2}$/u;

export function webPushVapidPublicKey() {
  const value = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  return value && urlSafeBase64Pattern.test(value) ? value : undefined;
}

export function webPushVapidPrivateKey() {
  const value = process.env.OUR_DAYS_WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  return value && urlSafeBase64Pattern.test(value) ? value : undefined;
}

export function webPushVapidSubject() {
  const configured = process.env.OUR_DAYS_WEB_PUSH_VAPID_SUBJECT?.trim();
  if (
    configured &&
    (configured.startsWith("mailto:") || configured.startsWith("https://"))
  ) {
    return configured;
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl?.startsWith("https://")) return siteUrl;
  return "https://our-days-neon.vercel.app";
}

export function webPushIsConfigured() {
  return Boolean(webPushVapidPublicKey() && webPushVapidPrivateKey());
}

export function decodeUrlSafeBase64(value: string) {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(`${padded}${"=".repeat(padLength)}`, "base64");
}

export function encodeUrlSafeBase64(bytes: Buffer | Uint8Array) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}
