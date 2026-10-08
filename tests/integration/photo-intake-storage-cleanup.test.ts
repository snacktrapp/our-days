import { describe, expect, it, vi } from "vitest";
import {
  deleteIntakeObjects,
  runIntakeCleanupReport,
} from "../../scripts/photo-intake-storage-cleanup.mjs";

const intakeId = "10000000-0000-4000-8000-000000000001";
const intakePath = `intake/${intakeId}`;
const originalPath =
  "original/20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001";

function fakeClient({
  intakeBytes = Buffer.from("matching-bytes"),
  originalBytes = Buffer.from("matching-bytes"),
}) {
  const remove = vi.fn(async () => ({ data: [], error: null }));
  const list = vi.fn(async (prefix: string) => {
    if (prefix === "intake") {
      return {
        data: [{ id: "intake-file", metadata: {}, name: intakeId }],
        error: null,
      };
    }
    if (prefix === "original") {
      return {
        data: [{ id: null, metadata: null, name: originalPath.split("/")[1] }],
        error: null,
      };
    }
    if (prefix === `original/${originalPath.split("/")[1]}`) {
      return {
        data: [{ id: "original-file", metadata: {}, name: originalPath.split("/")[2] }],
        error: null,
      };
    }
    return { data: [], error: null };
  });
  const info = vi.fn(async (path: string) => {
    if (path === originalPath) {
      return { data: { user_metadata: { intake_id: intakeId } }, error: null };
    }
    return { data: null, error: { message: "not found" } };
  });
  const download = vi.fn(async (path: string) => {
    if (path === intakePath) {
      return { data: new Blob([intakeBytes]), error: null };
    }
    if (path === originalPath) {
      return { data: new Blob([originalBytes]), error: null };
    }
    return { data: null, error: { message: "not found" } };
  });

  return {
    remove,
    client: {
      storage: {
        from(bucket: string) {
          return {
            download,
            info,
            list,
            remove:
              bucket === "our-days-intake"
                ? remove
                : vi.fn(async () => ({ data: [], error: null })),
          };
        },
      },
    },
  };
}

describe("photo-intake-storage-cleanup script", () => {
  it("keeps dry-run mode read-only", async () => {
    const log = { info: vi.fn(), table: vi.fn() };
    const { client, remove } = fakeClient({});

    const report = await runIntakeCleanupReport({
      applyCleanup: false,
      client,
      log,
    });

    expect(report.totals.byteIdenticalMatches).toBe(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("refuses cleanup when any candidate is not byte-identical", async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const client = {
      storage: {
        from() {
          return { remove };
        },
      },
    };

    await expect(
      deleteIntakeObjects(client, [
        {
          intakePath,
          shaMatch: false,
          sizeMatch: true,
        },
      ]),
    ).rejects.toThrow("Refusing cleanup");
    expect(remove).not.toHaveBeenCalled();
  });
});
