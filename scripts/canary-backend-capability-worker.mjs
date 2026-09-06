import { createHmac, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const VERSION = "toonspectrum.backend-capability.v1";
const HEALTH_PATH =
  "/.well-known/toonspectrum/backend-capabilities/v1/health";
const EXECUTE_PATH =
  "/.well-known/toonspectrum/backend-capabilities/v1/execute";
const CONTENT_TYPE =
  "application/vnd.toonspectrum.backend-capability+json;version=1";
const MAXIMUM_RESPONSE_BYTES = 65_536;

export function isGatewayResponseContentType(value) {
  if (typeof value !== "string") return false;
  const [mediaType, ...parameters] = value.split(";");
  if (
    mediaType?.trim().toLowerCase()
    !== "application/vnd.toonspectrum.backend-capability+json"
  ) return false;
  const version = parameters
    .map((parameter) => parameter.split("=", 2).map((part) => part.trim()))
    .find(([name]) => name?.toLowerCase() === "version")?.[1]
    ?.replace(/(?:^"|"$)/gu, "");
  return version === "1";
}

export function createHealthSignature(token, provider, timestamp) {
  return `sha256:${createHmac("sha256", token)
    .update(["GET", HEALTH_PATH, provider, timestamp].join("\n"))
    .digest("hex")}`;
}

function required(environment, key) {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function secureOrigin(value, allowLoopback) {
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (
    (url.protocol !== "https:" && !(allowLoopback && loopback)) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("BACKEND_CAPABILITY_CANARY_BASE_URL must be a secure origin");
  }
  return url.origin;
}

function createCanaryAbortScope() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  timeout.unref?.();
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timeout),
  };
}

async function boundedJson(response) {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > MAXIMUM_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("worker response exceeded canary budget");
  }
  if (!response.body) throw new Error("worker response body is missing");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("worker response exceeded canary budget");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function runBackendCapabilityWorkerCanary(
  environment = process.env,
  runtime = { fetch: globalThis.fetch.bind(globalThis), now: Date.now },
) {
  const baseUrl = secureOrigin(
    required(environment, "BACKEND_CAPABILITY_CANARY_BASE_URL"),
    environment.BACKEND_CAPABILITY_CANARY_ALLOW_LOOPBACK === "true",
  );
  const provider = required(environment, "BACKEND_CAPABILITY_CANARY_PROVIDER");
  const token = required(environment, "BACKEND_CAPABILITY_CANARY_AUTH_TOKEN");
  if (token.length < 32) throw new Error("canary auth token is too short");
  const timestamp = String(runtime.now());
  const healthScope = createCanaryAbortScope();
  let health;
  let healthBody;
  try {
    health = await runtime.fetch(`${baseUrl}${HEALTH_PATH}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-toonspectrum-health-provider": provider,
        "x-toonspectrum-health-timestamp": timestamp,
        "x-toonspectrum-health-signature": createHealthSignature(
          token,
          provider,
          timestamp,
        ),
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: healthScope.signal,
    });
    healthBody = await boundedJson(health);
  } finally {
    healthScope.dispose();
  }
  if (
    !health.ok ||
    health.redirected ||
    healthBody?.version !== VERSION ||
    healthBody?.role !== "capability-worker" ||
    healthBody?.ready !== true ||
    !Array.isArray(healthBody?.operations)
  ) {
    throw new Error("capability worker signed health failed");
  }

  const sourceText = environment.BACKEND_CAPABILITY_CANARY_SOURCE_OBJECT_JSON?.trim();
  if (!sourceText) {
    return { provider, health: "ready", thumbnail: "not-requested" };
  }
  const sourceObject = JSON.parse(sourceText);
  const idempotencyKey = `canary-thumbnail-${randomUUID()}`;
  const tenantId =
    environment.BACKEND_CAPABILITY_CANARY_TENANT_ID?.trim() || "canary";
  const envelope = {
    version: VERSION,
    provider,
    tenantId,
    capability: "async-job",
    workload: "thumbnail",
    idempotencyKey,
    idempotent: true,
    createdAt: new Date(runtime.now()).toISOString(),
    nonce: randomUUID(),
    requirements: {
      fidelity: "exact",
      allowDegraded: false,
      latency: "tolerant",
    },
    execution: {
      estimatedCostUnits: 1,
      estimatedDurationMs: 30_000,
      durability: "best-effort",
    },
    payload: {
      operation: "thumbnail.render",
      tenantId,
      sourceAssetId:
        environment.BACKEND_CAPABILITY_CANARY_SOURCE_ASSET_ID?.trim() ||
        "canary-source",
      sourceObject,
      format: "png",
      maxWidth: 320,
      maxHeight: 320,
      requestKey: idempotencyKey,
    },
  };
  const executionScope = createCanaryAbortScope();
  let execution;
  let executionBody;
  try {
    execution = await runtime.fetch(`${baseUrl}${EXECUTE_PATH}`, {
      method: "POST",
      headers: {
        accept: CONTENT_TYPE,
        "content-type": CONTENT_TYPE,
        "x-toonspectrum-gateway-token": token,
        "x-toonspectrum-idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(envelope),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: executionScope.signal,
    });
    executionBody = await boundedJson(execution);
  } finally {
    executionScope.dispose();
  }
  if (
    !execution.ok ||
    execution.redirected ||
    !isGatewayResponseContentType(execution.headers.get("content-type")) ||
    executionBody?.version !== VERSION ||
    executionBody?.provider !== provider ||
    executionBody?.idempotencyKey !== idempotencyKey ||
    executionBody?.fidelity !== "exact" ||
    executionBody?.outcome !== "completed" ||
    executionBody?.result?.operation !== "thumbnail.render" ||
    executionBody?.result?.object?.purpose !== "derived"
  ) {
    throw new Error("capability worker thumbnail canary failed");
  }
  return { provider, health: "ready", thumbnail: "completed" };
}

async function main() {
  const result = await runBackendCapabilityWorkerCanary();
  process.stdout.write(
    `Capability worker canary passed: provider=${result.provider} health=${result.health} thumbnail=${result.thumbnail}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(
      `Capability worker canary failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  });
}
