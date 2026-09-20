import type { JournalSection } from "./shell-view-model";

// Loading and loaded chrome must use the same complete pair.
export const journalHeadings = {
  you: { title: "Just me", eyebrow: "Just me" },
  all: { title: "All circles", eyebrow: "Circles" },
  circles: { title: "Circles", eyebrow: "Journals" },
  settings: { title: "Account", eyebrow: "Our family" },
  memories: { title: "Memories", eyebrow: "Our family" },
} as const;

export function sectionHeading(section: JournalSection) {
  if (section === "circles" || section === "people")
    return journalHeadings.circles;
  if (section === "settings") return journalHeadings.settings;
  if (section === "memories") return journalHeadings.memories;
  return null;
}
