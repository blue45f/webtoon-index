import { describe, expect, it } from "vitest";

import { studioCoreBrushCatalogSelection } from "../brush/studio-brush-selection";
import { planStudioDrawPointerStart } from "../brush/studio-draw-pointer-start-plan";
import { exportPageToSvg } from "../export/studio-svg-export";
import { studioCrdtStrokeToDrawElement, studioDrawElementToCrdtStroke } from "../live/studio-crdt-page-bridge";
import { BRUSH_PRESETS } from "../studio-brush";

import { verifyStudioEngineVNextBrushLifecycleParity } from "./studio-engine-vnext-brush-lifecycle-parity";

import type { StudioBrushCatalogSelection } from "../brush/studio-brush-selection";
import type { DrawEl } from "../studio-element-model";

const REPRESENTATIVE_CATALOG_IDS = [
  "pen",
  "fineliner",
  "gpen",
  "mapping-pen",
  "liner",
  "watercolor",
  "airbrush",
  "dry-media",
] as const;

function selection(catalogId: string): StudioBrushCatalogSelection {
  const preset = BRUSH_PRESETS.find((candidate) => candidate.id === catalogId);
  if (!preset) throw new Error(`Missing core preset ${catalogId}`);
  return studioCoreBrushCatalogSelection(preset);
}

function startStroke(current: StudioBrushCatalogSelection): DrawEl {
  return planStudioDrawPointerStart({
    id: `lifecycle-${current.catalogId}`,
    position: { x: 10, y: 20 },
    pointer: {
      pointerType: "pen",
      pressure: 0.42,
      tiltX: 12,
      tiltY: -8,
      twist: 30,
      tangentialPressure: 0.1,
      altitudeAngle: 0.8,
      azimuthAngle: 1.1,
      width: 2,
      height: 1.5,
      timeStamp: 1_000,
    },
    drawMode: "pen",
    drawShape: "line",
    shapeFill: false,
    color: "#315cdd",
    strokeWidth: current.defaultWidth,
    brushOpacity: current.defaultOpacity,
    brush: current.runtimeBrushId,
    brushCatalogId: current.catalogId,
    brushCatalogName: current.catalogName,
    stampTuning: null,
    brushDynamics: current.brushDynamics,
    stabilizer: 0,
    stabilizerMode: "standard",
    velocitySensitivity: 0.65,
    pressureCurve: 1,
    pressureMinSize: 0,
    positionScale: 1,
    brushTip: { tiltEnabled: true, angleDeg: 0, roundness: 1 },
    symmetry: { type: "none", centerX: 360, centerY: 500, radialCount: 6 },
  }).element;
}

interface AddedSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly time: number;
}

function withSamples(start: DrawEl, samples: readonly AddedSample[]): DrawEl {
  const next = structuredClone(start);
  for (const [index, sample] of samples.entries()) {
    next.points.push(sample.x, sample.y);
    next.pressures?.push(sample.pressure);
    next.tiltXs?.push(12 + index);
    next.tiltYs?.push(-8 - index);
    next.twists?.push(30 + index * 5);
    next.speeds?.push(1 + index * 0.1);
    next.tangentialPressures?.push(0.1);
    next.altitudeAngles?.push(0.8);
    next.azimuthAngles?.push(1.1);
    next.contactWidths?.push(2);
    next.contactHeights?.push(1.5);
    next.sampleTimeOffsets?.push(sample.time);
  }
  return next;
}

function reopenThroughCrdt(element: DrawEl): DrawEl {
  const input = studioDrawElementToCrdtStroke("page-lifecycle", element);
  const reopened = studioCrdtStrokeToDrawElement({
    ...input,
    status: "finalized",
    deleted: false,
    orderIndex: 0,
  });
  if (reopened.kind !== "freehand") {
    throw new Error("CRDT lifecycle fixture reopened with a non-freehand geometry.");
  }
  return reopened as DrawEl;
}

