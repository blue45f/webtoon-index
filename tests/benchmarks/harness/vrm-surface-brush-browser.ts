/**
 * Production Vite build -> real Chromium evidence for the complete VRM surface
 * brush path. Run from the repository root:
 *
 *   pnpm exec tsx tests/benchmarks/harness/vrm-surface-brush-browser.ts
 */

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";
import { build, preview } from "vite";

import type { Browser, Page, Request } from "playwright";
import type { PreviewServer } from "vite";

export const VRM_SURFACE_BRUSH_BROWSER_REPORT_SCHEMA_VERSION = 2 as const;
export const VRM_SURFACE_BRUSH_BROWSER_RESULT_GLOBAL =
  "__TOONSPECTRUM_VRM_SURFACE_BRUSH_BROWSER_RESULT__";
export const VRM_SURFACE_BRUSH_BROWSER_BOOTSTRAP_RECEIPT_GLOBAL =
  "__TOONSPECTRUM_VRM_SURFACE_BRUSH_BOOTSTRAP_RECEIPT__";
export const VRM_SURFACE_BRUSH_BROWSER_WARMUPS = 3;
export const VRM_SURFACE_BRUSH_BROWSER_SAMPLES = 31;
export const VRM_SURFACE_BRUSH_BROWSER_CASES = Object.freeze([
  Object.freeze({ id: "controlled-256-8", atlasSize: 256, gridSegments: 8, inputSamples: 8 }),
  Object.freeze({ id: "controlled-512-32", atlasSize: 512, gridSegments: 32, inputSamples: 32 }),
  Object.freeze({ id: "controlled-1024-128", atlasSize: 1024, gridSegments: 64, inputSamples: 128 }),
] as const);

const RESULT_TIMEOUT_MS = 12 * 60 * 1_000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PAGE_ENTRY = join(
  ROOT,
  "tests/benchmarks/harness/vrm-surface-brush-browser-page.ts",
);
const TRACKED_RESULT = join(
  ROOT,
  "tests/benchmarks/results/vrm-surface-brush-browser.json",
);
const BUNDLED_VRM_FIXTURE = join(ROOT, "apps/web/public/vrm/sample.vrm");
const PAGE_ALIAS = "virtual:vrm-surface-brush-browser-page";
const CHROMIUM_ARGS = Object.freeze([
  "--no-sandbox",
  "--enable-precise-memory-info",
  "--enable-webgl",
  "--use-angle=metal",
  "--disable-software-rasterizer",
]);
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "style-src 'none'",
  "img-src 'self' blob: data:",
  "font-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

type JsonRecord = Record<string, unknown>;

export interface VrmSurfaceBrushBrowserDiagnostics {
  readonly browserVersion: string;
  /** Actual Chromium argv returned by Browser.getBrowserCommandLine. */
  readonly launchArgs: readonly string[];
  readonly consoleErrors: readonly string[];
  readonly consoleWarnings: readonly string[];
  readonly pageErrors: readonly string[];
  readonly requestFailures: readonly string[];
  readonly successfulAssetResponseAborts: readonly string[];
  readonly errorResponses: readonly string[];
  readonly responseHeaders: Readonly<{
    contentSecurityPolicy: string;
    crossOriginOpenerPolicy: string;
    crossOriginEmbedderPolicy: string;
  }>;
}

export interface VrmSurfaceBrushBrowserArtifact {
  readonly schemaVersion: typeof VRM_SURFACE_BRUSH_BROWSER_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly status: "pass" | "fail";
  readonly pass: boolean;
  readonly benchmark: unknown;
  readonly diagnostics: VrmSurfaceBrushBrowserDiagnostics;
  readonly productionBuild: Readonly<{
    mode: "vite-production-build";
    assets: readonly string[];
    scratchDirectory: string;
    bundledVrmFixture: "apps/web/public/vrm/sample.vrm";
  }>;
  readonly validationIssues: readonly string[];
}

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function nested(value: unknown, ...keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) current = record(current)?.[key];
  return current;
}

