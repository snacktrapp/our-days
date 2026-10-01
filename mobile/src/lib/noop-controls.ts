/**
 * Controls that are on screen because the web shows them.
 * They do not write, navigate, or start an upload yet.
 */
export const noopControls = [
  "Sign in with Google",
  "Sign in with X",
  "Settings gear opens the settings page. Profile color saves. Theme, accent, sign out, and the Notifications switch work. Recently removed is visible and does not navigate.",
  "Notification heart",
  "Circles in the bottom nav",
  "Post overflow (•••) when you can change that post",
  "Place name (does not open Maps)",
  "Insight source link (opens the URL; playback of the clip is the poster only)",
  "Video poster (no player controls)",
  "Photo pager (swipe is visual only)",
  "Banner “Got it” dismisses locally and does not sync with the web",
] as const;
