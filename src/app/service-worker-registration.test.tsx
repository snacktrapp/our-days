import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceWorkerCleanup } from "./service-worker-registration";

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "caches");
});

describe("ServiceWorkerCleanup", () => {
  it("unregisters this origin's workers and deletes only its legacy caches", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const localUnregister = vi.fn().mockResolvedValue(true);
    const foreignUnregister = vi.fn().mockResolvedValue(true);
    const deleteCache = vi.fn().mockResolvedValue(true);

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistrations: vi.fn().mockResolvedValue([
          {
            scope: `${window.location.origin}/`,
            unregister: localUnregister,
          },
          {
            scope: "https://another-app.test/",
            unregister: foreignUnregister,
          },
        ]),
      },
    });
    Object.defineProperty(window, "caches", {
      configurable: true,
      value: {
        keys: vi
          .fn()
          .mockResolvedValue(["our-days-public-shell-v4", "another-app-cache"]),
        delete: deleteCache,
      },
    });

    render(<ServiceWorkerCleanup />);

    await waitFor(() => expect(localUnregister).toHaveBeenCalledOnce());
    expect(foreignUnregister).not.toHaveBeenCalled();
    expect(deleteCache).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("our-days-public-shell-v4");
  });
});
