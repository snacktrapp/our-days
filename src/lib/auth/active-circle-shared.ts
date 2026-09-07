export const ACTIVE_CIRCLE_COOKIE = "our-days-active-circle";
export const PREVIEW_CREATED_GROUP_NAME_COOKIE = "our-days-created-group-name";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const previewCirclePattern = /^[a-z][a-z0-9-]{0,47}$/u;
const previewGroupNamePattern = /^[^\u0000-\u001f\u007f]{1,80}$/u;

export function isActiveCircleToken(value: string) {
  return uuidPattern.test(value) || previewCirclePattern.test(value);
}

export function normalizeGroupName(value: string) {
  const name = value.trim();
  if (!name || name.length > 80 || !previewGroupNamePattern.test(name)) {
    return null;
  }
  return name;
}
