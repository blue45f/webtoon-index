import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  DEFAULT_UPLOAD_REQUEST_TIMEOUT_MS, MAX_UPLOAD_RESPONSE_BYTES,
  hasExistingAsset, normalizeUploadBaseUrl, requestUploadApi,
} from "../upload-toonstudio-3d-assets.mts";

const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");
const CLI = fileURLToPath(new URL("../upload-toonstudio-3d-assets.mts", import.meta.url));
const TOKEN = "synthetic-network-test-secret";
const COOKIE = "toonsession=synthetic-session-secret";

async function withServer(handler, run) {
  const requests = [];
  let handlerError;
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    Promise.resolve().then(() => handler(req, res)).catch((error) => {
      handlerError = error;
      res.destroy();
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const result = await run(`http://127.0.0.1:${server.address().port}`, requests);
    if (handlerError) throw handlerError;
    return result;
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

async function withManifest(run, entries = [{ path: "a.png", name: "a", subtype: "image" }]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "upload-network-"));
  try {
    await writeFile(path.join(dir, "a.png"), Uint8Array.of(1, 2, 3));
    const manifestPath = path.join(dir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(entries));
    return await run(manifestPath);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

function cli(args, overrides = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("STUDIO_") || ["NEST_API_URL", "API_BASE_URL"].includes(key)) delete env[key];
    Object.assign(env, overrides);
    const child = spawn(process.execPath, ["--experimental-strip-types", CLI, ...args], {
      cwd: os.tmpdir(), env, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("child test deadline exceeded")); }, 8000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
function json(res, value, status = 200) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); }
async function form(req) {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  return new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers["content-type"] } }).formData();
}
const args = (url, manifest) => ["--base-url", url, "--session-token", TOKEN, "--work-id", "test-work", "--manifest", manifest];

for (const [input, expected] of [
  ["https://api.example.test/", "https://api.example.test"],
  ["https://api.example.test/gateway/", "https://api.example.test/gateway"],
  ["http://127.0.0.1:4001", "http://127.0.0.1:4001"],
  ["http://localhost:4001/", "http://localhost:4001"],
  ["http://[::1]:4001/", "http://[::1]:4001"],
]) test(`base URL keeps supported transport and prefix: ${input}`, () => assert.equal(normalizeUploadBaseUrl(input), expected));

for (const input of ["http://127.evil.test", "http://127.0.0.1.evil.test", "http://localhost.evil.test", "https://example.test\u0000", "http://example.test", "https://user:secret@example.test", "https://example.test?token=secret",
  "https://example.test#secret", "file:///private", "data:text/plain,secret", "not-a-url", "https://example.test\\private", "https://exam\nple.test", " https://example.test"]) {
  test(`unsafe/ambiguous base is rejected without echoing it: ${JSON.stringify(input)}`, () => {
    assert.throws(() => normalizeUploadBaseUrl(input), (error) => !error.message.includes(input) && !error.message.includes("secret"));
  });
}

for (const route of ["https://other.example.test", "//other.example.test", "/\\other", "/api#secret", "/../outside", "/api/%2e%2e/outside", "/api/%2fother", "/api/%5cother"]) {
  test(`route cannot leave a configured prefix: ${route}`, async () => {
    await assert.rejects(requestUploadApi("https://example.invalid/gateway", route, {}, {}), /route/u);
  });
}

test("base prefix, encoded route and request headers are preserved", async () => withServer((req, res) => {
  assert.equal(req.url, "/gateway/api/work?id=x%2Fy");
  assert.equal(req.headers["x-user-id"], TOKEN);
  assert.equal(req.headers.accept, "application/json");
  json(res, { ok: true });
}, async (url) => {
  const res = await requestUploadApi(url + "/gateway", "/api/work?id=x%2Fy", { headers: { "x-user-id": "wrong" } }, { "x-user-id": TOKEN });
  assert.deepEqual(await res.json(), { ok: true });
}));

