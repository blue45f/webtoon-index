import { describe, expect, it } from "vitest";

import {
  planNormalizedStudioDynamicBrushDabs,
  resolveStudioBrushDynamics,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
} from "./studio-brush-dynamics";
import {
  STUDIO_BRUSH_PACK_CARRIER_TUNING_IDS,
  STUDIO_BRUSH_PACK_EXPANSION_WAVE_IDS,
  STUDIO_BRUSH_PACK_VISIBILITY_TUNING_IDS,
  STUDIO_BRUSH_PACK_MATERIAL_WAVE_IDS,
  studioBrushPackExpansionTuningById,
} from "./studio-brush-pack-expansion";
import { STUDIO_BRUSH_PACK_CATALOG_IDS } from "./studio-brush-pack-id";
import { STUDIO_BRUSH_PACK_DESCRIPTORS } from "./studio-brush-pack-index";
import {
  STUDIO_BRUSH_PACK_CUSTOM_TIP_MOTIFS,
  materializeAllStudioBrushPackSelections,
  materializeStudioBrushPackDynamics,
  materializeStudioBrushPackSelection,
  materializeStudioBrushPackTipSettings,
  studioBrushPackRuntimeSignature,
} from "./studio-brush-pack-runtime";
import { STUDIO_BRUSH_TIP_LAYER_MAX_COUNT } from "./studio-brush-tip-composition";
import {
  buildStudioBrushTipAlphaMap,
  decodeStudioBrushTipAlphaMapBase64,
  STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE,
} from "./studio-brush-tip-stamp";

function expectFiniteNumbers(value: unknown, path = "root"): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), path).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => expectFiniteNumbers(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      expectFiniteNumbers(entry, `${path}.${key}`);
    }
  }
}

function alphaSignature(values: Float32Array): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= Math.round(value * 255);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function withoutSeedFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSeedFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === "seed" ? 0 : withoutSeedFields(entry),
  ]));
}

