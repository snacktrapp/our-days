export type PostableCircle = Readonly<{
  id: string;
  name: string;
  personId: string;
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
