"use client";

const PRIVATE_KEY_PREFIXES = ["our-days:", "our_days:"];
const PRIVATE_DATABASE_NAMES = ["our-days:drafts", "our-days:photo-uploads"];

function belongsToOurDays(name: string) {
  return PRIVATE_KEY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function clearStorage(storage: Storage) {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key && belongsToOurDays(key)) storage.removeItem(key);
  }
}

export async function purgeOurDaysBrowserState() {
  let completelyCleared = true;
  window.dispatchEvent(new Event("our-days:clear-private-state"));

  try {
    clearStorage(window.localStorage);
    clearStorage(window.sessionStorage);
  } catch {
    completelyCleared = false;
  }

  try {
    if ("caches" in window) {
      const names = await window.caches.keys();
      const results = await Promise.allSettled(
        names
          .filter(belongsToOurDays)
          .map((name) => window.caches.delete(name)),
      );
      if (results.some(({ status }) => status === "rejected")) {
        completelyCleared = false;
      }
    }
  } catch {
    completelyCleared = false;
  }

  try {
    if ("indexedDB" in window) {
      const databaseNames = new Set(PRIVATE_DATABASE_NAMES);
      if (typeof window.indexedDB.databases === "function") {
        const databases = await window.indexedDB.databases();
        for (const { name } of databases) {
          if (name && belongsToOurDays(name)) databaseNames.add(name);
        }
      }
      const results = await Promise.all(
        [...databaseNames].map(
          (name) =>
            new Promise<boolean>((resolve) => {
              const request = window.indexedDB.deleteDatabase(name);
              request.addEventListener("success", () => resolve(true), {
                once: true,
              });
              request.addEventListener("error", () => resolve(false), {
                once: true,
              });
              request.addEventListener("blocked", () => resolve(false), {
                once: true,
              });
            }),
        ),
      );
      if (results.some((deleted) => !deleted)) completelyCleared = false;
    }
  } catch {
    completelyCleared = false;
  }

  return completelyCleared;
}
