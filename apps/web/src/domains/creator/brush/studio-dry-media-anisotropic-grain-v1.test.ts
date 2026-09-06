import { describe, expect, it } from "vitest";

import {
  STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1,
  STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1,
  STUDIO_DRY_MEDIA_PACKED_MARK_FLOAT_STRIDE_V1,
  appendStudioDryMediaAnisotropicGrainV1,
  beginStudioDryMediaAnisotropicGrainV1,
  packStudioDryMediaAnisotropicMarksV1,
  planStudioDryMediaAnisotropicGrainV1,
  resolveStudioDryMediaAnisotropicDabResponseV1,
  resolveStudioDryMediaAnisotropicPresetIdV1,
  type StudioDryMediaAnisotropicOptionsV1,
  type StudioDryMediaAnisotropicSampleV1,
} from "./studio-dry-media-anisotropic-grain-v1";

const OPTIONS: StudioDryMediaAnisotropicOptionsV1 = {
  presetId: "charcoal",
  seed: 0x5eedcafe,
  baseWidth: 12,
};

function sample(
  x: number,
  y: number,
  pressure = 0.55,
  patch: Partial<StudioDryMediaAnisotropicSampleV1> = {},
): StudioDryMediaAnisotropicSampleV1 {
  return {
    x,
    y,
    pressure,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    ...patch,
  };
}

function curvedSamples(count: number): StudioDryMediaAnisotropicSampleV1[] {
  return Array.from({ length: count }, (_, index) => sample(
    index * 1.35,
    Math.sin(index / 17) * 8 + Math.sin(index / 53) * 13,
    0.18 + index / Math.max(1, count - 1) * 0.78,
    {
      tiltX: Math.sin(index / 37) * 45,
      tiltY: Math.cos(index / 43) * 35,
      twist: index % 360,
    },
  ));
}

