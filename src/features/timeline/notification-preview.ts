import type { TimelineViewModel } from "./timeline-view-model";

const previewNotificationPageSize = 2;

export function slicePreviewTimelineForNotification(
  model: TimelineViewModel,
  search: Readonly<{
    moment?: string;
    note?: string;
    thread?: string;
    pages?: string;
    circle?: string;
  }>,
): TimelineViewModel {
  if (!search.moment || search.circle) return model;
  const pages = Math.max(1, Number(search.pages) || 1);
  const limit = pages * previewNotificationPageSize;
  let seen = 0;
  const entries = [];
  for (const entry of model.entries) {
    if (entry.entryType === "moment") {
      if (seen >= limit) break;
      seen += 1;
    }
    entries.push(entry);
  }
  const momentCount = model.entries.filter(
    (entry) => entry.entryType === "moment",
  ).length;
  if (momentCount <= limit) return { ...model, entries };
  const params = new URLSearchParams();
  params.set("moment", search.moment);
  if (search.note) params.set("note", search.note);
  if (search.thread) params.set("thread", search.thread);
  params.set("pages", String(pages + 1));
  return {
    ...model,
    entries,
    pagination: {
      nextHref: `/family?${params.toString()}`,
      label: "Show earlier days",
    },
  };
}