for (const status of [301, 302, 303, 307, 308]) test(`HTTP ${status} cannot forward authentication or a PUT body`, async () => {
  await withServer((req, res) => json(res, {}), async (destination, leaked) => {
    await withServer((req, res) => { res.writeHead(status, { location: `${destination}/secret-location` }); res.end(); }, async (url) => {
      await assert.rejects(requestUploadApi(url, "/api/upload", { method: "PUT", body: "synthetic-file", redirect: "follow" }, { "x-user-id": TOKEN, cookie: COOKIE }), /redirect refused/u);
      assert.equal(leaked.length, 0);
    });
  });
});

test("even same-origin redirect is rejected before a second request", async () => withServer((req, res) => {
  res.writeHead(307, { location: "/api/other" }); res.end();
}, async (url, requests) => {
  await assert.rejects(requestUploadApi(url, "/api/upload", {}, {}), /redirect refused/u);
  assert.equal(requests.length, 1);
}));

for (const stage of ["headers", "body"]) test(`deadline covers a server stalled at ${stage}`, async () => withServer((req, res) => {
  if (stage === "body") { res.writeHead(200, { "content-type": "application/json" }); res.flushHeaders(); res.write("{"); }
}, async (url) => {
  await assert.rejects(requestUploadApi(url, "/api/work", {}, {}, 100), /timed out.*response body/u);
}));

test("ongoing response chunks cannot reset the overall deadline", async () => withServer((req, res) => {
  res.writeHead(200); res.write("x");
  const timer = setInterval(() => res.write("x"), 20);
  res.once("close", () => clearInterval(timer));
}, async (url) => {
  await assert.rejects(requestUploadApi(url, "/api/work", {}, {}, 100), /timed out/u);
}));

test("an incomplete existence response never becomes a successful skip", async () => withServer((req, res) => {
  res.writeHead(200); res.flushHeaders(); res.write("{");
}, async (url) => {
  await assert.rejects(hasExistingAsset(url, {}, "work", "asset", "image", 100), /timed out/u);
}));

test("caller cancellation interrupts an already-started body", async () => {
  const controller = new AbortController();
  await withServer((req, res) => { res.writeHead(200); res.flushHeaders(); controller.abort(); }, async (url) => {
    await assert.rejects(requestUploadApi(url, "/api/work", { signal: controller.signal }, {}), /cancelled/u);
  });
});

test("pre-aborted request performs no HTTP request", async () => withServer((req, res) => json(res, {}), async (url, requests) => {
  await assert.rejects(requestUploadApi(url, "/api/work", { signal: AbortSignal.abort() }, {}), /cancelled/u);
  assert.equal(requests.length, 0);
}));

test("response at the exact byte limit remains readable", async () => withServer((req, res) => {
  res.end(Buffer.alloc(MAX_UPLOAD_RESPONSE_BYTES, 32));
}, async (url) => {
  const res = await requestUploadApi(url, "/api/work", {}, {});
  assert.equal((await res.arrayBuffer()).byteLength, MAX_UPLOAD_RESPONSE_BYTES);
}));

for (const mode of ["advertised", "chunked", "gzip"]) test(`${mode} oversized response is rejected`, async () => withServer((req, res) => {
  const body = Buffer.alloc(MAX_UPLOAD_RESPONSE_BYTES + 1, 32);
  if (mode === "advertised") { res.writeHead(200, { "content-length": body.length }); res.end(body); }
  else if (mode === "chunked") { res.writeHead(200); res.write(body); res.end(); }
  else { const compressed = gzipSync(body); res.writeHead(200, { "content-encoding": "gzip", "content-length": compressed.length }); res.end(compressed); }
}, async (url) => {
  await assert.rejects(requestUploadApi(url, "/api/work", {}, {}), /byte limit/u);
}));

test("network disconnect errors do not expose authentication values", async () => withServer((req) => req.socket.destroy(), async (url) => {
  await assert.rejects(requestUploadApi(url, "/api/work", {}, { "x-user-id": TOKEN }), (error) => {
    assert.match(error.message, /transport failed/u); assert.ok(!error.message.includes(TOKEN)); return true;
  });
}));

