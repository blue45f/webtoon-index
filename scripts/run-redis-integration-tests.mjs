#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { createClient } from "redis";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const require = createRequire(import.meta.url);
const VITEST_ENTRYPOINT = resolve(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs"
);
const REDIS_INTEGRATION_SUITE =
  "apps/api/src/infrastructure/upstash-coordination/upstash-coordination.redis.integration.test.ts";
const REDIS_IMAGE = "redis:7-alpine";

function runDocker(arguments_, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("docker", arguments_, {
      cwd: REPOSITORY_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.once("error", () => {
      rejectPromise(new Error("Docker could not be started."));
    });
    child.once("exit", (code, signal) => {
      if (signal || code !== 0) {
        rejectPromise(
          new Error(
            `Docker command failed${
              stderr.length > 0 ? `: ${Buffer.concat(stderr).toString("utf8").trim()}` : "."
            }`
          )
        );
        return;
      }
      resolvePromise(Buffer.concat(stdout).toString("utf8").trim());
    });
  });
}

async function connectWhenReady(redisUrl) {
  const deadline = Date.now() + 15_000;
  let lastFailure = "unknown";
  while (Date.now() < deadline) {
    const client = createClient({
      url: redisUrl,
      socket: { connectTimeout: 500, reconnectStrategy: false },
    });
    client.on("error", () => {
      // Retry through the bounded outer loop while the disposable container boots.
    });
    try {
      await client.connect();
      await client.ping();
      await client.quit();
      return;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) lastFailure = String(error.code);
      else if (error instanceof Error) lastFailure = error.name;
      else lastFailure = "unknown";
      if (client.isOpen) client.destroy();
      await delay(100);
    }
  }
  throw new Error(
    `Disposable Redis did not become ready within 15 seconds (${lastFailure}).`
  );
}

function runVitest(redisUrl) {
  const child = spawn(
    process.execPath,
    [VITEST_ENTRYPOINT, "run", "--no-file-parallelism", REDIS_INTEGRATION_SUITE],
    {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        REDIS_INTEGRATION_URL: redisUrl,
      },
      stdio: "inherit",
    }
  );
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", () => {
      rejectPromise(new Error("The Redis integration-test process could not start."));
    });
    child.once("exit", (code, signal) => {
      if (signal) {
        rejectPromise(new Error("The Redis integration-test process was interrupted."));
        return;
      }
      if (code !== 0) {
        rejectPromise(new Error("The Redis integration suite failed."));
        return;
      }
      resolvePromise();
    });
  });
}

async function main() {
  const suffix = randomBytes(8).toString("hex");
  const containerName = `toonspectrum-redis-it-${process.pid}-${suffix}`;
  const password = `ts_${randomBytes(32).toString("base64url")}`;
  let started = false;
  let cleaning = false;

  const cleanup = async () => {
    if (!started || cleaning) return;
    cleaning = true;
    try {
      await runDocker(["rm", "--force", containerName]);
    } catch {
      console.error("Disposable Redis cleanup failed; remove only the reported test container.");
      console.error(`Container: ${containerName}`);
    }
  };
  const interrupt = () => {
    cleanup().finally(() => {
      process.exitCode = 130;
      process.exit();
    });
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    await runDocker([
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--label",
      "com.toonspectrum.purpose=redis-integration",
      "--publish",
      "127.0.0.1::6379",
      "--memory",
      "128m",
      "--cpus",
      "1",
      REDIS_IMAGE,
      "redis-server",
      "--save",
      "",
      "--appendonly",
      "no",
      "--requirepass",
      password,
    ]);
    started = true;

    const port = await runDocker([
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "6379/tcp") 0).HostPort}}',
      containerName,
    ]);
    if (!/^\d{1,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65_535) {
      throw new Error("Docker returned an invalid disposable Redis port.");
    }
    const redisUrl = `redis://:${encodeURIComponent(password)}@127.0.0.1:${port}/0`;
    await connectWhenReady(redisUrl);
    console.log("Disposable loopback Redis is ready; credentials are hidden.");
    await runVitest(redisUrl);
  } finally {
    await cleanup();
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown Redis integration failure.";
  console.error(`Redis integration tests failed: ${message}`);
  process.exitCode = 1;
});
