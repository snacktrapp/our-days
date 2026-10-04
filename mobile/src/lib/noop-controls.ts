/**
 * Controls that are on screen because the web shows them.
 * They do not write, navigate, or start an upload yet.
 */
export const noopControls = [
  "Place name (does not open Maps)",
  "Insight source link (opens the URL)",
  "Photo pager (swipe is visual only)",
  "Banner dismiss is local and does not sync with the web",
] as const;
