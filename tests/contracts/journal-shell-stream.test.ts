// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

const root = process.cwd();

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function run(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`next ${args.join(" ")} exited ${code}`));
    });
  });
}

describe("journal document stream", () => {
  let child: ChildProcess | undefined;
  let logs = "";
  let origin = "";

  beforeAll(async () => {
    const nextBin = `${root}/node_modules/next/dist/bin/next`;
    await run([nextBin, "build"], {
      ...process.env,
      NODE_ENV: "production",
    });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      OUR_DAYS_LAB: "1",
      OUR_DAYS_ENVIRONMENT: "local",
      OUR_DAYS_RESOURCE_MODE: "detached",
      OUR_DAYS_INVITATION_DELIVERY_MODE: "disabled",
      OUR_DAYS_MEDIA_DELIVERY_MODE: "disabled",
      OUR_DAYS_PHOTO_POSTING_MODE: "disabled",
      OUR_DAYS_LOCAL_JOURNAL_MODE: "disabled",
      OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF: "",
      OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_SITE_URL: origin,
      OUR_DAYS_ENABLE_DESIGN_PREVIEW: "true",
      OUR_DAYS_LAB_JOURNAL_DELAY_MS: "1500",
    };
    delete env.VERCEL;
    delete env.VERCEL_ENV;
    delete env.OUR_DAYS_LAB_BLOCK_BEFORE_SHELL;
    const server = spawn(
      process.execPath,
      [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: root,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      },
    );
    child = server;
    server.stdout?.on("data", (chunk: Buffer) => {
      logs += chunk.toString();
    });
    server.stderr?.on("data", (chunk: Buffer) => {
      logs += chunk.toString();
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (server.exitCode != null) {
        throw new Error(`next start exited early\n${logs}`);
      }
      try {
        const response = await fetch(`${origin}/sign-in`);
        if (response.status < 500) return;
      } catch {
        // The listener is not up yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`next start did not listen\n${logs}`);
  }, 180_000);

  afterAll(async () => {
    if (!child?.pid || child.exitCode != null) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  });

  it("sends a Uint8Array chunk of the shell before the delayed journal read", async () => {
    const started = performance.now();
    const response = await fetch(`${origin}/family`);
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const decoder = new TextDecoder();
    let early = "";
    let firstChunkAt: number | null = null;
    let sawUint8Array = false;
    while (true) {
      const chunk = await reader!.read();
      if (chunk.done) break;
      expect(chunk.value).toBeInstanceOf(Uint8Array);
      sawUint8Array = true;
      const elapsed = performance.now() - started;
      if (firstChunkAt == null) firstChunkAt = elapsed;
      if (elapsed < 1_000) {
        early += decoder.decode(chunk.value, { stream: true });
      }
    }
    const finished = performance.now() - started;
    expect(sawUint8Array).toBe(true);
    expect(firstChunkAt).not.toBeNull();
    expect(firstChunkAt!).toBeLessThan(800);
    expect(early).toMatch(/topbar|Opening this journal/);
    expect(finished).toBeGreaterThan(1_200);
  }, 20_000);
});
