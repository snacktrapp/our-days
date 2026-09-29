// expo-secure-store stand-in that behaves like the strict iOS/Android limits:
// values over 2048 UTF-8 bytes and keys outside [A-Za-z0-9._-] reject.
export const LIMIT_BYTES = 2048;
export const store = new Map();
export const state = { failWrites: false, writes: 0, maxValueBytes: 0 };

function checkKey(key) {
  if (typeof key !== "string" || !/^[\w.-]+$/u.test(key)) {
    throw new Error(`Invalid key provided to SecureStore: ${key}`);
  }
}

export async function setItemAsync(key, value) {
  checkKey(key);
  const bytes = new TextEncoder().encode(value).length;
  if (bytes > LIMIT_BYTES) {
    throw new Error(
      `Value being stored in SecureStore is larger than ${LIMIT_BYTES} bytes (${bytes})`,
    );
  }
  if (state.failWrites) throw new Error("SecureStore write failed (simulated)");
  state.writes += 1;
  state.maxValueBytes = Math.max(state.maxValueBytes, bytes);
  store.set(key, value);
}

export async function getItemAsync(key) {
  checkKey(key);
  return store.has(key) ? store.get(key) : null;
}

export async function deleteItemAsync(key) {
  checkKey(key);
  store.delete(key);
}
