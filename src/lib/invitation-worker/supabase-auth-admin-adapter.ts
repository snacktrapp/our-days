import type {
  InvitationAuthAdminProvisioner,
  InvitationAuthUserSnapshot,
} from "./provisioner";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const PAGE_SIZE = 1_000;
const MAX_PAGES = 100;

type Fetch = typeof globalThis.fetch;

export class InvitationAuthAdminAdapterError extends Error {
  constructor() {
    super("Invitation Auth administration failed.");
    this.name = "InvitationAuthAdminAdapterError";
  }
}

function failed(): never {
  throw new InvitationAuthAdminAdapterError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateEmail(value: string) {
  if (
    value.length < 3 ||
    value.length > 254 ||
    value !== value.trim().toLowerCase() ||
    !EMAIL.test(value) ||
    CONTROL_CHARACTER.test(value)
  )
    failed();
}

function parseUser(
  value: unknown,
  expectedEmail: string,
): InvitationAuthUserSnapshot {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID_V4.test(value.id) ||
    value.email !== expectedEmail ||
    (value.email_confirmed_at !== undefined &&
      value.email_confirmed_at !== null &&
      typeof value.email_confirmed_at !== "string")
  )
    failed();
  return {
    id: value.id,
    email: expectedEmail,
    emailConfirmedAt:
      typeof value.email_confirmed_at === "string"
        ? value.email_confirmed_at
        : null,
  };
}

function validateProjectOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    failed();
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    failed();
  return url.origin;
}

/**
 * Worker-only adapter for Supabase Auth Admin. Do not export it from the
 * browser-neutral invitation-worker index or import it from the Next app.
 */
export class SupabaseInvitationAuthAdminAdapter implements InvitationAuthAdminProvisioner {
  readonly #origin: string;
  readonly #serviceRoleKey: string;
  readonly #fetch: Fetch;

  constructor(input: {
    projectUrl: string;
    serviceRoleKey: string;
    fetch?: Fetch;
  }) {
    this.#origin = validateProjectOrigin(input.projectUrl);
    if (
      typeof input.serviceRoleKey !== "string" ||
      input.serviceRoleKey.length < 32 ||
      CONTROL_CHARACTER.test(input.serviceRoleKey)
    )
      failed();
    this.#serviceRoleKey = input.serviceRoleKey;
    this.#fetch = input.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") failed();
  }

  #headers(contentType = false) {
    return {
      apikey: this.#serviceRoleKey,
      authorization: `Bearer ${this.#serviceRoleKey}`,
      ...(contentType ? { "content-type": "application/json" } : {}),
    };
  }

  async findByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<InvitationAuthUserSnapshot | null> {
    validateEmail(normalizedEmail);
    let match: InvitationAuthUserSnapshot | null = null;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await this.#fetch(
        `${this.#origin}/auth/v1/admin/users?page=${page}&per_page=${PAGE_SIZE}`,
        { headers: this.#headers(), method: "GET" },
      ).catch(failed);
      if (!response.ok) failed();
      const body: unknown = await response.json().catch(failed);
      if (!isRecord(body) || !Array.isArray(body.users)) failed();

      for (const user of body.users) {
        if (
          isRecord(user) &&
          typeof user.email === "string" &&
          user.email.trim().toLowerCase() === normalizedEmail
        ) {
          const candidate = parseUser(user, normalizedEmail);
          if (match !== null && match.id !== candidate.id) failed();
          match = candidate;
        }
      }

      if (body.users.length < PAGE_SIZE) return match;
    }
    failed();
  }

  async createUnconfirmedUser(
    normalizedEmail: string,
  ): Promise<InvitationAuthUserSnapshot> {
    validateEmail(normalizedEmail);
    const response = await this.#fetch(`${this.#origin}/auth/v1/invite`, {
      body: JSON.stringify({ email: normalizedEmail }),
      headers: this.#headers(true),
      method: "POST",
    }).catch(failed);
    if (!response.ok) failed();
    const value: unknown = await response.json().catch(failed);
    const user = parseUser(value, normalizedEmail);
    if (user.emailConfirmedAt !== null) failed();
    return user;
  }

  async sendAuthenticationCode(user: InvitationAuthUserSnapshot) {
    validateEmail(user.email);
    if (!UUID_V4.test(user.id)) failed();

    if (user.emailConfirmedAt === null) {
      const response = await this.#fetch(`${this.#origin}/auth/v1/invite`, {
        body: JSON.stringify({ email: user.email }),
        headers: this.#headers(true),
        method: "POST",
      }).catch(failed);
      if (!response.ok) failed();
      const value: unknown = await response.json().catch(failed);
      const renewed = parseUser(value, user.email);
      if (renewed.id !== user.id || renewed.emailConfirmedAt !== null) failed();
      return;
    }

    const response = await this.#fetch(`${this.#origin}/auth/v1/otp`, {
      body: JSON.stringify({ email: user.email, create_user: false }),
      headers: this.#headers(true),
      method: "POST",
    }).catch(failed);
    if (!response.ok) failed();
  }
}
