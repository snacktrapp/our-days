export const mapsApiPathPattern =
  /\/api\/maps\/(?:static|tile|geocode|style|upstream)/u;

export const blockedStylesheetConsole =
  "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive";

const mapsUnavailableStatusPattern = /status of (50[23])/u;
const genericResourceFailedPattern =
  /^console: Failed to load resource: the server responded with a status of 50[23]/u;

export function isMapsUnavailableStatus(status: number) {
  return status === 502 || status === 503;
}

export function unexpectedConsoleErrors(
  errors: readonly string[],
  options: {
    allowedConsoleErrors?: readonly string[];
    expectedConsoleErrors?: readonly string[];
    mapsUnavailableStatuses?: readonly number[];
  } = {},
) {
  const remainingStatuses = [...(options.mapsUnavailableStatuses ?? [])];

  return errors.filter((error) => {
    if (
      options.expectedConsoleErrors?.some((expectedError) =>
        error.includes(expectedError),
      ) ||
      options.allowedConsoleErrors?.some((allowedError) =>
        error.includes(allowedError),
      ) ||
      // Production style-src correctly rejects nonce-less sheets. WebKit still
      // logs this on some navigations even though the inset writer is a no-op.
      error.includes(blockedStylesheetConsole)
    ) {
      return false;
    }

    if (
      mapsApiPathPattern.test(error) &&
      mapsUnavailableStatusPattern.test(error)
    ) {
      return false;
    }

    // Chrome logs img/fetch 502/503 without the URL. Pair those with the
    // maps responses this page already recorded.
    if (genericResourceFailedPattern.test(error)) {
      const status = Number(error.match(mapsUnavailableStatusPattern)?.[1]);
      const index = remainingStatuses.indexOf(status);
      if (index !== -1) {
        remainingStatuses.splice(index, 1);
        return false;
      }
    }

    return true;
  });
}
