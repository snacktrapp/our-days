import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const typesPath = fileURLToPath(
  new URL("../src/lib/supabase/database.types.ts", import.meta.url),
);
const supabaseBinary = fileURLToPath(
  new URL("../node_modules/.bin/supabase", import.meta.url),
);

const generated = execFileSync(
  supabaseBinary,
  ["gen", "types", "--local", "--lang", "typescript", "--schema", "public"],
  {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const formatted = await prettier.format(generated, { filepath: typesPath });
const committed = readFileSync(typesPath, "utf8");
const normalizeGeneratedTypeContract = (value) => value.replace(/[\s;]/gu, "");

if (
  normalizeGeneratedTypeContract(formatted) !==
  normalizeGeneratedTypeContract(committed)
) {
  const generatedLines = formatted.split("\n");
  const committedLines = committed.split("\n");
  const firstDifference = generatedLines.findIndex(
    (line, index) => line !== committedLines[index],
  );
  throw new Error(
    `The committed Supabase database types do not match the local schema (first difference at line ${firstDifference + 1}: generated ${JSON.stringify(generatedLines[firstDifference])}, committed ${JSON.stringify(committedLines[firstDifference])}). Regenerate and commit them.`,
  );
}

process.stdout.write(
  "Committed Supabase types match the local database schema.\n",
);
