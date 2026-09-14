import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readActiveCircleCookie: vi.fn<() => Promise<string | null>>(),
  readPreviewCreatedGroupName: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/active-circle", () => ({
  readActiveCircleCookie: mocks.readActiveCircleCookie,
  readPreviewCreatedGroupName: mocks.readPreviewCreatedGroupName,
}));

import { previewGroupOptions } from "./preview-groups.server";

describe("previewGroupOptions", () => {
  beforeEach(() => {
    mocks.readActiveCircleCookie.mockReset();
    mocks.readPreviewCreatedGroupName.mockReset();
    mocks.readActiveCircleCookie.mockResolvedValue(null);
    mocks.readPreviewCreatedGroupName.mockResolvedValue(null);
  });

  it("returns an empty shape when no query or cookie is present", async () => {
    await expect(previewGroupOptions()).resolves.toEqual({});
  });

  it("uses an explicit circle query when present", async () => {
    await expect(previewGroupOptions({ circle: "family" })).resolves.toEqual({
      selectedGroupId: "family",
    });
  });

  it("keeps a created circle selected when returning to /family", async () => {
    mocks.readActiveCircleCookie.mockResolvedValue("created");
    mocks.readPreviewCreatedGroupName.mockResolvedValue("Cousins");

    await expect(previewGroupOptions()).resolves.toEqual({
      extraGroup: { id: "created", name: "Cousins" },
      selectedGroupId: "created",
    });
  });

  it("lets an explicit circle query override the cookie selection", async () => {
    mocks.readActiveCircleCookie.mockResolvedValue("created");
    mocks.readPreviewCreatedGroupName.mockResolvedValue("Cousins");

    await expect(previewGroupOptions({ circle: "family" })).resolves.toEqual({
      extraGroup: { id: "created", name: "Cousins" },
      selectedGroupId: "family",
    });
  });

  it("does not force a family cookie into a scoped selection", async () => {
    mocks.readActiveCircleCookie.mockResolvedValue("family");

    await expect(previewGroupOptions()).resolves.toEqual({});
  });
});
