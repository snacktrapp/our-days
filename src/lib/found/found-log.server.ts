import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

export type FoundModelErrorLog = Readonly<{
  stage: "leads" | "picker";
  name: string;
  message: string;
}>;

export type FoundLeadLog = Readonly<{
  sourceType: string;
  host?: string;
  fetchStatus: "ok" | "empty" | "blocked" | "http";
  httpStatus?: number;
  dropReason?: string;
  attempts: readonly Readonly<{
    host?: string;
    fetchStatus: "ok" | "empty" | "blocked" | "http";
    httpStatus?: number;
  }>[];
}>;

type FoundRequestStore = {
  requestId: string;
  modelErrors: FoundModelErrorLog[];
  leadCount: number;
  leads: readonly FoundLeadLog[];
  cards: number;
  finished: boolean;
};

const requests = new AsyncLocalStorage<FoundRequestStore>();

function clippedMessage(error: unknown, secrets: readonly string[]) {
  const raw = error instanceof Error ? error.message : "Unknown model error";
  let message = raw;
  for (const secret of secrets) {
    if (secret.length >= 8) message = message.split(secret).join("[redacted]");
  }
  return message.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function beginFoundRequest<T>(run: () => Promise<T>) {
  return requests.run(
    {
      requestId: crypto.randomUUID(),
      modelErrors: [],
      leadCount: 0,
      leads: [],
      cards: 0,
      finished: false,
    },
    run,
  );
}

export function recordFoundModelError(
  stage: "leads" | "picker",
  error: unknown,
  secrets: readonly string[] = [],
) {
  const entry: FoundModelErrorLog = {
    stage,
    name: error instanceof Error ? error.name : "Error",
    message: clippedMessage(error, secrets),
  };
  const store = requests.getStore();
  store?.modelErrors.push(entry);
  console.warn({
    event: "found.model",
    requestId: store?.requestId,
    stage: entry.stage,
    name: entry.name,
    message: entry.message,
  });
}

export function noteFoundLeads(leads: readonly FoundLeadLog[], cards: number) {
  const store = requests.getStore();
  if (!store) return;
  store.leads = leads;
  store.leadCount = leads.length;
  store.cards = cards;
}

export function finishFoundRequestLog() {
  const store = requests.getStore();
  if (!store || store.finished) return;
  store.finished = true;
  const payload = {
    event: "found.search",
    requestId: store.requestId,
    leadCount: store.leadCount,
    leads: store.leads,
    cards: store.cards,
    ...(store.modelErrors.length > 0 ? { modelErrors: store.modelErrors } : {}),
  };
  console.info(payload);
  const fetchTrouble = store.leads.some((lead) => lead.fetchStatus !== "ok");
  if (store.modelErrors.length > 0 || fetchTrouble || store.cards === 0) {
    console.warn(payload);
  }
}
