export const APP_REVIEW_DEMO_CIRCLE_ID = "c1ec1e00-0000-4000-8000-a99e11e00001";
export const APP_REVIEW_DEMO_CIRCLE_NAME = "The Rivera Family (Demo)";
export const APP_REVIEW_REVIEWER_EMAIL = "appreview@beelinetech.co";
export const APP_REVIEW_ORGANIZER_PERSON_ID =
  "c1ec1e00-0000-4000-8000-a99e11e00021";
export const APP_REVIEW_PHOTO_REQUEST_KEY =
  "c1ec1e00-0000-4000-8000-a99e11e00081";
export const APP_REVIEW_PHOTO_UPLOAD_KEY =
  "c1ec1e00-0000-4000-8000-a99e11e00082";
/** Stable marker for the fictional demo circle. It is the circle id, not a name lookup. */
export const APP_REVIEW_DEMO_MARKER = APP_REVIEW_DEMO_CIRCLE_ID;

export type AppReviewMembership = Readonly<{
  circleId: string;
  role: string;
  status: string;
}>;

export type AppReviewCircle = Readonly<{
  id: string;
  name: string;
}>;

export type AppReviewPlanInput = Readonly<{
  reviewerEmail: string;
  memberships: readonly AppReviewMembership[];
  demoCircle: AppReviewCircle | null;
  /**
   * An unscoped circle list. Passing this refuses the run. The seed must
   * never choose a circle from a list.
   */
  circles?: readonly AppReviewCircle[];
}>;

export type AppReviewPlan =
  | Readonly<{ ok: true; action: "create" | "update" }>
  | Readonly<{ ok: false; reason: string }>;

function refuse(reason: string): AppReviewPlan {
  return { ok: false, reason };
}

export function planAppReviewDemo(input: AppReviewPlanInput): AppReviewPlan {
  if ("circles" in input) return refuse("unscoped-circle-list");
  if (input.reviewerEmail !== APP_REVIEW_REVIEWER_EMAIL) {
    return refuse("reviewer-email");
  }

  const memberships = input.memberships ?? [];
  if (
    memberships.some(
      (membership) => membership.circleId !== APP_REVIEW_DEMO_CIRCLE_ID,
    )
  ) {
    return refuse("other-circle");
  }

  const demo = input.demoCircle;
  if (demo && demo.id !== APP_REVIEW_DEMO_CIRCLE_ID) {
    return refuse("marker-mismatch");
  }
  if (demo && demo.name !== APP_REVIEW_DEMO_CIRCLE_NAME) {
    return refuse("marker-mismatch");
  }

  if (!demo) {
    if (memberships.length > 0) return refuse("marker-mismatch");
    return { ok: true, action: "create" };
  }

  const mine = memberships.filter(
    (membership) => membership.circleId === APP_REVIEW_DEMO_CIRCLE_ID,
  );
  if (mine.length !== 1) return refuse("reviewer-not-member");
  const membership = mine[0];
  if (!membership) return refuse("reviewer-not-member");
  if (membership.role !== "organizer" || membership.status !== "active") {
    return refuse("reviewer-not-organizer");
  }
  return { ok: true, action: "update" };
}
