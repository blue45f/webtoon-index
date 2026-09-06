import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

const selectionSource = source("./studio-bg3d-engine-selection.ts");
const runtimeSource = source("./useStudioBg3dEngineRuntime.ts");
const viewportSource = source("./StudioBg3dEditorViewport.tsx");
const insertSource = source("./studio-bg3d-editor-insert-host.ts");
const magicSource = source("./studio-bg3d-magic-object-id-capture.ts");

describe("BG3D no-forced-fallback wiring", () => {
  it("has no automatic preference, fallback backend, or failure-count demotion contract", () => {
    expect(selectionSource).toContain("export type StudioBg3dEnginePreference = StudioBg3dEngineBackend");
    expect(selectionSource).toContain("Legacy `auto` and unknown persisted values migrate");
    expect(selectionSource).not.toContain("fallbackBackend");
    expect(selectionSource).not.toContain("recordStudioBg3dWebGpuFailure");
    expect(selectionSource).not.toContain("STUDIO_BG3D_WEBGPU_FAILURE_LIMIT");
    expect(selectionSource).toContain(
      'return plan(selected.backend, "runtime-capability-unavailable", "unavailable"',
    );
    expect(runtimeSource).not.toContain("webgpuFailureCount");
    expect(runtimeSource).not.toContain("WebGL2로 전환");
  });

  it("mounts Canvas only after the selected plan is available", () => {
    const gateStart = viewportSource.indexOf('engineRuntime.phase === "probing"');
    const canvasStart = viewportSource.indexOf("<Canvas", gateStart);
    const canvasEnd = viewportSource.indexOf("</Canvas>", canvasStart);
    const gate = viewportSource.slice(gateStart, canvasEnd + "</Canvas>".length + 100);
    expect(gateStart).toBeGreaterThan(0);
    expect(canvasStart).toBeGreaterThan(gateStart);
    expect(gate).toContain('engineRuntime.plan.status !== "available"');
    expect(gate).toContain('role="alert"');
    expect(gate).toContain('data-testid="studio-bg3d-engine-unavailable"');
    expect(gate).toContain("자동으로 다른 엔진을 실행하지 않습니다");
  });

  it("binds shipped Magic capture to exactly the explicit BG3D preference", () => {
    const choiceStart = insertSource.indexOf("const magicBackends:");
    const captureStart = insertSource.indexOf("captureStudioBg3dMagicObjectIds({", choiceStart);
    const choice = insertSource.slice(choiceStart, captureStart);
    expect(choiceStart).toBeGreaterThan(0);
    expect(choice).toContain("engineRuntime.preference");
    expect(choice).not.toContain("navigator");
    expect(choice).not.toContain('["webgpu", "webgl2"]');
    expect(magicSource).toContain("backends.length !== 1");
  });

  it("withdraws the WebGPU factory after the explicit selection fails", () => {
    expect(runtimeSource).toContain('plan.status !== "available"');
    expect(runtimeSource).toContain("setWebgpuRuntimeFailed(true)");
    expect(selectionSource).toContain('hardBlocks.includes("webgpu-runtime-failed")');
  });
});
