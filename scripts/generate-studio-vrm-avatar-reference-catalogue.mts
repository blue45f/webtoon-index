/**
 * Deterministically generates the clean-room Avatar Forge reference catalogue.
 *
 * Usage:
 *   pnpm exec tsx scripts/generate-studio-vrm-avatar-reference-catalogue.mts --write
 *   pnpm exec tsx scripts/generate-studio-vrm-avatar-reference-catalogue.mts --check
 *
 * Canonical serialization contract:
 * - the generator constructs every object in the schema order visible below;
 * - output is compact `JSON.stringify(envelope)` followed by one LF byte;
 * - MediaPipe Float32 values remain finite JavaScript numbers and use ECMAScript's native JSON
 *   shortest round-trippable number spelling (no decimal rounding or quantization);
 * - `referenceImageSha256` covers exactly 512x512 top-left row-major RGBA8 raw bytes;
 * - `embeddingSha256` covers UTF-8 JSON.stringify({ headIndex, headName, floatEmbedding }) with
 *   those exact key names and order, using the exact vector serialized into the catalogue.
 */
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { createServer as createPortProbe } from "node:net";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { chromium } from "playwright";
import { createServer as createViteServer, type ViteDevServer } from "vite";

import {
  AVATAR_FORGE_PRESETS,
  createAvatarForgeState,
  serializeAvatarForgeState,
} from "../apps/web/src/domains/creator/vrm/studio-vrm-avatar-forge";
import {
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_URL,
  STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
  STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
  type StudioVrmAvatarReferenceCatalogue,
  type StudioVrmAvatarReferenceEmbedding,
} from "../apps/web/src/domains/creator/vrm/studio-vrm-avatar-reference-recommendation";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const STUDIO_VRM_AVATAR_REFERENCE_ROOT = resolve(SCRIPT_DIRECTORY, "..");
export const STUDIO_VRM_AVATAR_REFERENCE_ARTIFACT_PATH = resolve(
  STUDIO_VRM_AVATAR_REFERENCE_ROOT,
  "apps/web/public/catalog/studio-vrm-avatar-reference-catalogue-v1.json",
);
export const STUDIO_VRM_AVATAR_REFERENCE_ARTIFACT_URL =
  "/catalog/studio-vrm-avatar-reference-catalogue-v1.json" as const;
export const STUDIO_VRM_AVATAR_REFERENCE_RAW_BYTE_LIMIT = 512 * 1024;
export const STUDIO_VRM_AVATAR_REFERENCE_GZIP_BYTE_LIMIT = 220 * 1024;
const STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH = 512;
const STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT = 512;
const STUDIO_VRM_AVATAR_REFERENCE_BROWSER_MODEL_ROUTE =
  "/__studio_vrm_avatar_reference_model_v1__.tflite";
export const STUDIO_VRM_AVATAR_REFERENCE_RGBA_BYTE_LENGTH =
  STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH
  * STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT
  * 4;

// The pinned source was retired from apps/web/public/vrm on 2026-09-02; the committed artifact stays the
// authority. --write/--check need a new CC0 base that passes the gates below before they can run.
const SOURCE_PATH = resolve(
  STUDIO_VRM_AVATAR_REFERENCE_ROOT,
  "apps/web/public/vrm/TS_Minseo_Campus.vrm",
);
const SOURCE_URL = "/vrm/TS_Minseo_Campus.vrm";
const SOURCE_BYTE_LENGTH = 1_325_288;
const SOURCE_SHA256 = "903601a5ffa71383188a3885509653283fb842e9a3f0025dca222b1c9b78ebea";
const HARNESS_PATH = "/__studio_vrm_avatar_reference_catalogue_v1__";
const HARNESS_ENTRY = "/scripts/studio-vrm-avatar-reference-catalogue-browser.tsx";
const READY_TIMEOUT_MS = 90_000;
const RENDER_TIMEOUT_MS = 45_000;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const CHROMIUM_ARGS = Object.freeze([
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu-sandbox",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
] as const);
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  // `blob:` because GLTFLoader fetches a GLB's embedded textures through blob URLs, and
  // production already allows it (see vercel.json). Without it the harness renders a VRM with
  // every texture silently missing -- invisible while the pinned model had none, and a wrong
  // answer the moment one does. `img-src` and `worker-src` below already carry blob:.
  "connect-src 'self' blob: ws:",
  "img-src 'self' data: blob:",
  "style-src 'unsafe-inline'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "font-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export type StudioVrmAvatarReferenceGenerationMode = "check" | "write";

