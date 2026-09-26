import http from "node:http";
import { createRequire } from "node:module";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { installDeferredDocumentStylesheets } from "./defer-document-stylesheet";
import { enableDeferredStylesheetScript } from "./defer-full-stylesheet";
import { deferDocumentStylesheetLinks } from "./defer-document-stylesheet";

describe("deferred full stylesheet", () => {
  it("marks the render-blocking journal sheet and leaves other links", () => {
    const html = [
      '<link rel="preload" href="/font.woff2" as="style"/>',
      '<link rel="stylesheet" href="/_next/static/chunks/app.css" data-precedence="next"/>',
      '<link rel="stylesheet" href="/other.css" media="screen"/>',
    ].join("");
    const rewritten = deferDocumentStylesheetLinks(html);
    expect(rewritten).toContain(
      '<link media="print" data-our-days-deferred-css="" rel="stylesheet" href="/_next/static/chunks/app.css" data-precedence="next"/>',
    );
    expect(rewritten).toContain('rel="preload"');
    expect(rewritten).toContain('href="/other.css" media="screen"');
  });

  it("rewrites the stylesheet inside the gzip stream browsers receive", async () => {
    installDeferredDocumentStylesheets();
    const gzip = zlib.createGzip();
    const chunks: Buffer[] = [];
    gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    const html = `<!DOCTYPE html><html><head><link rel="stylesheet" href="/_next/static/chunks/app.css" data-precedence="next"/></head><body>Hi</body></html>`;
    const done = new Promise((resolve) => gzip.on("end", resolve));
    gzip.end(html);
    await done;
    const out = zlib.gunzipSync(Buffer.concat(chunks)).toString("utf8");
    expect(out).toContain('media="print"');
    expect(out).toContain('data-our-days-deferred-css=""');
    expect(out).toContain("<body>Hi</body>");
  });

  it("rewrites the stylesheet through Next's compression middleware", async () => {
    installDeferredDocumentStylesheets();
    const html = `<!DOCTYPE html><html><head><link rel="stylesheet" href="/_next/static/chunks/app.css" data-precedence="next"/></head><body>Hi</body></html>`;
    const require = createRequire(import.meta.url);
    const compress = require("next/dist/compiled/compression") as (
      options?: object,
    ) => (
      req: http.IncomingMessage,
      res: http.ServerResponse,
      next: () => void,
    ) => void;
    const server = http.createServer((req, res) => {
      compress()(req, res, () => {});
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.write(html.slice(0, 50));
      res.write(html.slice(50, 120));
      res.end(html.slice(120));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    try {
      const compressed = await fetch(`http://127.0.0.1:${address.port}/`, {
        headers: { "Accept-Encoding": "gzip" },
      });
      expect(compressed.headers.get("content-encoding")).toBe("gzip");
      const compressedText = await compressed.text();
      expect(compressedText).toContain('media="print"');
      expect(compressedText).toContain('data-our-days-deferred-css=""');
      expect(compressedText).toContain("<body>Hi</body>");

      const plain = await fetch(`http://127.0.0.1:${address.port}/`, {
        headers: { "Accept-Encoding": "identity" },
      });
      const plainText = await plain.text();
      expect(plainText).toContain('media="print"');
      expect(plainText).toContain("<body>Hi</body>");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("promotes the deferred sheet without an inline event handler", () => {
    expect(enableDeferredStylesheetScript).toContain(
      "data-our-days-deferred-css",
    );
    expect(enableDeferredStylesheetScript).toContain('link.media = "all"');
    expect(enableDeferredStylesheetScript).not.toContain("onload");
  });
});
