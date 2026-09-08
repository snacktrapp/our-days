const dailyPrayerEmailAllowlist = ["trappbrian@gmail.com"] as const;

export function normalizeAccountEmail(email: string | null | undefined) {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

export function dailyPrayerIsAllowedForEmail(email: string | null | undefined) {
  const normalized = normalizeAccountEmail(email);
  return (dailyPrayerEmailAllowlist as readonly string[]).includes(normalized);
}

export function sessionEmailFromClaims(claims: unknown) {
  if (!claims || typeof claims !== "object") return null;
  const email = (claims as { email?: unknown }).email;
  return typeof email === "string" ? email : null;
}
