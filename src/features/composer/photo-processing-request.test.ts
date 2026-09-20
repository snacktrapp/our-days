import { afterEach, expect, it, vi } from "vitest";
import { requestPhotoProcessingResponse } from "./photo-processing-request";

afterEach(() => vi.unstubAllGlobals());

it("shares an overlapping uploader/shelf request and gives each its own body", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const uploader = requestPhotoProcessingResponse(
    "same-intake",
    new AbortController().signal,
  );
  const shelf = requestPhotoProcessingResponse("same-intake");
  expect(fetcher).toHaveBeenCalledTimes(1);
  finish(
    Response.json({ ok: false, message: "Needs attention" }, { status: 409 }),
  );
  const [first, second] = await Promise.all([uploader, shelf]);
  expect(first.status).toBe(409);
  expect(await first.json()).toEqual(await second.json());
  fetcher.mockResolvedValueOnce(Response.json({ ok: true }));
  await requestPhotoProcessingResponse("same-intake");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("allows retry after a failed request and never combines different intakes", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  await expect(requestPhotoProcessingResponse("first")).rejects.toThrow(
    "Offline",
  );
  await Promise.all([
    requestPhotoProcessingResponse("first"),
    requestPhotoProcessingResponse("second"),
  ]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
