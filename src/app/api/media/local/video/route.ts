import { localJournalIsEnabled } from "../../../../../../config/our-days-environment";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { readLocalJournalAccess } from "@/lib/local-journal/auth";
import {
  LocalMediaCoordinatorError,
  publishVerifiedVideoMoment,
} from "@/lib/local-journal/media-coordinator";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

function json(status: number, body: unknown) {
  return Response.json(body, { status, headers: privateHeaders });
}

function readString(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  if (!localJournalIsEnabled()) return json(404, { message: "Not found." });
  if (
    !isExpectedMutationOrigin(
      request.headers.get("origin"),
      process.env.NEXT_PUBLIC_SITE_URL,
    )
  ) {
    return json(403, { message: "That request could not be verified." });
  }
  const access = await readLocalJournalAccess();
  if (!access) {
    return json(401, { message: "Your private session needs to be renewed." });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return json(400, { message: "Choose a video and try again." });
  }
  let taggedPersonIds: string[] = [];
  try {
    const parsed = JSON.parse(readString(form, "taggedPersonIds") || "[]");
    if (
      !Array.isArray(parsed) ||
      parsed.some((value) => typeof value !== "string")
    ) {
      throw new Error("invalid tags");
    }
    taggedPersonIds = parsed;
  } catch {
    return json(400, { message: "Check the moment and try again." });
  }

  try {
    const moment = await publishVerifiedVideoMoment(access, {
      file,
      journalPersonId: readString(form, "journalPersonId"),
      body: readString(form, "body").trim(),
      placeName: readString(form, "placeName").trim(),
      taggedPersonIds,
      occurredOn: readString(form, "occurredOn"),
      occurredAt: readString(form, "occurredAt") || null,
      occurredTimezone: readString(form, "occurredTimezone") || null,
      durationMs: Number(readString(form, "durationMs")),
    });
    return json(200, {
      momentId: moment.id,
    });
  } catch (error) {
    if (error instanceof LocalMediaCoordinatorError) {
      return json(error.status, { message: error.message });
    }
    return json(400, {
      message:
        error instanceof Error
          ? error.message
          : "That video could not be saved.",
    });
  }
}
