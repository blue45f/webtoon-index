import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const documentLayerSource = readFileSync(
  new URL("./StudioCanvasViewportDocumentLayer.tsx", import.meta.url),
  "utf8",
);
const interactionSource = readFileSync(
  new URL("./studio-canvas-viewport-interaction.ts", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, startToken: string, endToken: string): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Studio canvas mask hit isolation boundary", () => {
  it("wraps every render-as-mask clone in a non-listening Konva ancestor", () => {
    const renderElement = sourceBetween(
      documentLayerSource,
      "const renderEl = (el: El",
      "// 문서 마스터 밑그림",
    );

    expect(renderElement).toContain("const isNonInteractiveRender =");
    expect(renderElement).toMatch(
      /opts\.asMask === true[\s\S]*?\|\|\s*isAdvancedFillVirtualPreview/u,
    );
    expect(renderElement).toContain("const wrapRenderInteraction =");
    expect(renderElement).toMatch(
      /isNonInteractiveRender\s*\?\s*\(\s*<Group[\s\S]*?listening=\{false\}/u,
    );
    expect(renderElement).toContain(
      "return wrapRenderInteraction(clippedNode)",
    );
    expect(renderElement).toMatch(
      /if \(el\.type === "frame"\) \{\s*return wrapRenderInteraction\(/u,
    );
    expect(renderElement).toContain("!isNonInteractiveRender &&");
    expect(renderElement).toContain(
      "const onSelect = isNonInteractiveRender",
    );
    expect(renderElement).toContain(
      "const setRef = isNonInteractiveRender",
    );
  });

  it("does not create the select-only draw hit Shape for a mask clone", () => {
    const drawBranch = sourceBetween(
      documentLayerSource,
      'if (el.type === "draw") {',
      'if (el.type === "text")',
    );

    expect(drawBranch).toContain("<StudioDrawNode");
    expect(drawBranch).toContain("paperSurface={paperSurfaceForPreview}");
    expect(drawBranch).toContain(
      '{tool === "select" && !isNonInteractiveRender ? (',
    );
    expect(drawBranch).toContain("hitFunc={(context, shape) => {");
    expect(drawBranch).toContain("listening");
    expect(drawBranch).toContain("onMouseDown={onSelect}");
    expect(drawBranch).toContain("onTap={onSelect}");
    expect(drawBranch).not.toContain('{tool === "select" ? (');
  });

  it("marks every duplicate mask source non-interactive while leaving authored content interactive", () => {
    const composite = sourceBetween(
      documentLayerSource,
      "const masterUnderlay =",
      "return (\n                  <>",
    );
    const maskCloneCalls =
      composite.match(/renderEl\([^)]*,\s*\{\s*asMask:\s*true\s*\}\)/gu) ?? [];

    expect(maskCloneCalls).toHaveLength(4);
    expect(composite).toContain(
      "renderEl(mel, mIdx, { asMask: true })",
    );
    expect(composite).toContain(
      "renderEl(pel, pIdx, { asMask: true })",
    );
    expect(composite).toContain(
      "renderEl(maskEl, idx, { asMask: true })",
    );
    expect(composite).toContain(
      "renderEl(base, idx - 1, { asMask: true })",
    );
    // The sandwich content must be `source-in` unconditionally. It used to inherit the caller's
    // composite, so on the plain (non-clipBelow) branch it rendered `source-over`, covered its
    // mask sibling instead of being clipped by it, and painting on the mask changed nothing.
    expect(composite).toContain(
      'const content = renderEl(el, idx, { ...opts, compositeOverride: "source-in" })',
    );
    expect(composite).not.toContain("const content = renderEl(el, idx, opts)");
    expect(composite).toContain(
      'renderWithOwnMask({ compositeOverride: "source-in" })',
    );
    // The caller's intent survives on the cached sandwich root: clipBelow's source-in keeps
    // clipping to the layer below, and a masked layer's blend mode is not silently dropped.
    expect(composite).toContain("const sandwichComposite = (opts.compositeOverride ??");
    expect(composite).toContain("composite: sandwichComposite");
  });
});

describe("Studio canvas selection interaction guards", () => {
  it("keeps 44px resize hit targets on wide coarse-pointer devices", () => {
    expect(interactionSource).toContain(
      'import { useMediaQuery } from "@/src/hooks/use-media-query"',
    );
    expect(interactionSource).toContain(
      'const hasCoarsePointer = useMediaQuery("(pointer: coarse)")',
    );
    // 2026-08-21 intentional: the proxy call site moved verbatim into the selection-decorations
    // leaf, so the slice reads that file (and its shallower indentation) instead.
    const decorations = readFileSync(
      new URL("./StudioCanvasSelectionDecorations.tsx", import.meta.url),
      "utf8",
    );
    const proxyStart = decorations.indexOf("<StudioGroupUniformResizeProxy");
    const proxyEnd = decorations.indexOf("/>\n      ) : null}", proxyStart);
    expect(proxyStart).toBeGreaterThanOrEqual(0);
    expect(proxyEnd).toBeGreaterThan(proxyStart);
    const resizeProxy = decorations.slice(proxyStart, proxyEnd);
    expect(resizeProxy).toContain("mobile={isMobile}");
    expect(resizeProxy).toContain("coarse={hasCoarsePointer}");
  });

  it("disables alignment for both fully and partially locked selections", () => {
    const selectionGuards = sourceBetween(
      interactionSource,
      "const selectionLockedCount =",
      "const multiSelectionVisibleBounds =",
    );

    expect(selectionGuards).toContain(
      "isEffectivelyLocked(element, groups)",
    );
    expect(selectionGuards).toContain("selectionLockedCount > 0");
    expect(selectionGuards).toContain(
      "잠긴 객체가 포함되어 있어 정렬·분배·반전할 수 없어요. 선택 항목의 잠금을 모두 해제하세요.",
    );
    expect(selectionGuards.indexOf("selectionLockedCount > 0")).toBeLessThan(
      selectionGuards.indexOf("topLevelSelectedGroupIds.size > 0"),
    );
  });
});