describe("procedural brush pack runtime", () => {
  it("materializes all 160 descriptors into the shared selection contract", () => {
    const selections = materializeAllStudioBrushPackSelections();
    expect(selections).toHaveLength(160);
    expect(selections.map((selection) => selection.catalogId)).toEqual(
      STUDIO_BRUSH_PACK_CATALOG_IDS
    );
    expect(selections.every(
      ({ brushDynamics }) => brushDynamics.depositPipeline
        === STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3
    )).toBe(true);
    const dryMediaSelections = selections.filter(
      ({ runtimeBrushId }) => runtimeBrushId === "dry-media"
    );
    expect(dryMediaSelections).toHaveLength(61);
    expect(dryMediaSelections.every(
      ({ brushDynamics }) => brushDynamics.depositPipeline
        === STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3
    )).toBe(true);

    for (const [index, selection] of selections.entries()) {
      const descriptor = STUDIO_BRUSH_PACK_DESCRIPTORS[index]!;
      expect(selection).toMatchObject({
        catalogId: descriptor.catalogId,
        catalogName: descriptor.catalogName,
        defaultWidth: descriptor.defaultWidth,
        defaultOpacity: descriptor.defaultOpacity,
        operation: "paint",
        runtimeBrushId: descriptor.runtimeBrushId,
        mediaGroup: descriptor.mediaGroup,
        previewStyle: descriptor.previewStyle,
        shortName: descriptor.shortName,
        hint: descriptor.hint,
      });
      expect(["ink-particle", "airbrush", "dry-media"]).toContain(selection.runtimeBrushId);
      expectFiniteNumbers(selection.brushDynamics, selection.catalogId);
      expect(selection.brushDynamics.width.base).toBe(selection.defaultWidth);
      // Element opacity is the sole catalogue-default multiplier; dynamics stays neutral to avoid
      // squaring low-opacity presets before flow and pressure are evaluated.
      expect(selection.brushDynamics.opacity.base).toBe(1);
      expect(materializeStudioBrushPackSelection(selection.catalogId)).toEqual(selection);
      expect(materializeStudioBrushPackDynamics(selection.catalogId)).toEqual(selection.brushDynamics);
    }
  });

  it("generates deterministic original alpha tips for every custom motif", () => {
    const signatures = new Set<string>();
    for (const [index, motif] of STUDIO_BRUSH_PACK_CUSTOM_TIP_MOTIFS.entries()) {
      const first = materializeStudioBrushPackTipSettings(motif, index + 17, 0.12);
      const second = materializeStudioBrushPackTipSettings(motif, index + 17, 0.12);
      expect(first).toEqual(second);
      expect(first.alphaMapSize).toBe(STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE);
      expect(200 / first.alphaMapSize).toBeLessThanOrEqual(3.125);
      expect(first.alphaMapBase64).not.toBeNull();
      const bytes = decodeStudioBrushTipAlphaMapBase64(first.alphaMapBase64);
      expect(bytes).not.toBeNull();
      expect(bytes).toHaveLength(first.alphaMapSize * first.alphaMapSize);

      const firstMap = buildStudioBrushTipAlphaMap(first);
      const secondMap = buildStudioBrushTipAlphaMap(second);
      expect(firstMap.custom).toBe(true);
      expect(Array.from(firstMap.alphas)).toEqual(Array.from(secondMap.alphas));
      expect(firstMap.alphas.some((alpha) => alpha > 0.5), `${motif}: invisible tip`).toBe(true);
      signatures.add(alphaSignature(firstMap.alphas));
    }
    expect(signatures.size).toBe(STUDIO_BRUSH_PACK_CUSTOM_TIP_MOTIFS.length);
  });

  it("keeps every bundled custom motif at the full document-safe R8 resolution", () => {
    const customTips = materializeAllStudioBrushPackSelections()
      .flatMap(({ brushDynamics }) => [
        brushDynamics.tip,
        ...(brushDynamics.dualBrush?.enabled ? [brushDynamics.dualBrush.tip] : []),
        ...brushDynamics.tipLayers.map(({ tip }) => tip),
      ])
      .filter((tip) => tip.alphaMapBase64 !== null);

    expect(customTips.length).toBeGreaterThanOrEqual(88);
    expect(customTips.every(
      ({ alphaMapSize }) => alphaMapSize === STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE,
    )).toBe(true);
  });

  it("gives all 160 catalogue brushes a distinct deterministic runtime fingerprint", () => {
    const first = STUDIO_BRUSH_PACK_CATALOG_IDS.map(studioBrushPackRuntimeSignature);
    const second = STUDIO_BRUSH_PACK_CATALOG_IDS.map(studioBrushPackRuntimeSignature);
    const physical = materializeAllStudioBrushPackSelections().map((selection) => JSON.stringify(withoutSeedFields({
      runtimeBrushId: selection.runtimeBrushId,
      brushDynamics: selection.brushDynamics,
    })));
    expect(first).toEqual(second);
    expect(first.every((signature) => typeof signature === "string" && signature.length > 100)).toBe(true);
    expect(new Set(first).size).toBe(160);
    // Neither the stroke seed nor nested grain seeds may be the sole differentiator.
    expect(new Set(physical).size).toBe(160);
  });

  it("plans a finite, visible, deterministic engine stroke for every catalogue preset", () => {
    for (const selection of materializeAllStudioBrushPackSelections()) {
      const input = {
        baseOpacity: selection.defaultOpacity,
        baseWidth: selection.defaultWidth,
        directions: [0, 18, -12, 24],
        maxDabs: 512,
        points: [4, 28, 24, 10, 48, 34, 76, 16],
        pressures: [0.28, 0.64, 0.86, 0.48],
        seed: 0x13ad_beef,
        speeds: [0.2, 0.8, 1.4, 0.5],
        tiltXs: [0, 24, 48, 12],
        tiltYs: [0, -18, 36, 10],
      };
      const first = planNormalizedStudioDynamicBrushDabs(input, selection.brushDynamics);
      const replay = planNormalizedStudioDynamicBrushDabs(input, selection.brushDynamics);
      expect(first, `${selection.catalogId}: no planned dabs`).not.toHaveLength(0);
      expect(replay, `${selection.catalogId}: non-deterministic dabs`).toEqual(first);
      for (const [dabIndex, dab] of first.entries()) {
        expectFiniteNumbers(dab, `${selection.catalogId}.dabs[${dabIndex}]`);
        expect(dab.size, `${selection.catalogId}: invisible size`).toBeGreaterThan(0);
        expect(dab.opacity * dab.flow, `${selection.catalogId}: invisible flow`).toBeGreaterThan(0);
      }
      const alphaMap = buildStudioBrushTipAlphaMap(selection.brushDynamics.tip);
      expect(
        alphaMap.alphas.some((alpha) => alpha > 0),
        `${selection.catalogId}: empty tip alpha`
      ).toBe(true);
    }
  });

  it("audits neutral-pressure first marks without flattening intentionally transparent media", () => {
    const intentionallyLight = new Set([
      "marker-colorless-blender",
      "cloud-billow-soft",
      "watercolor-flat-wash",
      "bleeding-stain",
      "cotton-fiber",
      "watercolor-edge-stain",
      "transparent-flat",
      "cloud-cirrus-stream",
      "fur-undercoat-soft",
      "smoke-wisp-layered",
      "watercolor-backrun-ring",
    ]);
    const visibilityCorrectedSoftMedia = new Set([
      "airbrush-grand-soft",
      "bokeh-scatter",
      "cloud-soft",
      "mist-soft",
      "watercolor-wet-bleed",
      "watercolor-wet-wash",
    ]);
    const observedLight = new Set<string>();
    const visibleCoverageById = new Map<string, number>();

    for (const selection of materializeAllStudioBrushPackSelections()) {
      const tap = planNormalizedStudioDynamicBrushDabs({
        baseOpacity: selection.defaultOpacity,
        baseWidth: selection.defaultWidth,
        points: [12, 9],
        pressures: [0.5],
        speeds: [0],
        maxDabs: 1,
        seed: 0x13ad_beef,
      }, selection.brushDynamics);
      expect(tap, `${selection.catalogId}: spacing swallowed first tap`).toHaveLength(1);

      const dab = tap[0]!;
      const tipAlpha = buildStudioBrushTipAlphaMap(selection.brushDynamics.tip).alphas.reduce(
        (maximum, alpha) => Math.max(maximum, alpha),
        0
      );
      const visibleCoverage = dab.opacity * dab.flow * tipAlpha;
      visibleCoverageById.set(selection.catalogId, visibleCoverage);
      if (visibleCoverage < 0.08) observedLight.add(selection.catalogId);

      expect(tipAlpha, `${selection.catalogId}: stamp alpha has no visible core`).toBeGreaterThan(0.45);
      expect(dab.size, `${selection.catalogId}: neutral pressure collapsed the tip`).toBeGreaterThan(
        selection.defaultWidth * 0.05
      );
      expect(dab.spacing, `${selection.catalogId}: invalid spacing`).toBeGreaterThanOrEqual(0.25);
      expect(visibleCoverage, `${selection.catalogId}: fully invisible first mark`).toBeGreaterThan(0);
    }

    // These named media deliberately build pigment gradually. Keeping the list exact ensures a
    // future opaque ink/marker cannot silently join it through compounded opacity or low flow.
    expect(observedLight).toEqual(intentionallyLight);
    // Soft-tip centre normalization lifts formerly near-invisible media above the first-contact
    // floor, but their authored opacity/flow still keeps them safely below opaque marker density.
    for (const catalogId of visibilityCorrectedSoftMedia) {
      const visibleCoverage = visibleCoverageById.get(catalogId)!;
      expect(visibleCoverage, `${catalogId}: corrected soft tip is still too faint`)
        .toBeGreaterThanOrEqual(0.08);
      expect(visibleCoverage, `${catalogId}: corrected soft tip lost gradual build-up`)
        .toBeLessThanOrEqual(0.16);
    }
  });

  it("materializes bounded phase-two colour, grain-space and multi-tip contracts", () => {
    const selections = materializeAllStudioBrushPackSelections();
    const coloured = selections.filter((selection) => (
      selection.brushDynamics.colorDynamics.hueJitter > 0
      || selection.brushDynamics.colorDynamics.saturationJitter > 0
      || selection.brushDynamics.colorDynamics.valueJitter > 0
    ));
    const grained = selections.filter((selection) => selection.brushDynamics.grain.amount > 0);
    const layered = selections.filter((selection) => selection.brushDynamics.tipLayers.length > 0);
    const dual = selections.filter((selection) => selection.brushDynamics.dualBrush?.enabled);

    expect(coloured.length).toBeGreaterThanOrEqual(20);
    expect(grained.length).toBeGreaterThanOrEqual(20);
    expect(new Set(grained.map((selection) => selection.brushDynamics.grain.space))).toEqual(
      new Set(["canvas-fixed", "stroke-fixed"])
    );
    expect(layered.length).toBeGreaterThanOrEqual(10);
    expect(layered.some((selection) => selection.brushDynamics.tipLayers.length === 2)).toBe(true);
    expect(dual.length).toBeGreaterThanOrEqual(20);

    for (const selection of selections) {
      expect(selection.brushDynamics.tipLayers.length).toBeLessThanOrEqual(
        STUDIO_BRUSH_TIP_LAYER_MAX_COUNT
      );
      // brushDynamics shares the CRDT's 16 KiB metadata envelope with a few small scalar fields.
      expect(new TextEncoder().encode(JSON.stringify(selection.brushDynamics)).byteLength)
        .toBeLessThan(14 * 1024);
    }
  });

  it("rejects unknown ids rather than silently selecting a fallback brush", () => {
    expect(materializeStudioBrushPackDynamics("pen")).toBeNull();
    expect(materializeStudioBrushPackSelection("not-a-brush")).toBeNull();
    expect(studioBrushPackRuntimeSignature(null)).toBeNull();
  });

  it("hand-tunes the 2026-07 expansion wave and the bounded legacy visibility corrections", () => {
    const tunedIds = new Set<string>([
      ...STUDIO_BRUSH_PACK_EXPANSION_WAVE_IDS,
      ...STUDIO_BRUSH_PACK_VISIBILITY_TUNING_IDS,
      ...STUDIO_BRUSH_PACK_CARRIER_TUNING_IDS,
    ]);
    for (const id of STUDIO_BRUSH_PACK_CATALOG_IDS) {
      expect(
        studioBrushPackExpansionTuningById(id) !== null,
        `${id}: tuning table membership drift`
      ).toBe(tunedIds.has(id));
    }
    // A rake reads as parallel scratches only when consecutive bristle-row stamps overlap; the
    // formula gave dry-rake three times the cadence of its sibling rakes and drew a picket fence.
    const rakeCadence = (id: "dry-rake" | "hatching-contour-rake" | "wood-knot-rake"): number =>
      materializeStudioBrushPackDynamics(id)?.spacingRatio ?? Number.NaN;
    expect(rakeCadence("dry-rake")).toBeLessThanOrEqual(rakeCadence("wood-knot-rake"));
    expect(rakeCadence("dry-rake")).toBeCloseTo(rakeCadence("hatching-contour-rake"), 2);

    const dynamicsById = (id: (typeof STUDIO_BRUSH_PACK_CATALOG_IDS)[number]) =>
      materializeStudioBrushPackDynamics(id)!;

    // Technical liner ignores pressure entirely; the G-pen swells dramatically instead.
    const milli = dynamicsById("milli-pen-uniform");
    expect(milli.width.mappings).toHaveLength(0);
    expect(milli.opacity.mappings).toHaveLength(0);
    expect(milli.flow.mappings).toHaveLength(0);
    expect(milli.taper.enabled).toBe(false);
    const milliLight = resolveStudioBrushDynamics(
      { pressure: 0.1, speed: 0.5, stampIndex: 7 },
      milli
    );
    const milliHeavy = resolveStudioBrushDynamics(
      { pressure: 0.95, speed: 0.5, stampIndex: 7 },
      milli
    );
    expect(milliHeavy).toMatchObject({
      width: milliLight.width,
      opacity: milliLight.opacity,
      flow: milliLight.flow,
    });
    const gPen = dynamicsById("g-pen-flex");
    expect(gPen.width.mappings[0]).toMatchObject({ source: "pressure", from: 0.12, to: 1.9 });
    expect(gPen.taper.enabled).toBe(true);
    expect(gPen.taper.minSizeRatio).toBeLessThanOrEqual(0.05);

    // The calligraphy nib rotates with the stylus azimuth, never with the stroke direction.
    const calligraphy = dynamicsById("calligraphy-tilt-nib");
    expect(calligraphy.angle.mappings.map((mapping) => mapping.source)).toEqual([
      "tilt-azimuth",
      "twist",
    ]);
    const tiltPencil = dynamicsById("pencil-tilt-shading");
    expect(tiltPencil.width.mappings.some((mapping) => mapping.source === "tilt-magnitude")).toBe(true);

    // Grain pin-mode contrast: pastel tooth stays canvas-pinned, crayon wax drags with the stroke.
    const paperPastel = dynamicsById("pastel-paper-soft");
    expect(paperPastel.grain).toMatchObject({
      space: "canvas-fixed",
      amount: 0.55,
    });
    expect(paperPastel.spacingRatio).toBe(0.12);
    expect(paperPastel.scatterRatio).toBe(0.04);
    expect(paperPastel.roundness.base).toBe(0.24);
    expect(paperPastel.roundness.mappings).toMatchObject([
      { source: "pressure", mode: "multiply", from: 0.2, to: 0.3, curve: 1 },
    ]);
    expect(paperPastel.angle.mappings).toMatchObject([
      { source: "direction", mode: "add", from: 0, to: 360, curve: 1 },
    ]);
    expect(dynamicsById("crayon-wax-bold").grain.space).toBe("stroke-fixed");
    expect(dynamicsById("oil-impasto-heavy").spacingRatio).toBeLessThan(0.06);
    expect(dynamicsById("airbrush-grand-soft")).toMatchObject({
      spacingRatio: 0.09,
      scatterRatio: 0.025,
      flow: { base: 0.37 },
    });

    // Continuous pigment keeps one stable colour per stroke so overlapping carriers cannot appear
    // to erase one another. Authored discrete leaf stamps retain their intentional colour spread.
    expect(dynamicsById("pencil-colored-soft").colorDynamics.hueJitter).toBe(0);
    expect(dynamicsById("leaf-fall-flurry").colorDynamics.hueJitter).toBeGreaterThanOrEqual(10);

    // Stamps and scatters: rope dabs sit one tip-width apart, splatter bursts under pressure,
    // rain keeps a fixed diagonal with velocity-driven spacing.
    expect(dynamicsById("rope-twist-stamp").spacingRatio).toBeGreaterThanOrEqual(0.9);
    expect(dynamicsById("sponge-stipple-dab").spacingRatio).toBeGreaterThanOrEqual(0.7);
    expect(
      dynamicsById("ink-splatter-burst").scatter.mappings.some(
        (mapping) => mapping.source === "pressure"
      )
    ).toBe(true);
    const rain = dynamicsById("rain-streak-diagonal");
    expect(rain.angle.base).toBeLessThan(-60);
    expect(rain.angle.mappings.some((mapping) => mapping.source === "direction")).toBe(false);
    expect(rain.width.mappings.some((mapping) => mapping.source === "speed")).toBe(true);
    expect(rain.opacity.mappings.some((mapping) => mapping.source === "pressure")).toBe(true);
    expect(rain.flow.mappings.some((mapping) => mapping.source === "pressure")).toBe(true);
    const rainWithoutJitter = {
      ...rain,
      opacity: { ...rain.opacity, jitter: null },
    };
    const lightRain = resolveStudioBrushDynamics(
      { pressure: 0.1, speed: 0.55, stampIndex: 19 },
      rainWithoutJitter
    );
    const heavyRain = resolveStudioBrushDynamics(
      { pressure: 0.95, speed: 0.55, stampIndex: 19 },
      rainWithoutJitter
    );
    expect(heavyRain.width).toBe(lightRain.width);
    expect(heavyRain.opacity).toBeGreaterThan(lightRain.opacity);
    expect(heavyRain.flow).toBeGreaterThan(lightRain.flow);
    const rainMist = dynamicsById("rain-mist-combo");
    expect(rainMist.width.mappings.some((mapping) => mapping.source === "speed")).toBe(true);
    expect(rainMist.spacing.mappings.some((mapping) => mapping.source === "speed")).toBe(true);
    expect(rainMist.opacity.mappings.some((mapping) => mapping.source === "pressure")).toBe(true);
    expect(rainMist.flow.mappings.some((mapping) => mapping.source === "pressure")).toBe(true);
    const rainMistWithoutJitter = {
      ...rainMist,
      opacity: { ...rainMist.opacity, jitter: null },
    };
    const lightRainMist = resolveStudioBrushDynamics(
      { pressure: 0.1, speed: 0.55, stampIndex: 23 },
      rainMistWithoutJitter
    );
    const heavyRainMist = resolveStudioBrushDynamics(
      { pressure: 0.95, speed: 0.55, stampIndex: 23 },
      rainMistWithoutJitter
    );
    expect(heavyRainMist.width).toBe(lightRainMist.width);
    expect(heavyRainMist.opacity).toBeGreaterThan(lightRainMist.opacity);
    expect(heavyRainMist.flow).toBeGreaterThan(lightRainMist.flow);
    expect(dynamicsById("snow-flurry-flake").angle.jitter).toMatchObject({ amount: 180 });

    // Multi-tip composition still applies to the expansion's foliage and rake members.
    expect(dynamicsById("leaf-fall-flurry").tipLayers.length).toBeGreaterThan(0);
    expect(dynamicsById("fur-soft-clumps").tipLayers.length).toBeGreaterThan(0);
  });

  it("covers every material-wave id with bounded, distinct, renderer-consumed physics", () => {
    const signatures = new Set<string>();
    let customTipCount = 0;
    let colouredCount = 0;
    let dualTipCount = 0;
    let grainedCount = 0;
    let layeredCount = 0;
    const mappingSources = new Set<string>();

    for (const id of STUDIO_BRUSH_PACK_MATERIAL_WAVE_IDS) {
      const descriptor = STUDIO_BRUSH_PACK_DESCRIPTORS.find((item) => item.catalogId === id);
      const selection = materializeStudioBrushPackSelection(id);
      const signature = studioBrushPackRuntimeSignature(id);
      expect(descriptor, `${id}: missing descriptor`).toBeDefined();
      expect(selection, `${id}: missing runtime selection`).not.toBeNull();
      expect(studioBrushPackExpansionTuningById(id), `${id}: missing tuning`).not.toBeNull();
      expect(signature, `${id}: missing signature`).not.toBeNull();
      signatures.add(signature!);

      const dynamics = selection!.brushDynamics;
      expectFiniteNumbers(dynamics, id);
      const tipMap = buildStudioBrushTipAlphaMap(dynamics.tip);
      if (tipMap.custom) customTipCount += 1;
      if (
        dynamics.colorDynamics.hueJitter > 0
        || dynamics.colorDynamics.saturationJitter > 0
        || dynamics.colorDynamics.valueJitter > 0
      ) colouredCount += 1;
      if (dynamics.dualBrush?.enabled) dualTipCount += 1;
      if (dynamics.grain.amount > 0) grainedCount += 1;
      if (dynamics.tipLayers.length > 0) layeredCount += 1;
      for (const channel of [
        dynamics.width,
        dynamics.opacity,
        dynamics.flow,
        dynamics.spacing,
        dynamics.scatter,
        dynamics.angle,
        dynamics.roundness,
      ]) {
        channel.mappings.forEach((mapping) => mappingSources.add(mapping.source));
      }
      expect(tipMap.alphas.some((alpha) => alpha > 0.45), `${id}: invisible procedural tip`)
        .toBe(true);
      expect(dynamics.spacingRatio, `${id}: invalid spacing budget`).toBeGreaterThanOrEqual(0.02);
      expect(dynamics.spacingRatio, `${id}: excessive spacing`).toBeLessThanOrEqual(2);
      expect(dynamics.scatterRatio, `${id}: invalid scatter budget`).toBeGreaterThanOrEqual(0);
      expect(dynamics.scatterRatio, `${id}: excessive scatter`).toBeLessThanOrEqual(2);
      expect(dynamics.tipLayers.length).toBeLessThanOrEqual(STUDIO_BRUSH_TIP_LAYER_MAX_COUNT);
      expect(new TextEncoder().encode(JSON.stringify(dynamics)).byteLength)
        .toBeLessThan(14 * 1024);

      const input = {
        baseOpacity: selection!.defaultOpacity,
        baseWidth: selection!.defaultWidth,
        directions: [0, 17, -23, 31, -14],
        maxDabs: 384,
        points: [2, 18, 18, 4, 42, 32, 70, 11, 92, 28],
        pressures: [0.22, 0.46, 0.92, 0.58, 0.34],
        seed: 0x7713_2a5d,
        speeds: [0.15, 0.72, 1.5, 0.44, 1.1],
        tiltXs: [0, 20, 52, 12, -34],
        tiltYs: [0, -16, 38, 8, 27],
      };
      const first = planNormalizedStudioDynamicBrushDabs(input, dynamics);
      const replay = planNormalizedStudioDynamicBrushDabs(input, dynamics);
      expect(first, `${id}: empty representative stroke`).not.toHaveLength(0);
      expect(first.length, `${id}: dab planner exceeded budget`).toBeLessThanOrEqual(384);
      expect(replay, `${id}: non-deterministic representative stroke`).toEqual(first);
      first.forEach((dab, dabIndex) => {
        expectFiniteNumbers(dab, `${id}.dabs[${dabIndex}]`);
      });
    }

    expect(signatures.size).toBe(STUDIO_BRUSH_PACK_MATERIAL_WAVE_IDS.length);
    expect(customTipCount).toBeGreaterThanOrEqual(30);
    expect(colouredCount).toBeGreaterThanOrEqual(12);
    expect(dualTipCount).toBeGreaterThanOrEqual(20);
    expect(grainedCount).toBeGreaterThanOrEqual(20);
    expect(layeredCount).toBeGreaterThanOrEqual(20);
    expect(mappingSources).toEqual(new Set([
      "pressure",
      "speed",
      "tilt-magnitude",
      "tilt-azimuth",
      "twist",
      "direction",
    ]));
  });

  it("keeps representative material-wave visual plans stable", () => {
    const representatives = [
      "bristle-fan-dry",
      "palette-knife-edge",
      "watercolor-salt-bloom",
      "ribbon-satin-fold",
      "smoke-wisp-layered",
      "flower-petal-scatter",
      "halftone-gradient-dot",
      "focus-ray-streak",
    ] as const;
    const visualPlans = representatives.map((id) => {
      const selection = materializeStudioBrushPackSelection(id)!;
      const dabs = planNormalizedStudioDynamicBrushDabs({
        baseOpacity: selection.defaultOpacity,
        baseWidth: selection.defaultWidth,
        directions: [0, 21, -18, 33],
        maxDabs: 96,
        points: [4, 32, 28, 8, 58, 38, 88, 14],
        pressures: [0.26, 0.72, 0.94, 0.4],
        seed: 0x62f8_1c4a,
        speeds: [0.18, 0.86, 1.42, 0.52],
        tiltXs: [0, 26, 48, 10],
        tiltYs: [0, -20, 36, 8],
      }, selection.brushDynamics);
      const tip = buildStudioBrushTipAlphaMap(selection.brushDynamics.tip);
      return {
        id,
        tip: alphaSignature(tip.alphas),
        dabs: alphaSignature(Float32Array.from(dabs.flatMap((dab) => [
          dab.x / 128,
          dab.y / 128,
          dab.size / 128,
          dab.opacity,
          dab.flow,
          dab.spacing / 128,
          (dab.angle + 180) / 360,
          dab.roundness,
        ]))),
        count: dabs.length,
      };
    });

    expect(visualPlans).toEqual([
      // Values intentionally pin both custom tip rasterization and the dynamic dab planner.
      // Update only after a deliberate visual QA pass.
      { id: "bristle-fan-dry", tip: "985d4700", dabs: "62a0855b", count: 18 },
      { id: "palette-knife-edge", tip: "c344c2cf", dabs: "ae46755f", count: 70 },
      { id: "watercolor-salt-bloom", tip: "206daca6", dabs: "c11da11a", count: 7 },
      { id: "ribbon-satin-fold", tip: "30f1532a", dabs: "ac5ec2b4", count: 17 },
      // Denser soft wash carriers (continuous-carrier-quality-v3) add stations on layered smoke.
      { id: "smoke-wisp-layered", tip: "115d49be", dabs: "b9897050", count: 26 },
      { id: "flower-petal-scatter", tip: "a7be40ba", dabs: "616763b3", count: 9 },
      { id: "halftone-gradient-dot", tip: "ea3c1dbd", dabs: "96b49af2", count: 13 },
      { id: "focus-ray-streak", tip: "194e1e56", dabs: "9d9ff412", count: 27 },
    ]);
  });
});