const EXPECTED_BOOTSTRAP_ORDER = Object.freeze([
  "listener-installed",
  "zod-jitless-configured",
  "positive-control-started",
  "positive-control-blocked",
  "positive-control-observed",
  "entry-import-started",
  "page-module-evaluated",
  "entry-import-complete",
] as const);

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function strictCspIsExact(policy: string): boolean {
  if (policy.trim() !== CONTENT_SECURITY_POLICY) return false;
  const scriptDirective = policy
    .split(";")
    .map((directive) => directive.trim().split(/\s+/u))
    .find(([name]) => name === "script-src");
  if (!scriptDirective) return false;
  const tokens = new Set(scriptDirective.slice(1));
  return !tokens.has("'unsafe-eval'") && !tokens.has("'unsafe-inline'");
}

function disablesJavascriptJit(argument: string): boolean {
  const normalized = argument.toLowerCase().replace(/["']/gu, " ").trim();
  const forbidden =
    /(?:^|[\s,])--?(?:jitless|disable-jit|no-jit|disable-javascript-jit|no-opt|no-turbofan)(?:$|[\s,=])/u;
  if (forbidden.test(normalized)) return true;
  const jsFlagsPrefix = "--js-flags=";
  if (!normalized.startsWith(jsFlagsPrefix)) return false;
  return forbidden.test(normalized.slice(jsFlagsPrefix.length));
}

function bootstrapReceiptIssues(benchmark: unknown): string[] {
  const issues: string[] = [];
  const receipt = record(nested(benchmark, "bootstrapReceipt"));
  const order = receipt?.order;
  const positiveControlViolations = receipt?.positiveControlViolations;
  const runtimeViolations = receipt?.runtimeViolations;
  if (
    receipt?.schemaVersion !== 1
    || !stringArray(order)
    || order.length !== EXPECTED_BOOTSTRAP_ORDER.length
    || order.some((step, index) => step !== EXPECTED_BOOTSTRAP_ORDER[index])
    || receipt.configIdentityObserved !== true
    || receipt.globalConfigJitlessObserved !== true
    || receipt.zodAllowsEvalFalse !== true
  ) {
    issues.push("strict-CSP bootstrap did not prove pre-import Zod jitless initialization");
  }
  if (
    receipt?.positiveControlThrew !== true
    || receipt.positiveControlObserved !== true
    || !stringArray(positiveControlViolations)
    || positiveControlViolations.length === 0
    || !positiveControlViolations.every((violation) => violation.startsWith("script-src:"))
  ) {
    issues.push("strict-CSP positive eval control was not blocked and observed");
  }
  if (!stringArray(runtimeViolations) || runtimeViolations.length !== 0) {
    issues.push("strict-CSP runtime captured unexpected policy violations");
  }
  return issues;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function close(actual: unknown, expected: number): boolean {
  const numeric = finite(actual);
  return numeric !== null && Math.abs(numeric - expected) <= 0.000_002;
}

function numericArray(value: unknown, expectedLength: number): value is number[] {
  return Array.isArray(value)
    && value.length === expectedLength
    && value.every((candidate) => (finite(candidate) ?? -1) >= 0);
}

function distributionValid(value: unknown): boolean {
  const distribution = record(value);
  const samples = distribution?.samplesMs;
  if (
    distribution?.sampleCount !== VRM_SURFACE_BRUSH_BROWSER_SAMPLES
    || distribution.percentileMethod !== "nearest-rank-ceil"
    || !numericArray(samples, VRM_SURFACE_BRUSH_BROWSER_SAMPLES)
  ) {
    return false;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (quantile: number): number => {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * quantile) - 1),
    );
    return sorted[index]!;
  };
  const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  return close(distribution.p50Ms, at(0.5))
    && close(distribution.p95Ms, at(0.95))
    && close(distribution.p99Ms, at(0.99))
    && close(distribution.minMs, sorted[0]!)
    && close(distribution.maxMs, sorted.at(-1)!)
    && close(distribution.meanMs, mean);
}

function memoryObservationValid(value: unknown): boolean {
  const memory = record(value);
  if (!memory) return false;
  if (memory.source === "performance.memory") {
    return (finite(memory.usedJsHeapBytes) ?? -1) >= 0
      && (finite(memory.totalJsHeapBytes) ?? -1) >= 0
      && (finite(memory.jsHeapSizeLimitBytes) ?? -1) > 0
      && memory.reason === null;
  }
  return memory.source === "unavailable"
    && memory.usedJsHeapBytes === null
    && memory.totalJsHeapBytes === null
    && memory.jsHeapSizeLimitBytes === null
    && typeof memory.reason === "string"
    && memory.reason.length > 0;
}

function userAgentMemoryValid(value: unknown): boolean {
  const memory = record(value);
  if (!memory) return false;
  if (memory.source === "performance.measureUserAgentSpecificMemory") {
    return (finite(memory.bytes) ?? -1) >= 0 && memory.reason === null;
  }
  return memory.source === "unavailable"
    && memory.bytes === null
    && typeof memory.reason === "string"
    && memory.reason.length > 0;
}

function controlledCaseIssues(
  candidate: unknown,
  expected: typeof VRM_SURFACE_BRUSH_BROWSER_CASES[number],
): string[] {
  const issues: string[] = [];
  const item = record(candidate);
  if (!item || item.id !== expected.id) return [`${expected.id}: case is absent or misidentified`];
  if (
    nested(item, "exactWorkload", "atlasWidth") !== expected.atlasSize
    || nested(item, "exactWorkload", "atlasHeight") !== expected.atlasSize
    || nested(item, "exactWorkload", "gridSegments") !== expected.gridSegments
    || nested(item, "exactWorkload", "triangleCount") !== expected.gridSegments ** 2 * 2
    || nested(item, "exactWorkload", "inputSamplesPerStroke") !== expected.inputSamples
    || nested(item, "exactWorkload", "warmupsExcluded") !== VRM_SURFACE_BRUSH_BROWSER_WARMUPS
    || nested(item, "exactWorkload", "measuredStrokes") !== VRM_SURFACE_BRUSH_BROWSER_SAMPLES
    || nested(item, "exactWorkload", "proxyOrReductionUsed") !== false
  ) {
    issues.push(`${expected.id}: exact unreduced scene/sample workload is not proven`);
  }
  if (
    nested(item, "provider", "raycastProviderId") !== "three-mesh-bvh"
    || nested(item, "provider", "raycastRuntimeVersion") !== "three-mesh-bvh-0.9.13"
    || nested(item, "provider", "projectionProviderId") !== "three-vrm-texture-paint"
    || nested(item, "provider", "textureOwner") !== "StudioVrmTexturePaintRuntime"
    || !/^sha256:[0-9a-f]{64}$/u.test(String(nested(item, "provider", "bvhReceiptHash") ?? ""))
  ) {
    issues.push(`${expected.id}: production provider provenance is incomplete`);
  }
  for (const timing of [
    "fullRaycastProjectionCommit",
    "bvhRaycasts",
    "projectionLoweringAtlasCommit",
    "normalizedFullMsPerInputSample",
  ] as const) {
    if (!distributionValid(nested(item, "timings", timing))) {
      issues.push(`${expected.id}: ${timing} lacks 31 recomputable warm samples`);
    }
  }
  const qualityArrays = [
    "operationCounts",
    "referenceChangedTexels",
    "committedChangedTexels",
    "atlasChangedTexels",
    "referenceDigests",
    "atlasDigests",
  ] as const;
  for (const key of qualityArrays) {
    const value = nested(item, "quality", key);
    if (!Array.isArray(value) || value.length !== VRM_SURFACE_BRUSH_BROWSER_SAMPLES) {
      issues.push(`${expected.id}: ${key} does not retain every raw measurement`);
    }
  }
  if (
    (finite(nested(item, "quality", "maxBvhDerivedUvDelta")) ?? Number.POSITIVE_INFINITY)
      > 0.000_001
    || nested(item, "quality", "deterministicReference") !== true
    || nested(item, "quality", "deterministicAtlas") !== true
    || nested(item, "quality", "pressurePreservedWithoutQuantization") !== true
    || nested(item, "quality", "undoRestoredZero") !== true
  ) {
    issues.push(`${expected.id}: UV, deterministic byte, pressure, or undo quality gate failed`);
  }
  const gates = record(item.gates);
  if (!gates || Object.values(gates).some((gate) => gate !== true)) {
    issues.push(`${expected.id}: one or more promotion gates failed`);
  }
  if (
    !memoryObservationValid(nested(item, "memory", "jsHeapBefore"))
    || !memoryObservationValid(nested(item, "memory", "jsHeapAfter"))
    || !userAgentMemoryValid(nested(item, "memory", "userAgentSpecificMemory"))
    || nested(item, "memory", "browserObservedGpuMemoryBytes") !== null
    || typeof nested(item, "memory", "browserGpuMemoryReason") !== "string"
    || (nested(item, "memory", "browserGpuMemoryReason") as string).length === 0
  ) {
    issues.push(`${expected.id}: memory is estimated, omitted without reason, or malformed`);
  }
  return issues;
}

export function validateVrmSurfaceBrushBrowserEvidence(
  benchmark: unknown,
  diagnostics: VrmSurfaceBrushBrowserDiagnostics,
  productionAssets: readonly string[],
): readonly string[] {
  const issues: string[] = [];
  if (
    nested(benchmark, "schemaVersion") !== VRM_SURFACE_BRUSH_BROWSER_REPORT_SCHEMA_VERSION
    || nested(benchmark, "status") !== "ok"
    || nested(benchmark, "pass") !== true
    || nested(benchmark, "execution") !==
      "vite-production-build-chromium-real-three-bvh-vrm-atlas"
  ) {
    issues.push("browser did not produce passing real VRM surface-brush evidence");
  }
  issues.push(...bootstrapReceiptIssues(benchmark));
  const productPath = nested(benchmark, "workload", "productPath");
  if (
    !Array.isArray(productPath)
    || !productPath.includes("three-mesh-bvh-0.9.13")
    || !productPath.includes("StudioVrmSurfaceProjectionProvider")
    || !productPath.includes("executeSurfaceBrushStroke")
    || !productPath.includes("StudioVrmTexturePaintRuntime")
    || nested(benchmark, "workload", "mockProjectionProviderUsed") !== false
    || nested(benchmark, "workload", "hotPathGpuReadbacks") !== 0
  ) {
    issues.push("real provider chain or zero-readback receipt is incomplete");
  }
  const cases = nested(benchmark, "controlledCases");
  if (!Array.isArray(cases) || cases.length !== VRM_SURFACE_BRUSH_BROWSER_CASES.length) {
    issues.push("controlled case matrix is absent or reduced");
  } else {
    for (const [index, expected] of VRM_SURFACE_BRUSH_BROWSER_CASES.entries()) {
      issues.push(...controlledCaseIssues(cases[index], expected));
    }
  }
  if (
    nested(benchmark, "seamControl", "pass") !== true
    || nested(benchmark, "seamControl", "runs") !== 2
    || nested(benchmark, "seamControl", "seamBreaks") !== 1
    || nested(benchmark, "seamControl", "noInterpolatedBridge") !== true
  ) {
    issues.push("two-island seam control did not split the UV run without a bridge");
  }
  if (
    nested(benchmark, "cancellationControl", "pass") !== true
    || nested(benchmark, "cancellationControl", "changedTexelsAfterCancel") !== 0
    || nested(benchmark, "uploadRollbackControl", "pass") !== true
    || nested(benchmark, "uploadRollbackControl", "changedTexelsAfterRollback") !== 0
  ) {
    issues.push("cancellation or dirty-upload rollback retained pixels/history");
  }
  const realVrmChanged = nested(benchmark, "bundledVrmFixture", "changedTexels");
  const realVrmDigests = nested(benchmark, "bundledVrmFixture", "atlasDigests");
  if (
    nested(benchmark, "bundledVrmFixture", "pass") !== true
    || nested(benchmark, "bundledVrmFixture", "assetUrl") !== "/vrm/sample.vrm"
    || nested(benchmark, "bundledVrmFixture", "loader") !== "loadStudioVrmAsset"
    || nested(benchmark, "bundledVrmFixture", "bvhRuntimeVersion") !== "three-mesh-bvh-0.9.13"
    || nested(benchmark, "bundledVrmFixture", "deterministicByteEquality") !== true
    || !Array.isArray(realVrmChanged)
    || realVrmChanged.length !== 2
    || realVrmChanged.some((value) => (finite(value) ?? 0) <= 0)
    || !Array.isArray(realVrmDigests)
    || realVrmDigests.length !== 2
    || new Set(realVrmDigests).size !== 1
  ) {
    issues.push("bundled sample.vrm did not complete the real deterministic atlas commit path");
  }
  if (
    diagnostics.consoleErrors.length > 0
    || diagnostics.pageErrors.length > 0
    || diagnostics.requestFailures.length > 0
    || diagnostics.errorResponses.length > 0
    || !stringArray(nested(benchmark, "cspViolations"))
    || (nested(benchmark, "cspViolations") as string[]).length !== 0
  ) {
    issues.push("browser diagnostics contain runtime, network, or CSP failures");
  }
  if (
    !Array.isArray(diagnostics.successfulAssetResponseAborts)
    || diagnostics.successfulAssetResponseAborts.some((receipt) =>
      !/^(?:HEAD|GET) http:\/\/127\.0\.0\.1:\d+\/vrm\/sample\.vrm: HTTP 2\d\d then net::ERR_ABORTED$/u
        .test(receipt))
  ) {
    issues.push("successful sample.vrm response abort diagnostics are absent or misclassified");
  }
  if (
    !diagnostics.launchArgs.includes("--enable-precise-memory-info")
    || !diagnostics.launchArgs.includes("--use-angle=metal")
    || !strictCspIsExact(diagnostics.responseHeaders.contentSecurityPolicy)
    || diagnostics.responseHeaders.crossOriginOpenerPolicy !== "same-origin"
    || diagnostics.responseHeaders.crossOriginEmbedderPolicy !== "require-corp"
    || !productionAssets.some((asset) => asset.endsWith(".js"))
    || !productionAssets.includes("vrm/sample.vrm")
  ) {
    issues.push("production build, bundled VRM, CSP, isolation, or Chromium launch receipt is incomplete");
  }
  if (diagnostics.launchArgs.some(disablesJavascriptJit)) {
    issues.push("Chromium was launched with a JavaScript JIT-disabling flag");
  }
  return issues;
}

export function validateVrmSurfaceBrushBrowserArtifact(
  artifact: unknown,
): readonly string[] {
  const item = record(artifact);
  const issues: string[] = [];
  if (
    item?.schemaVersion !== VRM_SURFACE_BRUSH_BROWSER_REPORT_SCHEMA_VERSION
    || item.status !== "pass"
    || item.pass !== true
    || typeof item.generatedAt !== "string"
  ) {
    issues.push("top-level VRM surface-brush artifact schema/status is invalid");
  }
  const diagnostics = item?.diagnostics as VrmSurfaceBrushBrowserDiagnostics | undefined;
  const production = record(item?.productionBuild);
  if (!diagnostics || !Array.isArray(diagnostics.consoleErrors) || !Array.isArray(production?.assets)) {
    issues.push("top-level diagnostics or production build receipt is absent");
    return issues;
  }
  issues.push(...validateVrmSurfaceBrushBrowserEvidence(
    item?.benchmark,
    diagnostics,
    production.assets as string[],
  ));
  if (!Array.isArray(item.validationIssues) || item.validationIssues.length !== 0) {
    issues.push("artifact records unresolved validation issues");
  }
  return issues;
}

function findFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        rejectPort(new Error("failed to allocate preview port"));
        return;
      }
      const port = address.port;
      server.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

function walkFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const absolute = join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      return statSync(absolute).isDirectory()
        ? walkFiles(absolute, relative)
        : [relative];
    });
}

function createHtml(): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>VRM surface brush browser benchmark</title>",
    "</head>",
    "<body>",
    '<script type="module" src="/bootstrap.ts"></script>',
    "</body>",
    "</html>",
  ].join("");
}

function emptyDiagnostics(): VrmSurfaceBrushBrowserDiagnostics {
  return {
    browserVersion: "unavailable",
    launchArgs: CHROMIUM_ARGS,
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
    successfulAssetResponseAborts: [],
    errorResponses: [],
    responseHeaders: {
      contentSecurityPolicy: "",
      crossOriginOpenerPolicy: "",
      crossOriginEmbedderPolicy: "",
    },
  };
}

function observePage(
  page: Page,
  browserVersion: string,
): VrmSurfaceBrushBrowserDiagnostics {
  const diagnostics: {
    browserVersion: string;
    launchArgs: readonly string[];
    consoleErrors: string[];
    consoleWarnings: string[];
    pageErrors: string[];
    requestFailures: string[];
    successfulAssetResponseAborts: string[];
    errorResponses: string[];
    responseHeaders: VrmSurfaceBrushBrowserDiagnostics["responseHeaders"];
  } = {
    ...emptyDiagnostics(),
    browserVersion,
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
    successfulAssetResponseAborts: [],
    errorResponses: [],
  };
  const responseStatuses = new WeakMap<Request, number>();
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
    if (message.type() === "warning") diagnostics.consoleWarnings.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "unknown";
    const responseStatus = responseStatuses.get(request) ?? null;
    const isSuccessfulFixtureBodyAbort = errorText === "net::ERR_ABORTED"
      && (request.method() === "HEAD" || request.method() === "GET")
      && new URL(request.url()).pathname === "/vrm/sample.vrm"
      && responseStatus !== null
      && responseStatus >= 200
      && responseStatus < 300;
    if (isSuccessfulFixtureBodyAbort) {
      diagnostics.successfulAssetResponseAborts.push(
        `${request.method()} ${request.url()}: HTTP ${responseStatus} then ${errorText}`,
      );
      return;
    }
    diagnostics.requestFailures.push(
      `${request.method()} ${request.url()}: ${errorText}`,
    );
  });
  page.on("response", (response) => {
    responseStatuses.set(response.request(), response.status());
    if (response.status() >= 400) diagnostics.errorResponses.push(`${response.status()} ${response.url()}`);
  });
  return diagnostics;
}

