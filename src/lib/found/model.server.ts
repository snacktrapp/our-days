import "server-only";

import {
  APICallError,
  Output,
  gateway,
  generateText,
  jsonSchema,
  stepCountIs,
} from "ai";
import { FoundBudgetError } from "./errors.server";
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
  }>;
}>({
  type: "object",
  additionalProperties: false,
  required: ["leads"],
  properties: {
    leads: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
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
        },
      },
    },
  },
});

const spanSchema = jsonSchema<{ start: number; end: number }>({
  type: "object",
  additionalProperties: false,
  required: ["start", "end"],
  properties: {
    start: { type: "integer" },
    end: { type: "integer" },
  },
});

const leadSystem = `You locate where a real passage lives. You never write, quote, or paraphrase the passage.
Use web search. Return at most 5 leads. Each lead is a place to read the words, not the words.
- youtube: set videoId to the 11-character id and hintSeconds to the approximate start, if you know it.
- web: set url to an https page that contains the passage.
- bible: World English Bible only. Use book "Psalm" (not "Psalms"), plus chapter, startVerse, and endVerse.
Leave every field that would contain the passage empty. If you are unsure, return fewer leads.`;

const spanSystem = `You choose a span inside the source window. Return UTF-16 start and end indexes into the window exactly as given.
The slice must already be in the window. Do not rewrite, translate, or add words.
If the window does not contain a passage that answers the request, return start -1 and end -1.
Do not include the passage in any other field.`;

function rethrowKnown(error: unknown): never {
  if (APICallError.isInstance(error) && error.statusCode === 402) {
    throw new FoundBudgetError();
  }
  throw error;
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
}): FoundLead | null {
  if (
    value.kind !== "youtube" &&
    value.kind !== "web" &&
    value.kind !== "bible"
  ) {
    return null;
  }
  const hint = Number(value.hintSeconds);
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
    rethrowKnown(error);
  }
}

export async function pickFoundSpan(
  input: Readonly<{ query: string; window: string; signal: AbortSignal }>,
): Promise<SpanPick | null> {
  try {
    const { output } = await generateText({
      model: foundModelId,
      output: Output.object({ schema: spanSchema }),
      temperature: 0,
      maxRetries: 0,
      maxOutputTokens: 80,
      abortSignal: input.signal,
      system: spanSystem,
      prompt: `Request: ${input.query}\n\nWindow:\n${input.window}`,
    });
    if (
      !output ||
      !Number.isInteger(output.start) ||
      !Number.isInteger(output.end)
    ) {
      return null;
    }
    return { start: output.start, end: output.end };
  } catch (error) {
    if (input.signal.aborted) throw error;
    rethrowKnown(error);
  }
}
