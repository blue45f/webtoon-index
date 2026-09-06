import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const bundleCheckSource = readFileSync(
  new URL("../../../../../scripts/check-studio-bundle.mjs", import.meta.url),
  "utf8",
);
const pageOrchestrationBoundarySource = readFileSync(
  new URL("./studio-page-orchestration-boundary.test.ts", import.meta.url),
  "utf8",
);
const viteConfigSource = readFileSync(
  new URL("../../../vite.config.ts", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string): string {
  const startIndex = bundleCheckSource.indexOf(start);
  const endIndex = bundleCheckSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return bundleCheckSource.slice(startIndex, endIndex);
}

describe("Studio quality-first build-size policy", () => {
  it("keeps bundle bytes and request counts as observations rather than release vetoes", () => {
    expect(bundleCheckSource).toContain(
      "bundle bytes and static request counts are",
    );
    expect(bundleCheckSource).toContain(
      "telemetry, not release vetoes",
    );

    const byteBudgetBlock = sourceBetween(
      "function checkBudget(",
      "function observeCount(",
    );
    const requestCountBlock = sourceBetween(
      "function observeCount(",
      "function matchingEntries(",
    );

    expect(byteBudgetBlock).toContain("bundleObservations.push(");
    expect(requestCountBlock).toContain("bundleObservations.push(");
    expect(byteBudgetBlock).not.toContain("fail(");
    expect(requestCountBlock).not.toContain("fail(");
  });

  it("does not reintroduce an arbitrary StudioPage source-byte ceiling", () => {
    expect(pageOrchestrationBoundarySource).not.toMatch(
      /Buffer\.byteLength\(studioPageSource[\s\S]*?toBeLessThan/u,
    );
    expect(pageOrchestrationBoundarySource).toContain(
      "engine-quality work fail",
    );
  });

  it("retains structural runtime boundaries even while size growth is allowed", () => {
    expect(bundleCheckSource).toContain(
      "engine isolation and accidental eager-boundary regressions",
    );
    expect(bundleCheckSource).toContain(
      "function checkDynamicBoundary(",
    );
    expect(bundleCheckSource).toContain(
      "returned to the Studio static graph",
    );
  });

  it("allows Babylon only through one exact lazy specialist boundary", () => {
    expect(bundleCheckSource).toContain(
      '"apps/web/src/domains/creator/bg3d/studio-bg3d-babylon-specialist-entry.ts"',
    );
    expect(bundleCheckSource).toContain(
      "const babylonManifestPattern = /(?:@babylonjs|babylon(?:\\.js)?)/i",
    );
    expect(bundleCheckSource).toContain(
      'const approvedBabylonRuntimeChunkName = "studio-bg3d-babylon-runtime"',
    );
    expect(viteConfigSource).toContain('id.includes("/node_modules/@babylonjs/")');
    expect(viteConfigSource).toContain(
      'id.includes("/node_modules/babylonjs-gltf2interface/")',
    );
    expect(viteConfigSource).toContain(
      'return "studio-bg3d-babylon-runtime"',
    );

    const specialistBoundaryBlock = sourceBetween(
      "function checkApprovedLazySpecialistBoundary(",
      "try {",
    );
    expect(specialistBoundaryBlock).toContain("if (matching.length === 0) {");
    expect(specialistBoundaryBlock).toContain(
      "production activation is missing its approved emitted entry/runtime chunk",
    );
    expect(specialistBoundaryBlock).toContain("fail(");
    expect(specialistBoundaryBlock).toContain("approvedEntries.length !== 1");
    expect(specialistBoundaryBlock).toContain("approvedEntry.isDynamicEntry !== true");
    expect(specialistBoundaryBlock).toContain("runtimeChunks.length !== 1");
    expect(specialistBoundaryBlock).toContain("forbiddenStaticClosures");
    expect(specialistBoundaryBlock).toContain("outsideApprovedClosure");
    expect(specialistBoundaryBlock).toContain("staticOwnersOutsideApprovedClosure");
    // The guard used to be "exactly one direct dynamic importer". That count stopped standing for
    // the property once the editor gained a second legitimate call site (a thumbnail job borrowing
    // the live renderer), which the count cannot tell apart from an unrelated feature dragging in a
    // whole second renderer graph. Ownership is asserted by reachability instead, and the one-hop
    // rule below still forbids a nested waterfall.
    expect(specialistBoundaryBlock).toContain("foreignDynamicImporters");
    expect(specialistBoundaryBlock).toContain("reachableClosure(approvedParentEntryKey)");
    expect(specialistBoundaryBlock).toContain(
      "dynamicTargetsFromStaticClosure(approvedParentEntryKey).has(approvedEntryKey)",
    );

    const engineBoundaryCall = sourceBetween(
      "const emittedUnapprovedProductionEngineLabs",
      "const pngWorkerFiles",
    );
    expect(engineBoundaryCall).toContain("checkApprovedLazySpecialistBoundary({");
    expect(engineBoundaryCall).toContain(
      "approvedEntrySource: approvedBabylonSpecialistEntry",
    );
    expect(engineBoundaryCall).toContain(
      "requiredRuntimeChunkName: approvedBabylonRuntimeChunkName",
    );
    expect(engineBoundaryCall).toContain(
      '["BG3D editor activation", background3dKeys]',
    );
  });
});
