export function suggestWiderCircleName(baseName: string) {
  const inner = baseName.trim() || "Circle";
  return `${inner} + …`;
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
