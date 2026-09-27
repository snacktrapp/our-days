import { createHash } from "node:crypto";

const batchLimit = 10;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function assertNotServiceRole(key) {
  const payload = key.split(".")[1];
  if (!payload) return;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (json.role === "service_role") {
      throw new Error("Card backfill refuses the service role.");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Card backfill refuses the service role."
    ) {
      throw error;
    }
  }
}

function workerTarget() {
  const live = process.argv.includes("--live");
  const url = process.env.OUR_DAYS_SUPABASE_URL?.trim();
  const anonKey = process.env.OUR_DAYS_SUPABASE_ANON_KEY?.trim();
  const email = process.env.OUR_DAYS_PHOTO_WORKER_EMAIL?.trim();
  const password = process.env.OUR_DAYS_PHOTO_WORKER_PASSWORD?.trim();
  if (!url || !anonKey || !email || !password) {
    throw new Error(
      "Card backfill needs the deployment photo worker identity.",
    );
  }
  assertNotServiceRole(anonKey);
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error("Card backfill URL is invalid.");
  }
  const local = hostname === "127.0.0.1" || hostname === "localhost";
  if (!local && !live) {
    throw new Error(
      "Card backfill refuses a non-local host unless --live is set.",
    );
  }
  return { anonKey, email, hostname, local, password, url };
}

async function workerClient(target) {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(target.url, target.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: target.email,
    password: target.password,
  });
  if (error || !data.session?.access_token) {
    throw new Error("Photo worker sign-in failed.");
  }
  return client;
}

async function uploadCard(target, token, objectPath, bytes, metadata) {
  const response = await fetch(
    `${target.url}/storage/v1/object/our-days-display/${objectPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    {
      body: Buffer.from(bytes),
      headers: {
        apikey: target.anonKey,
        authorization: `Bearer ${token}`,
        "cache-control": "max-age=0",
        "content-type": "image/webp",
        "x-metadata": Buffer.from(JSON.stringify(metadata)).toString("base64"),
        "x-upsert": "false",
      },
      method: "POST",
    },
  );
  if (response.ok || response.status === 409) return;
  throw new Error("Card upload failed.");
}

async function applyOne(target, client, row) {
  const { renderCardWebp } = await import("./lib/card-photo-rendition.mjs");
  const claimed = await client.rpc("claim_photo_card_backfill_lease", {
    display_derivative_id: row.display_derivative_id,
  });
  if (claimed.error || !claimed.data?.[0]) {
    console.log(`skip ${row.display_derivative_id} lease unavailable`);
    return;
  }
  const lease = claimed.data[0];
  try {
    const downloaded = await client.storage
      .from("our-days-display")
      .download(lease.object_path);
    if (downloaded.error || !downloaded.data) {
      console.log(`skip ${lease.display_derivative_id} display unreadable`);
      return;
    }
    const displayBytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const displaySha = createHash("sha256").update(displayBytes).digest("hex");
    if (displaySha !== lease.output_sha256_hex) {
      console.log(`skip ${lease.display_derivative_id} display sha differs`);
      return;
    }
    const rendered = await renderCardWebp(displayBytes, 1080);
    const digest = createHash("sha256").update(rendered.bytes).digest("hex");
    const objectPath = `${lease.object_path}.card-1080.webp`;
    const token = (await client.auth.getSession()).data.session?.access_token;
    if (!token) {
      console.log(`skip ${lease.display_derivative_id} worker session ended`);
      return;
    }
    try {
      await uploadCard(target, token, objectPath, rendered.bytes, {
        card_width: 1080,
        display_derivative_id: lease.display_derivative_id,
        original_id: lease.original_id,
        output_height: rendered.height,
        output_mime_type: "image/webp",
        output_sha256: digest,
        output_size_bytes: rendered.bytes.byteLength,
        output_width: rendered.width,
      });
    } catch {
      console.log(
        `skip ${lease.display_derivative_id} card-1080 upload failed`,
      );
      return;
    }
    const info = await client.storage.from("our-days-display").info(objectPath);
    if (info.error || !info.data?.id) {
      console.log(
        `skip ${lease.display_derivative_id} card-1080 identity missing`,
      );
      return;
    }
    const recorded = await client.rpc("record_photo_card_rendition", {
      card_width: 1080,
      display_derivative_id: lease.display_derivative_id,
      output_height: rendered.height,
      output_sha256_hex: digest,
      output_size_bytes: rendered.bytes.byteLength,
      output_width: rendered.width,
      storage_object_id: info.data.id,
      storage_object_version: info.data.version ?? "",
    });
    if (recorded.error) {
      console.log(
        `skip ${lease.display_derivative_id} card-1080 record failed`,
      );
      return;
    }
    console.log(`recorded ${lease.display_derivative_id} card-1080`);
  } finally {
    await client.rpc("release_photo_card_backfill_lease", {
      display_derivative_id: row.display_derivative_id,
    });
  }
}

async function main() {
  const apply =
    process.argv.includes("--apply") && !process.argv.includes("--dry-run");
  const after = argValue("--after");
  if (after && !uuidPattern.test(after)) {
    throw new Error("Card backfill cursor must be a uuid.");
  }
  const target = workerTarget();
  const client = await workerClient(target);
  const listed = await client.rpc("list_photo_card_backfill_candidates", {
    after_display_derivative_id: after,
    batch_limit: batchLimit,
  });
  if (listed.error) {
    throw new Error("Card backfill candidate list failed.");
  }
  const page = listed.data ?? [];
  const next =
    page.length === batchLimit ? page.at(-1)?.display_derivative_id : null;
  console.log(
    apply
      ? "card rendition backfill (apply)"
      : "card rendition backfill (dry-run)",
  );
  console.log(`host: ${target.hostname} ${target.local ? "local" : "live"}`);
  console.log(`batch: ${page.length}`);
  if (page.length === 0) console.log("candidates: none");
  for (const row of page) {
    console.log(`${row.display_derivative_id} would create card-1080`);
  }
  console.log(`next: ${next ?? "none"}`);
  if (!apply) {
    await client.auth.signOut({ scope: "local" });
    return;
  }
  for (const row of page) {
    await applyOne(target, client, row);
  }
  await client.auth.signOut({ scope: "local" });
}

const invokedDirectly = process.argv[1]?.endsWith(
  "backfill-card-renditions.mjs",
);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Card backfill failed.",
    );
    process.exitCode = 1;
  });
}
