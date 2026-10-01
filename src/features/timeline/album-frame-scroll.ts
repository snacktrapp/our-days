/** Keep an album frame's vertical center fixed while its height changes. */

export function nextAlbumCenterScroll(scrollTop: number, heightDelta: number) {
  const current = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  return Math.max(0, current + heightDelta / 2);
}

export function albumFrameOnScreen(
  rect: Pick<DOMRect, "top" | "bottom">,
  viewportHeight: number,
) {
  return rect.bottom > 0 && rect.top < viewportHeight;
}

export function albumScrollLockedByPull(doc: Document) {
  const shell = doc.querySelector(".timeline-pull-shell");
  if (!(shell instanceof HTMLElement)) return false;
  const state = shell.dataset.pullState;
  return (
    state === "pulling" ||
    state === "armed" ||
    state === "refreshing" ||
    state === "settling"
  );
}

export function albumFeedScroller(frame: HTMLElement): HTMLElement {
  const doc = frame.ownerDocument;
  let node: HTMLElement | null = frame.parentElement;
  while (node) {
    const overflow = doc.defaultView?.getComputedStyle(node).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  const root = doc.scrollingElement;
  return root instanceof HTMLElement ? root : doc.documentElement;
}

function writeFeedScroll(el: HTMLElement, next: number) {
  const clamped = Math.max(0, next);
  el.scrollTop = clamped;
  const view = el.ownerDocument.defaultView;
  const root = el.ownerDocument.scrollingElement;
  if (view && el === root && Math.abs(view.scrollY - clamped) > 0.5) {
    view.scrollTo(0, clamped);
  }
}

const settleMs = 320;

export function createAlbumCenterFollower(stage: HTMLElement) {
  let lastHeight = stage.getBoundingClientRect().height;
  let userTookOver = false;
  let ignoreScroll = 0;
  let ownScroll: number | null = null;
  let raf = 0;
  let deferred = 0;
  let frameDepth = 0;
  let listening = false;

  const onScroll = () => {
    const current = scroller().scrollTop;
    if (ownScroll != null && Math.abs(current - ownScroll) < 1) return;
    if (ignoreScroll > 0) {
      ignoreScroll -= 1;
      return;
    }
    userTookOver = true;
  };

  function scroller() {
    return albumFeedScroller(stage);
  }

  function bind() {
    if (listening) return;
    listening = true;
    const el = scroller();
    const view = stage.ownerDocument.defaultView;
    const root = stage.ownerDocument.scrollingElement;
    if (view && (el === root || el === stage.ownerDocument.documentElement)) {
      view.addEventListener("scroll", onScroll, { passive: true });
    } else {
      el.addEventListener("scroll", onScroll, { passive: true });
    }
  }

  function unbind() {
    if (!listening) return;
    listening = false;
    const el = scroller();
    const view = stage.ownerDocument.defaultView;
    const root = stage.ownerDocument.scrollingElement;
    if (view && (el === root || el === stage.ownerDocument.documentElement)) {
      view.removeEventListener("scroll", onScroll);
    } else {
      el.removeEventListener("scroll", onScroll);
    }
  }

  function applyOnce() {
    const rect = stage.getBoundingClientRect();
    const height = rect.height;
    const delta = height - lastHeight;
    lastHeight = height;
    if (userTookOver || albumScrollLockedByPull(stage.ownerDocument))
      return false;
    const viewport = stage.ownerDocument.defaultView?.innerHeight ?? 0;
    if (!albumFrameOnScreen(rect, viewport)) return false;
    if (Math.abs(delta) < 0.5) return false;
    const el = scroller();
    const next = nextAlbumCenterScroll(el.scrollTop, delta);
    if (Math.abs(next - el.scrollTop) < 0.5) return false;
    ignoreScroll += 1;
    ownScroll = next;
    writeFeedScroll(el, next);
    return true;
  }

  function clearFrame() {
    const view = stage.ownerDocument.defaultView;
    if (raf) view?.cancelAnimationFrame(raf);
    if (deferred) view?.clearTimeout(deferred);
    raf = 0;
    deferred = 0;
  }

  /** Schedule the next sample. A synchronous requestAnimationFrame (the
   *  test runner calls the callback before returning) is deferred so the
   *  loop cannot recurse. Browsers invoke the callback later, so this
   *  stays on the animation frame. */
  function requestFrame(tick: () => void) {
    const view = stage.ownerDocument.defaultView;
    if (!view) return;
    if (frameDepth > 0) {
      deferred = view.setTimeout(() => {
        deferred = 0;
        raf = view.requestAnimationFrame(tick);
      }, 0);
      return;
    }
    frameDepth += 1;
    try {
      raf = view.requestAnimationFrame(tick);
    } finally {
      frameDepth -= 1;
    }
  }

  function sync(instant: boolean) {
    bind();
    if (instant) {
      applyOnce();
      return;
    }
    if (raf || deferred) return;
    const started = performance.now();
    const tick = () => {
      applyOnce();
      if (
        userTookOver ||
        albumScrollLockedByPull(stage.ownerDocument) ||
        performance.now() - started > settleMs
      ) {
        raf = 0;
        unbind();
        return;
      }
      requestFrame(tick);
    };
    requestFrame(tick);
  }

  return {
    /** A new horizontal gesture may follow the center again. */
    releaseUser() {
      userTookOver = false;
    },
    /** Remember a height change that was not caused by a swipe. */
    noteHeight() {
      if (raf) return;
      lastHeight = stage.getBoundingClientRect().height;
    },
    sync,
    stop() {
      clearFrame();
      unbind();
    },
  };
}
