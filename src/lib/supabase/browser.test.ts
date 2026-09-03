import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ auth: {} })),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));
vi.mock("./public-config", () => ({
  readSupabasePublicConfig: () => ({
    url: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    publishableKey: "sb_publishable_environment_contract_fixture",
  }),
}));

import {
  createOurDaysBrowserClient,
  createOurDaysInviteCompletionClient,
} from "./browser";

describe("browser Supabase clients", () => {
  beforeEach(() => {
    mocks.createBrowserClient.mockClear();
  });

  it("keeps the shared journal client on the default PKCE cookie path", () => {
    createOurDaysBrowserClient();
    expect(mocks.createBrowserClient).toHaveBeenCalledExactlyOnceWith(
      "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
      "sb_publishable_environment_contract_fixture",
    );
  });

  it("completes invite links without inspecting a PKCE callback URL", () => {
    createOurDaysInviteCompletionClient();
    expect(mocks.createBrowserClient).toHaveBeenCalledExactlyOnceWith(
      "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
      "sb_publishable_environment_contract_fixture",
      {
        isSingleton: false,
        auth: { detectSessionInUrl: false },
      },
    );
  });
});
