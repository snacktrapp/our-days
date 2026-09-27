import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const batchLimit = 10;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function localDatabaseUrl() {
  const configured = process.env.OUR_DAYS_LOCAL_DATABASE_URL?.trim();
  if (!configured) {
    throw new Error(
      "Set OUR_DAYS_LOCAL_DATABASE_URL to the local database before running the card backfill.",
    );
  }
  const url = new URL(configured);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Card backfill refuses any database that is not local.");
  }
  return url;
}

function psql(databaseUrl, sql) {
  const result = spawnSync(
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      databaseUrl.href,
      "--command",
      sql,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || "Local card backfill query failed.",
    );
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function quote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function candidates(databaseUrl, after) {
  const cursor =
    after == null ? "true" : `derivative.id > ${quote(after)}::uuid`;
  return psql(
    databaseUrl,
    `
      select derivative.id::text || '|' || derivative.object_path || '|' ||
        coalesce(string_agg(card.width::text || ':' || encode(card.output_sha256, 'hex'), ','), '')
        from private.photo_display_derivatives as derivative
        left join private.photo_card_renditions as card
          on card.display_derivative_id = derivative.id
       where ${cursor}
       group by derivative.id, derivative.object_path
       order by derivative.id
       limit ${batchLimit + 1}
    `,
  ).map((line) => {
    const [id, objectPath, existing = ""] = line.split("|");
    const rows = new Map(
      existing
        .split(",")
        .filter(Boolean)
        .map((item) => {
          const [width, sha] = item.split(":");
          return [Number(width), sha];
        }),
    );
    return { id, objectPath, rows };
  });
}

async function uploadCard(config, objectPath, bytes, metadata) {
  const response = await fetch(
    `${config.url}/storage/v1/object/our-days-display/${objectPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    {
      body: Buffer.from(bytes),
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${config.token}`,
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

async function applyBatch(databaseUrl, rows) {
  const { createClient } = await import("@supabase/supabase-js");
  const { renderCardWebp } = await import("./lib/card-photo-rendition.mjs");
  const url = process.env.OUR_DAYS_SUPABASE_URL?.trim();
  const anonKey = process.env.OUR_DAYS_SUPABASE_ANON_KEY?.trim();
  const email = process.env.OUR_DAYS_PHOTO_WORKER_EMAIL?.trim();
  const password = process.env.OUR_DAYS_PHOTO_WORKER_PASSWORD?.trim();
  if (!url || !anonKey || !email || !password) {
    throw new Error(
      "Local card backfill apply needs the photo worker session.",
    );
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/u.test(url)) {
    throw new Error("Card backfill apply refuses any API that is not local.");
  }
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session?.access_token) {
    throw new Error("Photo worker sign-in failed.");
  }
  const config = { anonKey, token: data.session.access_token, url };
  for (const row of rows) {
    const downloaded = await client.storage
      .from("our-days-display")
      .download(row.objectPath);
    if (downloaded.error || !downloaded.data) {
      console.log(`skip ${row.id} display unreadable`);
      continue;
    }
    const original = psql(
      databaseUrl,
      `select original_id::text from private.photo_display_derivatives where id = ${quote(row.id)}::uuid`,
    )[0];
    if (!original) {
      console.log(`skip ${row.id} derivative missing`);
      continue;
    }
    const displayBytes = new Uint8Array(await downloaded.data.arrayBuffer());
    for (const width of [1080, 640]) {
      const rendered = await renderCardWebp(displayBytes, width);
      const digest = createHash("sha256").update(rendered.bytes).digest("hex");
      if (row.rows.get(width) === digest) {
        console.log(`skip ${row.id} card-${width} sha matches`);
        continue;
      }
      if (row.rows.has(width)) {
        console.log(`skip ${row.id} card-${width} existing sha differs`);
        continue;
      }
      const objectPath = `${row.objectPath}.card-${width}.webp`;
      try {
        await uploadCard(config, objectPath, rendered.bytes, {
          card_width: width,
          display_derivative_id: row.id,
          original_id: original,
          output_height: rendered.height,
          output_mime_type: "image/webp",
          output_sha256: digest,
          output_size_bytes: rendered.bytes.byteLength,
          output_width: rendered.width,
        });
      } catch {
        console.log(`skip ${row.id} card-${width} upload failed`);
        continue;
      }
      const info = await client.storage
        .from("our-days-display")
        .info(objectPath);
      if (info.error || !info.data?.id) {
        console.log(`skip ${row.id} card-${width} identity missing`);
        continue;
      }
      const recorded = await client.rpc("record_photo_card_rendition", {
        card_width: width,
        display_derivative_id: row.id,
        output_height: rendered.height,
        output_sha256_hex: digest,
        output_size_bytes: rendered.bytes.byteLength,
        output_width: rendered.width,
        storage_object_id: info.data.id,
        storage_object_version: info.data.version ?? "",
      });
      if (recorded.error) {
        console.log(`skip ${row.id} card-${width} record failed`);
        continue;
      }
      console.log(`recorded ${row.id} card-${width}`);
    }
  }
  await client.auth.signOut({ scope: "local" });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const after = argValue("--after");
  if (after && !uuidPattern.test(after)) {
    throw new Error("Card backfill cursor must be a uuid.");
  }
  const databaseUrl = localDatabaseUrl();
  const rows = candidates(databaseUrl, after);
  const page = rows.slice(0, batchLimit);
  const next = rows.length > batchLimit ? rows[batchLimit]?.id : null;
  console.log(
    apply
      ? "card rendition backfill (apply)"
      : "card rendition backfill (dry-run)",
  );
  console.log(`host: ${databaseUrl.hostname} local`);
  console.log(`batch: ${page.length}`);
  if (page.length === 0) console.log("candidates: none");
  for (const row of page) {
    const has1080 = row.rows.has(1080);
    const has640 = row.rows.has(640);
    const action = has1080
      ? "skip 1080 (row exists; sha rechecked only on apply)"
      : "would create card-1080";
    const small = has640
      ? "skip 640"
      : "would create card-640 when under budget";
    console.log(`${row.id} ${action}; ${small}`);
  }
  console.log(`next: ${next ?? "none"}`);
  if (!apply) return;
  await applyBatch(databaseUrl, page);
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
