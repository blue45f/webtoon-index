import { readFileSync } from "node:fs";


import { describe, expect, it } from "vitest";

import { normalizeStudioBrushDynamicsSettings } from "../brush/studio-brush-dynamics";
import { STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1 } from "../brush/studio-ink-pressure-model";
import { readStudioPageCompositionSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

import {
  createStudioRasterHandoffAuthorityKey,
  createStudioRasterHandoffBaseKey,
  isStudioRasterHandoffCandidateAuthorized,
  isStudioRasterHandoffViewNavigationTool,
  readStudioAuthoritativeStageFrame,
  studioRasterAuthorizedOperationIds,
  type StudioRasterHandoffCandidate,
} from "./studio-raster-handoff-authority";

import type { Tool } from "../studio-editor-tool-model";

const viewport = {
  surface: { left: 10, top: 20, width: 300, height: 400 },
  transform: {
    scaleX: 2,
    scaleY: 3,
    offsetX: -4,
    offsetY: -5,
    flipX: false,
  },
} as const;

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  for (
    let index = source.indexOf(needle);
    index !== -1;
    index = source.indexOf(needle, index + needle.length)
  ) {
    count += 1;
  }
  return count;
}

/**
 * Finds the `>` that terminates the JSX opening tag starting at `tagStart`, skipping `>` inside
 * attribute expressions (`{...}` — arrow functions, comparisons) and string/template literals.
 */
function findJsxTagEnd(source: string, tagStart: number): { end: number; selfClosing: boolean } {
  let braceDepth = 0;
  let quote: '"' | "'" | "`" | null = null;
  for (let index = tagStart; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote !== null) {
      if (char === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth -= 1;
    else if (char === ">" && braceDepth === 0) {
      return { end: index, selfClosing: source[index - 1] === "/" };
    }
  }
  throw new Error("unterminated JSX opening tag");
}

/**
 * Returns the full JSX source of the `<div>` element starting at `wrapperStart` (through its
 * matching `</div>`), tracking nested and self-closing div tags. Formatting-robust: no line
 * numbers, only tag structure.
 */
function jsxDivSubtree(source: string, wrapperStart: number): string {
  let depth = 0;
  let cursor = wrapperStart;
  for (;;) {
    const open = source.indexOf("<div", cursor);
    const close = source.indexOf("</div>", cursor);
    if (close === -1) throw new Error("unbalanced <div> subtree");
    if (open !== -1 && open < close) {
      const tag = findJsxTagEnd(source, open);
      if (!tag.selfClosing) depth += 1;
      cursor = tag.end + 1;
    } else {
      depth -= 1;
      cursor = close + "</div>".length;
      if (depth === 0) return source.slice(wrapperStart, cursor);
    }
  }
}

function baseKey(overrides: Partial<Parameters<typeof createStudioRasterHandoffBaseKey>[0]> = {}) {
  return createStudioRasterHandoffBaseKey({
    pageId: "page-a",
    documentWidth: 720,
    documentHeight: 1_200,
    elements: [{
      id: "draw-a",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 3, 4],
      pressures: [0.5, 0.6],
      stroke: "#123456",
      strokeWidth: 4,
      opacity: 1,
      brush: "pen",
      panelClip: "none",
    }],
    viewport,
    ...overrides,
  });
}

function candidate(key: string): StudioRasterHandoffCandidate {
  const sourceOperations = [{ operationId: "draw-a", semanticParameters: "{\"a\":1}" }];
  const rasterLogSha256 = "a".repeat(64);
  return {
    baseKey: key,
    generation: 3,
    operationIds: ["draw-a"],
    rasterLogSha256,
    authorityKey: createStudioRasterHandoffAuthorityKey({
      baseKey: key,
      generation: 3,
      rasterLogSha256,
      sourceOperations,
    }),
  };
}

