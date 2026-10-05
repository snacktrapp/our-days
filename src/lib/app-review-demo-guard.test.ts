import { describe, expect, it } from "vitest";
import {
  APP_REVIEW_DEMO_CIRCLE_ID,
  APP_REVIEW_DEMO_CIRCLE_NAME,
  APP_REVIEW_REVIEWER_EMAIL,
  planAppReviewDemo,
  type AppReviewPlanInput,
} from "./app-review-demo-guard";

const homeId = "20000000-0000-4000-8000-0000000000aa";

function plan(
  overrides: Partial<AppReviewPlanInput> & Pick<AppReviewPlanInput, never> = {},
) {
  const input: AppReviewPlanInput = {
    reviewerEmail: APP_REVIEW_REVIEWER_EMAIL,
    memberships: [],
    demoCircle: null,
    ...overrides,
  };
  return planAppReviewDemo(input);
}

describe("app review demo seed guard", () => {
  it("creates the demo when the reviewer has no memberships and the marker circle is absent", () => {
    expect(plan()).toEqual({ ok: true, action: "create" });
  });

  it("updates only when the marker circle exists and the reviewer is its active organizer", () => {
    expect(
      plan({
        demoCircle: {
          id: APP_REVIEW_DEMO_CIRCLE_ID,
          name: APP_REVIEW_DEMO_CIRCLE_NAME,
        },
        memberships: [
          {
            circleId: APP_REVIEW_DEMO_CIRCLE_ID,
            role: "organizer",
            status: "active",
          },
        ],
      }),
    ).toEqual({ ok: true, action: "update" });
  });

  it("refuses an unscoped circle list even when Home is the first row and the demo is later", () => {
    const result = planAppReviewDemo({
      reviewerEmail: APP_REVIEW_REVIEWER_EMAIL,
      memberships: [],
      demoCircle: null,
      circles: [
        { id: homeId, name: "Home" },
        {
          id: APP_REVIEW_DEMO_CIRCLE_ID,
          name: APP_REVIEW_DEMO_CIRCLE_NAME,
        },
      ],
    });

    expect(result).toEqual({ ok: false, reason: "unscoped-circle-list" });
    expect(result).not.toMatchObject({ action: "update" });
  });

  it("refuses when the reviewer belongs to any circle other than the marker", () => {
    expect(
      plan({
        memberships: [
          { circleId: homeId, role: "organizer", status: "active" },
        ],
      }),
    ).toEqual({ ok: false, reason: "other-circle" });
  });

  it("refuses a circle at the marker id whose name is not the demo", () => {
    expect(
      plan({
        demoCircle: { id: APP_REVIEW_DEMO_CIRCLE_ID, name: "Home" },
        memberships: [
          {
            circleId: APP_REVIEW_DEMO_CIRCLE_ID,
            role: "organizer",
            status: "active",
          },
        ],
      }),
    ).toEqual({ ok: false, reason: "marker-mismatch" });
  });

  it("refuses to attach the reviewer when the marker circle has no membership for them", () => {
    expect(
      plan({
        demoCircle: {
          id: APP_REVIEW_DEMO_CIRCLE_ID,
          name: APP_REVIEW_DEMO_CIRCLE_NAME,
        },
        memberships: [],
      }),
    ).toEqual({ ok: false, reason: "reviewer-not-member" });
  });

  it("refuses a different email", () => {
    expect(plan({ reviewerEmail: "someone@example.com" })).toEqual({
      ok: false,
      reason: "reviewer-email",
    });
  });
});
