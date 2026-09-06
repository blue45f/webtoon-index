import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";

const pageUrl = new URL("./StudioCuttoonEditorHost.tsx", import.meta.url);
const previewUrl = new URL("./studio-advanced-fill-preview.ts", import.meta.url);
const source = readFileSync(pageUrl, "utf8");
const viewportSource = readStudioCanvasViewportStack(import.meta.url, "./canvas/");
const previewSource = readFileSync(previewUrl, "utf8");
const file = ts.createSourceFile(
  pageUrl.pathname,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function nestedFunction(name: string): string {
  let match: ts.FunctionDeclaration | null = null;
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!match) throw new Error(`Missing nested function ${name}`);
  return (match as ts.FunctionDeclaration).getText(file);
}

describe("Studio vector line-art advanced fill entry boundary", () => {
  it("plans from the latest page snapshot and never mutates while arming", () => {
    const input = nestedFunction("currentAdvancedFillVectorInput");
    const toggle = nestedFunction("toggleAdvancedFill");

    expect(input).toContain("pagesHistoryRef.current");
    expect(input).toContain("pagesHiRef.current");
    expect(input).toContain("currentPageIdRef.current");
    expect(input).toContain("currentStudioVectorReferenceBudgets()");
    expect(toggle).toContain("flushPendingStrokeCommitsRef.current()");
    expect(toggle).toContain("resolveStudioAdvancedFillEntry({");
    expect(toggle).toContain("vectorInput: currentAdvancedFillVectorInput()");
    expect(toggle).toContain('entry.mode === "virtual-vector-fill"');
    expect(toggle).toContain("setAdvancedFillVirtualTarget(entry.target)");
    expect(toggle).toContain("advancedFillAutoArmTargetRef.current = {");
    expect(toggle).toContain("virtualTarget: entry.target");
    expect(toggle).not.toContain("planStudioAdvancedFillVectorTarget(");
    expect(toggle).not.toContain("commit(");
    expect(toggle).not.toContain("patchEl(");
  });

  it("rasterizes visible vectors through the abortable reference seam before filling", () => {
    const run = nestedFunction("runAdvancedFillAt");

    expect(run).toContain("advancedFillVirtualReferenceRef.current");
    expect(run).toContain("renderStudioAdvancedFillVectorReference(vectorInput");
    expect(run.match(/rasterExecutionBackend: "offscreen-worker"/gu)).toHaveLength(2);
    expect(run).toContain("signal: controller.signal");
    expect(run).toContain("renderedReference.fingerprint !== vectorTarget.sourceFingerprint");
    expect(run).toContain("referenceSrc = renderedReference.dataUrl");
    expect(run).toContain("runStudioAdvancedFillInBrowser({");
    expect(run).toContain("pagesHiRef.current !== historyIndex");
    expect(run).toContain("canApplyStudioMutation(mutationTicket)");
    expect(run).toContain("currentPlan.target.sourceFingerprint !== vectorTarget.sourceFingerprint");
    expect(run).toContain("virtualTarget: vectorTarget");
  });

  it("includes the same visible vector reference when filling an existing raster target", () => {
    const run = nestedFunction("runAdvancedFillAt");

    expect(run).toContain("renderStudioAdvancedFillVectorReference(vectorInput");
    expect(run).toContain("composeStudioFillReferenceImageWithPageReferences(");
    expect(run).toContain("pageWidth: vectorInput.width");
    expect(run).toContain("pageHeight: vectorInput.height");
    expect(run).toContain("fillReference: true");
  });

  it("keeps preview paint-only and applies exactly one image layer in one history commit", () => {
    const apply = nestedFunction("applyAdvancedFillPreview");
    const cancel = nestedFunction("cancelAdvancedFillPreview");
    const renderStart = viewportSource.indexOf("const canvasRenderElements: El[] =");
    const renderEnd = viewportSource.indexOf("const timelineComposite =", renderStart);
    const paintProjection = viewportSource.slice(renderStart, renderEnd);
    const renderEl = viewportSource.slice(
      viewportSource.indexOf("const renderEl =", renderEnd),
      viewportSource.indexOf("// 문서 마스터 밑그림", renderEnd),
    );

    expect(previewSource).toContain("virtualTarget?: StudioAdvancedFillVirtualTarget");
    expect(paintProjection).toContain("materializeStudioAdvancedFillVectorTarget(");
    expect(paintProjection).toContain("canvasRenderElements.splice(insertionIndex, 0, virtualFillPreviewElement)");
    expect(renderEl).toContain("isAdvancedFillVirtualPreview");
    expect(renderEl).toContain("const isNonInteractiveRender =");
    expect(renderEl).toMatch(
      /opts\.asMask === true\s*\|\|\s*isAdvancedFillVirtualPreview/u,
    );
    expect(renderEl).not.toContain(
      "opts.asMask || isAdvancedFillVirtualPreview",
    );
    expect(renderEl).toContain("const wrapRenderInteraction =");
    expect(renderEl).toMatch(
      /isNonInteractiveRender\s*\?\s*\(\s*<Group[\s\S]*?listening=\{false\}/u,
    );
    expect(renderEl).toContain(
      '{tool === "select" && !isNonInteractiveRender ? (',
    );

    expect(apply).toContain("planStudioAdvancedFillVectorTarget(vectorInput)");
    expect(apply).toContain("materializeStudioAdvancedFillVectorTarget(currentPlan.target, preview.resultSrc)");
    expect(apply).toContain("nextElements.splice(currentPlan.target.insertionIndex, 0, materialized)");
    expect(apply.match(/\bcommit\(/gu)).toHaveLength(1);
    expect(apply).toContain("if (!commit(nextElements)) return");
    expect(cancel).not.toContain("commit(");
    expect(cancel).not.toContain("patchEl(");
  });
});