async function waitForBenchmark(page: Page): Promise<unknown> {
  await page.waitForFunction(
    (key) => (window as unknown as Record<string, unknown>)[key] !== undefined,
    VRM_SURFACE_BRUSH_BROWSER_RESULT_GLOBAL,
    { timeout: RESULT_TIMEOUT_MS },
  );
  return page.evaluate(
    (key) => (window as unknown as Record<string, unknown>)[key],
    VRM_SURFACE_BRUSH_BROWSER_RESULT_GLOBAL,
  );
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function runVrmSurfaceBrushBrowserBenchmark(
  options: { scratchDirectory?: string; resultPath?: string } = {},
): Promise<VrmSurfaceBrushBrowserArtifact> {
  const scratch = options.scratchDirectory
    ?? mkdtempSync(join(tmpdir(), "toonspectrum-vrm-surface-brush-"));
  const sourcePath = join(scratch, "production-source");
  const distributionPath = join(scratch, "production-dist");
  mkdirSync(sourcePath, { recursive: true });
  mkdirSync(distributionPath, { recursive: true });
  const sourceDirectory = realpathSync(sourcePath);
  const distributionDirectory = realpathSync(distributionPath);
  writeFileSync(join(sourceDirectory, "index.html"), createHtml());
  writeFileSync(
    join(sourceDirectory, "bootstrap.ts"),
    [
      "// This dependency-free bootstrap must execute before the production graph.",
      "const root = globalThis;",
      `const receiptKey = ${JSON.stringify(VRM_SURFACE_BRUSH_BROWSER_BOOTSTRAP_RECEIPT_GLOBAL)};`,
      "const receipt = {",
      "  schemaVersion: 1,",
      "  order: [],",
      "  positiveControlViolations: [],",
      "  runtimeViolations: [],",
      "  positiveControlThrew: false,",
      "  captureChannel: 'runtime',",
      "  configRef: null,",
      "};",
      "root[receiptKey] = receipt;",
      "document.addEventListener('securitypolicyviolation', (event) => {",
      "  const target = receipt.captureChannel === 'positive-control'",
      "    ? receipt.positiveControlViolations",
      "    : receipt.runtimeViolations;",
      "  target.push(`${event.effectiveDirective}: ${event.blockedURI || 'inline'}`);",
      "});",
      "receipt.order.push('listener-installed');",
      "const zodConfig = root.__zod_globalConfig ??= {};",
      "zodConfig.jitless = true;",
      "receipt.configRef = zodConfig;",
      "receipt.order.push('zod-jitless-configured');",
      "receipt.captureChannel = 'positive-control';",
      "receipt.order.push('positive-control-started');",
      "try {",
      "  new Function('return 1')();",
      "} catch {",
      "  receipt.positiveControlThrew = true;",
      "  receipt.order.push('positive-control-blocked');",
      "}",
      "await new Promise((resolve) => setTimeout(resolve, 25));",
      "if (receipt.positiveControlViolations.length > 0) {",
      "  receipt.order.push('positive-control-observed');",
      "}",
      "receipt.captureChannel = 'runtime';",
      "receipt.order.push('entry-import-started');",
      'await import("./entry.ts");',
      "receipt.order.push('entry-import-complete');",
      "",
    ].join("\n"),
  );
  writeFileSync(join(sourceDirectory, "entry.ts"), `import ${JSON.stringify(PAGE_ALIAS)};\n`);
  await build({
    root: sourceDirectory,
    configFile: false,
    cacheDir: join(scratch, "vite-cache"),
    clearScreen: false,
    logLevel: "error",
    base: "/",
    resolve: {
      alias: [
        { find: PAGE_ALIAS, replacement: PAGE_ENTRY },
        { find: "@", replacement: ROOT },
      ],
    },
    build: {
      outDir: distributionDirectory,
      emptyOutDir: true,
      target: "es2022",
      minify: true,
      sourcemap: true,
      manifest: true,
    },
  });
  mkdirSync(join(distributionDirectory, "vrm"), { recursive: true });
  copyFileSync(BUNDLED_VRM_FIXTURE, join(distributionDirectory, "vrm/sample.vrm"));
  const assets = walkFiles(distributionDirectory);
  const port = await findFreePort();
  let previewServer: PreviewServer | null = null;
  let browser: Browser | null = null;
  let diagnostics: VrmSurfaceBrushBrowserDiagnostics;
  let benchmark: unknown;
  try {
    previewServer = await preview({
      root: sourceDirectory,
      configFile: false,
      clearScreen: false,
      logLevel: "error",
      build: { outDir: distributionDirectory },
      preview: {
        host: "127.0.0.1",
        port,
        strictPort: true,
        headers: {
          "Cache-Control": "no-store",
          "Content-Security-Policy": CONTENT_SECURITY_POLICY,
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      },
    });
    browser = await chromium.launch({ headless: true, args: [...CHROMIUM_ARGS] });
    const browserSession = await browser.newBrowserCDPSession();
    const commandLine = await browserSession.send("Browser.getBrowserCommandLine") as {
      arguments?: unknown;
    };
    await browserSession.detach();
    const actualLaunchArgs = stringArray(commandLine.arguments)
      ? commandLine.arguments
      : [];
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    diagnostics = observePage(page, browser.version());
    (diagnostics as { launchArgs: readonly string[] }).launchArgs = actualLaunchArgs;
    const response = await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: "load",
      timeout: 30_000,
    });
    (diagnostics as { responseHeaders: typeof diagnostics.responseHeaders }).responseHeaders = {
      contentSecurityPolicy: (await response?.headerValue("content-security-policy")) ?? "",
      crossOriginOpenerPolicy: (await response?.headerValue("cross-origin-opener-policy")) ?? "",
      crossOriginEmbedderPolicy: (await response?.headerValue("cross-origin-embedder-policy")) ?? "",
    };
    benchmark = await waitForBenchmark(page);
  } finally {
    await browser?.close().catch(() => undefined);
    await previewServer?.close().catch(() => undefined);
  }
  const validationIssues = validateVrmSurfaceBrushBrowserEvidence(
    benchmark,
    diagnostics,
    assets,
  );
  const artifact: VrmSurfaceBrushBrowserArtifact = {
    schemaVersion: VRM_SURFACE_BRUSH_BROWSER_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: validationIssues.length === 0 ? "pass" : "fail",
    pass: validationIssues.length === 0,
    benchmark,
    diagnostics,
    productionBuild: {
      mode: "vite-production-build",
      assets,
      scratchDirectory: scratch,
      bundledVrmFixture: "apps/web/public/vrm/sample.vrm",
    },
    validationIssues,
  };
  writeJson(options.resultPath ?? TRACKED_RESULT, artifact);
  return artifact;
}

