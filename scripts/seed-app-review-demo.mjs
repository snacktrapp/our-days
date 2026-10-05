/**
 * Idempotent App Review demo seed.
 *
 * Do not run this against production until Brian says GO. It refuses to write
 * any circle other than the fictional demo circle identified by
 * APP_REVIEW_DEMO_CIRCLE_ID.
 *
 * Apply the migration in this PR before the first real run. The function
 * public.apply_app_review_demo is granted only to the service role.
 *
 *   OUR_DAYS_APP_REVIEW_URL=https://<project>.supabase.co \
 *   OUR_DAYS_APP_REVIEW_SERVICE_KEY=... \
 *   OUR_DAYS_APP_REVIEW_PASSWORD=... \
 *   OUR_DAYS_APP_REVIEW_PUBLISHABLE_KEY=... \
 *   node --experimental-strip-types scripts/seed-app-review-demo.mjs --dry-run
 *
 * Omit --dry-run to create or update the reviewer and the demo circle.
 * The service key is read from the environment only and is never printed.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  APP_REVIEW_DEMO_CIRCLE_ID,
  APP_REVIEW_ORGANIZER_PERSON_ID,
  APP_REVIEW_PHOTO_REQUEST_KEY,
  APP_REVIEW_PHOTO_UPLOAD_KEY,
  APP_REVIEW_REVIEWER_EMAIL,
  planAppReviewDemo,
} from "../src/lib/app-review-demo-guard.ts";

const photoFixturePath = fileURLToPath(
  new URL("./fixtures/app-review/backyard-afternoon.png", import.meta.url),
);
const photoCaption = "A quiet afternoon in the backyard.";
const photoOccurredOn = "2026-09-20";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function required(name, { allowEmpty = false } = {}) {
  const value = process.env[name]?.trim() ?? "";
  if (!value && !allowEmpty) {
    fail(`Missing ${name}.`);
    return "";
  }
  return value;
}

function projectUrl() {
  return required("OUR_DAYS_APP_REVIEW_URL").replace(/\/+$/, "");
}

async function findReviewer(url, serviceKey) {
  const response = await fetch(
    `${url}/auth/v1/admin/users?filter=${encodeURIComponent(APP_REVIEW_REVIEWER_EMAIL)}`,
    {
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Reviewer lookup failed (${response.status}).`);
  }
  const body = await response.json();
  const users = Array.isArray(body?.users)
    ? body.users
    : Array.isArray(body)
      ? body
      : [];
  const matches = users.filter(
    (user) =>
      typeof user?.email === "string" &&
      user.email.toLowerCase() === APP_REVIEW_REVIEWER_EMAIL &&
      typeof user.id === "string",
  );
  if (matches.length > 1) {
    throw new Error("Refusing: more than one exact reviewer auth user.");
  }
  return matches[0] ?? null;
}

function userAlreadyExists(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message : "";
  return (
    code === "email_exists" ||
    /already (?:been )?registered|already exists/i.test(message)
  );
}

async function readDemoCircle(admin) {
  const { data, error } = await admin
    .from("circles")
    .select("id,name")
    .eq("id", APP_REVIEW_DEMO_CIRCLE_ID)
    .maybeSingle();
  if (error) throw new Error(`Demo circle lookup failed: ${error.message}`);
  if (!data) return null;
  return { id: data.id, name: data.name };
}

async function readMemberships(admin, userId) {
  const { data, error } = await admin
    .from("circle_memberships")
    .select("circle_id,role,status")
    .eq("user_id", userId);
  if (error) throw new Error(`Membership lookup failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    circleId: row.circle_id,
    role: row.role,
    status: row.status,
  }));
}

function firstRow(data) {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

function asciiBase64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function uploadDemoPhoto({ url, publishableKey, password }) {
  const client = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const signedIn = await client.auth.signInWithPassword({
    email: APP_REVIEW_REVIEWER_EMAIL,
    password,
  });
  if (signedIn.error || !signedIn.data.session) {
    throw new Error(
      "Reviewer password sign-in failed before the photo upload.",
    );
  }

  const bytes = await readFile(photoFixturePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const reserved = await client.rpc("reserve_photo_moment", {
    body: photoCaption,
    circle_id: APP_REVIEW_DEMO_CIRCLE_ID,
    journal_person_id: APP_REVIEW_ORGANIZER_PERSON_ID,
    occurred_on: photoOccurredOn,
    place_name: "",
    request_key: APP_REVIEW_PHOTO_REQUEST_KEY,
    tagged_person_ids: [],
    audience: "family",
  });
  if (reserved.error) {
    throw new Error(`Photo moment was not reserved: ${reserved.error.message}`);
  }
  const reservation = firstRow(reserved.data);
  if (!reservation?.intake_id) {
    throw new Error("Photo moment was not reserved.");
  }

  const state = reservation.state;
  if (state === "invalidated") {
    throw new Error("Photo intake was invalidated.");
  }
  if (state === "uploaded_unverified") {
    const acknowledged = await client.rpc("acknowledge_photo_intake", {
      intake_id: reservation.intake_id,
    });
    if (acknowledged.error) {
      throw new Error(
        `Photo intake could not be acknowledged: ${acknowledged.error.message}`,
      );
    }
    return { intakeId: reservation.intake_id, momentId: reservation.moment_id };
  }
  if (state !== "reserved" && state !== "upload_claimed") {
    return {
      intakeId: reservation.intake_id,
      momentId: reservation.moment_id,
      state,
    };
  }

  const claimed = await client.rpc("claim_photo_intake_upload", {
    expected_mime_type: "image/png",
    expected_sha256_hex: sha256,
    expected_size_bytes: bytes.length,
    intake_id: reservation.intake_id,
    upload_request_key: APP_REVIEW_PHOTO_UPLOAD_KEY,
  });
  if (claimed.error) {
    throw new Error(`Photo upload was not claimed: ${claimed.error.message}`);
  }
  const claim = firstRow(claimed.data);
  if (!claim?.object_path || !claim.bucket_id) {
    throw new Error("Photo upload was not claimed.");
  }
  if (claim.state === "reserved" || claim.state === "upload_claimed") {
    await uploadFixture({
      url,
      publishableKey,
      accessToken: signedIn.data.session.access_token,
      bytes,
      claim,
      intakeId: reservation.intake_id,
      sha256,
    });
  }
  const acknowledged = await client.rpc("acknowledge_photo_intake", {
    intake_id: reservation.intake_id,
  });
  if (acknowledged.error) {
    throw new Error(
      `Photo intake could not be acknowledged: ${acknowledged.error.message}`,
    );
  }
  return { intakeId: reservation.intake_id, momentId: reservation.moment_id };
}

async function uploadFixture({
  url,
  publishableKey,
  accessToken,
  bytes,
  claim,
  intakeId,
  sha256,
}) {
  const endpoint = `${url}/storage/v1/upload/resumable`;
  const metadata = {
    bucketName: claim.bucket_id,
    objectName: claim.object_path,
    contentType: "image/png",
    cacheControl: "3600",
    metadata: JSON.stringify({
      expected_mime_type: "image/png",
      expected_sha256: sha256,
      expected_size_bytes: bytes.length,
      intake_id: intakeId,
      upload_request_key: APP_REVIEW_PHOTO_UPLOAD_KEY,
    }),
  };
  const headers = {
    apikey: publishableKey,
    authorization: `Bearer ${accessToken}`,
    "tus-resumable": "1.0.0",
    "x-upsert": "false",
  };
  const created = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...headers,
      "upload-length": String(bytes.length),
      "upload-metadata": Object.entries(metadata)
        .map(([key, value]) => `${key} ${asciiBase64(String(value))}`)
        .join(","),
    },
  });
  if (!created.ok) {
    throw new Error(`Photo upload did not start (${created.status}).`);
  }
  const location = created.headers.get("location");
  if (!location) throw new Error("Photo upload did not start.");
  const uploadUrl = new URL(location, endpoint);
  if (uploadUrl.origin !== new URL(endpoint).origin) {
    throw new Error("Photo upload target was not accepted.");
  }
  const patched = await fetch(uploadUrl, {
    method: "PATCH",
    headers: {
      ...headers,
      "content-type": "application/offset+octet-stream",
      "upload-offset": "0",
    },
    body: bytes,
  });
  if (!patched.ok) {
    throw new Error(`Photo upload did not finish (${patched.status}).`);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const help = process.argv.includes("--help");
  if (help) {
    console.log(
      "node --experimental-strip-types scripts/seed-app-review-demo.mjs [--dry-run]",
    );
    return;
  }

  const url = projectUrl();
  const serviceKey = required("OUR_DAYS_APP_REVIEW_SERVICE_KEY");
  if (!url || !serviceKey) return;
  const password = required("OUR_DAYS_APP_REVIEW_PASSWORD", {
    allowEmpty: dryRun,
  });
  const publishableKey = required("OUR_DAYS_APP_REVIEW_PUBLISHABLE_KEY", {
    allowEmpty: dryRun,
  });
  if ((!dryRun && !password) || (!dryRun && !publishableKey)) return;
  if (!dryRun && password.length < 8) {
    fail("OUR_DAYS_APP_REVIEW_PASSWORD must be at least 8 characters.");
    return;
  }

  const admin = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  let reviewer = await findReviewer(url, serviceKey);
  const demoCircle = await readDemoCircle(admin);
  const memberships = reviewer ? await readMemberships(admin, reviewer.id) : [];
  const plan = planAppReviewDemo({
    reviewerEmail: APP_REVIEW_REVIEWER_EMAIL,
    memberships,
    demoCircle,
  });
  if (!plan.ok) {
    fail(`Refusing demo seed: ${plan.reason}`);
    return;
  }
  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          plan,
          reviewerExists: Boolean(reviewer),
          demoCircle,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!reviewer) {
    const created = await admin.auth.admin.createUser({
      email: APP_REVIEW_REVIEWER_EMAIL,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      if (created.error && userAlreadyExists(created.error)) {
        fail(
          "The reviewer account already exists but was not returned by an exact-email lookup. Refusing to page through other accounts.",
        );
        return;
      }
      fail("Reviewer account could not be created.");
      return;
    }
    reviewer = created.data.user;
  } else {
    const updated = await admin.auth.admin.updateUserById(reviewer.id, {
      password,
      email_confirm: true,
    });
    if (updated.error) {
      fail("Reviewer password could not be updated.");
      return;
    }
  }

  const refreshedMemberships = await readMemberships(admin, reviewer.id);
  const refreshedCircle = await readDemoCircle(admin);
  const refreshedPlan = planAppReviewDemo({
    reviewerEmail: APP_REVIEW_REVIEWER_EMAIL,
    memberships: refreshedMemberships,
    demoCircle: refreshedCircle,
  });
  if (!refreshedPlan.ok) {
    fail(`Refusing demo seed: ${refreshedPlan.reason}`);
    return;
  }

  const preview = await admin.rpc("apply_app_review_demo", {
    reviewer_user_id: reviewer.id,
    dry_run: true,
  });
  if (preview.error) {
    fail(`Demo seed preview failed: ${preview.error.message}`);
    return;
  }
  if (!preview.data?.ok) {
    fail(`Refusing demo seed: ${preview.data?.reason ?? "unknown"}`);
    return;
  }

  const applied = await admin.rpc("apply_app_review_demo", {
    reviewer_user_id: reviewer.id,
    dry_run: false,
  });
  if (applied.error) {
    fail(`Demo seed failed: ${applied.error.message}`);
    return;
  }
  if (!applied.data?.ok) {
    fail(`Refusing demo seed: ${applied.data?.reason ?? "unknown"}`);
    return;
  }

  const photo = await uploadDemoPhoto({ url, publishableKey, password });
  console.log(
    JSON.stringify(
      {
        dryRun: false,
        action: applied.data.action,
        circleId: applied.data.circleId,
        photo,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Demo seed failed.";
  fail(message);
});