describe("studio raster handoff authority", () => {
  it("uses exact scene, viewport and gate semantics in the base identity", () => {
    const current = baseKey();
    expect(baseKey()).toBe(current);
    expect(baseKey({ viewport: { ...viewport, surface: { ...viewport.surface, left: 11 } } }))
      .not.toBe(current);
    expect(baseKey({ gates: { exportActive: true } })).not.toBe(current);
    const dynamicElement = {
      id: "draw-dynamic",
      type: "draw" as const,
      kind: "freehand" as const,
      mode: "pen" as const,
      points: [1, 2, 3, 4],
      pressures: [0, 0],
      stroke: "#123456",
      strokeWidth: 20,
      opacity: 1,
      brush: "airbrush",
      panelClip: "none" as const,
    };
    const floorKey = (minimumDiameterRatio: number) => baseKey({
      elements: [{
        ...dynamicElement,
        brushDynamics: normalizeStudioBrushDynamicsSettings({
          minimumDiameterRatio,
          width: { base: 20 },
        }),
      }],
    });
    expect(floorKey(0.2)).not.toBe(floorKey(0.8));
    expect(baseKey({ elements: [{
      id: "draw-a",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 3, 4],
      pressures: [0.5, 0.6],
      stroke: "#123456",
      strokeWidth: 4,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
      opacity: 1,
      brush: "pen",
      panelClip: "none",
    }] })).not.toBe(current);
    const materialBase = baseKey({ elements: [{
      id: "draw-material",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 3, 4],
      pressures: [0, 0],
      stroke: "#123456",
      strokeWidth: 4,
      materialPressureModel: "canonical-material-v1",
      materialMinimumDiameterRatio: 0.2,
      opacity: 1,
      brush: "pencil",
      panelClip: "none",
    }] });
    expect(baseKey({ elements: [{
      id: "draw-material",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 3, 4],
      pressures: [0, 0],
      stroke: "#123456",
      strokeWidth: 4,
      materialPressureModel: "canonical-material-v1",
      materialMinimumDiameterRatio: 1,
      opacity: 1,
      brush: "pencil",
      panelClip: "none",
    }] })).not.toBe(materialBase);
    expect(baseKey({ elements: [{
      id: "draw-a",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 3, 4],
      pressures: [0.5, 0.6],
      stroke: "#123456",
      strokeWidth: 4,
      paintModel: "layered-flow-v1",
      opacity: 1,
      brush: "pen",
      panelClip: "none",
    }] })).not.toBe(current);
    expect(baseKey({ elements: [{
      id: "draw-a",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 3, 5],
      pressures: [0.5, 0.6],
      stroke: "#123456",
      strokeWidth: 4,
      opacity: 1,
      brush: "pen",
      panelClip: "none",
    }] })).not.toBe(current);
  });

  it("authorizes only a non-empty exact candidate while every gate stays open", () => {
    const key = baseKey();
    const ready = candidate(key);
    expect(isStudioRasterHandoffCandidateAuthorized({
      candidate: ready,
      currentBaseKey: key,
      authorizedRasterLogSha256: ready.rasterLogSha256,
      blocked: false,
    })).toBe(true);
    expect(isStudioRasterHandoffCandidateAuthorized({
      candidate: ready,
      currentBaseKey: baseKey({ gates: { editActive: true } }),
      authorizedRasterLogSha256: ready.rasterLogSha256,
      blocked: false,
    })).toBe(false);
    expect(isStudioRasterHandoffCandidateAuthorized({
      candidate: ready,
      currentBaseKey: key,
      authorizedRasterLogSha256: ready.rasterLogSha256,
      blocked: true,
    })).toBe(false);
    expect(isStudioRasterHandoffCandidateAuthorized({
      candidate: { ...ready, operationIds: [] },
      currentBaseKey: key,
      authorizedRasterLogSha256: ready.rasterLogSha256,
      blocked: false,
    })).toBe(false);
    expect(isStudioRasterHandoffCandidateAuthorized({
      candidate: { ...ready, operationIds: ["draw-a", "draw-a"] },
      currentBaseKey: key,
      authorizedRasterLogSha256: ready.rasterLogSha256,
      blocked: false,
    })).toBe(false);
    expect(isStudioRasterHandoffCandidateAuthorized({
      candidate: ready,
      currentBaseKey: key,
      authorizedRasterLogSha256: "b".repeat(64),
      blocked: false,
    })).toBe(false);
  });

  it("returns no hidden vector ids for stale or blocked frames", () => {
    const key = baseKey();
    const ready = candidate(key);
    expect([...studioRasterAuthorizedOperationIds({
      candidate: ready,
      currentBaseKey: key,
      authorizedRasterLogSha256: ready.rasterLogSha256,
      blocked: false,
    })]).toEqual(["draw-a"]);
    expect(studioRasterAuthorizedOperationIds({
      candidate: ready,
      currentBaseKey: `${key}:stale`,
      authorizedRasterLogSha256: ready.rasterLogSha256,
      blocked: false,
    }).size).toBe(0);
  });

  it("admits only chrome-free view navigation tools and fails closed for unknown tools", () => {
    expect(isStudioRasterHandoffViewNavigationTool("select")).toBe(true);
    expect(isStudioRasterHandoffViewNavigationTool("hand")).toBe(true);
    expect(isStudioRasterHandoffViewNavigationTool("draw")).toBe(false);
    // A future tool union member must opt in explicitly instead of inheriting the open slice.
    expect(isStudioRasterHandoffViewNavigationTool("warp" as Tool)).toBe(false);
  });

  it("keeps one base identity across view navigation tools but re-keys on a special draft", () => {
    const openGates = { specialDraftActive: false } as const;
    // select and hand both derive the same open gate bits, so their base identity is shared and
    // an authorized candidate survives switching between the two view navigation tools.
    expect(baseKey({ gates: openGates })).toBe(baseKey({ gates: { ...openGates } }));
    expect(baseKey({ gates: openGates })).toBe(baseKey());
    expect(baseKey({ gates: { specialDraftActive: true } })).not.toBe(baseKey({ gates: openGates }));
  });

  it("pins the StudioPage gate matrix wiring for the M2 view-tool slice", () => {
    const source = readStudioPageCompositionSource();
    const memoStart = source.indexOf("const studioRasterHandoffGates = useMemo");
    expect(memoStart).toBeGreaterThan(-1);
    const memo = source.slice(memoStart, source.indexOf("]);", memoStart));

    // Correctness vetoes: capture and scene identity stay closed.
    expect(memo).toContain("exportActive: isExporting || saving || timelapseCapturing");
    expect(memo).toContain("masterEditActive: masterEditMode");
    expect(memo).toContain(
      "editActive: selectedId !== null || marqueeIds.length > 0 || editing !== null"
    );
    // M2b: the CSS-filter post-processing inputs (page grade filter chain, colour-vision preview)
    // are colocation-proven by the wrapper contract test below and no longer veto. The vignette
    // is not a CSS filter — it is an overlay outside the filter wrapper — so it is the one
    // remaining post-processing veto.
    expect(memo).toContain("postProcessingActive: pageGrade.vignette > 0");
    expect(memo).not.toContain("pageGradeActive");
    expect(memo).not.toContain("colorBlindPreview");

    // M2 slice: only the tested view-navigation predicate may widen the tool axis.
    expect(memo).toContain("!isStudioRasterHandoffViewNavigationTool(tool)");
    expect(memo).not.toMatch(/tool\s*!==\s*"select"/u);

    // Every state that still shows a Konva interaction plane keeps its veto bit.
    expect(memo).toMatch(/canvasRotation\s*!==\s*0/u);
    expect(memo).toMatch(/marqueeActive\s*\|\|\s*userGuides\.length\s*>\s*0/u);
    for (const flag of [
      "eyedropperActive", "timelinePlaying",
      "advancedFillArmed", "pixelToolArmed", "cropArmed", "panelSplitArmed", "nodeEditArmed",
      "bubbleShapeArmed", "smudgeArmed", "dodgeBurnArmed", "wetMixArmed", "liquifyArmed",
      // 의도적 변경(2026-07-24): 필터 마스크 페인팅 툴 배선 — 새 armed 도구도 래스터 핸드오프를 veto.
      "healCloneArmed", "layerMaskPaintArmed", "filterMaskPaintArmed", "quickMaskArmed", "historyBrushArmed",
      "puppetWarpArmed",
    ]) {
      expect(memo, `specialDraftActive must keep vetoing on ${flag}`).toContain(flag);
    }

    // Keystone for the hand-tool opening: native scrolling (wheel, space pan and the hand tool
    // alike) must keep revoking the raster authority synchronously before the viewport plan
    // catches up, so a stale frame can never leave a blank newly exposed edge.
    expect(source).toMatch(
      /const onScroll = \(\) => \{\s*revokeStudioRasterHandoffRef\.current\(\);/u
    );
  });

  it("pins the raster surface inside the page grade + colour vision filter wrapper (M2b)", () => {
    const source = readFileSync(new URL("../canvas/StudioCanvasViewportStageHost.tsx", import.meta.url), "utf8");

    // Stable anchor: the single post-processing filter wrapper carries an inert data attribute.
    // Moving the attribute, the filter style or either presentation breaks this contract, which
    // is the proof the open postProcessing gate rests on.
    const anchor = 'data-studio-post-processing-scope=""';
    expect(countOccurrences(source, anchor)).toBe(1);
    const wrapperStart = source.lastIndexOf("<div", source.indexOf(anchor));
    expect(wrapperStart).toBeGreaterThan(-1);

    // The anchored wrapper itself must be the element applying BOTH post-processing filters.
    const tag = findJsxTagEnd(source, wrapperStart);
    expect(tag.selfClosing).toBe(false);
    const openTag = source.slice(wrapperStart, tag.end + 1);
    expect(openTag).toMatch(/style=\{\{\s*filter:/u);
    expect(openTag).toContain("pageGradeCss");
    expect(openTag).toContain("colorBlindFilterStyle(colorBlindPreview)");

    // Both presentations render inside that same wrapper, so a handed-off raster frame receives
    // exactly the filter chain the authoritative Konva Stage receives.
    const wrapper = jsxDivSubtree(source, wrapperStart);
    expect(wrapper).toMatch(/<Stage[\s>]/u);
    expect(wrapper).toMatch(/<StudioRasterCrdtSurface[\s>]/u);

    // Single render sites: neither the Stage nor the raster surface may also render on some other
    // path (fullscreen, portal, split view) outside the filter wrapper.
    expect((source.match(/<Stage[\s>]/gu) ?? []).length).toBe(1);
    expect((source.match(/<StudioRasterCrdtSurface[\s>]/gu) ?? []).length).toBe(1);
    // And this is the single colour-vision filter application, so no second chain can diverge.
    expect(countOccurrences(source, "colorBlindFilterStyle(")).toBe(1);

    // The vignette is NOT a CSS filter: it stays an overlay OUTSIDE the wrapper, painting above
    // the wrapper only while the wrapper's filter forms a stacking context. That unprovable paint
    // order is exactly why pageGrade.vignette keeps the postProcessing veto. If the overlay moves
    // inside the wrapper (or a second one appears), the gate derivation must be revisited.
    expect(wrapper).not.toContain("vignetteCss");
    expect(source.indexOf("vignetteCss(", wrapperStart + wrapper.length)).toBeGreaterThan(-1);
  });

  it("revokes the raster surface and redraws Konva before a Stage-only readback", () => {
    const calls: string[] = [];
    const value = readStudioAuthoritativeStageFrame({
      revokeRasterHandoff: () => calls.push("revoke"),
      drawStage: () => calls.push("draw"),
      read: () => {
        calls.push("read");
        return "captured";
      },
    });
    expect(value).toBe("captured");
    expect(calls).toEqual(["revoke", "draw", "read"]);
  });
});
