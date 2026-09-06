import { describe, expect, it } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  type StudioDynamicBrushDab,
} from "./brush/studio-brush-dynamics";
import { materializeStudioBrushPackDynamics } from "./brush/studio-brush-pack-runtime";
import { buildStudioBrushTipAlphaMap } from "./brush/studio-brush-tip-stamp";
import { resolveStudioDynamicBrushMaterialIdentity } from "./brush/studio-dry-media-dynamic-bridge";
import { exportPageToSvg } from "./export/studio-svg-export";
import {
  planStudioDynamicBrushCoverageMarks,
  renderStudioDynamicBrushCoverageMark,
} from "./studio-dynamic-brush-coverage-renderer";
import {
  planStudioFlatNibRibbonCarrier,
  STUDIO_FLAT_NIB_RIBBON_MAX_STATIONS,
  STUDIO_FLAT_NIB_RIBBON_CARRIER_VERSION,
  type StudioFlatNibRibbonSourceMark,
} from "./studio-flat-nib-ribbon-carrier";

const ELIGIBLE = [
  "line-block",
  "clean-flat-marker",
  "alcohol-chisel-marker",
  "calligraphy-tilt-nib",
] as const;

function settings(id = "clean-flat-marker") {
  const result = materializeStudioBrushPackDynamics(id);
  if (!result) throw new Error(`missing settings: ${id}`);
  return result;
}

function dab(index: number): StudioDynamicBrushDab {
  return {
    index,
    progress: index / 8,
    sourceX: 24 + index * 5,
    sourceY: 36 + Math.sin(index * 0.35) * 3,
    direction: index === 0 ? 0 : 8 + index * 1.5,
    distanceFromPrevious: index === 0 ? 0 : 5,
    x: 24 + index * 5.01,
    y: 36 + Math.sin(index * 0.35) * 3.01,
    size: Math.max(4, 22 - index * 0.18),
    opacity: 0.82,
    flow: 0.78,
    spacing: 5,
    scatter: 0.2,
    angle: -18 + (index === 0 ? 0 : 8 + index * 1.5),
    roundness: 0.42,
  };
}

function sourceMark(
  id = "clean-flat-marker",
  index = 0,
): StudioFlatNibRibbonSourceMark {
  const dynamics = settings(id);
  const alphaMap = buildStudioBrushTipAlphaMap(dynamics.tip);
  if (!alphaMap) throw new Error(`missing alpha map: ${id}`);
  const source = dab(index);
  return {
    x: source.x,
    y: source.y,
    radiusX: source.size / 2,
    radiusY: source.size / 2 * source.roundness,
    angleRadians: source.angle * Math.PI / 180,
    alpha: source.opacity * source.flow,
    color: "#172033",
    texture: { kind: "alpha-map", alphaMap },
  };
}

function identity(id: string) {
  const result = resolveStudioDynamicBrushMaterialIdentity("ink-particle", id);
  if (!result) throw new Error(`missing identity: ${id}`);
  return result;
}