type BrowserRenderResult = Readonly<{
  presetId: string;
  width: number;
  height: number;
  rgbaBase64: string;
  embedding: StudioVrmAvatarReferenceEmbedding;
  calibration: readonly Readonly<{
    id: "horizontal-flip" | "center-scale-90";
    embedding: StudioVrmAvatarReferenceEmbedding;
  }>[];
}>;

type BrowserAuthorityEvidence = Readonly<{
  wasmVariant: "simd" | "nosimd";
  wasmLoaderSha256: string;
  wasmBinarySha256: string;
  webglVersion: string;
  unmaskedVendor: string;
  unmaskedRenderer: string;
  contextAttributes: Readonly<{
    alpha: boolean;
    antialias: boolean;
    depth: boolean;
    premultipliedAlpha: boolean;
    preserveDrawingBuffer: boolean;
    stencil: boolean;
  }>;
  qualityGate: Readonly<{
    id: "avatar-reference-calibration-v1";
    original: Readonly<{
      requiredTopK: 1;
      strictRunnerUpMargin: true;
    }>;
    variants: readonly [
      Readonly<{ id: "horizontal-flip"; requiredTopK: 3 }>,
      Readonly<{
        id: "center-scale-90";
        scale: 0.9;
        background: "#f3f0e8";
        imageSmoothingEnabled: true;
        imageSmoothingQuality: "high";
        requiredTopK: 3;
      }>,
    ];
  }>;
}>;

type BrowserQualityQueryResult = Readonly<{
  queryId: string;
  targetPresetId: string;
  topPresetIds: readonly string[];
  targetRank: number;
  targetSimilarity: number;
  runnerUpSimilarity: number;
}>;

type GeneratedRender = Readonly<{
  presetId: string;
  presetStateSha256: string;
  referenceImageSha256: string;
  referenceImageByteLength: number;
  embeddingSha256: string;
}>;

type GeneratedCatalogueEntry = Readonly<{
  presetId: string;
  embedding: StudioVrmAvatarReferenceEmbedding;
}>;

type BrowserDiagnostics = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
};

