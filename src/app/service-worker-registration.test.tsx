import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceWorkerRegistration } from "./service-worker-registration";

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "caches");
});

describe("ServiceWorkerRegistration", () => {
  it("registers the push worker when a VAPID public key is present", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    const register = vi.fn().mockResolvedValue({});
    const unregister = vi.fn();
    const deleteCache = vi.fn().mockResolvedValue(true);

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register,
        getRegistrations: vi
          .fn()
          .mockResolvedValue([
            { scope: `${window.location.origin}/`, unregister },
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

    render(<ServiceWorkerRegistration />);

    await waitFor(() => expect(register).toHaveBeenCalledOnce());
    expect(register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    expect(unregister).not.toHaveBeenCalled();
    expect(deleteCache).toHaveBeenCalledWith("our-days-public-shell-v4");
    expect(deleteCache).not.toHaveBeenCalledWith("another-app-cache");
  });

  it("retires this origin's workers when push is not configured", async () => {
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

    render(<ServiceWorkerRegistration />);

    await waitFor(() => expect(localUnregister).toHaveBeenCalledOnce());
    expect(foreignUnregister).not.toHaveBeenCalled();
    expect(deleteCache).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("our-days-public-shell-v4");
  });
});
