import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const pageSource = readStudioCuttoonEditorSource();
const viewportSource = readStudioCanvasViewportStack(import.meta.url, "./canvas/");
const proxySource = readFileSync(
  new URL("./StudioGroupUniformResizeProxy.tsx", import.meta.url),
  "utf8",
);
const gestureSource = readFileSync(
  new URL("./studio-live-canvas-gesture.ts", import.meta.url),
  "utf8",
);
const previewSessionSource = readFileSync(
  new URL("./studio-live-transform-preview-session.ts", import.meta.url),
  "utf8",
);
const konvaGestureSource = readFileSync(
  new URL("./studio-live-transform-gesture-konva.ts", import.meta.url),
  "utf8",
);
const draftStoreSource = readFileSync(
  new URL("./studio-live-transform-draft-store.ts", import.meta.url),
  "utf8",
);
const draftNodeSource = readFileSync(
  new URL("./StudioLiveTransformDraftNode.tsx", import.meta.url),
  "utf8",
);
// 2026-08-21 intentional: the proxy call site and the single-object Transformer moved verbatim out
// of StudioCanvasViewport.tsx into the canvas selection-decorations leaf. The viewport still owns
// the resize handlers and the bounds they consume, which is what the rest of this test asserts.
const selectionDecorationsSource = readFileSync(
  new URL("./canvas/StudioCanvasSelectionDecorations.tsx", import.meta.url),
  "utf8",
);
// The commit's planner choice, change detection and wording live in a pure module; the host
// keeps the session guards and the single document commit.
const commitPlanSource = readFileSync(
  new URL("./studio-selection-transform-commit.ts", import.meta.url),
  "utf8",
);
const browserVerifierSource = readFileSync(
  new URL("../../../../../scripts/verify-studio-groups.mts", import.meta.url),
  "utf8",
);

function functionBody(name: string): string {
  const start = pageSource.indexOf(`function ${name}`);
  expect(
    start,
    `StudioPage must expose the runtime function ${name}`,
  ).toBeGreaterThanOrEqual(0);
  const tail = pageSource.slice(start + `function ${name}`.length);
  const nextFunction = /\n {2}(?:async )?function [A-Za-z]/.exec(tail);
  const end =
    nextFunction?.index === undefined
      ? pageSource.length
      : start + `function ${name}`.length + nextFunction.index;
  expect(
    end,
    `${name} must have a readable function boundary`,
  ).toBeGreaterThan(start);
  return pageSource.slice(start, end);
}

function occurrences(source: string, token: string): number {
  return source.split(token).length - 1;
}

function expectSourceToken(
  source: string,
  token: string,
  contract: string,
): void {
  expect(
    source.includes(token),
    `${contract} must include ${JSON.stringify(token)}`,
  ).toBe(true);
}