test("invalid header exceptions do not echo their supplied value", async () => withServer((req, res) => json(res, {}), async (url, requests) => {
  await assert.rejects(requestUploadApi(url, "/api/work", {}, { "x-user-id": TOKEN + "\n" }), (error) => !error.message.includes(TOKEN));
  assert.equal(requests.length, 0);
}));

for (const status of [401, 403, 429, 500]) test(`HTTP ${status} error body is not echoed into CLI diagnostics`, async () => withServer((req, res) => {
  json(res, { message: `${req.headers["x-user-id"]} ${req.headers.cookie}` }, status);
}, async (url) => {
  await assert.rejects(hasExistingAsset(url, { "x-user-id": TOKEN, cookie: COOKIE }, "work", "asset", "image"), (error) => {
    assert.match(error.message, new RegExp(`\\(${status}\\)`));
    assert.ok(!error.message.includes(TOKEN)); assert.ok(!error.message.includes(COOKIE)); return true;
  });
}));

// The per-request deadline also bounds the cold child's preceding non-stalled requests (work lookup
// before the lookup/upload stages). Under parallel CI load that first fetch can exceed 100 ms, which
// would time out the wrong stage; keep the deadline well above cold-start latency.
const STALLED_STAGE_TIMEOUT_MS = "2000";
for (const stage of ["login", "work", "lookup", "upload"]) test(`real CLI ${stage} request times out without automatic retries`, async () => withManifest(async (manifest) => { // NOSONAR javascript:S3776
  await withServer(async (req, res) => {
    let current = "work";
    if (req.url.includes("/auth/")) current = "login";
    else if (req.method === "PUT") current = "upload";
    else if (req.url.includes("/assets/")) current = "lookup";
    if (current === stage) { res.writeHead(200); res.flushHeaders(); res.write("{"); return; }
    if (current === "lookup") { json(res, {}, 404); return; }
    json(res, { id: "test-work" });
  }, async (url, requests) => {
    const auth = stage === "login" ? ["--auto-demo-login"] : ["--session-token", TOKEN, "--work-id", "test-work"];
    const result = await cli(["--base-url", url, "--manifest", manifest, ...auth, "--request-timeout-ms", STALLED_STAGE_TIMEOUT_MS, ...(stage === "lookup" ? ["--skip-existing"] : [])]);
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /timed out/u);
    const puts = requests.filter((req) => req.method === "PUT");
    assert.equal(puts.length, stage === "upload" ? 1 : 0);
  });
}));
for (const kind of ["empty", "filter", "resume"]) test(`empty ${kind} selection makes no work or auth request`, async () => withManifest(async (manifest) => {
  await withServer((req, res) => json(res, { id: "unexpected-work" }), async (url, requests) => {
    let extras = [];
    if (kind === "filter") extras = ["--filter-category", "absent"];
    else if (kind === "resume") extras = ["--start-index", "2"];
    const result = await cli(["--base-url", url, "--manifest", manifest, "--auto-demo-login", ...extras]);
    assert.equal(result.code, 2); assert.equal(requests.length, 0);
  });
}, kind === "empty" ? [] : undefined));

for (const flag of ["--concurrency", "--request-timeout-ms"]) {
  for (const value of ["0", "1.5", "Infinity", "999999999999999999999"]) test(`CLI rejects unsafe ${flag} ${value} before I/O`, async () => withManifest(async (manifest) => {
    await withServer((req, res) => json(res, {}), async (url, requests) => {
      const result = await cli([...args(url, manifest), flag, value]);
      assert.equal(result.code, 1); assert.equal(requests.length, 0);
    });
  }));
}

test("timeout environment variable is effective, not silently ignored", async () => withManifest(async (manifest) => {
  await withServer((req, res) => { res.writeHead(200); res.flushHeaders(); }, async (url) => {
    const result = await cli(args(url, manifest), { STUDIO_REQUEST_TIMEOUT_MS: "100" });
    assert.equal(result.code, 1); assert.match(result.stderr, /timed out/u);
  });
}));

