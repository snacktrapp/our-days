const stylesheetLink = /<link\b[^>]*\brel="stylesheet"[^>]*>/g;

export function deferDocumentStylesheetLinks(html: string) {
  if (!html.includes('rel="stylesheet"') || !html.includes("data-precedence")) {
    return html;
  }
  return html.replace(stylesheetLink, (tag) => {
    if (!tag.includes('data-precedence="next"') || tag.includes(" media=")) {
      return tag;
    }
    return tag.replace(
      "<link",
      '<link media="print" data-our-days-deferred-css=""',
    );
  });
}

type WriteCallback = (error?: Error | null) => void;
type Piece = { chunk: unknown; encoding: unknown };
type HeadState = {
  decided: "no" | "yes" | null;
  pieces: Piece[];
  text: string;
};

function pieceText(piece: Piece) {
  if (typeof piece.chunk === "string") return piece.chunk;
  if (Buffer.isBuffer(piece.chunk)) {
    const encoding =
      typeof piece.encoding === "string" && Buffer.isEncoding(piece.encoding)
        ? piece.encoding
        : "utf8";
    return piece.chunk.toString(encoding);
  }
  return "";
}

function looksLikeDocument(text: string) {
  const sniff = text.trimStart().slice(0, 64);
  return (
    sniff.startsWith("<!DOCTYPE") ||
    sniff.startsWith("<html") ||
    sniff.startsWith("<head")
  );
}

/**
 * Rewrite the full stylesheet link before it is compressed or sent.
 * Next builds that link inside a prebundled server runtime, so the document
 * stream is the place the media type can change.
 */
export function installDeferredDocumentStylesheets() {
  const states = new WeakMap<object, HeadState>();

  const accept = (
    stream: object,
    original: (
      this: object,
      chunk: unknown,
      encoding?: unknown,
      callback?: WriteCallback,
    ) => unknown,
    chunk: unknown,
    encoding: unknown,
    callback?: WriteCallback,
  ) => {
    let state = states.get(stream);
    if (!state) {
      state = { decided: null, pieces: [], text: "" };
      states.set(stream, state);
    }
    if (state.decided === "no") {
      return original.call(stream, chunk, encoding, callback);
    }
    if (state.decided === "yes") {
      const text = pieceText({ chunk, encoding });
      if (!text) return original.call(stream, chunk, encoding, callback);
      return original.call(
        stream,
        deferDocumentStylesheetLinks(text),
        "utf8",
        callback,
      );
    }

    state.pieces.push({ chunk, encoding });
    state.text += pieceText({ chunk, encoding });
    const sniff = state.text.trimStart();
    const document = looksLikeDocument(state.text);
    const ready =
      (document &&
        (state.text.includes("</head>") || state.text.length >= 120_000)) ||
      (!document &&
        (state.text.length >= 64 ||
          (sniff !== "" && !sniff.startsWith("<") && state.text.length >= 8)));
    if (!ready) {
      if (typeof callback === "function") callback();
      return true;
    }

    const pieces = state.pieces;
    const text = state.text;
    state.pieces = [];
    state.text = "";
    state.decided = document ? "yes" : "no";
    if (!document) {
      for (let index = 0; index < pieces.length - 1; index += 1) {
        const piece = pieces[index];
        original.call(stream, piece.chunk, piece.encoding);
      }
      const last = pieces[pieces.length - 1];
      return original.call(stream, last?.chunk, last?.encoding, callback);
    }
    return original.call(
      stream,
      deferDocumentStylesheetLinks(text),
      "utf8",
      callback,
    );
  };

  const patchWrite = (proto: {
    write: (
      chunk: unknown,
      encoding?: unknown,
      callback?: WriteCallback,
    ) => unknown;
    end: (
      chunk?: unknown,
      encoding?: unknown,
      callback?: WriteCallback,
    ) => unknown;
    __ourDaysDeferredCss?: boolean;
  }) => {
    if (proto.__ourDaysDeferredCss) return;
    proto.__ourDaysDeferredCss = true;
    const originalWrite = proto.write;
    const originalEnd = proto.end;
    proto.write = function write(chunk, encoding, callback) {
      let cb = callback;
      let enc = encoding;
      if (typeof enc === "function") {
        cb = enc as WriteCallback;
        enc = undefined;
      }
      return accept(this, originalWrite, chunk, enc, cb);
    };
    proto.end = function end(chunk, encoding, callback) {
      let body = chunk;
      let cb = callback;
      let enc = encoding;
      if (typeof body === "function") {
        cb = body as WriteCallback;
        body = undefined;
        enc = undefined;
      } else if (typeof enc === "function") {
        cb = enc as WriteCallback;
        enc = undefined;
      }
      if (body != null) this.write(body, enc);
      const state = states.get(this);
      if (state?.pieces.length) {
        const text = state.text;
        const pieces = state.pieces;
        state.pieces = [];
        state.text = "";
        if (looksLikeDocument(text)) {
          state.decided = "yes";
          originalWrite.call(this, deferDocumentStylesheetLinks(text), "utf8");
        } else {
          state.decided = "no";
          for (const piece of pieces) {
            originalWrite.call(this, piece.chunk, piece.encoding);
          }
        }
      }
      return originalEnd.call(this, cb);
    };
  };

  const zlib = process.getBuiltinModule("zlib") as {
    Gzip: { prototype: Parameters<typeof patchWrite>[0] };
  };
  patchWrite(zlib.Gzip.prototype);
  const { ServerResponse } = process.getBuiltinModule("http") as {
    ServerResponse: { prototype: Parameters<typeof patchWrite>[0] };
  };
  patchWrite(ServerResponse.prototype);
}
