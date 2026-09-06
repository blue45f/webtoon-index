import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const studioPageSource = readStudioCuttoonEditorSource();

function sourceBetween(start: string, end: string): string {
  const startIndex = studioPageSource.indexOf(start);
  const endIndex = studioPageSource.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing StudioPage boundary start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing StudioPage boundary end: ${end}`).toBeGreaterThan(startIndex);
  return studioPageSource.slice(startIndex, endIndex);
}

describe("StudioPage lazy precision stabilizer product boundary", () => {
  it("owns one stroke-scoped bridge and activates it only for positive precision mode", () => {
    expect(studioPageSource).toContain("createStudioStrokeStabilizerBridge,");
    expect(studioPageSource).toContain(
      "useRef<StudioStrokeStabilizerBridge | null>(null)"
    );

    const pointerStart = sourceBetween(
      "function onStageDown(",
      "function appendFreehandStrokePoint("
    );
    expect(pointerStart).toMatch(
      /drawingStabilizerRef\.current[\s\S]*drawingFixedRateFilterRef\.current === null[\s\S]*stabilizerMode === "precision"[\s\S]*stabilizer > 0/u
    );
    expect(pointerStart).toContain("useLazyPrecision: true");
    expect(pointerStart).toContain('lazyPointerPolicy: "all"');
    expect(pointerStart).toContain("drawingPrecisionStabilizerBridgeRef.current = bridge");
  });

  it("commits real samples but previews predictions without advancing authoritative state", () => {
    const append = sourceBetween(
      "function appendFreehandStrokePoint(",
      "function publishAuthoritativeFreehandSuffix("
    );
    const fixedRateExit = append.indexOf("if (fixedRateState)");
    const bridgeDispatch = append.indexOf("const precisionBridgeOptions");

    expect(fixedRateExit).toBeGreaterThanOrEqual(0);
    expect(bridgeDispatch).toBeGreaterThan(fixedRateExit);
    expect(append).toMatch(
      /drawingPredictionPreviewRef\.current\s*\?\s*precisionBridge\.preview\([\s\S]*:\s*precisionBridge\.commit\(/u
    );
    expect(append).toMatch(
      /if \(!drawingPredictionPreviewRef\.current\) \{\s*drawingStabilizerRef\.current = stabilized\.state;\s*\}/u
    );
    expect(append).toContain("stabilizeStudioStrokeSample(");
    expect(append).toMatch(
      /strokeStabilizerMode === "precision"\s*&& strokeStabilizerStrength > 0/u
    );
  });

  it("flushes on release and resets the mutable provider through shared cleanup", () => {
    const releaseInput = sourceBetween(
      "function sealStudioDrawReleaseInput(",
      "function finishStudioSpecialistStroke("
    );
    expect(releaseInput).toMatch(
      /drawingPrecisionStabilizerBridgeRef\.current\?\.flush\(\)\s*\?\? \(liveState \? flushStudioStrokeStabilizerEndpoint\(liveState\) : null\)/u
    );
    expect(releaseInput.indexOf("drawingPrecisionStabilizerBridgeRef.current?.flush()"))
      .toBeLessThan(releaseInput.indexOf("drawingStabilizerRef.current = flushed.state"));
    expect(releaseInput.indexOf("drawingStabilizerRef.current = flushed.state"))
      .toBeLessThan(releaseInput.indexOf("appendDrawingCrdtSampleSuffix("));

    const finish = sourceBetween(
      "function finishDrawingPointer(",
      "function onStagePointerCancel("
    );
    expect(finish.indexOf("authoritativeLiveStroke = sealStudioDrawReleaseInput("))
      .toBeLessThan(finish.indexOf("planStudioDrawPointerRelease({"));
    expect(finish.indexOf("planStudioDrawPointerRelease({"))
      .toBeLessThan(finish.indexOf("finally {"));

    const release = sourceBetween(
      "function releaseDrawingPointerSession()",
      "function discardDrawingPointerSession()"
    );
    expect(release).toContain(
      "drawingPrecisionStabilizerBridgeRef.current?.reset()"
    );
    expect(release).toContain(
      "drawingPrecisionStabilizerBridgeRef.current = null"
    );

    const discard = sourceBetween(
      "function discardDrawingPointerSession()",
      "function hasActiveDrawingPointerSession()"
    );
    expect(discard).toContain("releaseDrawingPointerSession()");
    expect(studioPageSource).toContain("cleanupDrawing: () => drawingUnmountCleanupRef.current()");
  });
});