async function main(): Promise<void> {
  const resultPath = process.env.TOONSPECTRUM_VRM_SURFACE_BRUSH_RESULT ?? TRACKED_RESULT;
  try {
    const artifact = await runVrmSurfaceBrushBrowserBenchmark({ resultPath });
    console.log(JSON.stringify({
      status: artifact.status,
      pass: artifact.pass,
      result: resultPath,
      browser: nested(artifact.benchmark, "browser"),
      controlledCases: nested(artifact.benchmark, "controlledCases"),
      seamControl: nested(artifact.benchmark, "seamControl"),
      cancellationControl: nested(artifact.benchmark, "cancellationControl"),
      uploadRollbackControl: nested(artifact.benchmark, "uploadRollbackControl"),
      bundledVrmFixture: nested(artifact.benchmark, "bundledVrmFixture"),
      validationIssues: artifact.validationIssues,
    }, null, 2));
    process.exitCode = artifact.pass ? 0 : 1;
  } catch (error) {
    const failure: VrmSurfaceBrushBrowserArtifact = {
      schemaVersion: VRM_SURFACE_BRUSH_BROWSER_REPORT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      status: "fail",
      pass: false,
      benchmark: {
        schemaVersion: VRM_SURFACE_BRUSH_BROWSER_REPORT_SCHEMA_VERSION,
        status: "error",
        pass: false,
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack ?? null }
          : { name: "NonError", message: String(error) },
      },
      diagnostics: emptyDiagnostics(),
      productionBuild: {
        mode: "vite-production-build",
        assets: [],
        scratchDirectory: "unavailable",
        bundledVrmFixture: "apps/web/public/vrm/sample.vrm",
      },
      validationIssues: ["benchmark orchestrator failed"],
    };
    writeJson(resultPath, failure);
    console.error(error);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) void main();
