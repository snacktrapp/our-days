import { createContext } from "react";

/**
 * Lets a horizontal gesture inside the feed (album swipe) pause the feed's
 * vertical scroll until the finger lifts. On iOS (new architecture) a native
 * ScrollView keeps scrolling under an active PanResponder, so a diagonal album
 * swipe would also drag the feed (react-native#51970).
 */
export const FeedScrollLock = createContext<((locked: boolean) => void) | null>(null);
