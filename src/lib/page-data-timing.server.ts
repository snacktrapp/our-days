import "server-only";

import { headers } from "next/headers";
import { recordPageDataTiming, requestTimingHeader } from "./server-timing";

export async function timePageData<T>(work: () => Promise<T>) {
  const started = performance.now();
  try {
    return await work();
  } finally {
    const requestHeaders = await headers();
    const id = requestHeaders.get(requestTimingHeader);
    if (id) recordPageDataTiming(id, performance.now() - started);
  }
}
