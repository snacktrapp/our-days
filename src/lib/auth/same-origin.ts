export function isExpectedMutationOrigin(
  requestOrigin: string | null,
  expectedSiteOrigin: string | undefined,
) {
  if (!requestOrigin || !expectedSiteOrigin) return false;

  try {
    return new URL(requestOrigin).origin === new URL(expectedSiteOrigin).origin;
  } catch {
    return false;
  }
}
