import { describe, expect, it } from "vitest";

import {
  mergeStudioLiveGesturePreviewElements,
  planStudioLiveGesturePreviewRenderElements,
  projectStudioLiveGesturePreviewEntry,
  studioLiveGesturePreviewAuthoritativeReceiptIds,
} from "./studio-live-gesture-preview-projection";

import type { DrawEl, El } from "../studio-element-model";
import type {
  StudioLiveGesturePreviewSnapshot,
  StudioLiveGesturePreviewSnapshotEntry,
} from "./studio-live-gesture-preview-store";

function freehandEntry(
  overrides: Partial<StudioLiveGesturePreviewSnapshotEntry> = {},
): StudioLiveGesturePreviewSnapshotEntry {
  return {
    key: "8:sender-agesture-a",
    senderSessionId: "sender-a",
    gestureId: "gesture-a",
    pageId: "page-a",
    seq: 3,
    lastPhase: "end",
    operation: "erase",
    base: { documentGeneration: 7 },
    renderer: {
      kind: "freehand",
      mode: "eraser",
      stroke: "#112233",
      strokeWidth: 18,
      opacity: 0.75,
      brush: "soft-airbrush",
      brushCatalogId: "airbrush-v1",
      brushCatalogName: "Soft Airbrush",
      sampleSpacing: 1.5,
      blendMode: "multiply",
      paintModel: "bounded-flow-v2",
      pressureModel: "linear-residual-path-v3",
      materialPressureModel: "canonical-material-v1",
      materialMinimumDiameterRatio: 0.2,
      stampPipeline: "causal-walker-v2",
      brushTip: { tiltEnabled: true, angleDeg: 12, roundness: 0.8 },
      symmetry: { type: "none", centerX: 0, centerY: 0 },
      brushDynamics: {
        version: 1,
        presetId: "airbrush",
        seed: 99,
        fallbackPressure: 0.4,
        minimumDiameterRatio: 0.15,
        spacingRatio: 0.2,
        scatterRatio: null,
      },
    },
    samples: {
      startIndex: 0,
      points: [0, 0, 10, 10, 20, 20],
      pressures: [0.4, 0.5, 0.6],
      tiltXs: [1, 2, 3],
      tiltYs: [4, 5, 6],
      twists: [7, 8, 9],
      speeds: [0.1, 0.2, 0.3],
      tangentialPressures: [0, 0.1, 0.2],
      altitudeAngles: [0.5, 0.6, 0.7],
      azimuthAngles: [1, 1.1, 1.2],
      contactWidths: [2, 3, 4],
      contactHeights: [3, 4, 5],
      sampleTimeOffsets: [0, 8, 16],
    },
    sampleCount: 3,
    updatedAt: 10_000,
    ...overrides,
  };
}

function shapeEntry(
  overrides: Partial<StudioLiveGesturePreviewSnapshotEntry> = {},
): StudioLiveGesturePreviewSnapshotEntry {
  return {
    key: "8:sender-ashape-a",
    senderSessionId: "sender-a",
    gestureId: "shape-a",
    pageId: "page-a",
    seq: 2,
    lastPhase: "end",
    operation: "shape",
    base: { documentGeneration: 7 },
    renderer: {
      kind: "rect",
      mode: "pen",
      stroke: "#223344",
      strokeWidth: 4,
      fill: "#aabbcc",
      strokeStyle: {
        dash: "solid",
        lineCap: "round",
        arrowStart: "none",
        arrowEnd: "none",
      },
      shapeParams: {
        starPoints: 5,
        starInnerRatio: 0.5,
        polygonSides: 6,
        cornerRadius: 3,
      },
      sketch: {
        enabled: true,
        roughness: 1.5,
        bowing: 1,
        fillStyle: "hachure",
      },
    },
    shape: { kind: "rect", x0: 1, y0: 2, x1: 30, y1: 40 },
    sampleCount: 0,
    updatedAt: 10_000,
    ...overrides,
  };
}

