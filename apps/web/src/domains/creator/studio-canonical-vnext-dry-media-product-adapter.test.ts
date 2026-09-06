import { describe, expect, it } from "vitest";

import { normalizeStudioBrushDynamicsSettings } from "./brush/studio-brush-dynamics";
import { materializeAllStudioBrushPackSelections } from "./brush/studio-brush-pack-runtime";
import { validateStudioCanonicalVNextDryMediaCompiledFrame } from "./studio-canonical-vnext-dry-media-presentation-controller";
import {
  compileStudioCanonicalVNextDryMediaProductFrame,
  type StudioCanonicalVNextDryMediaProductCompileResult,
} from "./studio-canonical-vnext-dry-media-product-adapter";

import type { DrawEl } from "./studio-element-model";

function shippedPastelElement(
  overrides: Partial<DrawEl> = {},
): DrawEl {
  const selection = materializeAllStudioBrushPackSelections().find(
    ({ catalogId }) => catalogId === "pastel-paper-soft",
  );
  if (!selection) throw new Error("missing shipped pastel-paper-soft brush");
  const pointCount = 120;
  const points: number[] = [];
  const pressures: number[] = [];
  const speeds: number[] = [];
  const tiltXs: number[] = [];
  const tiltYs: number[] = [];
  const twists: number[] = [];
  const tangentialPressures: number[] = [];
  for (let index = 0; index < pointCount; index += 1) {
    const progress = index / (pointCount - 1);
    points.push(
      24 + progress * 620,
      180 + Math.sin(progress * Math.PI * 2.4) * 72,
    );
    pressures.push(0.18 + progress * 0.76);
    speeds.push(index === 0 ? 0 : 0.55 + progress);
    tiltXs.push(12 + progress * 24);
    tiltYs.push(-8 + progress * 18);
    twists.push(progress * 120);
    tangentialPressures.push(0);
  }
  return {
    id: "selected-shipped-pastel",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points,
    pressures,
    speeds,
    tiltXs,
    tiltYs,
    twists,
    tangentialPressures,
    stroke: "#334155",
    strokeWidth: selection.defaultWidth,
    // Product pointer-start stamps the bounded-flow-v2 seam (with causal sampleSpacing) on every
    // pen stroke with retained dynamics; the specialist only admits the unit-opacity identity form
    // of that seam. Legacy seamless strokes intentionally stay on the retained Canvas authority.
    opacity: 1,
    paintModel: "bounded-flow-v2",
    sampleSpacing: 1,
    brush: selection.runtimeBrushId,
    brushCatalogId: selection.catalogId,
    brushCatalogName: selection.catalogName,
    brushDynamics: selection.brushDynamics,
    ...overrides,
  };
}

async function ready(
  element: DrawEl,
): Promise<Extract<
  StudioCanonicalVNextDryMediaProductCompileResult,
  { readonly status: "ready" }
>> {
  const result = await compileStudioCanonicalVNextDryMediaProductFrame({
    element,
    sessionEpoch: 1,
    strokeEpoch: 1,
    commandSequence: 1,
  });
  if (result.status !== "ready") {
    throw new Error(`compile failed with status=${result.status} reason=${result.reason} detail=${result.detail ?? ""}`);
  }
  expect(result.status).toBe("ready");
  return result;
}

function axisDelta(left: number, right: number): number {
  let delta = Math.abs(left - right) % Math.PI;
  if (delta > Math.PI / 2) delta = Math.PI - delta;
  return delta;
}

