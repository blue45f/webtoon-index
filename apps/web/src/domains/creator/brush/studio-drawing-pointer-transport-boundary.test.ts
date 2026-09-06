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
    ts.ScriptKind.TS
  );
  const imports: string[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
  }
  return { imports, source };
}

describe("studio drawing pointer transport ownership boundary", () => {
  it("keeps the imperative transport React-, Konva-, CRDT-, and document-model-free", () => {
    const transport = moduleFacts("./studio-drawing-pointer-transport.ts");

    expect(transport.imports).toEqual(["../canvas/studio-pointer-input"]);
    expect(transport.source).not.toMatch(/from\s+["'](?:react|konva|react-konva)["']/u);
    for (const domainOwner of [
      "finishDrawingPointer",
      "studioCrdtDocumentRef",
      "pendingStrokeCommitsRef",
      "scheduleDraft(",
      "beginLiveResourceEdit",
      "endLiveResourceEdit",
      "DrawEl",
    ]) {
      expect(transport.source).not.toContain(domainOwner);
    }
  });

  it("moves drawing session, capture, safety listeners, and native-end dedupe out of StudioPage", () => {
    const transport = moduleFacts("./studio-drawing-pointer-transport.ts").source;
    const page = moduleFacts("../StudioCuttoonEditorHost.tsx").source;

    expect(page).toContain('from "./brush/studio-drawing-pointer-transport"');
    for (const formerPageOwner of [
      "drawingPointerSessionRef",
      "drawingPointerCaptureTargetRef",
      "drawingPointerSafetyCleanupRef",
      "drawingPointerGlobalEndRef",
      "drawingPointerGlobalMoveRef",
      "drawingPointerGlobalCancelRef",
      "drawingHandledNativeEndEventsRef",
      "resolveDrawingPointerCaptureTarget",
      "attachDrawingPointerSafetyListeners",
    ]) {
      expect(page).not.toContain(formerPageOwner);
    }

    for (const transportOwner of [
      "class StudioDrawingPointerTransportController",
      "resolveStudioDrawingPointerCaptureTarget",
      "handledNativeEndEvents",
      'add(windowTarget, "pointermove"',
      'add(windowTarget, "pointerrawupdate"',
      'add(windowTarget, "pointerup"',
      'add(windowTarget, "pointercancel"',
      'add(captureTarget as StudioDrawingPointerEventTarget, "lostpointercapture"',
      "tryCaptureStudioStrokePointer",
      "tryReleaseStudioStrokePointer",
    ]) {
      expect(transport).toContain(transportOwner);
    }
  });

  it("leaves Stage facades and the full finish/CRDT/draft/pending/lease coordinator in the Page", () => {
    const page = moduleFacts("../StudioCuttoonEditorHost.tsx").source;

    for (const pageOwner of [
      "function onStageDown",
      "function onStageMove",
      "function onStagePointerCancel",
      "function onStageUp",
      "function finishDrawingPointer",
      "crdtDocument.beginStroke(",
      "crdtDocument.appendStrokeSamples(",
      "studioCrdtDocumentRef.current?.deleteStroke(",
      "scheduleDraft(",
      "pendingStrokeCommitsRef.current",
      "beginLiveResourceEdit(",
      "endLiveResourceEdit()",
    ]) {
      expect(page).toContain(pageOwner);
    }

    expect(page).toContain("requireStudioDrawingPointerTransport(drawingPointerTransportRef).start({");
    expect(page).toContain("requireStudioDrawingPointerTransport(drawingPointerTransportRef).updatePorts({");
    expect(page).toContain(
      "requireStudioDrawingPointerTransport(drawingPointerTransportRef).consumeHandledNativeEnd(pointerEvent)"
    );
    expect(page).toContain("requireStudioDrawingPointerTransport(drawingPointerTransportRef).release()");
    expect(page).toContain("requireStudioDrawingPointerTransport(drawingPointerTransportRef).dispose()");
  });

  it("restores the authoritative fixed-rate clock after previewing future pen samples", () => {
    const page = moduleFacts("../StudioCuttoonEditorHost.tsx").source;
    const predictionStart = page.indexOf("const authoritativePerspectiveRay =");
    const predictionEnd = page.indexOf("drawingVelocityRef.current = authoritativeVelocity", predictionStart);
    const predictionBlock = page.slice(predictionStart, predictionEnd);

    expect(predictionStart).toBeGreaterThan(-1);
    expect(predictionBlock).toContain(
      "const authoritativeFixedRateFilter = drawingFixedRateFilterRef.current"
    );
    expect(predictionBlock).toContain(
      "liveDraftDirectRef.current && predictedInkTailStateRef.current"
    );
    expect(predictionBlock).toContain("planStudioPredictedInkSuffixDraft({");
    expect(predictionBlock).toContain(
      "suffixDraftCandidate?.authoritativeSampleCount === authoritativePointCount"
    );
    expect(predictionBlock).toContain(
      "replacePredictedInkTail(predictedPreview, predictionStartSampleIndex)"
    );
    expect(predictionBlock).toContain("for (const sample of batch.predicted)");
    expect(predictionBlock).toContain(
      "drawingFixedRateFilterRef.current = authoritativeFixedRateFilter"
    );
    expect(predictionBlock.indexOf("const authoritativeFixedRateFilter")).toBeLessThan(
      predictionBlock.indexOf("for (const sample of batch.predicted)")
    );
    expect(predictionBlock.indexOf("for (const sample of batch.predicted)")).toBeLessThan(
      predictionBlock.indexOf("drawingFixedRateFilterRef.current = authoritativeFixedRateFilter")
    );
  });
});
