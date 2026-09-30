/**
 * Controls that are on screen because the web shows them.
 * They do not write, navigate, or start an upload yet.
 */
export const noopControls = [
  "Sign in with Google",
  "Sign in with X",
  "Settings gear (opens theme and sign out only; the rest of Settings is not built)",
  "Notification heart",
  "Add in the bottom nav",
  "Circles in the bottom nav",
  "Comment button on a post",
  "Heart on a post (shows the saved reaction, does not write)",
  "Heart on a comment (shows the saved reaction, does not write)",
  "Comment overflow (•••) when you can edit that comment",
  "Post overflow (•••) when you can change that post",
  "Place name (does not open Maps)",
  "Insight source link (opens the URL; playback of the clip is the poster only)",
  "Video poster (no player controls)",
  "Photo pager (swipe is visual only)",
  "Banner “Got it” dismisses locally and does not sync with the web",
] as const;
