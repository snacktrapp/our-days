export function defaultWiderCircleSourceId(
  groups: readonly Readonly<{ id: string; memberCount: number }>[],
  preferredId?: string,
) {
  if (groups.length === 0) return "";
  let largest = groups[0]!;
  for (const group of groups) {
    if (group.memberCount > largest.memberCount) largest = group;
  }
  const tied = groups.filter(
    (group) => group.memberCount === largest.memberCount,
  );
  if (preferredId && tied.some((group) => group.id === preferredId)) {
    return preferredId;
  }
  return largest.id;
}

export function suggestWiderCircleName(baseName: string) {
  const inner = baseName.trim() || "Family";
  return `${inner} + grandparents`;
}

export function formatWiderCircleIncludes(names: readonly string[]) {
  if (names.length === 0) return "";
  return `Includes ${names.join(", ")}…`;
}

export function isWiderCircleNameSuggestion(value: string, baseName: string) {
  return value.trim() === suggestWiderCircleName(baseName);
}

function readFormValue(input: unknown, field: string) {
  if (typeof FormData !== "undefined" && input instanceof FormData) {
    const value = input.get(field);
    return typeof value === "string" ? value : "";
  }
  if (typeof input === "object" && input !== null && field in input) {
    const value = (input as Record<string, unknown>)[field];
    return typeof value === "string" ? value : "";
  }
  return "";
}

export function readWiderCircleForm(input: unknown): Readonly<{
  name: string;
  sourceCircleId: string;
}> {
  return {
    name: readFormValue(input, "name"),
    sourceCircleId: readFormValue(input, "sourceCircleId").trim(),
  };
}