test("invalid concurrency environment fails closed", async () => withManifest(async (manifest) => {
  await withServer((req, res) => json(res, {}), async (url, requests) => {
    const result = await cli(args(url, manifest), { STUDIO_CONCURRENCY: "2.5" });
    assert.equal(result.code, 1); assert.equal(requests.length, 0);
  });
}));

for (const reply of ["wrong-id", "malformed-json", "null-json"]) test(`CLI does not report success for ${reply} after PUT`, async () => withManifest(async (manifest) => {
  await withServer(async (req, res) => {
    if (req.method === "GET") { json(res, { id: "test-work" }); return; }
    await form(req);
    if (reply === "wrong-id") json(res, { assetId: "another-asset" });
    else if (reply === "null-json") json(res, null);
    else { res.writeHead(200); res.end(`invalid:${TOKEN}`); }
  }, async (url, requests) => {
    const result = await cli(args(url, manifest));
    assert.equal(result.code, 1); assert.ok(!result.stderr.includes(TOKEN)); assert.match(result.stdout, /업로드: 0/u);
    assert.equal(requests.filter((req) => req.method === "PUT").length, 1);
  });
}));

test("real CLI ignores unrelated demo cookies and sends only the session cookie", async () => withManifest(async (manifest) => {
  await withServer(async (req, res) => {
    if (req.url.includes("/auth/")) { res.writeHead(200, { "set-cookie": ["analytics=not-a-session; Path=/", COOKIE + "; Path=/; HttpOnly"] }); res.end("{}"); return; }
    if (req.method === "POST") { assert.equal(req.headers.cookie, COOKIE); json(res, { id: "test-work" }); return; }
    assert.equal(req.headers.cookie, COOKIE);
    const uploaded = await form(req); json(res, { assetId: JSON.parse(uploaded.get("descriptor")).element.id });
  }, async (url) => {
    const result = await cli(["--base-url", url, "--manifest", manifest, "--auto-demo-login"]);
    assert.equal(result.code, 0, result.stderr);
  });
}));

for (const cookies of [["other-toonsession=fake"], ["toonsession="], ["toonsession=a", "toonsession=b"]]) {
  test(`ambiguous/missing demo session cookie does not create a work: ${cookies.join(",")}`, async () => withManifest(async (manifest) => {
    await withServer((req, res) => { res.writeHead(200, { "set-cookie": cookies }); res.end("{}"); }, async (url, requests) => {
      const result = await cli(["--base-url", url, "--manifest", manifest, "--auto-demo-login"]);
      assert.equal(result.code, 1); assert.equal(requests.length, 1);
    });
  }));
}

test("production default is explicit and finite", () => {
  assert.equal(DEFAULT_UPLOAD_REQUEST_TIMEOUT_MS, 120000);
  assert.equal(MAX_UPLOAD_RESPONSE_BYTES, 1048576);
});

test("explicit CLI limits override invalid environment defaults", async () => withManifest(async (manifest) => {
  await withServer((req, res) => json(res, {}), async (url, requests) => {
    const result = await cli([...args(url, manifest), "--dry-run", "--concurrency", "2", "--request-timeout-ms", "1000"], {
      STUDIO_CONCURRENCY: "invalid", STUDIO_REQUEST_TIMEOUT_MS: "invalid",
    });
    assert.equal(result.code, 0, result.stderr); assert.equal(requests.length, 0);
  });
}));

test("help neither validates unusable defaults nor echoes a credential-bearing base URL", async () => {
  const result = await cli(["--help"], { STUDIO_BASE_URL: `https://user:${TOKEN}@example.invalid`, STUDIO_CONCURRENCY: "invalid" });
  assert.equal(result.code, 0); assert.ok(!result.stdout.includes(TOKEN)); assert.ok(!result.stderr.includes(TOKEN));
});