function draw(id: string, points: number[], kind: DrawEl["kind"] = "freehand"): DrawEl {
  return {
    id,
    type: "draw",
    kind,
    mode: "pen",
    points,
    stroke: "#000000",
    strokeWidth: 4,
  };
}

function retainedPrefix(
  entry: StudioLiveGesturePreviewSnapshotEntry,
  points: number[],
): DrawEl {
  const projected = projectStudioLiveGesturePreviewEntry(entry);
  if (!projected) throw new Error("test preview must project to a DrawEl");
  return { ...projected, points };
}

function eligibleKeys(
  snapshot: StudioLiveGesturePreviewSnapshot,
): ReadonlySet<string> {
  return new Set(snapshot.map((entry) => entry.key));
}

describe("studio live gesture preview projection", () => {
  it("projects a settling freehand entry into a detached preview-only DrawEl", () => {
    const entry = freehandEntry();
    const projected = projectStudioLiveGesturePreviewEntry(entry);

    expect(projected).toMatchObject({
      id: "gesture-a",
      type: "draw",
      kind: "freehand",
      mode: "eraser",
      points: [0, 0, 10, 10, 20, 20],
      pressures: [0.4, 0.5, 0.6],
      stroke: "#112233",
      strokeWidth: 18,
      opacity: 0.75,
      paintModel: "bounded-flow-v2",
      pressureModel: "linear-residual-path-v3",
      brushDynamics: {
        presetId: "airbrush",
        seed: 99,
        fallbackPressure: 0.4,
        minimumDiameterRatio: 0.15,
        spacingRatio: 0.2,
        scatterRatio: null,
      },
    });
    expect(projected?.points).not.toBe(entry.samples?.points);
    expect(projected?.pressures).not.toBe(entry.samples?.pressures);
    projected!.points[0] = 999;
    expect(entry.samples?.points[0]).toBe(0);
  });

  it("projects shape endpoints and fails closed for retouch", () => {
    expect(projectStudioLiveGesturePreviewEntry(shapeEntry())).toMatchObject({
      id: "shape-a",
      kind: "rect",
      mode: "pen",
      points: [1, 2, 30, 40],
      fill: "#aabbcc",
      strokeStyle: { dash: "solid", lineCap: "round" },
      shapeParams: { cornerRadius: 3 },
      sketch: { enabled: true },
    });
    expect(projectStudioLiveGesturePreviewEntry(freehandEntry({
      operation: "retouch",
      renderer: undefined,
      samples: undefined,
      retouch: {
        tool: "smudge",
        startIndex: 0,
        points: [0.1, 0.2],
        radiusNorm: 0.1,
        strength: 0.5,
      },
      sampleCount: 1,
    }))).toBeNull();
  });

  it("normalizes the protocol normal blend mode to the retained source-over mode", () => {
    const base = freehandEntry();
    const entry = freehandEntry({
      renderer: {
        ...base.renderer!,
        blendMode: "normal",
      },
    });

    expect(projectStudioLiveGesturePreviewEntry(entry)).toMatchObject({
      id: "gesture-a",
      blendMode: "source-over",
    });

    const lagging: El = {
      ...retainedPrefix(entry, [0, 0]),
      blendMode: "normal",
    };
    const plan = planStudioLiveGesturePreviewRenderElements(
      [lagging],
      [entry],
      new Set([entry.key]),
    );
    expect(plan.previewElementIds).toEqual(new Set(["gesture-a"]));
    expect(plan.authoritativeHandoffIds).toEqual([]);
    expect(plan.elements[0]).toMatchObject({ blendMode: "source-over" });
  });

  it("returns explicit preview paint metadata for absent and lagging slots", () => {
    const entry = freehandEntry();
    const snapshot: StudioLiveGesturePreviewSnapshot = [entry];
    const absentPlan = planStudioLiveGesturePreviewRenderElements(
      [],
      snapshot,
      eligibleKeys(snapshot),
    );

    expect(absentPlan.elements).toHaveLength(1);
    expect(absentPlan.elements[0]).toMatchObject({
      id: "gesture-a",
      points: [0, 0, 10, 10, 20, 20],
    });
    expect(absentPlan.previewElementIds).toEqual(new Set(["gesture-a"]));
    expect(absentPlan.previewSequenceByElementId).toEqual(
      new Map([["gesture-a", 3]]),
    );
    expect(absentPlan.authoritativeHandoffIds).toEqual([]);
    expect(absentPlan.authoritativeHandoffToken).toBe("[]");

    const laterEntry = freehandEntry({ seq: 4 });
    const lagging = retainedPrefix(laterEntry, [0, 0]);
    const laterPlan = planStudioLiveGesturePreviewRenderElements(
      [lagging],
      [laterEntry],
      new Set([laterEntry.key]),
    );
    expect(laterPlan.previewElementIds).toEqual(new Set(["gesture-a"]));
    expect(laterPlan.previewSequenceByElementId.get("gesture-a")).toBe(4);
  });

  it("returns the authoritative identity without indexing when no preview can project", () => {
    const authoritative: readonly El[] = [draw("kept", [0, 0])];
    const emptyPlan = planStudioLiveGesturePreviewRenderElements(
      authoritative,
      [],
      new Set(),
    );
    expect(emptyPlan.elements).toBe(authoritative);
    expect(emptyPlan.previewElementIds.size).toBe(0);

    const retouch = freehandEntry({
      gestureId: "retouch-a",
      operation: "retouch",
      renderer: undefined,
      samples: undefined,
      retouch: {
        tool: "smudge",
        startIndex: 0,
        points: [0.1, 0.2],
        radiusNorm: 0.1,
        strength: 0.5,
      },
      sampleCount: 1,
    });
    const unsupportedPlan = planStudioLiveGesturePreviewRenderElements(
      authoritative,
      [retouch],
      new Set([retouch.key]),
    );
    expect(unsupportedPlan.elements).toBe(authoritative);
    expect(unsupportedPlan.previewElementIds.size).toBe(0);
  });

  it("returns the unchanged authoritative identity when all snapshot entries are unsupported", () => {
    const authoritative: readonly El[] = [draw("kept", [0, 0]), draw("kept-2", [5, 5])];
    const retouch = freehandEntry({
      gestureId: "retouch-a",
      operation: "retouch",
      renderer: undefined,
      samples: undefined,
      retouch: {
        tool: "smudge",
        startIndex: 0,
        points: [0.1, 0.2],
        radiusNorm: 0.1,
        strength: 0.5,
      },
      sampleCount: 1,
    });

    const unsupportedPlan = planStudioLiveGesturePreviewRenderElements(
      authoritative,
      [retouch],
      new Set([retouch.key]),
    );

    expect(unsupportedPlan.elements).toBe(authoritative);
    expect(unsupportedPlan.previewElementIds.size).toBe(0);
    expect(unsupportedPlan.authoritativeHandoffIds).toEqual([]);
    expect(unsupportedPlan.authoritativeHandoffToken).toBe("[]");
  });

  it("keeps raw authored ids reserved when a paint projection temporarily omits them", () => {
    const entry = freehandEntry();
    const plan = planStudioLiveGesturePreviewRenderElements(
      [],
      [entry],
      new Set([entry.key]),
      new Set([entry.gestureId]),
    );

    expect(plan.elements).toEqual([]);
    expect(plan.previewElementIds.size).toBe(0);
    expect(plan.authoritativeHandoffIds).toEqual([]);
  });

  it("fails closed when any admitted renderer material field differs", () => {
    const entry = freehandEntry();
    const preview = retainedPrefix(entry, [0, 0]);
    const mismatchedAuthoritative: readonly DrawEl[] = [
      { ...preview, brushCatalogId: "different-catalog" },
      { ...preview, brushCatalogName: "Different brush" },
      { ...preview, sampleSpacing: 99 },
      { ...preview, materialPressureModel: undefined },
      { ...preview, materialMinimumDiameterRatio: 0.9 },
      { ...preview, brushTip: { ...preview.brushTip!, roundness: 0.1 } },
      { ...preview, strokeStyle: { dash: "dot", lineCap: "round", arrowStart: "none", arrowEnd: "none" } },
      { ...preview, shapeParams: { ...preview.shapeParams!, cornerRadius: 99 } },
      { ...preview, sketch: { ...preview.sketch!, roughness: 0.25 } },
      { ...preview, symmetry: { ...preview.symmetry!, type: "vertical" } },
      { ...preview, brushDynamics: { ...preview.brushDynamics!, seed: 100 } },
    ];

    for (const authoritative of mismatchedAuthoritative) {
      const plan = planStudioLiveGesturePreviewRenderElements(
        [authoritative],
        [entry],
        new Set([entry.key]),
      );
      expect(plan.elements[0]).toBe(authoritative);
      expect(plan.previewElementIds.size).toBe(0);
      expect(plan.authoritativeHandoffIds).toEqual([entry.gestureId]);
    }
  });

  it("preserves authoritative layer structure when preview geometry replaces its slot", () => {
    const entry = freehandEntry();
    const lagging: El = {
      ...retainedPrefix(entry, [0, 0]),
      name: "Remote ink",
      hidden: true,
      locked: false,
      noClip: true,
      lockAspect: false,
      groupId: "group-a",
      clipBelow: true,
      alphaLocked: false,
      maskSrc: "mask-a",
      maskEnabled: false,
      layerRole: "lineart",
      layerColor: "violet",
      emeresSourceId: "custom:reference-a",
    };

    const plan = planStudioLiveGesturePreviewRenderElements(
      [lagging],
      [entry],
      new Set([entry.key]),
    );

    expect(plan.elements[0]).not.toBe(lagging);
    expect(plan.elements[0]).toMatchObject({
      id: "gesture-a",
      points: [0, 0, 10, 10, 20, 20],
      name: "Remote ink",
      hidden: true,
      locked: false,
      noClip: true,
      lockAspect: false,
      groupId: "group-a",
      clipBelow: true,
      alphaLocked: false,
      maskSrc: "mask-a",
      maskEnabled: false,
      layerRole: "lineart",
      layerColor: "violet",
      emeresSourceId: "custom:reference-a",
      opacity: 0.75,
      blendMode: "multiply",
    });
    expect(plan.previewElementIds).toEqual(new Set(["gesture-a"]));
  });

  it("inserts an absent preview exactly once and replaces a lagging freehand in the same slot", () => {
    const before = draw("before", [0, 0]);
    const after = draw("after", [0, 0]);
    const lagging = retainedPrefix(freehandEntry(), [0, 0]);
    const snapshot: StudioLiveGesturePreviewSnapshot = [freehandEntry()];

    const inserted = mergeStudioLiveGesturePreviewElements(
      [before],
      snapshot,
      eligibleKeys(snapshot),
    );
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toBe(before);
    expect(inserted[1]).toMatchObject({ id: "gesture-a", mode: "eraser" });

    const replaced = mergeStudioLiveGesturePreviewElements(
      [before, lagging, after],
      snapshot,
      eligibleKeys(snapshot),
    );
    expect(replaced).toHaveLength(3);
    expect(replaced[0]).toBe(before);
    expect(replaced[1]).not.toBe(lagging);
    expect(replaced[1]).toMatchObject({
      id: "gesture-a",
      mode: "eraser",
      points: [0, 0, 10, 10, 20, 20],
    });
    expect(replaced[2]).toBe(after);
  });

  it("uses authoritative freehand as soon as its sample count catches up", () => {
    const caughtUp = retainedPrefix(
      freehandEntry(),
      [100, 100, 110, 110, 120, 120],
    );
    const authoritative: readonly El[] = [caughtUp];

    const merged = mergeStudioLiveGesturePreviewElements(
      authoritative,
      [freehandEntry()],
      new Set([freehandEntry().key]),
    );
    expect(merged).toBe(authoritative);
    expect(merged[0]).toBe(caughtUp);
  });

  it("keeps matching authoritative shape endpoints and substitutes a stale endpoint in place", () => {
    const matching = retainedPrefix(shapeEntry(), [1, 2, 30, 40]);
    const matchingList: readonly El[] = [matching];
    const snapshot: StudioLiveGesturePreviewSnapshot = [shapeEntry()];
    expect(mergeStudioLiveGesturePreviewElements(
      matchingList,
      snapshot,
      eligibleKeys(snapshot),
    )).toBe(
      matchingList,
    );

    const stale = retainedPrefix(shapeEntry(), [1, 2, 3, 4]);
    const replaced = mergeStudioLiveGesturePreviewElements(
      [stale],
      snapshot,
      eligibleKeys(snapshot),
    );
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).not.toBe(stale);
    expect(replaced[0]).toMatchObject({ points: [1, 2, 30, 40] });
  });

  it("leaves authoritative elements untouched for retouch and duplicate preview ids", () => {
    const authoritative: readonly El[] = [draw("kept", [0, 0])];
    const retouch = freehandEntry({
      gestureId: "retouch-a",
      operation: "retouch",
      renderer: undefined,
      samples: undefined,
      retouch: {
        tool: "smudge",
        startIndex: 0,
        points: [0.1, 0.2],
        radiusNorm: 0.1,
        strength: 0.5,
      },
      sampleCount: 1,
    });
    const retouchSnapshot: StudioLiveGesturePreviewSnapshot = [retouch];
    expect(mergeStudioLiveGesturePreviewElements(
      authoritative,
      retouchSnapshot,
      eligibleKeys(retouchSnapshot),
    )).toBe(
      authoritative,
    );

    const duplicateIdSnapshot: StudioLiveGesturePreviewSnapshot = [
      freehandEntry(),
      freehandEntry({ key: "8:sender-bgesture-a", senderSessionId: "sender-b" }),
    ];
    // Both sender+gesture identities were independently pinned at begin time. The duplicate
    // authoritative id remains ambiguous and therefore fails closed.
    expect(
      mergeStudioLiveGesturePreviewElements(
        authoritative,
        duplicateIdSnapshot,
        eligibleKeys(duplicateIdSnapshot),
      ),
    ).toBe(authoritative);

    const duplicatePlan = planStudioLiveGesturePreviewRenderElements(
      authoritative,
      duplicateIdSnapshot,
      eligibleKeys(duplicateIdSnapshot),
    );
    expect(duplicatePlan.elements).toBe(authoritative);
    expect(duplicatePlan.previewElementIds).toEqual(new Set());
    expect(duplicatePlan.previewSequenceByElementId).toEqual(new Map());
    expect(duplicatePlan.authoritativeHandoffIds).toEqual([]);
    expect(duplicatePlan.authoritativeHandoffToken).toBe("[]");
  });

  it("fails closed for a duplicate authoritative id", () => {
    const entry = freehandEntry();
    const first = retainedPrefix(entry, [0, 0]);
    const second = retainedPrefix(entry, [0, 0, 10, 10, 20, 20]);
    const authoritative: readonly El[] = [first, second];

    const plan = planStudioLiveGesturePreviewRenderElements(
      authoritative,
      [entry],
      new Set([entry.key]),
    );

    expect(plan.elements).toBe(authoritative);
    expect(plan.previewElementIds).toEqual(new Set());
    expect(plan.previewSequenceByElementId).toEqual(new Map());
    expect(plan.authoritativeHandoffIds).toEqual([]);
    expect(plan.authoritativeHandoffToken).toBe("[]");
  });

  it("requires begin-time absent evidence for the exact sender and gesture key", () => {
    const preExisting = draw("gesture-a", [100, 100]);
    const authoritative: readonly El[] = [preExisting];
    const senderA = freehandEntry();
    const senderB = freehandEntry({
      key: "8:sender-bgesture-a",
      senderSessionId: "sender-b",
    });

    expect(mergeStudioLiveGesturePreviewElements(
      authoritative,
      [senderA],
      new Set(),
    )).toBe(authoritative);
    expect(mergeStudioLiveGesturePreviewElements(
      authoritative,
      [senderB],
      new Set([senderA.key]),
    )).toBe(authoritative);
    expect(mergeStudioLiveGesturePreviewElements(
      [],
      [senderA],
      new Set(),
    )).toEqual([]);
  });

  it("lets an incompatible authoritative renderer win instead of replacing it with a preview", () => {
    const authoritativePen = draw("gesture-a", [0, 0]);
    const snapshot: StudioLiveGesturePreviewSnapshot = [freehandEntry()];

    const merged = mergeStudioLiveGesturePreviewElements(
      [authoritativePen],
      snapshot,
      eligibleKeys(snapshot),
    );
    expect(merged[0]).toBe(authoritativePen);
    expect(studioLiveGesturePreviewAuthoritativeReceiptIds(
      [authoritativePen],
      snapshot,
      eligibleKeys(snapshot),
    )).toEqual(["gesture-a"]);
  });

  it("emits a receipt only after a compatible authoritative slot catches up", () => {
    const entry = freehandEntry();
    const snapshot: StudioLiveGesturePreviewSnapshot = [entry];
    const eligible = eligibleKeys(snapshot);
    const lagging = retainedPrefix(entry, [0, 0]);
    const caughtUp = retainedPrefix(entry, [0, 0, 10, 10, 20, 20]);
    const caughtUpAuthoritative: readonly El[] = [caughtUp];

    expect(studioLiveGesturePreviewAuthoritativeReceiptIds(
      [lagging],
      snapshot,
      eligible,
    )).toEqual([]);
    expect(studioLiveGesturePreviewAuthoritativeReceiptIds(
      [caughtUp],
      snapshot,
      eligible,
    )).toEqual(["gesture-a"]);

    const caughtUpPlan = planStudioLiveGesturePreviewRenderElements(
      caughtUpAuthoritative,
      snapshot,
      eligible,
    );
    expect(caughtUpPlan.elements).toBe(caughtUpAuthoritative);
    expect(caughtUpPlan.previewElementIds).toEqual(new Set());
    expect(caughtUpPlan.previewSequenceByElementId).toEqual(new Map());
    expect(caughtUpPlan.authoritativeHandoffIds).toEqual(["gesture-a"]);
    expect(caughtUpPlan.authoritativeHandoffToken).toBe(
      '[["gesture-a",3]]',
    );

    const nextEntry = freehandEntry({ seq: 4 });
    const nextPlan = planStudioLiveGesturePreviewRenderElements(
      [caughtUp],
      [nextEntry],
      new Set([nextEntry.key]),
    );
    expect(nextPlan.authoritativeHandoffToken).toBe('[["gesture-a",4]]');
    expect(studioLiveGesturePreviewAuthoritativeReceiptIds(
      [caughtUp],
      snapshot,
      new Set(),
    )).toEqual([]);

    const duplicatePreview: StudioLiveGesturePreviewSnapshot = [
      entry,
      freehandEntry({ key: "8:sender-bgesture-a", senderSessionId: "sender-b" }),
    ];
    expect(studioLiveGesturePreviewAuthoritativeReceiptIds(
      [caughtUp],
      duplicatePreview,
      eligibleKeys(duplicatePreview),
    )).toEqual([]);
  });
});
