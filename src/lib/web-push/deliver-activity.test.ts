// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deliverActivityWebPush,
  notifyFamilyActivity,
} from "./deliver-activity";

describe("deliverActivityWebPush", () => {
  it("is the notification domain entry", () => {
    expect(deliverActivityWebPush).toBe(notifyFamilyActivity);
  });
});
