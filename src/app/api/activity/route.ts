import { readJournalAccessState } from "@/lib/auth/journal-access";
import { loadJournalActivityNotifications } from "@/data/journal-context.server";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const access = await readJournalAccessState();
    if (access.mode !== "authenticated") {
      return Response.json(
        { error: "Sign in to view activity." },
        { status: 401, headers },
      );
    }
    const items = await loadJournalActivityNotifications(
      access,
      {},
      { strict: true },
    );
    return Response.json({ items }, { headers });
  } catch {
    return Response.json(
      { error: "Activity could not be refreshed." },
      { status: 503, headers },
    );
  }
}
