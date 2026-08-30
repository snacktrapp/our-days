import { expect, test as base } from "@playwright/test";

export const test = base.extend<{
  expectedConsoleErrors: string[];
  expectedRequestFailures: string[];
  pageHealth: void;
}>({
  expectedConsoleErrors: async ({}, provide) => provide([]),
  expectedRequestFailures: async ({}, provide) => provide([]),
  pageHealth: [
    async ({ page, expectedConsoleErrors, expectedRequestFailures }, use) => {
      const errors: string[] = [];
      const requestFailures: string[] = [];
      page.on("pageerror", (error) =>
        errors.push(`pageerror: ${error.message}`),
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          errors.push(`console: ${message.text()}`);
      });
      page.on("requestfailed", (request) => {
        requestFailures.push(
          `${request.failure()?.errorText ?? "unknown"} ${request.url()}`,
        );
      });
      await use();
      for (const expectedError of expectedConsoleErrors) {
        expect(errors.some((error) => error.includes(expectedError))).toBe(
          true,
        );
      }
      const unexpectedErrors = errors.filter(
        (error) =>
          !expectedConsoleErrors.some((expectedError) =>
            error.includes(expectedError),
          ),
      );
      expect(
        unexpectedErrors,
        "page should have no runtime, hydration, or console errors",
      ).toEqual([]);
      for (const expectedFailure of expectedRequestFailures) {
        expect(
          requestFailures.some((failure) => failure.includes(expectedFailure)),
        ).toBe(true);
      }
      const unexpectedRequestFailures = requestFailures.filter(
        (failure) =>
          !expectedRequestFailures.some((expectedFailure) =>
            failure.includes(expectedFailure),
          ) &&
          !(
            failure.includes("_rsc=") &&
            /(ERR_ABORTED|NS_BINDING_ABORTED|cancel)/i.test(failure)
          ),
      );
      expect(
        unexpectedRequestFailures,
        "page should have no unexpected failed requests",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
