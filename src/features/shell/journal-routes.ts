import type { JournalSection } from "./shell-view-model";

export type JournalSkeletonKind =
  "timeline" | "people" | "memories" | "settings";

export function pathWithoutSearch(href: string) {
  const path = href.split("?")[0] ?? href;
  return path.split("#")[0] ?? path;
}

export function sectionFromPathname(
  pathname: string | null,
): Extract<
  JournalSection,
  "timeline" | "people" | "memories" | "settings"
> | null {
  const path = pathname ?? "";
  if (
    path === "/family" ||
    path.startsWith("/journal") ||
    path.startsWith("/people/")
  ) {
    return "timeline";
  }
  if (path === "/people") return "settings";
  if (path.startsWith("/memories")) return "memories";
  if (path.startsWith("/settings")) return "settings";
  return null;
}

export function skeletonKindFromPathname(
  pathname: string | null,
): JournalSkeletonKind | null {
  const path = pathWithoutSearch(pathname ?? "");
  if (path === "/people") return "settings";
  if (
    path === "/family" ||
    path.startsWith("/journal") ||
    path.startsWith("/people/")
  ) {
    return "timeline";
  }
  if (path.startsWith("/memories")) return "memories";
  if (path.startsWith("/settings")) return "settings";
  return null;
}
