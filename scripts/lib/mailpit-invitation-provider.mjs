import { createHash } from "node:crypto";
import { createConnection } from "node:net";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/u;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const IDEMPOTENCY =
  /^our-days\/invitation-delivery\/v1:[0-9a-f-]{36}:[1-9][0-9]*$/u;

export class LocalMailpitProviderError extends Error {
  constructor() {
    super("Local invitation delivery failed.");
    this.name = "LocalMailpitProviderError";
  }
}

function failed() {
  throw new LocalMailpitProviderError();
}

function validateOrigin(value) {
  let url;
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

function exactInput(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      [
        "deliveryVersion",
        "displayName",
        "idempotencyKey",
        "invitationToken",
        "jobId",
        "recipientEmail",
      ]
        .sort()
        .join(",") ||
    typeof value.jobId !== "string" ||
    !UUID_V4.test(value.jobId) ||
    !Number.isSafeInteger(value.deliveryVersion) ||
    value.deliveryVersion < 1 ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY.test(value.idempotencyKey) ||
    !value.idempotencyKey.endsWith(
      `:${value.jobId}:${value.deliveryVersion}`,
    ) ||
    typeof value.displayName !== "string" ||
    value.displayName !== value.displayName.trim() ||
    Array.from(value.displayName).length < 1 ||
    Array.from(value.displayName).length > 80 ||
    CONTROL.test(value.displayName) ||
    typeof value.recipientEmail !== "string" ||
    value.recipientEmail !== value.recipientEmail.trim().toLowerCase() ||
    value.recipientEmail.length > 254 ||
    !EMAIL.test(value.recipientEmail) ||
    typeof value.invitationToken !== "string" ||
    !TOKEN.test(value.invitationToken)
  )
    failed();
  return value;
}

function buildMessage(input, siteOrigin, messageId) {
  const actionUrl = `${siteOrigin}/invite#${input.invitationToken}`;
  const body = [
    `Hello ${input.displayName},`,
    "",
    "You have been invited to a private family journal in Our Days.",
    "Open this invitation, then use the one-time code sent to this same address:",
    "",
    actionUrl,
    "",
    "If you were not expecting this invitation, you can ignore this email.",
    "",
  ].join("\r\n");
  return [
    "From: Our Days <invites@our-days.local>",
    `To: ${input.recipientEmail}`,
    `Message-ID: <${messageId}@our-days.local>`,
    "Subject: Your private Our Days invitation",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

function createResponseReader(socket) {
  let buffered = "";
  const groups = [];
  const waiters = [];
  let current = [];
  let currentCode = null;
  let terminalError = null;

  function settle() {
    while (groups.length && waiters.length) {
      waiters.shift().resolve(groups.shift());
    }
    if (terminalError) {
      while (waiters.length) waiters.shift().reject(terminalError);
    }
  }

  socket.on("data", (chunk) => {
    buffered += chunk.toString("utf8");
    for (;;) {
      const boundary = buffered.indexOf("\r\n");
      if (boundary < 0) break;
      const line = buffered.slice(0, boundary);
      buffered = buffered.slice(boundary + 2);
      const match = /^(\d{3})([ -])/u.exec(line);
      if (!match) {
        terminalError = new Error("Malformed SMTP response");
        break;
      }
      if (currentCode === null) currentCode = Number(match[1]);
      if (Number(match[1]) !== currentCode) {
        terminalError = new Error("Inconsistent SMTP response");
        break;
      }
      current.push(line);
      if (match[2] === " ") {
        groups.push({ code: currentCode, lines: current });
        current = [];
        currentCode = null;
      }
    }
    settle();
  });
  socket.on("error", (error) => {
    terminalError = error;
    settle();
  });
  socket.on("timeout", () => {
    terminalError = new Error("SMTP timeout");
    socket.destroy();
    settle();
  });
  socket.on("close", () => {
    if (!terminalError && (waiters.length || current.length)) {
      terminalError = new Error("SMTP closed early");
      settle();
    }
  });

  return {
    next() {
      if (groups.length) return Promise.resolve(groups.shift());
      if (terminalError) return Promise.reject(terminalError);
      return new Promise((resolve, reject) =>
        waiters.push({ resolve, reject }),
      );
    },
  };
}

async function defaultSend({ host, port, recipientEmail, message }) {
  const socket = createConnection({ host, port });
  socket.setTimeout(5_000);
  const responses = createResponseReader(socket);

  async function expect(code, command) {
    const pending = responses.next();
    if (command !== undefined) socket.write(`${command}\r\n`, "utf8");
    const response = await pending;
    if (response.code !== code) failed();
  }

  try {
    await expect(220);
    await expect(250, "EHLO our-days.local");
    await expect(250, "MAIL FROM:<invites@our-days.local>");
    await expect(250, `RCPT TO:<${recipientEmail}>`);
    await expect(354, "DATA");
    const escaped = message
      .split("\r\n")
      .map((line) => (line.startsWith(".") ? `.${line}` : line))
      .join("\r\n");
    const accepted = responses.next();
    socket.write(`${escaped}\r\n.\r\n`, "utf8");
    const result = await accepted;
    if (result.code !== 250) failed();
    await expect(221, "QUIT");
  } catch {
    failed();
  } finally {
    socket.destroy();
  }
}

/** Local integration adapter only; Mailpit SMTP is not durable idempotency. */
export class LocalMailpitInvitationProvider {
  #siteOrigin;
  #smtpHost;
  #smtpPort;
  #send;
  #clock;
  #receipts = new Map();

  constructor({
    siteOrigin,
    smtpHost = "127.0.0.1",
    smtpPort = 54325,
    send = defaultSend,
    clock = () => new Date(),
  }) {
    this.#siteOrigin = validateOrigin(siteOrigin);
    if (
      !["127.0.0.1", "localhost", "::1"].includes(smtpHost) ||
      !Number.isSafeInteger(smtpPort) ||
      smtpPort < 1 ||
      smtpPort > 65_535 ||
      typeof send !== "function" ||
      typeof clock !== "function"
    )
      failed();
    this.#smtpHost = smtpHost;
    this.#smtpPort = smtpPort;
    this.#send = send;
    this.#clock = clock;
  }

  async deliver(value) {
    const input = exactInput(value);
    const messageId = createHash("sha256")
      .update(input.idempotencyKey, "utf8")
      .digest("hex");
    const message = buildMessage(input, this.#siteOrigin, messageId);
    const payloadSha256 = createHash("sha256")
      .update(message, "utf8")
      .digest("hex");
    const existing = this.#receipts.get(input.idempotencyKey);
    if (existing) {
      if (existing.payloadSha256 !== payloadSha256) failed();
      return existing;
    }

    await this.#send({
      host: this.#smtpHost,
      port: this.#smtpPort,
      recipientEmail: input.recipientEmail,
      message,
    }).catch(failed);
    const now = this.#clock();
    if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) failed();
    const receipt = Object.freeze({
      provider: "mailpit-local",
      messageId: `${messageId}@our-days.local`,
      acceptedAt: now.toISOString(),
      idempotencyKey: input.idempotencyKey,
      payloadSha256,
    });
    this.#receipts.set(input.idempotencyKey, receipt);
    return receipt;
  }
}
