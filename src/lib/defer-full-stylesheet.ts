const deferredStylesheetFlag = "data-our-days-deferred-css";

/**
 * Keep Next's stylesheet request, but don't let it block first paint.
 * Critical shell rules are already in the document; this script promotes the
 * full sheet once it has loaded.
 */
export const enableDeferredStylesheetScript = `
  (function () {
    function enable(link) {
      if (!link || link.media === "all") return;
      link.media = "all";
    }
    function arm(link) {
      if (!link || link.getAttribute("${deferredStylesheetFlag}") === null) return;
      if (link.sheet) enable(link);
      else link.addEventListener("load", function () { enable(link); });
    }
    function scan(root) {
      if (!root || !root.querySelectorAll) return;
      var links = root.querySelectorAll("link[${deferredStylesheetFlag}]");
      for (var i = 0; i < links.length; i++) arm(links[i]);
    }
    scan(document);
    if (!document.head || typeof MutationObserver !== "function") return;
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var nodes = records[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) arm(nodes[j]);
      }
    });
    observer.observe(document.head, { childList: true });
  })();
`;
