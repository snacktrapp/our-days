import { describe, expect, it } from "vitest";
import { isEditConflictError } from "./edit-conflict";

describe("edit conflict mapping", () => {
  it("recognizes PT409, legacy 40001, and code 409", () => {
    expect(
      isEditConflictError({
        code: "PT409",
        message: "Moment changed elsewhere",
      }),
    ).toBe(true);
    expect(
      isEditConflictError({
        code: "40001",
        message: "Note changed elsewhere",
      }),
    ).toBe(true);
    expect(isEditConflictError({ code: "409" })).toBe(true);
  });

  it("recognizes HTTP 409 from the RPC response or the error object", () => {
    expect(
      isEditConflictError({ message: "Moment changed elsewhere" }, 409),
    ).toBe(true);
    expect(
      isEditConflictError({
        status: 409,
        message: "Note changed elsewhere",
      }),
    ).toBe(true);
  });

  it("keeps other HTTP 409 codes on the generic failure path", () => {
    expect(
      isEditConflictError(
        {
          code: "23505",
          message: "duplicate key value violates unique constraint",
        },
        409,
      ),
    ).toBe(false);
    expect(
      isEditConflictError(
        { code: "22023", message: "Moment could not be changed" },
        400,
      ),
    ).toBe(false);
    expect(isEditConflictError(null)).toBe(false);
    expect(isEditConflictError({ status: 503, code: "PGRST301" })).toBe(false);
  });

  it("still treats a 409 whose message is the revision conflict as that conflict", () => {
    expect(
      isEditConflictError(
        { code: "23505", message: "Moment changed elsewhere" },
        409,
      ),
    ).toBe(true);
  });
});
