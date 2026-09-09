export type WiderCirclePerson = Readonly<{
  displayName: string;
  email: string;
}>;

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export function suggestWiderCircleName(
  baseName: string,
  addedNames: readonly string[],
) {
  const inner = baseName.trim() || "Circle";
  const added = addedNames.map((name) => name.trim()).filter(Boolean);
  if (added.length === 1) return `${inner} + ${added[0]}`;
  return `${inner} + …`;
}

export function isWiderCircleNameSuggestion(
  value: string,
  baseName: string,
  addedNames: readonly string[],
) {
  return value.trim() === suggestWiderCircleName(baseName, addedNames);
}

export function normalizeWiderCirclePerson(input: {
  displayName?: string;
  email?: string;
}): WiderCirclePerson | null {
  const displayName = input.displayName?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  if (
    displayName.length < 1 ||
    Array.from(displayName).length > 80 ||
    CONTROL_CHARACTER.test(displayName) ||
    email.length > 254 ||
    !SIMPLE_EMAIL.test(email) ||
    CONTROL_CHARACTER.test(email)
  ) {
    return null;
  }
  return { displayName, email };
}

function readFormValues(input: unknown, field: string) {
  if (typeof FormData !== "undefined" && input instanceof FormData) {
    return input
      .getAll(field)
      .flatMap((value) => (typeof value === "string" ? [value] : []));
  }
  if (typeof input === "object" && input !== null && field in input) {
    const value = (input as Record<string, unknown>)[field];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) {
      return value.flatMap((item) => (typeof item === "string" ? [item] : []));
    }
  }
  return [];
}

export function readWiderCircleForm(input: unknown): Readonly<{
  name: string;
  sourceCircleId: string;
  whoElse: readonly WiderCirclePerson[];
}> {
  const names = readFormValues(input, "whoElseName");
  const emails = readFormValues(input, "whoElseEmail");
  const count = Math.max(names.length, emails.length);
  const whoElse: WiderCirclePerson[] = [];
  for (let index = 0; index < count; index += 1) {
    const person = normalizeWiderCirclePerson({
      displayName: names[index],
      email: emails[index],
    });
    if (person) whoElse.push(person);
  }
  return {
    name: readFormValues(input, "name")[0] ?? "",
    sourceCircleId: readFormValues(input, "sourceCircleId")[0]?.trim() ?? "",
    whoElse,
  };
}