function planned(
  samples: readonly StudioDryMediaAnisotropicSampleV1[],
  options: StudioDryMediaAnisotropicOptionsV1 = OPTIONS,
) {
  const result = planStudioDryMediaAnisotropicGrainV1({ samples, options });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("dry-media anisotropic grain v1", () => {
  it("opts in only unambiguous toolbar and catalogue dry media", () => {
    expect(resolveStudioDryMediaAnisotropicPresetIdV1("crayon")).toBe("crayon");
    expect(resolveStudioDryMediaAnisotropicPresetIdV1("charcoal")).toBe("charcoal");
    expect(resolveStudioDryMediaAnisotropicPresetIdV1("chalk")).toBe("chalk");
    expect(resolveStudioDryMediaAnisotropicPresetIdV1("oil-pastel")).toBe("pastel");
    expect(resolveStudioDryMediaAnisotropicPresetIdV1(
      "dry-media",
      "pastel-paper-soft",
    )).toBe("pastel");
    expect(resolveStudioDryMediaAnisotropicPresetIdV1(
      "dry-media",
      "pencil-charcoal-stick",
    )).toBe("charcoal");
    expect(resolveStudioDryMediaAnisotropicPresetIdV1(
      "dry-media",
      "precision-pencil",
    )).toBe("charcoal");
    expect(resolveStudioDryMediaAnisotropicPresetIdV1("dry-media")).toBeNull();
  });

  it("keeps pre-wave engine-lane runtime ids null-material — exact matching, never prefixes (probe D1)", () => {
    // These ids ship in persisted/collaborative documents (apps/api bounded-flow mirror).
    // Their stored strokes replay through the bridge identity pass (mark multiplier 1); a
    // prefix match would silently expand every one of them into 3–5 anisotropic lanes.
    for (const engineLaneId of [
      "crayon--wax-scrape",
      "charcoal--vine-soft",
      "charcoal--compressed-edge",
      "chalk--klecks-powder",
      "pastel--cake-soft",
      "oil-pastel--waxy-film",
      "oil-pastel--wgm-mix",
    ]) {
      expect(
        resolveStudioDryMediaAnisotropicPresetIdV1(engineLaneId),
        engineLaneId,
      ).toBeNull();
    }
    // Prefix-shaped catalogue ids resolve through the explicit key table only.
    expect(resolveStudioDryMediaAnisotropicPresetIdV1(
      "dry-media",
      "pastel-paper-soft",
    )).toBe("pastel");
    expect(resolveStudioDryMediaAnisotropicPresetIdV1(
      "dry-media",
      "chalk-powder-unshipped",
    )).toBeNull();
  });

  it("prefers the exact runtime brush id over catalogue classification (probe D4)", () => {
    // A stored core stroke keeps its own material even when the catalogue id classifies
    // differently — the runtime id decided its bytes when it was authored.
    expect(resolveStudioDryMediaAnisotropicPresetIdV1("chalk", "velvet-charcoal"))
      .toBe("chalk");
    expect(resolveStudioDryMediaAnisotropicPresetIdV1("oil-pastel", "chalk-powder"))
      .toBe("pastel");
    // The classification path never falls back to the brush id.
    expect(resolveStudioDryMediaAnisotropicPresetIdV1("velvet-charcoal")).toBeNull();
  });

  it("projects canonical pressure independently into causal fibre geometry and pigment", () => {
    const base = {
      presetId: "charcoal" as const,
      seed: 0x5eedcafe,
      stationIndex: 7,
      tangentRadians: Math.PI / 5,
      tiltX: 12,
      tiltY: -8,
      twist: 31,
    };
    const light = resolveStudioDryMediaAnisotropicDabResponseV1({
      ...base,
      pressure: 0.05,
    });
    const heavy = resolveStudioDryMediaAnisotropicDabResponseV1({
      ...base,
      pressure: 0.95,
    });

    expect(light).not.toBeNull();
    expect(heavy).not.toBeNull();
    expect(heavy!.widthScale).toBeGreaterThan(light!.widthScale);
    expect(heavy!.opacityScale).toBeGreaterThan(light!.opacityScale);
    expect(heavy!.flowScale).toBeGreaterThan(light!.flowScale);
    expect(heavy!.majorAxisScale).toBe(light!.majorAxisScale);
    expect(heavy!.roundness).toBe(light!.roundness);
    expect(1 / heavy!.roundness).toBeGreaterThanOrEqual(
      STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1.charcoal.minimumAspectRatio,
    );
    expect(resolveStudioDryMediaAnisotropicDabResponseV1({
      ...base,
      pressure: 0.95,
    })).toEqual(heavy);
  });

  it("emits elongated renderer-neutral marks even for a pointer-down tap", () => {
    for (const presetId of ["crayon", "charcoal", "chalk", "pastel"] as const) {
      const result = planned([sample(20, 30)], { ...OPTIONS, presetId });
      const preset = STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1[presetId];

      expect(result.stations).toHaveLength(1);
      expect(result.marks.length).toBeGreaterThanOrEqual(preset.minimumLaneCount);
      for (const mark of result.marks) {
        expect(mark.shape).toBe(preset.shape);
        expect(mark.halfLength / mark.halfThickness).toBeGreaterThanOrEqual(
          preset.minimumAspectRatio - 1e-8,
        );
        expect(mark.halfLength / mark.halfThickness).toBeGreaterThan(2);
      }
    }
  });

  it("maps pressure independently to width, opacity, flow and final pigment alpha", () => {
    const result = planned([
      sample(0, 0, 0.05),
      sample(200, 0, 1),
    ], {
      ...OPTIONS,
      presetId: "crayon",
      baseWidth: 16,
    });
    const first = result.stations[0]!;
    const last = result.stations.at(-1)!;

    expect(last.width).toBeGreaterThan(first.width * 2);
    expect(last.opacity).toBeGreaterThan(first.opacity);
    expect(last.flow).toBeGreaterThan(first.flow);
    const firstAlpha = result.marks.find(
      (mark) => mark.stationIndex === first.index,
    )!.alpha;
    const lastAlpha = result.marks.find(
      (mark) => mark.stationIndex === last.index,
    )!.alpha;
    expect(lastAlpha).toBeGreaterThan(firstAlpha);
  });

  it("orients fibres from the causal tangent and lets stylus tilt steer the material", () => {
    const horizontal = planned([
      sample(0, 0),
      sample(100, 0),
    ], { ...OPTIONS, presetId: "charcoal" });
    const tilted = planned([
      sample(0, 0, 0.55, { tiltX: 0, tiltY: 80 }),
      sample(100, 0, 0.55, { tiltX: 0, tiltY: 80 }),
    ], { ...OPTIONS, presetId: "charcoal" });

    expect(horizontal.stations.at(-1)!.tangentRadians).toBeCloseTo(0, 8);
    expect(Math.abs(horizontal.stations.at(-1)!.orientationRadians)).toBeLessThan(
      0.01,
    );
    expect(tilted.stations.at(-1)!.tiltMagnitude).toBeGreaterThan(0.8);
    expect(tilted.stations.at(-1)!.orientationRadians).toBeGreaterThan(0.5);
  });

  it("gives crayon, charcoal, chalk and pastel materially distinct contracts", () => {
    const results = (["crayon", "charcoal", "chalk", "pastel"] as const).map(
      (presetId) => planned(
        [sample(0, 0), sample(90, 12), sample(180, 0)],
        { ...OPTIONS, presetId },
      ),
    );

    expect(new Set(results.map((result) => result.marks[0]!.shape)).size).toBe(4);
    expect(
      new Set(results.map((result) => result.marks.length)).size,
    ).toBeGreaterThan(1);
    const charcoalAspect = results[1]!.marks.reduce(
      (sum, mark) => sum + mark.halfLength / mark.halfThickness,
      0,
    ) / results[1]!.marks.length;
    const chalkAspect = results[2]!.marks.reduce(
      (sum, mark) => sum + mark.halfLength / mark.halfThickness,
      0,
    ) / results[2]!.marks.length;
    expect(charcoalAspect).toBeGreaterThan(chalkAspect);
    expect(
      Math.min(...results[2]!.marks.map((mark) => mark.edgeRoughness)),
    ).toBeGreaterThan(
      Math.min(...results[0]!.marks.map((mark) => mark.edgeRoughness)),
    );
  });

  it("is deterministic for the same seed and changes the grain for a different seed", () => {
    const samples = curvedSamples(120);
    const first = planned(samples);
    const replay = planned(samples);
    const changed = planned(samples, { ...OPTIONS, seed: OPTIONS.seed + 1 });

    expect(replay).toEqual(first);
    expect(changed.stations).toEqual(first.stations);
    expect(changed.marks).not.toEqual(first.marks);
  });

  it("keeps every accepted prefix stable when future samples arrive", () => {
    const samples = curvedSamples(180);
    const prefix = planned(samples.slice(0, 73), {
      ...OPTIONS,
      presetId: "pastel",
    });
    const complete = planned(samples, {
      ...OPTIONS,
      presetId: "pastel",
    });

    expect(complete.stations.slice(0, prefix.stations.length)).toEqual(
      prefix.stations,
    );
    expect(complete.marks.slice(0, prefix.marks.length)).toEqual(prefix.marks);
    expect(complete.state.evaluatedSegmentCount).toBe(samples.length - 1);
  });

  it("matches batch output across arbitrary streaming chunk boundaries", () => {
    const samples = curvedSamples(257);
    const batch = planned(samples, { ...OPTIONS, presetId: "chalk" });
    const begun = beginStudioDryMediaAnisotropicGrainV1(samples[0]!, {
      ...OPTIONS,
      presetId: "chalk",
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) throw new Error(begun.reason);
    let state = begun.state;
    const stations = [begun.station];
    const marks = [...begun.marks];
    let offset = 1;
    for (const chunkSize of [1, 17, 3, 64, 2, 91, 79]) {
      if (offset >= samples.length) break;
      const appended = appendStudioDryMediaAnisotropicGrainV1(
        state,
        samples.slice(offset, offset + chunkSize),
      );
      expect(appended.ok).toBe(true);
      if (!appended.ok) throw new Error(appended.reason);
      stations.push(...appended.stations);
      marks.push(...appended.marks);
      state = appended.state;
      offset += chunkSize;
    }
    if (offset < samples.length) {
      const appended = appendStudioDryMediaAnisotropicGrainV1(
        state,
        samples.slice(offset),
      );
      expect(appended.ok).toBe(true);
      if (!appended.ok) throw new Error(appended.reason);
      stations.push(...appended.stations);
      marks.push(...appended.marks);
      state = appended.state;
    }

    expect(stations).toEqual(batch.stations);
    expect(marks).toEqual(batch.marks);
    expect(state).toEqual(batch.state);
  });

  it("fails closed without exposing a partial suffix when a station or mark budget is hit", () => {
    const stationLimited = planStudioDryMediaAnisotropicGrainV1({
      samples: [sample(0, 0), sample(1_000, 0)],
      options: {
        ...OPTIONS,
        maximumStations: 2,
      },
    });
    expect(stationLimited).toEqual({ ok: false, reason: "station-budget" });

    const markLimited = beginStudioDryMediaAnisotropicGrainV1(sample(0, 0), {
      ...OPTIONS,
      presetId: "pastel",
      maximumMarks: 1,
    });
    expect(markLimited).toEqual({ ok: false, reason: "mark-budget" });

    const begun = beginStudioDryMediaAnisotropicGrainV1(sample(0, 0), {
      ...OPTIONS,
      maximumMarks: 20,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) throw new Error(begun.reason);
    const previousSnapshot = structuredClone(begun.state);
    const overflow = appendStudioDryMediaAnisotropicGrainV1(
      begun.state,
      [sample(1_000, 0)],
    );
    expect(overflow).toEqual({ ok: false, reason: "mark-budget" });
    expect(begun.state).toEqual(previousSnapshot);
  });

  it("rejects malformed samples, options and forged stream state", () => {
    expect(planStudioDryMediaAnisotropicGrainV1({
      samples: [],
      options: OPTIONS,
    })).toEqual({ ok: false, reason: "invalid-input" });
    expect(beginStudioDryMediaAnisotropicGrainV1(
      sample(Number.NaN, 0),
      OPTIONS,
    )).toEqual({ ok: false, reason: "invalid-input" });
    expect(beginStudioDryMediaAnisotropicGrainV1(sample(0, 0), {
      ...OPTIONS,
      baseWidth: 0,
    })).toEqual({ ok: false, reason: "invalid-options" });
    expect(beginStudioDryMediaAnisotropicGrainV1(sample(0, 0), {
      ...OPTIONS,
      seed: -1,
    })).toEqual({ ok: false, reason: "invalid-options" });
    expect(beginStudioDryMediaAnisotropicGrainV1(
      sample(0, 0),
      undefined as never,
    )).toEqual({ ok: false, reason: "invalid-options" });

    const begun = beginStudioDryMediaAnisotropicGrainV1(sample(0, 0), OPTIONS);
    expect(begun.ok).toBe(true);
    if (!begun.ok) throw new Error(begun.reason);
    expect(appendStudioDryMediaAnisotropicGrainV1({
      ...begun.state,
      lastSpacing: Number.POSITIVE_INFINITY,
    }, [sample(10, 0)])).toEqual({ ok: false, reason: "invalid-state" });
  });

  it("packs the shared mark contract into a deterministic WebGPU-ready float layout", () => {
    const result = planned(
      [sample(0, 0), sample(50, 20)],
      { ...OPTIONS, presetId: "crayon" },
    );
    const packed = packStudioDryMediaAnisotropicMarksV1(result.marks);
    expect(packed.ok).toBe(true);
    if (!packed.ok) throw new Error(packed.reason);

    expect(packed.stride).toBe(STUDIO_DRY_MEDIA_PACKED_MARK_FLOAT_STRIDE_V1);
    expect(packed.markCount).toBe(result.marks.length);
    expect(packed.values).toBeInstanceOf(Float32Array);
    expect(packed.values).toHaveLength(
      result.marks.length * STUDIO_DRY_MEDIA_PACKED_MARK_FLOAT_STRIDE_V1,
    );
    expect(packed.values[0]).toBeCloseTo(result.marks[0]!.x, 5);
    expect(packed.values[2]).toBeCloseTo(result.marks[0]!.halfLength, 5);
    expect(packed.values[13]).toBe(0);
    expect(packStudioDryMediaAnisotropicMarksV1(
      result.marks,
      64,
    )).toEqual({ ok: false, reason: "buffer-budget" });

    const malformed = [{ ...result.marks[0]!, halfLength: Number.NaN }];
    expect(packStudioDryMediaAnisotropicMarksV1(
      malformed,
    )).toEqual({ ok: false, reason: "invalid-mark" });
  });

  it(
    "keeps 32k-sample planning near-linear and inside explicit station/mark budgets",
    () => {
      const sampleCount = 32_768;
      const samples = Array.from({ length: sampleCount }, (_, index) => sample(
        index * 1.1,
        Math.sin(index / 23) * 3,
        0.35 + (index % 97) / 194,
        {
          tiltX: (index % 31) - 15,
          tiltY: (index % 23) - 11,
          twist: index % 360,
        },
      ));
      const startedAt = performance.now();
      const result = planned(samples, {
        ...OPTIONS,
        presetId: "charcoal",
        baseWidth: 8,
        maximumStations:
          STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.stations.max,
        maximumMarks:
          STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.marks.max,
      });
      const elapsedMilliseconds = performance.now() - startedAt;

      expect(result.work.sourceSamples).toBe(sampleCount);
      expect(result.work.evaluatedSegments).toBe(sampleCount - 1);
      expect(result.work.emittedStations).toBe(result.stations.length);
      expect(result.work.emittedMarks).toBe(result.marks.length);
      expect(result.work.evaluatedMarkCandidates).toBe(
        result.stations.length
          * STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1.charcoal.laneCount,
      );
      expect(result.stations.length).toBeLessThanOrEqual(
        STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.stations.max,
      );
      expect(result.marks.length).toBeLessThanOrEqual(
        STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.marks.max,
      );
      expect(elapsedMilliseconds).toBeLessThan(8_000);
    },
    12_000,
  );
});
