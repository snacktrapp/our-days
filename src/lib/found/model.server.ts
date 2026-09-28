import "server-only";

import { GatewayAuthenticationError, GatewayError } from "@ai-sdk/gateway";
import {
  APICallError,
  Output,
  gateway,
  generateText,
  jsonSchema,
  stepCountIs,
} from "ai";
import { FoundBudgetError, FoundUnavailableError } from "./errors.server";
import { recordFoundModelError } from "./found-log.server";
import type { FoundLead } from "./leads.server";
import type { SpanPick } from "./verify.server";

/** Hunch, not a lock: cheap, fast, and tagged for tools plus structured output. */
export const foundModelId = "google/gemini-3.5-flash-lite" as const;

const leadSchema = jsonSchema<{
  leads: Array<{
    kind?: string;
    url?: string;
    videoId?: string;
    speaker?: string;
    title?: string;
    hintSeconds?: number;
    book?: string;
    chapter?: number;
    startVerse?: number;
    endVerse?: number;
    transcriptUrl?: string;
  }>;
}>({
  type: "object",
  additionalProperties: true,
  required: ["leads"],
  properties: {
    leads: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: true,
        required: ["kind"],
        properties: {
          kind: { type: "string", enum: ["youtube", "web", "bible"] },
          url: { type: "string" },
          videoId: { type: "string" },
          speaker: { type: "string" },
          title: { type: "string" },
          hintSeconds: { type: "number" },
          book: { type: "string" },
          chapter: { type: "integer" },
          startVerse: { type: "integer" },
          endVerse: { type: "integer" },
          transcriptUrl: { type: "string" },
        },
      },
    },
  },
});

const quoteSchema = jsonSchema<{ quote?: string; hintSeconds?: number }>({
  type: "object",
  additionalProperties: true,
  required: ["quote"],
  properties: {
    quote: { type: "string" },
    hintSeconds: { type: "number" },
  },
});

const leadSystem = `You locate where a real passage lives. You never write, quote, or paraphrase the passage.
Use web search. Return at most 5 leads. Each lead is a place to read the words, not the words.
- youtube: set videoId to the 11-character id and hintSeconds to the approximate start, if you know it. If the show publishes a transcript page, also set transcriptUrl to that https page, for example https://lexfridman.com/guest-transcript.
- web: set url to an https page that contains the passage.
- bible: World English Bible only. Use book "Psalm" (not "Psalms"), plus chapter, startVerse, and endVerse.
Leave every field that would contain the passage empty. If you are unsure, return fewer leads.`;

const quoteSystem = `You copy a passage that already appears in the window. Return that passage verbatim in quote.
Do not paraphrase, translate, or add words. Omit timestamp markers such as (01:52:42) or [1:52:42].
If the window does not contain a passage that answers the request, return an empty quote.
If a timestamp for the start of the passage is visible, set hintSeconds to that start in seconds. Otherwise omit hintSeconds.`;

function gatewayText(error: GatewayError) {
  const type = "type" in error ? String(error.type) : "";
  return `${error.name} ${type} ${error.message}`.toLowerCase();
}

function isInsufficientFunds(error: GatewayError) {
  if (error.statusCode === 402) return true;
  return /insufficient[\s_-]*funds|payment required/u.test(gatewayText(error));
}

function knownModelError(error: unknown) {
  if (
    GatewayAuthenticationError.isInstance(error) ||
    (GatewayError.isInstance(error) && error.statusCode === 401)
  ) {
    return new FoundUnavailableError();
  }
  if (GatewayError.isInstance(error) && isInsufficientFunds(error)) {
    return new FoundBudgetError();
  }
  if (APICallError.isInstance(error) && error.statusCode === 402) {
    return new FoundBudgetError();
  }
  return null;
}

function httpsUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function asLead(value: {
  kind?: string;
  url?: string;
  videoId?: string;
  speaker?: string;
  title?: string;
  hintSeconds?: number;
  book?: string;
  chapter?: number;
  startVerse?: number;
  endVerse?: number;
  transcriptUrl?: string;
}): FoundLead | null {
  if (
    value.kind !== "youtube" &&
    value.kind !== "web" &&
    value.kind !== "bible"
  ) {
    return null;
  }
  const hint = Number(value.hintSeconds);
  const transcriptUrl = httpsUrl(value.transcriptUrl);
  return {
    kind: value.kind,
    ...(typeof value.url === "string" ? { url: value.url.trim() } : {}),
    ...(typeof value.videoId === "string"
      ? { videoId: value.videoId.trim() }
      : {}),
    ...(typeof value.speaker === "string"
      ? { speaker: value.speaker.trim() }
      : {}),
    ...(typeof value.title === "string" ? { title: value.title.trim() } : {}),
    ...(Number.isFinite(hint) && hint >= 0 ? { hintSeconds: hint } : {}),
    ...(typeof value.book === "string" ? { book: value.book.trim() } : {}),
    ...(Number.isInteger(value.chapter) ? { chapter: value.chapter } : {}),
    ...(Number.isInteger(value.startVerse)
      ? { startVerse: value.startVerse }
      : {}),
    ...(Number.isInteger(value.endVerse) ? { endVerse: value.endVerse } : {}),
    ...(transcriptUrl ? { transcriptUrl } : {}),
  };
}

export async function proposeFoundLeads(
  query: string,
  signal: AbortSignal,
): Promise<FoundLead[]> {
  try {
    const { output } = await generateText({
      model: foundModelId,
      tools: {
        perplexity_search: gateway.tools.perplexitySearch({
          maxResults: 5,
          maxTokensPerPage: 1024,
          maxTokens: 8000,
          searchLanguageFilter: ["en"],
        }),
      },
      stopWhen: stepCountIs(4),
      prepareStep: ({ stepNumber }) => {
        // The last step must answer. A trailing tool call throws instead of returning leads.
        if (stepNumber >= 3) return { activeTools: [], toolChoice: "none" };
        return {};
      },
      output: Output.object({ schema: leadSchema }),
      temperature: 0,
      maxRetries: 0,
      maxOutputTokens: 1200,
      abortSignal: signal,
      system: leadSystem,
      prompt: query,
    });
    return (output?.leads ?? [])
      .flatMap((lead) => {
        const parsed = asLead(lead);
        return parsed ? [parsed] : [];
      })
      .slice(0, 5);
  } catch (error) {
    if (signal.aborted) throw error;
    const known = knownModelError(error);
    recordFoundModelError("leads", error, [query]);
    if (known) throw known;
    return [];
  }
}

export async function pickFoundQuote(
  input: Readonly<{ query: string; window: string; signal: AbortSignal }>,
): Promise<SpanPick | null> {
  try {
    const { output } = await generateText({
      model: foundModelId,
      output: Output.object({ schema: quoteSchema }),
      temperature: 0,
      maxRetries: 0,
      maxOutputTokens: 1200,
      abortSignal: input.signal,
      system: quoteSystem,
      prompt: `Request: ${input.query}\n\nWindow:\n${input.window}`,
    });
    const quote = typeof output?.quote === "string" ? output.quote.trim() : "";
    if (!quote) return null;
    const hint = Number(output?.hintSeconds);
    return {
      quote,
      ...(Number.isFinite(hint) && hint >= 0 ? { hintSeconds: hint } : {}),
    };
  } catch (error) {
    if (input.signal.aborted) throw error;
    const known = knownModelError(error);
    recordFoundModelError("picker", error, [input.query, input.window]);
    if (known) throw known;
    return null;
  }
}
