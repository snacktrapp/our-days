import { afterEach, describe, expect, it } from "vitest";
import {
  pageCspNonce,
  pageCspNonceMetaName,
  replaceNonceableStyleSheet,
} from "./page-csp-nonce";

afterEach(() => {
  document.getElementById("nonceable-sheet")?.remove();
  document.querySelector(`meta[name="${pageCspNonceMetaName}"]`)?.remove();
});

describe("page CSP nonce", () => {
  it("reads the nonce from the server meta tag", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", pageCspNonceMetaName);
    meta.setAttribute("content", "test-nonce");
    document.head.append(meta);
    expect(pageCspNonce(document)).toBe("test-nonce");
  });

  it("inserts a stylesheet with nonce and CSS before it is connected", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", pageCspNonceMetaName);
    meta.setAttribute("content", "test-nonce");
    document.head.append(meta);

    const sheet = replaceNonceableStyleSheet(
      document,
      "nonceable-sheet",
      ":root{--pin:-160px}",
    );
    expect(sheet).toHaveAttribute("nonce", "test-nonce");
    expect(sheet.textContent).toBe(":root{--pin:-160px}");
    expect(sheet.parentNode).toBe(document.head);
  });
});