describe("Engine vNext Brush Library lifecycle parity", () => {
  it.each(REPRESENTATIVE_CATALOG_IDS)(
    "keeps %s selection → live → commit → CRDT reopen → SVG export on one canonical recipe",
    (catalogId) => {
      const current = selection(catalogId);
      const start = startStroke(current);
      const live = withSamples(start, [
        { x: 16, y: 24, pressure: 0.58, time: 4 },
      ]);
      const commit = withSamples(start, [
        { x: 16, y: 24, pressure: 0.58, time: 4 },
        { x: 25, y: 31, pressure: 0.76, time: 8 },
        { x: 35, y: 28, pressure: 0.64, time: 12 },
      ]);
      const reopened = reopenThroughCrdt(commit);
      const exportSnapshot = structuredClone(reopened);
      const exported = exportPageToSvg({
        width: 720,
        height: 1_000,
        bg: "#ffffff",
        elements: [exportSnapshot],
      });

      expect(exported.svg).toContain("<svg");
      expect(exported.elementCount).toBe(1);
      const result = verifyStudioEngineVNextBrushLifecycleParity({
        selection: current,
        live,
        commit,
        reopened,
        exportSnapshot,
      });
      if (result.status !== "verified") {
        throw new Error(JSON.stringify(result));
      }
      expect(result.status).toBe("verified");
      expect(result.receipt).toMatchObject({
        catalogId,
        runtimeBrushId: current.runtimeBrushId,
        liveIsCommitPrefix: true,
        sameCanonicalRecipe: true,
        sameVisualContract: true,
        sameCommittedStroke: true,
        complete: true,
      });
      expect(result.receipt.phases.live.authoritativeSampleCount).toBe(2);
      expect(result.receipt.phases.commit.authoritativeSampleCount).toBe(4);
      expect(result.receipt.phases.reopen.strokeContentDigest).toBe(
        result.receipt.phases.commit.strokeContentDigest,
      );
      expect(result.receipt.phases.export.strokeContentDigest).toBe(
        result.receipt.phases.commit.strokeContentDigest,
      );
      expect(new Set([
        result.receipt.phases.live.canonicalPlanHash,
        result.receipt.phases.commit.canonicalPlanHash,
        result.receipt.phases.reopen.canonicalPlanHash,
        result.receipt.phases.export.canonicalPlanHash,
      ]).size).toBeGreaterThan(1);
      if (catalogId === "watercolor") {
        expect(current.brushDynamics?.dualBrush).toMatchObject({
          enabled: true,
          blendMode: "screen",
          sizeRatio: 1.42,
        });
        expect(result.receipt.recipeDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(result.receipt.visualContractDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
    },
  );

  it("fails closed when CRDT reopen changes one visual recipe field", () => {
    const current = selection("gpen");
    const commit = withSamples(startStroke(current), [
      { x: 16, y: 24, pressure: 0.58, time: 4 },
      { x: 25, y: 31, pressure: 0.76, time: 8 },
    ]);
    const reopened = reopenThroughCrdt(commit);
    const changed = { ...reopened, strokeWidth: reopened.strokeWidth + 1 };
    const result = verifyStudioEngineVNextBrushLifecycleParity({
      selection: current,
      live: commit,
      commit,
      reopened: changed,
      exportSnapshot: changed,
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "recipe-mismatch",
    });
  });

  it("does not silently reinterpret an unversioned dynamic stroke as bounded flow", () => {
    const current = selection("airbrush");
    const stroke = withSamples(startStroke(current), [
      { x: 18, y: 24, pressure: 0.62, time: 4 },
    ]);
    const legacy = { ...stroke, paintModel: undefined };
    const result = verifyStudioEngineVNextBrushLifecycleParity({
      selection: current,
      live: legacy,
      commit: legacy,
      reopened: legacy,
      exportSnapshot: structuredClone(legacy),
    });

    expect(stroke.paintModel).toBe("bounded-flow-v2");
    expect(result).toMatchObject({
      status: "rejected",
      reason: "canonical-adapter-rejected",
      phase: "live",
    });
    if (result.status === "rejected") {
      expect(result.detail).toMatch(/unsupported-(dynamics|brush)/);
    }
  });

  it("rejects a live path that is not an exact prefix of commit", () => {
    const current = selection("pen");
    const start = startStroke(current);
    const live = withSamples(start, [
      { x: 99, y: 24, pressure: 0.58, time: 4 },
    ]);
    const commit = withSamples(start, [
      { x: 16, y: 24, pressure: 0.58, time: 4 },
      { x: 25, y: 31, pressure: 0.76, time: 8 },
    ]);
    const reopened = reopenThroughCrdt(commit);
    const result = verifyStudioEngineVNextBrushLifecycleParity({
      selection: current,
      live,
      commit,
      reopened,
      exportSnapshot: structuredClone(reopened),
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "live-prefix-mismatch",
      phase: "live",
    });
  });
});
