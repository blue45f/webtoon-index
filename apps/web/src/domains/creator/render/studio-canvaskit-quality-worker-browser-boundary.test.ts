import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const browserEntry = readFileSync(
  resolve(root, "scripts/studio-canvaskit-quality-worker-browser.ts"),
  "utf8",
);
const verifier = readFileSync(
  resolve(root, "scripts/verify-studio-canvaskit-quality-worker.mjs"),
  "utf8",
);

describe("Studio CanvasKit real module Worker/WASM browser boundary", () => {
  it("uses the production client and production module Worker without a fake provider", () => {
    expect(browserEntry).toContain("new StudioQualityWorkerClient");
    expect(browserEntry).toContain("createStudioQualityModuleWorker");
    expect(browserEntry).toContain('createdBy: "createStudioQualityModuleWorker"');
    expect(browserEntry).not.toContain("createStudioQualityWorkerRuntime");
    expect(browserEntry).not.toContain("createStudioCanvasKitQualityEngine");
    expect(browserEntry).not.toContain("FakeWorker");
    expect(browserEntry).not.toContain("mockProvider");
    expect(verifier).toContain(
      'const HARNESS_ENTRY = "/scripts/studio-canvaskit-quality-worker-browser.ts";',
    );
    expect(verifier).toContain('appType: "custom"');
  });

  it("covers all four PathOps and stroke-to-fill with independent Path2D semantics", () => {
    for (const operation of ["union", "intersect", "difference", "xor"]) {
      expect(browserEntry).toContain(`"${operation}"`);
      expect(verifier).toContain(`"${operation}"`);
    }
    expect(browserEntry).toContain("client.pathBoolean");
    expect(browserEntry).toContain("client.strokeToFill");
    expect(browserEntry).toContain("new Path2D(pathData)");
    expect(browserEntry).toContain("context.isPointInPath");
    expect(verifier).toContain("Path2D semantic samples");
  });

  it("requires byte-exact same-input determinism and structured-clone-only messages", () => {
    expect(browserEntry).toContain("booleanSameInputExactPathData");
    expect(browserEntry).toContain("strokeSameInputExactPathData");
    expect(browserEntry).toContain("structuredClone(value)");
    expect(browserEntry).toContain("non-plain prototype");
    expect(browserEntry).toContain("forbiddenKeys");
    expect(verifier).toContain("identical path/stroke inputs were not byte-for-byte deterministic");
    expect(verifier).toContain("structuredCloneRoundTrips");
    expect(verifier).toContain("jsonRoundTrips");
  });

  it("proves malformed payload, input budget, and cancellation fail closed", () => {
    expect(browserEntry).toContain('unexpectedField: "must-fail-closed"');
    expect(browserEntry).toContain("maxInputPathCodeUnits");
    expect(browserEntry).toContain("new AbortController()");
    expect(browserEntry).toContain("preAbortedWorkerPostDelta");
    expect(browserEntry).toContain("cancelMessagePosted");
    expect(browserEntry).toContain("resultDeliveredToCaller: false");
    expect(verifier).toContain('fatalCode !== "invalid-message"');
    expect(verifier).toContain('error?.code !== "invalid-input"');
    expect(verifier).toContain('inFlightError?.code !== "aborted"');
    expect(verifier).toContain("recoveryProviderId");
  });

  it("enforces Worker/WASM CSP and captures every relevant browser error channel", () => {
    expect(verifier).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(verifier).toContain("worker-src 'self' blob:");
    expect(verifier).toContain("connect-src 'self'");
    expect(browserEntry).toContain('addEventListener("error"');
    expect(browserEntry).toContain('addEventListener("messageerror"');
    expect(browserEntry).toContain('addEventListener("securitypolicyviolation"');
    expect(verifier).toContain('page.on("console"');
    expect(verifier).toContain('page.on("pageerror"');
    expect(verifier).toContain('page.on("requestfailed"');
    expect(verifier).toContain('page.on("worker"');
  });

  it("requires observed module Worker and CanvasKit WASM requests and saves durable evidence", () => {
    expect(verifier).toContain("isCanvasKitWasmUrl");
    expect(verifier).toContain("isQualityWorkerUrl");
    expect(verifier).toContain("no real CanvasKit WASM network load was observed");
    expect(verifier).toContain("no real module Worker script load was observed");
    expect(verifier).toContain('writeJson("browser-result.json"');
    expect(verifier).toContain('writeJson("observations.json"');
    expect(verifier).toContain('writeJson("summary.json"');
    expect(verifier).toContain('"pathops-and-stroke.svg"');
    expect(verifier).toContain('process.exitCode = 2');
  });
});