describe("flat/chisel connected ribbon carrier", () => {
  it.each(ELIGIBLE)("opts only the audited built-in material into a connected carrier: %s", (id) => {
    const dynamics = settings(id);
    const result = planStudioFlatNibRibbonCarrier({
      dabs: [dab(0), dab(1)],
      marks: [sourceMark(id, 0), sourceMark(id, 1)],
      materialIdentity: identity(id),
      dynamics,
    });

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.catalogId).toBe(id);
    expect(result.marks).toHaveLength(2);
    expect(result.marks[0]?.ribbon).toMatchObject({
      kind: "flat-nib-ribbon-polygon",
      version: STUDIO_FLAT_NIB_RIBBON_CARRIER_VERSION,
      role: "tap",
    });
    expect(result.marks[1]?.ribbon.role).toBe("segment");
    expect(result.marks.every((mark) => (
      mark.ribbon.polygons.length > 0
      && mark.ribbon.polygons.every((points) => (
        points.length >= 6
        && points.length % 2 === 0
        && points.every(Number.isFinite)
      ))
      && !("texture" in mark)
    ))).toBe(true);
    expect(result.marks[0]?.ribbon.polygons).toHaveLength(
      id === "line-block" ? 2 : 1,
    );
  });

  it("keeps non-audited flat markers, grain, dual tips and layers on their authored renderer", () => {
    const base = settings();
    const cases = [
      {
        materialIdentity: identity("marker-wide-chisel"),
        dynamics: base,
      },
      {
        materialIdentity: identity("clean-flat-marker"),
        dynamics: normalizeStudioBrushDynamicsSettings({
          ...base,
          grain: { ...base.grain, amount: 0.2 },
        }),
      },
      {
        materialIdentity: identity("clean-flat-marker"),
        dynamics: normalizeStudioBrushDynamicsSettings({
          ...base,
          dualBrush: { enabled: true, tip: base.tip },
        }),
      },
      {
        materialIdentity: identity("clean-flat-marker"),
        dynamics: normalizeStudioBrushDynamicsSettings({
          ...base,
          tipLayers: [{
            tip: base.tip,
            scale: 0.5,
            opacity: 0.4,
          }],
        }),
      },
    ];
    for (const input of cases) {
      const marks = [sourceMark()];
      const result = planStudioFlatNibRibbonCarrier({
        dabs: [dab(0)],
        marks,
        ...input,
      });
      expect(result).toMatchObject({
        applied: false,
        reason: "ineligible-material",
        marks,
      });
    }
  });

  it("is prefix stable for incremental live append and full committed replay", () => {
    const dabs = Array.from({ length: 96 }, (_, index) => dab(index));
    const marks = dabs.map((_, index) => sourceMark("clean-flat-marker", index));
    const dynamics = settings();
    const full = planStudioFlatNibRibbonCarrier({
      dabs,
      marks,
      materialIdentity: identity("clean-flat-marker"),
      dynamics,
    });
    const prefix = planStudioFlatNibRibbonCarrier({
      dabs: dabs.slice(0, 41),
      marks: marks.slice(0, 41),
      materialIdentity: identity("clean-flat-marker"),
      dynamics,
    });
    const suffix = planStudioFlatNibRibbonCarrier({
      dabs: dabs.slice(41),
      marks: marks.slice(41),
      materialIdentity: identity("clean-flat-marker"),
      dynamics,
    });
    expect(full.applied).toBe(true);
    expect(prefix.applied).toBe(true);
    expect(suffix.applied).toBe(true);
    if (!full.applied || !prefix.applied || !suffix.applied) return;
    expect(prefix.marks).toEqual(full.marks.slice(0, prefix.marks.length));
    expect(suffix.marks).toEqual(full.marks.slice(prefix.marks.length));
  });

  it("removes stamp-centre scatter while preserving the authored causal station", () => {
    const dynamics = settings();
    const source = dab(4);
    const ordinaryMark = sourceMark("clean-flat-marker", 4);
    const scatteredMark = {
      ...ordinaryMark,
      x: ordinaryMark.x + 19,
      y: ordinaryMark.y - 13,
    };
    const ordinary = planStudioFlatNibRibbonCarrier({
      dabs: [source],
      marks: [ordinaryMark],
      materialIdentity: identity("clean-flat-marker"),
      dynamics,
    });
    const scattered = planStudioFlatNibRibbonCarrier({
      dabs: [source],
      marks: [scatteredMark],
      materialIdentity: identity("clean-flat-marker"),
      dynamics,
    });
    expect(ordinary.applied).toBe(true);
    expect(scattered.applied).toBe(true);
    if (!ordinary.applied || !scattered.applied) return;
    expect(scattered.marks[0]?.ribbon).toEqual(ordinary.marks[0]?.ribbon);
  });

  it("keeps the station work ceiling explicit and fail-closed", () => {
    const hugeDabs = {
      length: STUDIO_FLAT_NIB_RIBBON_MAX_STATIONS + 1,
    } as unknown as readonly StudioDynamicBrushDab[];
    const hugeMarks = {
      length: STUDIO_FLAT_NIB_RIBBON_MAX_STATIONS + 1,
    } as unknown as readonly StudioFlatNibRibbonSourceMark[];
    expect(planStudioFlatNibRibbonCarrier({
      dabs: hugeDabs,
      marks: hugeMarks,
      materialIdentity: identity("clean-flat-marker"),
      dynamics: settings(),
    })).toMatchObject({
      applied: false,
      reason: "station-budget",
    });
  });

  it("lowers the shared coverage plan to polygons and renders no ellipse or texture stamp", () => {
    const dynamics = settings();
    const dabs = Array.from({ length: 12 }, (_, index) => dab(index));
    const planned = planStudioDynamicBrushCoverageMarks({
      dabVariations: [dabs],
      dynamics,
      materialIdentity: identity("clean-flat-marker"),
      dynamicSeed: 73,
      stroke: "#172033",
      stampGrid: 7,
      markBudget: 1_024,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.marks).toHaveLength(dabs.length);
    expect(planned.marks.every((mark) => mark.ribbon !== undefined)).toBe(true);

    const calls: string[] = [];
    const context = {
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
      beginPath: () => calls.push("begin"),
      moveTo: () => calls.push("move"),
      lineTo: () => calls.push("line"),
      closePath: () => calls.push("close"),
      fill: () => calls.push("fill"),
      ellipse: () => calls.push("ellipse"),
      arc: () => calls.push("arc"),
      drawImage: () => calls.push("image"),
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      createRadialGradient: () => ({ addColorStop: () => {} }),
    } as never;
    renderStudioDynamicBrushCoverageMark(context, planned.marks[1]!);
    expect(calls).toContain("fill");
    expect(calls).not.toContain("ellipse");
    expect(calls).not.toContain("arc");
    expect(calls).not.toContain("image");
  });

  it("keeps live suffix coverage marks byte-identical to the committed full-plan slice", () => {
    const dynamics = settings("alcohol-chisel-marker");
    const dabs = Array.from({ length: 28 }, (_, index) => dab(index));
    const shared = {
      dynamics,
      materialIdentity: identity("alcohol-chisel-marker"),
      dynamicSeed: 811,
      stroke: "#842b45",
      stampGrid: 7 as const,
      markBudget: 1_024,
    };
    const full = planStudioDynamicBrushCoverageMarks({
      ...shared,
      dabVariations: [dabs],
    });
    const livePrefix = planStudioDynamicBrushCoverageMarks({
      ...shared,
      dabVariations: [dabs.slice(0, 11)],
    });
    const liveSuffix = planStudioDynamicBrushCoverageMarks({
      ...shared,
      dabVariations: [dabs.slice(11)],
    });
    expect(full.ok).toBe(true);
    expect(livePrefix.ok).toBe(true);
    expect(liveSuffix.ok).toBe(true);
    if (!full.ok || !livePrefix.ok || !liveSuffix.ok) return;
    expect(livePrefix.marks).toEqual(full.marks.slice(0, 11));
    expect(liveSuffix.marks).toEqual(full.marks.slice(11));
  });

  it("serializes the same connected polygons to SVG instead of reviving alpha-map stamps", () => {
    const dynamics = settings("calligraphy-tilt-nib");
    const exported = exportPageToSvg({
      width: 320,
      height: 180,
      bg: "#ffffff",
      elements: [{
        id: "flat-nib-svg-parity",
        type: "draw",
        kind: "freehand",
        mode: "pen",
        brush: "ink-particle",
        brushCatalogId: "calligraphy-tilt-nib",
        brushDynamics: dynamics,
        paintModel: "bounded-flow-v2",
        points: [24, 90, 82, 72, 146, 102, 218, 68, 292, 92],
        pressures: [0.45, 0.62, 0.84, 0.7, 0.56],
        tiltXs: [32, 35, 38, 34, 31],
        tiltYs: [18, 20, 22, 19, 17],
        twists: [4, 6, 8, 10, 12],
        stroke: "#172033",
        strokeWidth: 16,
        opacity: 0.82,
      }],
    });
    expect(exported.skipped).toEqual([]);
    expect(exported.svg).toContain('data-brush-coverage="flat-nib-ribbon"');
    expect(exported.svg).not.toContain('data-brush-coverage="alpha-map"');
  });

  it("rejects geometry that cannot reproduce a suffix without guessing", () => {
    const withoutTravel = { ...dab(1), direction: undefined };
    const result = planStudioFlatNibRibbonCarrier({
      dabs: [withoutTravel],
      marks: [sourceMark()],
      materialIdentity: identity("clean-flat-marker"),
      dynamics: settings(),
    });
    expect(result).toMatchObject({
      applied: false,
      reason: "invalid-geometry",
    });
  });
});
