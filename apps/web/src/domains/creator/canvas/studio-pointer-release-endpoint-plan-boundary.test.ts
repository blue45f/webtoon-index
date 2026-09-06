import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

interface ModuleFacts {
  imports: string[];
  source: string;
}

function moduleFacts(fileName: string): ModuleFacts {
  const fileUrl = new URL(fileName, import.meta.url);
  const rawSource = readFileSync(fileUrl, "utf8");
  const source = fileName.endsWith("StudioPage.tsx") || fileName.endsWith("StudioCuttoonEditorHost.tsx")
    ? readStudioCuttoonEditorSource()
    : rawSource;
  const file = ts.createSourceFile(
    fileUrl.pathname,
    rawSource,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const imports: string[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
  }
  return { imports, source };
}

function expectTokenOrder(value: string, tokens: readonly string[]): void {
  let cursor = -1;
  for (const token of tokens) {
    const index = value.indexOf(token, cursor + 1);
    expect(index, `missing or out-of-order token: ${token}`).toBeGreaterThan(cursor);
    cursor = index;
  }
}

describe("studio pointer-release endpoint planning ownership boundary", () => {
  it("keeps endpoint and aligned-channel decisions browser-, renderer-, and state-free", () => {
    const planner = moduleFacts("./studio-pointer-release-endpoint-plan.ts");

    expect(planner.imports).toEqual([
      "../brush/studio-brush-dynamics",
      "../brush/studio-brush-velocity-pressure",
      "../brush/studio-ink-pressure-model",
      "../studio-brush",
      "../studio-persisted-pointer-channels",
      "../studio-element-model",
      "@/shared/lib/studio-ink-input-contract",
    ]);
    expect(planner.source).not.toMatch(/from\s+["'](?:react|konva|react-konva)/u);
    expect(planner.source).not.toMatch(
      /\b(?:window|document|globalThis|PointerEvent|MouseEvent|TouchEvent|CanvasRenderingContext2D)\b/u
    );
    for (const pageOwnedAction of [
      "drawingRef",
      "drawingStabilizerRef",
      "studioCrdt",
      "appendStrokeSamples(",
      "commit(",
      "setState(",
      "draftPreviewStoreRef",
      "liveInkOverlayRendererRef",
      "webGpuCanvasHandleRef",
    ]) {
      expect(planner.source).not.toContain(pageOwnedAction);
    }
    expect(planner.source.split("\n").length).toBeLessThanOrEqual(210);
  });

  it("leaves stabilizer ownership, ref replacement, CRDT publication, and finalization in StudioPage", () => {
    const page = moduleFacts("../StudioCuttoonEditorHost.tsx").source;
    const sealStart = page.indexOf("function sealStudioDrawReleaseInput");
    const sealEnd = page.indexOf("function finishStudioSpecialistStroke", sealStart);
    const sealInput = page.slice(sealStart, sealEnd);
    const start = page.indexOf("function finishDrawingPointer");
    const end = page.indexOf("function onStagePointerCancel", start);
    const finish = page.slice(start, end);

    expect(page).toMatch(/from ["'].*canvas\/studio-pointer-release-endpoint-plan["']/);
    expect(sealStart).toBeGreaterThan(-1);
    expect(sealEnd).toBeGreaterThan(sealStart);
    expect(sealInput).toContain("planStudioPointerReleaseEndpoint({");
    expect(sealInput).not.toContain("const appendAligned =");
    expect(sealInput).not.toContain("const capturePointerDynamics =");
    expect(sealInput).not.toContain("const tangentialPressure =");

    expectTokenOrder(sealInput, [
      "flushStudioStrokeStabilizerEndpoint(liveState)",
      "drawingStabilizerRef.current = flushed.state",
      "const endpointPlan = planStudioPointerReleaseEndpoint({",
      "if (endpointPlan.appended) drawingRef.current = endpointPlan.stroke",
      "appendDrawingCrdtSampleSuffix(drawingRef.current, crdtReleaseSampleStart)",
      "appendStudioLivingInkAuthoritativeSuffix(",
      "appendStudioHokusaiAuthoritativeSuffix(",
      "authoritativeLiveStroke = drawingRef.current",
      "flushDirectLiveDraftNow(authoritativeLiveStroke)",
      "drawingCrdtPublisherRef.current.flush(authoritativeLiveStroke.id)",
    ]);
    expectTokenOrder(finish, [
      "authoritativeLiveStroke = sealStudioDrawReleaseInput(",
      "planStudioDrawPointerRelease({",
      "const finished = releasePlan.stroke",
      "finishStudioSpecialistStroke(finished)",
      "const committed = commit([...baseElements, finished])",
      "finally {",
      "releaseDrawingPointerSession()",
    ]);
  });
});