declare global {
  interface Window {
    __studioVrmAvatarReferenceCatalogueReady?: boolean;
    __studioVrmAvatarReferenceCatalogueError?: string;
    __studioVrmAvatarReferenceCatalogueAuthority?: () => Promise<BrowserAuthorityEvidence>;
    __studioVrmAvatarReferenceCatalogueRender?: (
      presetId: string,
    ) => Promise<BrowserRenderResult>;
    __studioVrmAvatarReferenceCatalogueRankQueries?: (
      entries: readonly Readonly<{
        presetId: string;
        embedding: StudioVrmAvatarReferenceEmbedding;
      }>[],
      queries: readonly Readonly<{
        queryId: string;
        targetPresetId: string;
        embedding: StudioVrmAvatarReferenceEmbedding;
      }>[],
    ) => Promise<readonly BrowserQualityQueryResult[]>;
    __studioVrmAvatarReferenceCatalogueDispose?: () => Promise<void>;
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseStudioVrmAvatarReferenceGenerationMode(
  argv: readonly string[],
): StudioVrmAvatarReferenceGenerationMode {
  if (argv.length !== 1 || (argv[0] !== "--check" && argv[0] !== "--write")) {
    throw new Error(
      "Usage: generate-studio-vrm-avatar-reference-catalogue.mts --write|--check",
    );
  }
  return argv[0] === "--write" ? "write" : "check";
}

export function studioVrmAvatarReferenceEmbeddingSha256(
  embedding: StudioVrmAvatarReferenceEmbedding,
): string {
  invariant(
    Number.isSafeInteger(embedding.headIndex) && embedding.headIndex >= 0,
    "embedding headIndex must be a non-negative safe integer",
  );
  invariant(typeof embedding.headName === "string", "embedding headName must be a string");
  invariant(
    embedding.floatEmbedding.length > 0
      && embedding.floatEmbedding.every((component) => Number.isFinite(component)),
    "embedding vector must be non-empty and finite",
  );
  return sha256Hex(JSON.stringify({
    headIndex: embedding.headIndex,
    headName: embedding.headName,
    floatEmbedding: embedding.floatEmbedding,
  }));
}

export function serializeStudioVrmAvatarReferenceCatalogue(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

export function assertStudioVrmAvatarReferenceArtifactSize(bytes: Uint8Array): Readonly<{
  rawByteLength: number;
  gzipByteLength: number;
}> {
  const gzipByteLength = gzipSync(bytes, { level: 9 }).byteLength;
  invariant(
    bytes.byteLength <= STUDIO_VRM_AVATAR_REFERENCE_RAW_BYTE_LIMIT,
    `catalogue is ${bytes.byteLength} bytes; raw limit is ${STUDIO_VRM_AVATAR_REFERENCE_RAW_BYTE_LIMIT}`,
  );
  invariant(
    gzipByteLength <= STUDIO_VRM_AVATAR_REFERENCE_GZIP_BYTE_LIMIT,
    `catalogue gzip is ${gzipByteLength} bytes; limit is ${STUDIO_VRM_AVATAR_REFERENCE_GZIP_BYTE_LIMIT}`,
  );
  return { rawByteLength: bytes.byteLength, gzipByteLength };
}

function normalizedPath(path: string): string {
  return path.split(sep).join("/");
}

async function readPackageVersion(name: string): Promise<string> {
  const packageJsonPath = resolve(
    STUDIO_VRM_AVATAR_REFERENCE_ROOT,
    "node_modules",
    ...name.split("/"),
    "package.json",
  );
  const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown };
  invariant(typeof parsed.version === "string" && parsed.version.length > 0, `${name} has no version`);
  return parsed.version;
}

async function hashFile(path: string): Promise<Readonly<{
  byteLength: number;
  sha256: string;
}>> {
  const bytes = new Uint8Array(await readFile(path));
  return { byteLength: bytes.byteLength, sha256: sha256Hex(bytes) };
}

async function findBrowserRevisionRoot(executablePath: string): Promise<Readonly<{
  path: string;
  revision: string;
}>> {
  let current = dirname(executablePath);
  while (current !== dirname(current)) {
    const name = current.slice(current.lastIndexOf(sep) + 1);
    const match = /^chromium-(\d+)$/u.exec(name);
    if (match) return { path: current, revision: match[1]! };
    current = dirname(current);
  }
  throw new Error(`could not resolve Playwright Chromium revision root from ${executablePath}`);
}

async function findSwiftShaderFiles(root: string): Promise<string[]> {
  const matches: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        return;
      }
      if (
        /^(?:libEGL|libGLESv2|libvk_swiftshader)\.(?:dylib|so|dll)$/iu.test(entry.name)
        || /^vk_swiftshader_icd\.json$/u.test(entry.name)
      ) matches.push(path);
    }));
  };
  await visit(root);
  return matches.sort((left, right) => normalizedPath(relative(root, left)).localeCompare(
    normalizedPath(relative(root, right)),
    "en",
  ));
}

