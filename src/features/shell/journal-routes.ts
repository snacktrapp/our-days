import type { JournalSection } from "./shell-view-model";

export type JournalSkeletonKind =
  "timeline" | "people" | "memories" | "settings";

export function pathWithoutSearch(href: string) {
  const path = href.split("?")[0] ?? href;
  return path.split("#")[0] ?? path;
}

export function withCircleBrowseContext(href: string, circleId?: string) {
  if (!circleId) return href;
  const url = new URL(href, "https://our-days.local");
  url.searchParams.set("fromCircle", circleId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function sectionFromPathname(
  pathname: string | null,
): Extract<
  JournalSection,
  "timeline" | "circles" | "memories" | "settings"
> | null {
  const path = pathWithoutSearch(pathname ?? "");
  const query = new URLSearchParams(
    (pathname ?? "").split("?")[1]?.split("#")[0],
  );
  if (
    path === "/circles" ||
    path === "/people" ||
    query.has("fromCircle") ||
    (path === "/family" && query.has("circle"))
  )
    return "circles";
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

export function skeletonKindFromPathname(
  pathname: string | null,
): JournalSkeletonKind | null {
  const path = pathWithoutSearch(pathname ?? "");
  if (path === "/people" || path === "/circles") return "people";
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
