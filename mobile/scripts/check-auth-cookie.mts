import assert from "node:assert/strict";
import { createChunks, stringToBase64URL } from "../src/lib/auth-cookie.ts";

assert.equal(stringToBase64URL("hello"), "aGVsbG8");

const encoded = `base64-${stringToBase64URL("x".repeat(4000))}`;
const chunks = createChunks("sb-example-auth-token", encoded);
assert.ok(chunks.length > 1);
assert.equal(chunks[0]?.name, "sb-example-auth-token.0");
assert.equal(
  chunks.map((chunk) => chunk.value).join("").length,
  encoded.length,
);

const single = createChunks("sb-example-auth-token", "base64-aGVsbG8");
assert.deepEqual(single, [
  { name: "sb-example-auth-token", value: "base64-aGVsbG8" },
]);

console.log("auth cookie codec ok");
