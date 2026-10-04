// Node module hooks so the app's real TypeScript modules run under Node:
// extensionless relative imports resolve to .ts, and native-only modules are
// replaced by test doubles.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mocks = {
  "expo-secure-store": new URL("./mock-secure-store.mjs", import.meta.url).href,
  "react-native-url-polyfill/auto": new URL("./noop.mjs", import.meta.url).href,
};

export async function resolve(specifier, context, next) {
  if (mocks[specifier]) return { url: mocks[specifier], shortCircuit: true };
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[cm]?[jt]sx?$/u.test(specifier) &&
    context.parentURL?.startsWith("file:")
  ) {
    for (const ext of [".ts", ".tsx"]) {
      const candidate = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
  }
  return next(specifier, context);
}
