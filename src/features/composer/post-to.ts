export type PostableCircle = Readonly<{
  id: string;
  name: string;
  personId: string;
}>;

export type CreatePostToHomeContext = Readonly<{
  kind: "you" | "group" | "person";
  circleId?: string;
}>;

export function defaultPostToCircleIds(
  circles: readonly PostableCircle[],
  currentCircleId?: string,
) {
  if (
    currentCircleId &&
    circles.some((circle) => circle.id === currentCircleId)
  ) {
    return [currentCircleId];
  }
  return circles[0] ? [circles[0].id] : [];
}

export function orderPostToCircleIds(
  selectedIds: readonly string[],
  circles: readonly PostableCircle[],
  currentCircleId?: string,
) {
  const selected = new Set(selectedIds);
  const ordered: string[] = [];
  if (currentCircleId && selected.has(currentCircleId)) {
    ordered.push(currentCircleId);
  }
  for (const circle of circles) {
    if (circle.id !== currentCircleId && selected.has(circle.id)) {
      ordered.push(circle.id);
    }
  }
  return ordered;
}

export function formatPostToTriggerLabel(
  circles: readonly PostableCircle[],
  selectedIds: readonly string[],
  justMe: boolean,
) {
  if (justMe) return "Just me";
  const names = selectedIds.flatMap((id) => {
    const name = circles.find((circle) => circle.id === id)?.name.trim();
    return name ? [name] : [];
  });
  if (names.length === 0) return "Choose circles";
  return names.join(" + ");
}

export function familyFeedHref(circleId?: string) {
  return circleId
    ? `/family?circle=${encodeURIComponent(circleId)}`
    : "/family";
}

export function primaryPostToCircle(
  circles: readonly PostableCircle[],
  selectedIds: readonly string[],
) {
  const primaryId = selectedIds[0];
  return circles.find((circle) => circle.id === primaryId) ?? circles[0];
}

export function initialPostToCircleIds(
  circles: readonly PostableCircle[],
  options: Readonly<{
    audience?: "family" | "just_me";
    circleId?: string;
    linkedCircleIds?: readonly string[];
  }> = {},
) {
  if (options.audience === "just_me") return [];
  if (options.linkedCircleIds?.length) {
    const known = new Set(circles.map((circle) => circle.id));
    const selected = options.linkedCircleIds.filter((id) => known.has(id));
    if (
      options.circleId &&
      known.has(options.circleId) &&
      !selected.includes(options.circleId)
    ) {
      selected.unshift(options.circleId);
    }
    return selected.length > 0
      ? orderPostToCircleIds(selected, circles, options.circleId)
      : defaultPostToCircleIds(circles, options.circleId);
  }
  return defaultPostToCircleIds(circles, options.circleId);
}

export function createPostToDefault(
  circles: readonly PostableCircle[],
  context?: CreatePostToHomeContext | null,
  fallbackCircleId?: string,
) {
  if (context?.kind === "you" || context?.kind === "person") {
    return { audience: "just_me" as const, circleIds: [] as const };
  }
  const circleId =
    context?.kind === "group"
      ? (context.circleId ?? fallbackCircleId)
      : fallbackCircleId;
  return {
    audience: "family" as const,
    circleIds: defaultPostToCircleIds(circles, circleId),
  };
}