async function fetchVerifiedModel(): Promise<Uint8Array> {
  const response = await fetch(STUDIO_VRM_AVATAR_REFERENCE_MODEL_URL, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  invariant(response.ok, `MediaPipe model fetch failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  invariant(
    bytes.byteLength === STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH,
    `MediaPipe model length drifted: ${bytes.byteLength}`,
  );
  invariant(
    sha256Hex(bytes) === STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
    "MediaPipe model SHA-256 drifted",
  );
  return bytes;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createPortProbe();
    probe.once("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        rejectPort(new Error("could not allocate Avatar reference catalogue port"));
        return;
      }
      probe.close((error) => (error ? rejectPort(error) : resolvePort(address.port)));
    });
  });
}

async function startHarnessServer(modelBytes: Uint8Array): Promise<Readonly<{
  server: ViteDevServer;
  origin: string;
}>> {
  const port = await findFreePort();
  const server = await createViteServer({
    root: STUDIO_VRM_AVATAR_REFERENCE_ROOT,
    configFile: false,
    envFile: false,
    appType: "custom",
    logLevel: "warn",
    resolve: {
      alias: { "@": STUDIO_VRM_AVATAR_REFERENCE_ROOT },
    },
    define: {
      "process.env": JSON.stringify({ NODE_ENV: "production" }),
    },
    optimizeDeps: { entries: [HARNESS_ENTRY.slice(1)] },
    server: { host: "127.0.0.1", port, strictPort: true },
    plugins: [{
      name: "studio-vrm-avatar-reference-catalogue-harness",
      configureServer(viteServer) {
        viteServer.middlewares.use((request, response, next) => {
          response.setHeader("Content-Security-Policy", CSP);
          response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
          response.setHeader("X-Content-Type-Options", "nosniff");
          if (request.method === "HEAD" && request.url === SOURCE_URL) {
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/octet-stream");
            response.setHeader("Content-Length", String(SOURCE_BYTE_LENGTH));
            response.setHeader("Cache-Control", "no-store");
            response.end();
            return;
          }
          if (request.url === STUDIO_VRM_AVATAR_REFERENCE_BROWSER_MODEL_ROUTE) {
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/octet-stream");
            response.setHeader("Content-Length", String(modelBytes.byteLength));
            response.setHeader("Cache-Control", "no-store");
            response.end(modelBytes);
            return;
          }
          if (request.url !== HARNESS_PATH) {
            next();
            return;
          }
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end([
            "<!doctype html>",
            '<html lang="en">',
            "<head>",
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=512,height=512,initial-scale=1">',
            "<title>ToonSpectrum Avatar Forge reference catalogue</title>",
            "</head>",
            "<body>",
            `<script type="module" src="${HARNESS_ENTRY}"></script>`,
            "</body>",
            "</html>",
          ].join(""));
        });
      },
    }],
  });
  await server.listen();
  return { server, origin: `http://127.0.0.1:${port}` };
}

function validateEmbedding(
  embedding: StudioVrmAvatarReferenceEmbedding,
  expected: Readonly<{ dimensions: number; headIndex: number; headName: string }> | null,
): Readonly<{ dimensions: number; headIndex: number; headName: string }> {
  invariant(
    Number.isSafeInteger(embedding.headIndex) && embedding.headIndex >= 0,
    "invalid MediaPipe embedding headIndex",
  );
  invariant(typeof embedding.headName === "string", "invalid MediaPipe embedding headName");
  invariant(
    Array.isArray(embedding.floatEmbedding)
      && embedding.floatEmbedding.length > 0
      && embedding.floatEmbedding.every((component) => Number.isFinite(component)),
    "invalid MediaPipe embedding vector",
  );
  invariant(
    embedding.floatEmbedding.some((component) => component !== 0),
    "MediaPipe embedding vector is all-zero",
  );
  const observed = {
    dimensions: embedding.floatEmbedding.length,
    headIndex: embedding.headIndex,
    headName: embedding.headName,
  };
  if (expected) {
    invariant(
      JSON.stringify(observed) === JSON.stringify(expected),
      `MediaPipe embedding head drifted: ${JSON.stringify(observed)}`,
    );
  }
  return observed;
}

function createCatalogueRevision(authority: unknown, renders: readonly GeneratedRender[]): string {
  const digest = sha256Hex(JSON.stringify({ authority, renders }));
  return `avatar-forge-reference-v1-${digest.slice(0, 16)}`;
}

async function generateEnvelope(): Promise<Readonly<{
  envelope: unknown;
  bytes: Uint8Array;
  size: Readonly<{ rawByteLength: number; gzipByteLength: number }>;
  artifactSha256: string;
  embeddingAuthority: Readonly<{ dimensions: number; headIndex: number; headName: string }>;
}>> {
  const sourceBytes = new Uint8Array(await readFile(SOURCE_PATH));
  invariant(sourceBytes.byteLength === SOURCE_BYTE_LENGTH, "TS_Minseo source byte length drifted");
  invariant(sha256Hex(sourceBytes) === SOURCE_SHA256, "TS_Minseo source SHA-256 drifted");

  const modelBytes = await fetchVerifiedModel();
  const executablePath = chromium.executablePath();
  const browserRevisionRoot = await findBrowserRevisionRoot(executablePath);
  const [
    executableHash,
    rendererModuleHash,
    avatarForgeStateModuleHash,
    packageVersions,
    swiftShaderPaths,
  ] = await Promise.all([
    hashFile(executablePath),
    hashFile(resolve(
      STUDIO_VRM_AVATAR_REFERENCE_ROOT,
      "apps/web/src/domains/creator/vrm/StudioVrmAvatarForge.tsx",
    )),
    hashFile(resolve(
      STUDIO_VRM_AVATAR_REFERENCE_ROOT,
      "apps/web/src/domains/creator/vrm/studio-vrm-avatar-forge.ts",
    )),
    Promise.all([
      readPackageVersion("three"),
      readPackageVersion("@pixiv/three-vrm"),
      readPackageVersion("@react-three/fiber"),
      readPackageVersion("@mediapipe/tasks-vision"),
      readPackageVersion("playwright"),
    ]),
    findSwiftShaderFiles(browserRevisionRoot.path),
  ]);
  invariant(swiftShaderPaths.length >= 3, "Playwright Chromium SwiftShader libraries are missing");
  const swiftShaderLibraries = await Promise.all(swiftShaderPaths.map(async (path) => {
    const hash = await hashFile(path);
    return {
      name: normalizedPath(relative(browserRevisionRoot.path, path)),
      byteLength: hash.byteLength,
      sha256: hash.sha256,
    };
  }));

  const harness = await startHarnessServer(modelBytes);
  const browser = await chromium.launch({ headless: true, args: [...CHROMIUM_ARGS] });
  const diagnostics: BrowserDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
  };
  try {
    const context = await browser.newContext({
      viewport: {
        width: STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH,
        height: STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT,
      },
      deviceScaleFactor: 1,
      colorScheme: "light",
      locale: "en-US",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      // MediaPipe's native logger writes this successful XNNPACK initialization notice to stderr,
      // which Chromium exposes as a console error even though no error occurred.
      if (message.text() === "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.") return;
      diagnostics.consoleErrors.push(`[${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      // `error.stack ?? error.message` renders as "" for a thrown non-Error and
      // for a CSP-sanitised cross-origin failure, which says nothing about what
      // died. Keep every field the runtime gives us.
      const rendered = [error.name, error.message, error.stack, String(error)]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join(" | ");
      diagnostics.pageErrors.push(rendered.length > 0 ? rendered : `<empty ${typeof error}>`);
    });
    page.on("requestfailed", (request) => {
      const errorText = request.failure()?.errorText ?? "";
      // Chromium reports a fulfilled fetch(HEAD) as ERR_ABORTED when no response body follows.
      // The product preflight still received and validated the exact 200/content-length headers,
      // and the subsequent GET/VRM parse is required before any render can complete.
      if (
        request.method() === "HEAD"
        && new URL(request.url()).pathname === SOURCE_URL
        && errorText === "net::ERR_ABORTED"
      ) return;
      diagnostics.failedRequests.push(`${request.method()} ${request.url()} ${errorText}`);
    });
    await page.goto(`${harness.origin}${HARNESS_PATH}`, { waitUntil: "load" });
    try {
      await page.waitForFunction(
        () => (
          window.__studioVrmAvatarReferenceCatalogueReady === true
          || typeof window.__studioVrmAvatarReferenceCatalogueError === "string"
        ),
        undefined,
        { timeout: READY_TIMEOUT_MS },
      );
    } catch (cause) {
      // The harness sets neither flag if it dies before its own try/catch is
      // reached, and the diagnostics collected above are only inspected far
      // below -- so a timeout used to report the deadline and discard every
      // console error, page error and failed request that explained it.
      throw new Error(
        `harness never signalled within ${READY_TIMEOUT_MS}ms. `
        + `Collected: ${JSON.stringify(diagnostics)}`,
        { cause },
      );
    }
    const startupError = await page.evaluate(
      () => window.__studioVrmAvatarReferenceCatalogueError ?? null,
    );
    invariant(startupError === null, `browser harness initialization failed: ${startupError}`);
    const browserEvidence = await page.evaluate(async () => {
      const readAuthority = window.__studioVrmAvatarReferenceCatalogueAuthority;
      if (!readAuthority) throw new Error("browser authority function is unavailable");
      return readAuthority();
    }) as BrowserAuthorityEvidence;
    invariant(
      /swiftshader/iu.test(browserEvidence.unmaskedRenderer),
      `locked browser did not use SwiftShader: ${browserEvidence.unmaskedRenderer}`,
    );
    invariant(
      browserEvidence.contextAttributes.alpha === true
        && browserEvidence.contextAttributes.antialias === true
        && browserEvidence.contextAttributes.preserveDrawingBuffer === true,
      `WebGL context authority drifted: ${JSON.stringify(browserEvidence.contextAttributes)}`,
    );
    invariant(SHA256_HEX.test(browserEvidence.wasmLoaderSha256), "invalid WASM loader hash");
    invariant(SHA256_HEX.test(browserEvidence.wasmBinarySha256), "invalid WASM binary hash");
    invariant(
      JSON.stringify(browserEvidence.qualityGate) === JSON.stringify({
        id: "avatar-reference-calibration-v1",
        original: { requiredTopK: 1, strictRunnerUpMargin: true },
        variants: [
          { id: "horizontal-flip", requiredTopK: 3 },
          {
            id: "center-scale-90",
            scale: 0.9,
            background: "#f3f0e8",
            imageSmoothingEnabled: true,
            imageSmoothingQuality: "high",
            requiredTopK: 3,
          },
        ],
      }),
      "browser quality-gate authority drifted",
    );

    const browserVersion = browser.version();
    const [
      threeVersion,
      threeVrmVersion,
      reactThreeFiberVersion,
      mediaPipeTasksVisionVersion,
      playwrightVersion,
    ] = packageVersions;
    const authority = {
      sourceAssetId: "toonspectrum-minseo-campus",
      sourceUrl: SOURCE_URL,
      sourceByteLength: SOURCE_BYTE_LENGTH,
      sourceSha256: SOURCE_SHA256,
      rendererId: "toonspectrum-avatar-forge-front",
      rendererRevision: "2",
      rendererModuleSha256: rendererModuleHash.sha256,
      avatarForgeStateModuleSha256: avatarForgeStateModuleHash.sha256,
      width: STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH,
      height: STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT,
      pixelFormat: "rgba8-unorm-top-left-row-major",
      camera: {
        id: "studio-bust-v1",
        projection: "perspective",
        fovDegrees: 27,
        position: [0, 1.68, 2.1],
        target: [0, 1.45, 0],
        up: [0, 1, 0],
        near: 0.1,
        far: 20,
      },
      lighting: {
        id: "studio-neutral-three-point-v1",
        ambient: { intensity: 0.92, color: "#ffffff" },
        directional: [
          { intensity: 1.5, color: "#ffffff", position: [2.8, 4.2, 3.6] },
          { intensity: 0.72, color: "#ffffff", position: [-3.2, 2.6, 2.1] },
          { intensity: 0.64, color: "#ffffff", position: [-1.6, 3.4, -3.2] },
        ],
      },
      color: {
        outputColorSpace: "srgb",
        toneMapping: "aces-filmic",
        exposure: 1,
        clearColor: "#f3f0e8",
        alpha: true,
      },
      packages: {
        three: threeVersion,
        threeVrm: threeVrmVersion,
        reactThreeFiber: reactThreeFiberVersion,
        mediaPipeTasksVision: mediaPipeTasksVisionVersion,
        playwright: playwrightVersion,
      },
      browser: {
        family: "chromium",
        version: browserVersion,
        revision: browserRevisionRoot.revision,
        executableSha256: executableHash.sha256,
        headless: true,
      },
      softwareGpu: {
        backend: "swiftshader-angle",
        launchArgs: [...CHROMIUM_ARGS],
        webglVersion: browserEvidence.webglVersion,
        unmaskedVendor: browserEvidence.unmaskedVendor,
        unmaskedRenderer: browserEvidence.unmaskedRenderer,
        swiftShaderLibraries,
      },
      mediaPipe: {
        providerId: STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
        modelId: STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
        modelRevision: STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
        modelUrl: STUDIO_VRM_AVATAR_REFERENCE_MODEL_URL,
        modelByteLength: STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH,
        modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
        delegate: "CPU",
        runningMode: "IMAGE",
        l2Normalize: false,
        quantize: false,
        wasmVariant: browserEvidence.wasmVariant,
        wasmLoaderSha256: browserEvidence.wasmLoaderSha256,
        wasmBinarySha256: browserEvidence.wasmBinarySha256,
      },
      qualityGate: browserEvidence.qualityGate,
    } as const;

    const presetIds = AVATAR_FORGE_PRESETS.map(({ id }) => id).sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    invariant(presetIds.length === 21, `expected 21 Avatar Forge presets, got ${presetIds.length}`);
    invariant(new Set(presetIds).size === presetIds.length, "Avatar Forge preset IDs are duplicated");
    const renders: GeneratedRender[] = [];
    const entries: GeneratedCatalogueEntry[] = [];
    const calibrationQueries: Array<Readonly<{
      queryId: string;
      targetPresetId: string;
      embedding: StudioVrmAvatarReferenceEmbedding;
    }>> = [];
    let embeddingAuthority: Readonly<{
      dimensions: number;
      headIndex: number;
      headName: string;
    }> | null = null;
    for (const presetId of presetIds) {
      const result = await page.evaluate(async (id) => {
        const render = window.__studioVrmAvatarReferenceCatalogueRender;
        if (!render) throw new Error("browser render function is unavailable");
        return render(id);
      }, presetId) as BrowserRenderResult;
      invariant(result.presetId === presetId, `${presetId}: browser result identity drifted`);
      invariant(
        result.width === STUDIO_VRM_AVATAR_REFERENCE_BROWSER_WIDTH
          && result.height === STUDIO_VRM_AVATAR_REFERENCE_BROWSER_HEIGHT,
        `${presetId}: browser result dimensions drifted`,
      );
      const rgba = new Uint8Array(Buffer.from(result.rgbaBase64, "base64"));
      invariant(
        rgba.byteLength === STUDIO_VRM_AVATAR_REFERENCE_RGBA_BYTE_LENGTH,
        `${presetId}: RGBA byte length drifted (${rgba.byteLength})`,
      );
      invariant(
        rgba.some((component, index) => index % 4 !== 3 && component < 245),
        `${presetId}: render is blank`,
      );
      embeddingAuthority = validateEmbedding(result.embedding, embeddingAuthority);
      invariant(
        result.calibration.length === 2
          && result.calibration[0]?.id === "horizontal-flip"
          && result.calibration[1]?.id === "center-scale-90",
        `${presetId}: calibration variants drifted`,
      );
      for (const calibration of result.calibration) {
        validateEmbedding(calibration.embedding, embeddingAuthority);
        calibrationQueries.push({
          queryId: `${presetId}:${calibration.id}`,
          targetPresetId: presetId,
          embedding: {
            headIndex: calibration.embedding.headIndex,
            headName: calibration.embedding.headName,
            floatEmbedding: [...calibration.embedding.floatEmbedding],
          },
        });
      }
      const canonicalState = serializeAvatarForgeState(createAvatarForgeState(presetId));
      const presetStateSha256 = sha256Hex(JSON.stringify(canonicalState));
      const embedding = {
        headIndex: result.embedding.headIndex,
        headName: result.embedding.headName,
        floatEmbedding: [...result.embedding.floatEmbedding],
      };
      const embeddingSha256 = studioVrmAvatarReferenceEmbeddingSha256(embedding);
      renders.push({
        presetId,
        presetStateSha256,
        referenceImageSha256: sha256Hex(rgba),
        referenceImageByteLength: rgba.byteLength,
        embeddingSha256,
      });
      entries.push({ presetId, embedding });
    }
    invariant(embeddingAuthority, "no MediaPipe embedding authority was observed");
    invariant(
      new Set(renders.map(({ referenceImageSha256 }) => referenceImageSha256)).size
        === renders.length,
      "Avatar Forge reference RGBA hashes are not unique",
    );
    invariant(
      new Set(renders.map(({ embeddingSha256 }) => embeddingSha256)).size === renders.length,
      "Avatar Forge MediaPipe embedding hashes are not unique",
    );
    const originalQueries = entries.map((entry) => ({
      queryId: `${entry.presetId}:original`,
      targetPresetId: entry.presetId,
      embedding: entry.embedding,
    }));
    const qualityQueries = await page.evaluate(async ({ catalogueEntries, queries }) => {
      const rank = window.__studioVrmAvatarReferenceCatalogueRankQueries;
      if (!rank) throw new Error("browser quality-query function is unavailable");
      return rank(catalogueEntries, queries);
    }, {
      catalogueEntries: entries,
      queries: [...originalQueries, ...calibrationQueries],
    }) as readonly BrowserQualityQueryResult[];
    invariant(
      qualityQueries.length === originalQueries.length + calibrationQueries.length,
      "quality-query result count drifted",
    );
    for (const result of qualityQueries.slice(0, originalQueries.length)) {
      invariant(
        result.targetRank === browserEvidence.qualityGate.original.requiredTopK
          && result.topPresetIds[0] === result.targetPresetId,
        `${result.queryId}: official MediaPipe original query was not top-1`,
      );
      invariant(
        Number.isFinite(result.targetSimilarity)
          && Number.isFinite(result.runnerUpSimilarity)
          && result.targetSimilarity > result.runnerUpSimilarity,
        `${result.queryId}: MediaPipe original query margin is not strictly positive`,
      );
    }
    // Every calibration miss, not the first: there are 21 presets x 2 transforms
    // here, and a gate that reports one at a time turns "is retrieval healthy on
    // this avatar" into 42 sequential runs. The rank and the ordering it lost to
    // also matter -- "not in top-3" alone cannot separate a near miss at 4 from a
    // collapse.
    const calibrationMisses = qualityQueries
      .slice(originalQueries.length)
      .filter((result) => !(
        Number.isFinite(result.targetSimilarity)
        && result.targetRank >= 1
        && result.targetRank <= 3
        && result.topPresetIds.includes(result.targetPresetId)
      ));
    invariant(
      calibrationMisses.length === 0,
      `${calibrationMisses.length} of ${qualityQueries.length - originalQueries.length} `
        + "calibration queries did not retain their preset in top-3:\n"
        + calibrationMisses
          .map((result) =>
            `  ${result.queryId}: rank ${result.targetRank}, `
            + `similarity ${result.targetSimilarity.toFixed(4)}, `
            + `top: ${result.topPresetIds.join(" > ")}`)
          .join("\n"),
    );
    await page.evaluate(async () => {
      await window.__studioVrmAvatarReferenceCatalogueDispose?.();
    });
    await context.close();
    invariant(
      diagnostics.consoleErrors.length === 0
        && diagnostics.pageErrors.length === 0
        && diagnostics.failedRequests.length === 0,
      `browser diagnostics failed: ${JSON.stringify(diagnostics)}`,
    );

    const catalogueRevision = createCatalogueRevision(authority, renders);
    const catalogue: StudioVrmAvatarReferenceCatalogue = {
      version: STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
      providerId: STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
      modelId: STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
      modelRevision: STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
      modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
      catalogueRevision,
      entries,
    };
    const envelope = { authority, renders, catalogue };
    const bytes = serializeStudioVrmAvatarReferenceCatalogue(envelope);
    const size = assertStudioVrmAvatarReferenceArtifactSize(bytes);
    return {
      envelope,
      bytes,
      size,
      artifactSha256: sha256Hex(bytes),
      embeddingAuthority,
    };
  } finally {
    await browser.close().catch(() => undefined);
    await harness.server.close().catch(() => undefined);
  }
}

async function writeAtomically(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, path);
}

export async function runStudioVrmAvatarReferenceCatalogueGeneration(
  mode: StudioVrmAvatarReferenceGenerationMode,
): Promise<Readonly<{
  artifactPath: string;
  artifactUrl: typeof STUDIO_VRM_AVATAR_REFERENCE_ARTIFACT_URL;
  artifactSha256: string;
  rawByteLength: number;
  gzipByteLength: number;
  embeddingAuthority: Readonly<{ dimensions: number; headIndex: number; headName: string }>;
}>> {
  const generated = await generateEnvelope();
  if (mode === "write") {
    await writeAtomically(STUDIO_VRM_AVATAR_REFERENCE_ARTIFACT_PATH, generated.bytes);
  } else {
    let committed: Uint8Array;
    try {
      committed = new Uint8Array(await readFile(STUDIO_VRM_AVATAR_REFERENCE_ARTIFACT_PATH));
    } catch (cause) {
      throw new Error(
        `catalogue is missing; run --write first: ${STUDIO_VRM_AVATAR_REFERENCE_ARTIFACT_PATH}`,
        { cause },
      );
    }
    invariant(
      committed.byteLength === generated.bytes.byteLength
        && committed.every((byte, index) => byte === generated.bytes[index]),
      "tracked Avatar reference catalogue is stale; rerun generator with --write",
    );
  }
  return {
    artifactPath: STUDIO_VRM_AVATAR_REFERENCE_ARTIFACT_PATH,
    artifactUrl: STUDIO_VRM_AVATAR_REFERENCE_ARTIFACT_URL,
    artifactSha256: generated.artifactSha256,
    rawByteLength: generated.size.rawByteLength,
    gzipByteLength: generated.size.gzipByteLength,
    embeddingAuthority: generated.embeddingAuthority,
  };
}

async function main(): Promise<void> {
  const mode = parseStudioVrmAvatarReferenceGenerationMode(process.argv.slice(2));
  const result = await runStudioVrmAvatarReferenceCatalogueGeneration(mode);
  console.log(JSON.stringify({ mode, ...result }, null, 2));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