describe("canonical vNext dry-media product adapter", () => {
  it("compiles a real shipped pastel curve into continuous directional multi-fibre RGBA16F work", async () => {
    const result = await ready(shippedPastelElement());
    const { frame } = result;

    expect(validateStudioCanonicalVNextDryMediaCompiledFrame(frame)).toMatchObject({
      status: "ready",
    });
    expect(result.laneCount).toBe(5);
    expect(result.texturedDabCount).toBe(result.sourceDabCount * result.laneCount);
    expect(result.texturedDabCount).toBeGreaterThan(1_000);
    expect(frame.canonicalPlan.recipe.brushId).toBe(
      `dry-media-resolved:${result.dynamicPlanDigest.slice("sha256:".length)}`,
    );
    expect(frame.texturedPlan.textureFormat).toBe("rgba16float");
    expect(frame.texturedPlan.mode).toBe("rebuild");
    expect(frame.texturedPlan.assets).toHaveLength(1);
    expect(frame.texturedPlan.grain).not.toBeNull();

    const groups = new Map<string, typeof frame.texturedPlan.dabs>();
    for (const dab of frame.texturedPlan.dabs) {
      const key = `${dab.stationX}:${dab.stationY}`;
      groups.set(key, [...(groups.get(key) ?? []), dab]);
      const [xx, xy, yx, yy] = dab.tip.localToDocument;
      const xRadius = Math.hypot(xx, xy);
      const yRadius = Math.hypot(yx, yy);
      expect(Math.min(xRadius, yRadius) / Math.max(xRadius, yRadius)).toBeLessThanOrEqual(0.9);
      expect(dab.color.components[3]).toBeGreaterThan(0);
      expect(dab.composite.porterDuff).toBe("source-over");
    }
    expect([...groups.values()].every((group) => group.length === 5)).toBe(true);

    const grouped = [...groups.values()];
    for (let index = 0; index < grouped.length; index += 1) {
      const current = grouped[index]!;
      const previous = grouped[Math.max(0, index - 1)]!;
      const next = grouped[Math.min(grouped.length - 1, index + 1)]!;
      const tangent = Math.atan2(
        next[0]!.stationY - previous[0]!.stationY,
        next[0]!.stationX - previous[0]!.stationX,
      );
      for (const dab of current) {
        const [xx, xy, yx, yy] = dab.tip.localToDocument;
        const majorAngle = Math.hypot(xx, xy) >= Math.hypot(yx, yy)
          ? Math.atan2(xy, xx)
          : Math.atan2(yy, yx);
        expect(axisDelta(majorAngle, tangent)).toBeLessThan(Math.PI / 5);
      }
    }
  });

  it("is deterministic and binds the full retained dynamics identity without replacing DrawEl", async () => {
    const element = shippedPastelElement();
    const first = await ready(element);
    const second = await ready(structuredClone(element));

    expect(second.dynamicPlanDigest).toBe(first.dynamicPlanDigest);
    expect(second.frame).toEqual(first.frame);
    expect(first.frame.canonicalPlan.strokeId).toBe(element.id);
    expect(first.frame.canonicalPlan.source.samples).toHaveLength(
      element.points.length / 2,
    );
  });

  it("admits unit-opacity bounded flow only when its final stroke composite is an identity", async () => {
    const element = shippedPastelElement({
      opacity: 1,
      paintModel: "bounded-flow-v2",
      sampleSpacing: 1,
    });
    const result = await ready(element);

    expect(result.frame.canonicalPlan.composite.opacity).toBe(1);
    expect(result.frame.canonicalPlan.strokeId).toBe(element.id);
  });

  it("retains Canvas for incomplete dual-tip, motif, destructive and external-grain routes", async () => {
    const base = shippedPastelElement();
    const baseDynamics = normalizeStudioBrushDynamicsSettings(base.brushDynamics);
    const candidates: Array<readonly [
      DrawEl,
      Exclude<StudioCanonicalVNextDryMediaProductCompileResult, { status: "ready" }>["reason"],
    ]> = [
      [{
        ...base,
        id: "dual-tip",
        brushDynamics: normalizeStudioBrushDynamicsSettings({
          ...baseDynamics,
          dualBrush: { enabled: true, tip: { shape: "hard" } },
        }),
      }, "unsupported-multi-tip"],
      [{
        ...base,
        id: "motif",
        brushCatalogId: "canvas-weave",
      }, "ineligible-material"],
      [{
        ...base,
        id: "erase",
        mode: "eraser",
      }, "invalid-input"],
      [{
        ...base,
        id: "paint-roller",
        brushCatalogId: "paint-roller",
      }, "unsupported-paint-roller"],
      [{
        ...base,
        id: "bounded-flow-opacity",
        opacity: 0.72,
        paintModel: "bounded-flow-v2",
        sampleSpacing: 1,
      }, "unsupported-paint-model"],
    ];

    for (const [element, reason] of candidates) {
      await expect(compileStudioCanonicalVNextDryMediaProductFrame({
        element,
        sessionEpoch: 1,
        strokeEpoch: 1,
        commandSequence: 1,
      })).resolves.toMatchObject({
        status: "unavailable",
        reason,
      });
    }
  });
});
