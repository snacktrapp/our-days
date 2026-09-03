import { afterEach, describe, expect, it } from "vitest";
import {
  deleteDynamicCssVar,
  dynamicCssStyleId,
  pageCspNonce,
  pageCspNonceMetaName,
  setDynamicCssVar,
} from "./page-csp-nonce";

afterEach(() => {
  document.getElementById(dynamicCssStyleId)?.remove();
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

  it("mutates the server stylesheet instead of inserting a new one", () => {
    const sheet = document.createElement("style");
    sheet.id = dynamicCssStyleId;
    sheet.setAttribute("nonce", "test-nonce");
    document.head.append(sheet);

    setDynamicCssVar(document, "--composer-scroll-lock-top", "-160px");
    expect(document.getElementById(dynamicCssStyleId)).toBe(sheet);
    expect(sheet).toHaveAttribute("nonce", "test-nonce");
    expect(sheet.textContent).toBe(":root{--composer-scroll-lock-top:-160px}");

    setDynamicCssVar(document, "--bottom-nav-visual-inset", "0px");
    expect(sheet.textContent).toBe(
      ":root{--composer-scroll-lock-top:-160px;--bottom-nav-visual-inset:0px}",
    );

    deleteDynamicCssVar(document, "--composer-scroll-lock-top");
    expect(sheet.textContent).toBe(":root{--bottom-nav-visual-inset:0px}");
    expect(sheet.parentNode).toBe(document.head);
  });
});