describe("Studio group uniform-resize runtime boundary", () => {
  it("renders a dedicated group proxy and transformer instead of attaching the single-object transformer to children", () => {
    expectSourceToken(
      proxySource,
      'name="studio-group-uniform-resize-proxy"',
      "dedicated group resize proxy",
    );
    expectSourceToken(
      proxySource,
      'name="studio-group-uniform-resize-transformer"',
      "dedicated group resize Transformer",
    );
    expectSourceToken(
      selectionDecorationsSource,
      "<StudioGroupUniformResizeProxy",
      "StudioCanvasViewport group resize integration",
    );
    expectSourceToken(viewportSource, "beginCanvasSelectionResize", "Viewport handlers");
    expectSourceToken(viewportSource, "commitCanvasSelectionResize", "Viewport handlers");
    expectSourceToken(viewportSource, "cancelCanvasSelectionResize", "Viewport handlers");
    expect(viewportSource).not.toContain("previewCanvasSelectionResize");
    expect(selectionDecorationsSource).not.toContain("previewCanvasSelectionResize");
    expect(proxySource).not.toContain("previewCanvasSelectionResize");

    expect(occurrences(selectionDecorationsSource, "<Transformer")).toBeGreaterThanOrEqual(1);
    expect(occurrences(proxySource, "<Transformer")).toBe(1);
    expectSourceToken(proxySource, "transformer.nodes([proxy])", "group Transformer");
    expectSourceToken(selectionDecorationsSource, "ref={trRef}", "single-object Transformer");
    // A panel frame stores no angle, and its transformend commits only {x, y, width, height} --
    // an offered turn would land as a displacement. The handle is withheld instead, matching the
    // verdict `studioGroupUniformResizeMemberCanRotate` reaches for a frame inside a selection.
    expectSourceToken(
      selectionDecorationsSource,
      'rotateEnabled={selected?.type !== "frame"}',
      "single-object Transformer frame rotation gate",
    );
    expectSourceToken(
      viewportSource,
      "unionBounds(multiSelectionVisibleBounds)",
      "multi-selection source bounds",
    );
  });

  it("previews the gesture imperatively through the engine-agnostic projection, never via document state", () => {
    const previewSource = readFileSync(
      new URL("./studio-live-transform-preview.ts", import.meta.url),
      "utf8",
    );
    // The projection math is the next-gen-engine seam: renderer-free by contract. Konva-specific
    // application must stay in the -konva adapter so a future scene backend swaps one file.
    expect(previewSource).not.toContain('from "konva"');
    expect(previewSource).not.toContain("react-konva");
    expectSourceToken(
      previewSource,
      "studioLiveTransformPreviewMat2d",
      "stable-IR projection",
    );
    expect(gestureSource).not.toContain('from "konva"');
    expect(gestureSource).not.toContain("react-konva");
    expect(previewSessionSource).not.toContain('from "konva"');
    expect(previewSessionSource).not.toContain("react-konva");
    expect(draftStoreSource).not.toContain('from "konva"');
    expect(draftStoreSource).not.toContain("react-konva");

    expectSourceToken(
      proxySource,
      "onTransform={handleTransform}",
      "live preview wiring",
    );
    expectSourceToken(
      proxySource,
      "active.gesture.offer({",
      "common live gesture mailbox",
    );
    expectSourceToken(
      previewSessionSource,
      "classifyStudioLiveTransformPreviewFrame",
      "rAF projection owner",
    );
    expectSourceToken(
      konvaGestureSource,
      "resetStudioLiveTransformPreviewNodeAttrs(node)",
      "Konva adapter rollback",
    );
    expectSourceToken(
      konvaGestureSource,
      "restoreStudioLiveTransformClip(clipHost, originalClip)",
      "Konva clip rollback",
    );
    expectSourceToken(
      konvaGestureSource,
      "planStudioDrawObjectTransformWithBounds({",
      "single-pass commit-equivalent exact draft planner",
    );
    expectSourceToken(
      previewSessionSource,
      "options.adapter.applyExact?.(frame)",
      "valid unsupported-frame exact fallback",
    );
    expectSourceToken(
      draftNodeSource,
      'renderPurpose="transform-draft"',
      "settled transform-draft rendering semantics",
    );
    expectSourceToken(
      draftNodeSource,
      "exposeSceneIdentity={false}",
      "preview scene identity isolation",
    );
    expectSourceToken(
      draftNodeSource,
      'name="studio-live-transform-draft-root"',
      "always-mounted exact draft root",
    );
    expectSourceToken(
      viewportSource,
      "<StudioLiveTransformDraftNode",
      "existing drag Layer exact draft mount",
    );
    // The live path may never touch the document: the one commit in
    // commitCanvasSelectionResize stays the only mutation of the gesture.
    expect(proxySource).not.toContain("patchEl(");
    expect(proxySource).not.toContain("setPagesHistory");
    expect(gestureSource).not.toContain("patchEl(");
    expect(gestureSource).not.toContain("setPagesHistory");
    expectSourceToken(
      selectionDecorationsSource,
      "livePreview={",
      "single-stroke live preview opt-in",
    );
    expect(selectionDecorationsSource).not.toContain("studioLiveTransformRouteOfPoints");
    expect(selectionDecorationsSource).not.toContain("resolveStudioBrushRuntimeContract");
  });

  it("proves live ink on the browser-facing Konva backing canvas", () => {
    const readerStart = browserVerifierSource.indexOf(
      "async function singleDrawLiveTransformState",
    );
    const readerEnd = browserVerifierSource.indexOf(
      "async function waitForSingleDrawLiveTransformState",
      readerStart,
    );
    expect(readerStart).toBeGreaterThanOrEqual(0);
    expect(readerEnd).toBeGreaterThan(readerStart);
    const executableReader = browserVerifierSource
      .slice(readerStart, readerEnd)
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/\/\/.*$/gmu, "");
    expectSourceToken(
      executableReader,
      "getNativeCanvasElement",
      "live-transform browser pixel receipt",
    );
    expectSourceToken(
      browserVerifierSource,
      "singleDrawLiveBackingPixelsObserved",
      "live-transform browser evidence",
    );
    // Rendering the same scene graph into a new offscreen canvas does not prove that the visible
    // Layer received the synchronous source/draft handoff before the browser paint.
    expect(executableReader).not.toMatch(/\.toCanvas\s*\(/u);
  });

  it("starts one exact multi-selection lease after validating IDs, locks, and source bounds", () => {
    const source = functionBody("beginCanvasSelectionResize");
    const idsHelper = functionBody("currentCanvasResizeSelectionIds");
    const boundsGuard = functionBody("finitePositiveGroupResizeBounds");

    expectSourceToken(source, "currentCanvasResizeSelectionIds()", "resize begin");
    expectSourceToken(idsHelper, "marqueeIdsRef.current", "resize ids helper");
    expectSourceToken(idsHelper, "selectedIdRef.current", "resize single-object ids");
    expectSourceToken(source, "new Set", "resize begin");
    expectSourceToken(source, "activeElementsRef.current", "resize begin");
    expectSourceToken(source, "currentPageIdRef.current", "resize page snapshot");
    expectSourceToken(source, "masterEditModeRef.current", "resize master snapshot");
    expectSourceToken(source, "captureStudioMutationTicket()", "resize document snapshot");
    expectSourceToken(source, "isEffectivelyLocked", "resize begin");
    // The source frame comes from the VISIBLE box, so a hidden member would be transformed by an
    // affine that never accounted for it -- a turn about a box it sits outside throws it off-page
    // with nothing on screen to show it. Refused at the gate, like a locked member.
    expectSourceToken(source, "isEffectivelyHidden", "resize hidden-member guard");
    expectSourceToken(
      viewportSource,
      "!selectionHasHiddenMember",
      "group resize hidden-member gate",
    );
    expectSourceToken(
      source,
      "finitePositiveGroupResizeBounds(sourceBounds)",
      "resize source bounds",
    );
    expectSourceToken(boundsGuard, "Number.isFinite", "resize bounds guard");
    expectSourceToken(boundsGuard, "bounds.width > 0", "resize bounds guard");
    expectSourceToken(boundsGuard, "bounds.height > 0", "resize bounds guard");
    expectSourceToken(source, "beginLiveResourceEdit(", "resize begin");
    expectSourceToken(source, "uniqueIds.size !== selectedIds.length", "resize duplicate guard");
    expectSourceToken(source, "!currentById.has(id)", "resize missing-ID guard");
    expectSourceToken(source, "sourceElements,", "resize element identity snapshot");
    expectSourceToken(
      source,
      "studioRevisionProjectGenerationRef.current",
      "O(1) document generation snapshot",
    );
    expect(source).not.toContain("canonicalJson");
    expect(source).not.toContain("completeSelectedGroupId()");
    // Multi-select (2+) or a single freehand stroke (CSP free-scale on one layer).
    expectSourceToken(source, "singleDrawResize", "single stroke free-scale");
    expectSourceToken(source, 'type === "draw"', "single stroke free-scale");
    expect(source).toContain("selectedIds.length < 2 && !singleDrawResize");
    expect(source.indexOf("isEffectivelyLocked")).toBeLessThan(
      source.indexOf("beginLiveResourceEdit("),
    );
    expect(source).not.toContain("commit(");
    expect(source).not.toContain("patchEl(");
  });

  it("bakes every member through the uniform planner in exactly one document commit", () => {
    const source = functionBody("commitCanvasSelectionResize");

    expectSourceToken(source, "planStudioSelectionTransformCommit(", "resize commit");
    expectSourceToken(
      commitPlanSource,
      "planStudioGroupUniformResize({",
      "resize commit planner",
    );
    expectSourceToken(source, "groupResizeRef.current", "resize commit");
    expectSourceToken(source, "currentPageIdRef.current", "resize page identity");
    expectSourceToken(source, "masterEditModeRef.current", "resize master identity");
    expectSourceToken(source, "currentCanvasResizeSelectionIds()", "resize commit");
    expectSourceToken(source, "selectionStillMatches", "resize selection identity");
    expectSourceToken(source, "sourceStillMatches", "resize element identity");
    expectSourceToken(
      source,
      "session.sourceDocumentGeneration",
      "O(1) document generation identity",
    );
    expectSourceToken(
      source,
      "canApplyStudioMutation(session.mutationTicket)",
      "resize document identity",
    );
    expectSourceToken(source, "isEffectivelyLocked", "resize effective lock guard");
    expect(occurrences(source, "commit(")).toBe(1);
    expect(source).not.toContain("patchEl(");
    expectSourceToken(source, 'session.phase = "settling"', "resize settlement lease");
    expect(source).not.toContain("endLiveResourceEdit()");
  });

  it("cancels without mutation and always releases the transform lease", () => {
    const source = functionBody("cancelCanvasSelectionResize");

    expectSourceToken(source, "groupResizeRef.current", "resize cancel");
    expectSourceToken(source, "groupResizeRef.current = null", "resize cancel");
    expectSourceToken(source, "endLiveResourceEdit()", "resize cancel");
    expect(source).not.toContain("commit(");
    expect(source).not.toContain("patchEl(");
  });

  it("requests external cancellation without releasing the renderer writer lease", () => {
    const source = functionBody("requestCanvasSelectionResizeCancel");

    expectSourceToken(source, "const session = groupResizeRef.current", "current resize session");
    expectSourceToken(source, 'phase !== "active"', "resize cancel request");
    expectSourceToken(source, 'session.phase = "cancel-requested"', "synchronous cancel seal");
    expectSourceToken(source, "setCanvasSelectionResizeCancelSignal", "resize cancel request");
    expect(source.indexOf('session.phase = "cancel-requested"')).toBeLessThan(
      source.indexOf("setCanvasSelectionResizeCancelSignal"),
    );
    expect(source).not.toContain("groupResizeRef.current = null");
    expect(source).not.toContain("endLiveResourceEdit()");
  });

  it.each([
    ["Escape", (() => {
      const start = pageSource.indexOf('} else if (e.key === "Escape") {');
      const end = pageSource.indexOf(
        "\n      } else if (",
        start + '} else if (e.key === "Escape") {'.length,
      );
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return pageSource.slice(start, end);
    })()],
    ["Stage pointercancel", functionBody("onStagePointerCancel")],
  ])("seals %s synchronously before a same-turn transformend can commit", (_route, routeSource) => {
    const requestSource = functionBody("requestCanvasSelectionResizeCancel");
    const commitSource = functionBody("commitCanvasSelectionResize");

    expectSourceToken(routeSource, "cancelCanvasSelectionResize()", "cancel request route");
    expectSourceToken(
      requestSource,
      'session.phase = "cancel-requested"',
      "same-turn cancellation seal",
    );
    expect(requestSource.indexOf('session.phase = "cancel-requested"')).toBeLessThan(
      requestSource.indexOf("setCanvasSelectionResizeCancelSignal"),
    );
    expectSourceToken(
      commitSource,
      'session.phase !== "active"',
      "same-turn transformend commit gate",
    );
    expect(commitSource.indexOf('session.phase !== "active"')).toBeLessThan(
      commitSource.indexOf('session.phase = "settling"'),
    );
    expect(requestSource).not.toContain("groupResizeRef.current = null");
    expect(requestSource).not.toContain("endLiveResourceEdit()");
  });

  it("routes Stage pointer cancellation through the request channel and reserves the finalizer for the commit port", () => {
    const stableHandlersStart = pageSource.indexOf(
      "const studioCanvasViewportHandlers = useStudioStableHandlers<StudioCanvasViewportHandlers>",
    );
    expect(stableHandlersStart).toBeGreaterThanOrEqual(0);
    const stableHandlersSource = pageSource.slice(stableHandlersStart, stableHandlersStart + 900);
    expectSourceToken(
      stableHandlersSource,
      "cancelCanvasSelectionResize: requestCanvasSelectionResizeCancel",
      "Stage pointer cancel request",
    );
    expectSourceToken(
      stableHandlersSource,
      "finalizeCanvasSelectionResize: cancelCanvasSelectionResize",
      "renderer settlement finalizer",
    );
    expectSourceToken(
      viewportSource,
      "cancelCanvasSelectionResize: finalizeCanvasSelectionResize",
      "selection decorations finalizer",
    );
    expectSourceToken(
      selectionDecorationsSource,
      "release: cancelCanvasSelectionResize",
      "commit-port release",
    );
    expectSourceToken(
      selectionDecorationsSource,
      "cancel: cancelCanvasSelectionResize",
      "commit-port cancellation",
    );
  });

  it("keeps draw-body interaction excluded while resize settlement owns the local lease", () => {
    const source = functionBody("nodeInteractionBegin");

    expectSourceToken(source, "groupResizeRef.current", "draw-body writer exclusion");
    expectSourceToken(source, "return false", "draw-body writer exclusion");
  });

  it("fails closed when locks, selection identity, page identity, or cancellation invalidate the session", () => {
    const lifecycleStart = pageSource.indexOf(
      "// Transformer pointer capture 중에",
    );
    const lifecycleEnd = pageSource.indexOf(
      "function applyGroupSelectionState",
      lifecycleStart,
    );
    expect(lifecycleStart).toBeGreaterThanOrEqual(0);
    expect(lifecycleEnd).toBeGreaterThan(lifecycleStart);
    const lifecycleSource = pageSource.slice(lifecycleStart, lifecycleEnd);
    expectSourceToken(lifecycleSource, "useEffect(() => {", "resize lifecycle");
    expectSourceToken(lifecycleSource, "groupResizeRef.current", "resize lifecycle");
    expectSourceToken(lifecycleSource, "selectionStillMatches", "resize lifecycle");
    expectSourceToken(lifecycleSource, "activePage.id", "resize lifecycle");
    expectSourceToken(lifecycleSource, "masterEditMode", "resize lifecycle");
    expectSourceToken(lifecycleSource, 'session.phase !== "active"', "resize lifecycle");
    expectSourceToken(
      lifecycleSource,
      "requestCanvasSelectionResizeCancel()",
      "resize lifecycle request",
    );
    expect(lifecycleSource).not.toContain("groupResizeRef.current = null");
    expect(lifecycleSource).not.toContain("endLiveResourceEdit()");
    expectSourceToken(
      lifecycleSource,
      "[activePage.id, masterEditMode, marqueeIds, selectedId]",
      "resize lifecycle dependencies",
    );

    const escapeStart = pageSource.indexOf(
      '} else if (e.key === "Escape") {',
    );
    const escapeEnd = pageSource.indexOf(
      "\n      } else if (",
      escapeStart + '} else if (e.key === "Escape") {'.length,
    );
    expect(escapeStart).toBeGreaterThanOrEqual(0);
    expect(escapeEnd).toBeGreaterThan(escapeStart);
    expectSourceToken(
      pageSource.slice(escapeStart, escapeEnd),
      "groupResizeRef.current",
      "Escape handling",
    );
    expectSourceToken(
      pageSource.slice(escapeStart, escapeEnd),
      "cancelCanvasSelectionResize",
      "Escape handling",
    );

    const pointerCancelSource = functionBody("onStagePointerCancel");
    expectSourceToken(
      pointerCancelSource,
      "groupResizeRef.current",
      "pointer cancellation",
    );
    expectSourceToken(
      pointerCancelSource,
      "cancelCanvasSelectionResize()",
      "pointer cancellation",
    );
    expectSourceToken(
      proxySource,
      "active.gesture.cancel(reason)",
      "common gesture cancellation",
    );
  });

  it("cancels an active session when any document composition snapshot changes", () => {
    // Clip membership and lift eligibility read panels/siblings too, so even an unrelated element
    // replacement can invalidate a frozen preview composition while the selected stroke survives.
    const marker = "// The preview captures the entire composition used by clip/lift eligibility";
    const watchStart = pageSource.indexOf(marker);
    expect(watchStart, "document composition watch").toBeGreaterThan(-1);
    const watchSource = pageSource.slice(watchStart, watchStart + 750);

    expectSourceToken(
      watchSource,
      'groupResizeRef.current?.phase !== "active"',
      "composition watch",
    );
    expect(watchSource).not.toContain("groupResizeRef.current = null");
    expect(watchSource).not.toContain("endLiveResourceEdit()");
    expectSourceToken(
      watchSource,
      "requestCanvasSelectionResizeCancel()",
      "reconciliation watch",
    );
    // A transient gesture never changes elements, so only a document snapshot replacement fires.
    expectSourceToken(watchSource, "}, [elements]);", "reconciliation watch");
  });

  it("keeps the existing single-object Transformer detached for every multi/group selection", () => {
    const transformerEffectStart = pageSource.indexOf(
      "// 트랜스포머를 선택 노드",
    );
    const transformerEffectEnd = pageSource.indexOf(
      "function publishStudioCrdtSceneTransition",
      transformerEffectStart,
    );
    expect(transformerEffectStart).toBeGreaterThanOrEqual(0);
    expect(transformerEffectEnd).toBeGreaterThan(transformerEffectStart);
    const source = pageSource.slice(
      transformerEffectStart,
      transformerEffectEnd,
    );

    expectSourceToken(source, "marqueeIds.length > 0", "single Transformer effect");
    expectSourceToken(source, "tr.nodes([])", "single Transformer effect");
    expect(source).not.toContain("planStudioGroupUniformResize");
  });
});
