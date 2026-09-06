import { describe, expect, it } from "vitest";

import {
  isStudioBrushEraserAliasId,
  mapStudioBrushAliasPressure,
  studioBrushAliasEffectiveDiameter,
} from "../brush/studio-brush-alias-profile";
import {
  studioBrushSymmetryTransforms,
  type StudioBrushSymmetrySpec,
  type StudioBrushSymmetryTransform,
} from "../brush/studio-brush-symmetry";
import {
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
  studioInkFallbackPressure,
} from "../brush/studio-ink-pressure-model";
import { selectStudioCausalInkSamples } from "../studio-causal-ink";

import {
  STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_ADVANCE_SOURCE_POINTS,
  STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_VARIATION_POINTS,
  STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_VARIATIONS,
  advanceStudioGpuLiveSourceJournal,
  createStudioGpuLiveSourceJournal,
  sameStudioGpuLiveSourceJournalIdentity,
  type StudioGpuLiveSourceJournalAdvance,
  type StudioGpuLiveSourceJournalIdentity,
  type StudioGpuLiveSourceJournalState,
} from "./studio-webgpu-live-source-journal";
import { planStudioGpuLiveStroke } from "./studio-webgpu-live-stroke-plan";

const IDENTITY_TRANSFORM = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
}) satisfies StudioBrushSymmetryTransform;

function identity(
  overrides: Partial<StudioGpuLiveSourceJournalIdentity> = {}
): StudioGpuLiveSourceJournalIdentity {
  return {
    epoch: 7,
    strokeId: "stroke:7",
    styleKey: "round-ink-v3",
    pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
    brushAlias: "pen",
    mode: "pen",
    selectedDiameter: 10,
    color: "#123456",
    opacity: 0.75,
    composite: "normal",
    orderKey: "operation:7",
    sampleSpacing: 4,
    variations: [{ id: "stroke:7", transform: IDENTITY_TRANSFORM }],
    ...overrides,
  };
}

function stateFor(
  sourceIdentity: StudioGpuLiveSourceJournalIdentity = identity()
): StudioGpuLiveSourceJournalState {
  const state = createStudioGpuLiveSourceJournal(sourceIdentity);
  expect(state).not.toBeNull();
  return state!;
}

function variationIdentity(
  sourceIdentity: StudioGpuLiveSourceJournalIdentity,
  symmetry: StudioBrushSymmetrySpec
): StudioGpuLiveSourceJournalIdentity {
  return {
    ...sourceIdentity,
    variations: studioBrushSymmetryTransforms(symmetry).map((transform, index) => ({
      id: index === 0
        ? sourceIdentity.strokeId
        : `${sourceIdentity.strokeId}:gpu-symmetry:${index}`,
      transform,
    })),
  };
}

function guardedSuffixView(
  values: readonly number[],
  unreadablePrefixLength: number
): { readonly view: readonly number[]; readonly accessed: number[] } {
  const accessed: number[] = [];
  const view = new Proxy([...values], {
    get(target, property, receiver) {
      if (typeof property === "string" && /^(?:0|[1-9]\d*)$/u.test(property)) {
        const index = Number(property);
        if (index < unreadablePrefixLength) {
          throw new Error(`historical index ${index} was read`);
        }
        accessed.push(index);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { view, accessed };
}

function collectSuffixes(
  target: Map<string, { points: number[]; pressures: number[] }>,
  advance: StudioGpuLiveSourceJournalAdvance
): void {
  for (const suffix of advance.suffixes) {
    const collected = target.get(suffix.id) ?? { points: [], pressures: [] };
    collected.points.push(...suffix.points);
    collected.pressures.push(...suffix.pressures);
    target.set(suffix.id, collected);
  }
}

function expectedPlan(
  sourceIdentity: StudioGpuLiveSourceJournalIdentity,
  points: readonly number[],
  pressures: readonly number[] | undefined,
  symmetry: StudioBrushSymmetrySpec,
  sealEndpoint: boolean
) {
  const samples = selectStudioCausalInkSamples({
    points,
    pressures,
    pressureModel: sourceIdentity.pressureModel,
    minDistance: sourceIdentity.sampleSpacing,
    sealEndpoint,
  });
  const selectedDiameter = Math.max(1, sourceIdentity.selectedDiameter);
  const namedEraser = sourceIdentity.mode === "eraser"
    && isStudioBrushEraserAliasId(sourceIdentity.brushAlias);
  const size = sourceIdentity.mode === "eraser" && !namedEraser
    ? selectedDiameter
    : studioBrushAliasEffectiveDiameter(sourceIdentity.brushAlias, selectedDiameter);
  return planStudioGpuLiveStroke({
    id: sourceIdentity.strokeId,
    points: samples.flatMap(({ x, y }) => [x, y]),
    pressures: samples.map(({ pressure }) => mapStudioBrushAliasPressure(
      sourceIdentity.mode === "eraser" && !namedEraser ? null : sourceIdentity.brushAlias,
      pressure,
      studioInkFallbackPressure(sourceIdentity.pressureModel)
    )),
    color: sourceIdentity.color,
    size,
    pressureModel: sourceIdentity.pressureModel,
    opacity: sourceIdentity.opacity,
    composite: sourceIdentity.composite,
    orderKey: sourceIdentity.orderKey,
    symmetry,
  });
}

describe("studio WebGPU live source journal", () => {
  it("pins a deep immutable operation identity without retaining source history", () => {
    const source = identity();
    const state = stateFor(source);

    expect(state).toMatchObject({
      revision: 0,
      sourcePointCount: 0,
      pressurePointCount: 0,
      renderedPointCount: 0,
      lastSourceSample: null,
      lastRenderedSample: null,
      sealed: false,
      effectiveDiameter: 10,
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.identity)).toBe(true);
    expect(Object.isFrozen(state.identity.variations)).toBe(true);
    expect(Object.isFrozen(state.identity.variations[0]?.transform)).toBe(true);
    expect(state.identity).not.toBe(source);
    expect(state).not.toHaveProperty("points");
    expect(state).not.toHaveProperty("pressures");
    expect(sameStudioGpuLiveSourceJournalIdentity(state.identity, source)).toBe(true);
  });

  it("drops unknown identity history without invoking an extra accessor", () => {
    let getterCalls = 0;
    const source = identity() as StudioGpuLiveSourceJournalIdentity & {
      points?: readonly number[];
      arbitraryMutable?: { value: number };
    };
    Object.defineProperty(source, "points", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return new Array(100_000).fill(0);
      },
    });
    source.arbitraryMutable = { value: 1 };

    const state = createStudioGpuLiveSourceJournal(source)!;
    expect(getterCalls).toBe(0);
    expect(state.identity).not.toHaveProperty("points");
    expect(state.identity).not.toHaveProperty("arbitraryMutable");
  });

  it("matches the current causal selector and GPU planner while reading only a skipped delivery suffix", () => {
    const points = [0, 0, 1, 0, 5, 0, 12, 0, 14, 0];
    const pressures = [0.2, 0.3, 0.5, 0.8, 1];
    const symmetry = { type: "none", centerX: 0, centerY: 0 } as const;
    const sourceIdentity = variationIdentity(identity(), symmetry);
    let state = stateFor(sourceIdentity);
    const collected = new Map<string, { points: number[]; pressures: number[] }>();

    const first = advanceStudioGpuLiveSourceJournal(state, {
      identity: sourceIdentity,
      points: points.slice(0, 2),
      pressures: pressures.slice(0, 1),
    });
    expect(first.status).toBe("advanced");
    collectSuffixes(collected, first);
    state = first.state;

    const guardedPoints = guardedSuffixView(points, 2);
    const guardedPressures = guardedSuffixView(pressures, 1);
    const jumped = advanceStudioGpuLiveSourceJournal(state, {
      identity: sourceIdentity,
      points: guardedPoints.view,
      pressures: guardedPressures.view,
    });
    expect(jumped.status).toBe("advanced");
    expect(jumped.sourcePointCountDelta).toBe(4);
    expect(guardedPoints.accessed).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(guardedPressures.accessed).toEqual([1, 2, 3, 4]);
    collectSuffixes(collected, jumped);
    state = jumped.state;

    const sealedPoints = guardedSuffixView(points, points.length);
    const sealedPressures = guardedSuffixView(pressures, pressures.length);
    const sealed = advanceStudioGpuLiveSourceJournal(state, {
      identity: sourceIdentity,
      points: sealedPoints.view,
      pressures: sealedPressures.view,
      sealEndpoint: true,
    });
    expect(sealed.status).toBe("advanced");
    expect(sealed.renderedPointCountDelta).toBe(1);
    expect(sealed.samples[0]?.sourceIndex).toBe(4);
    expect(sealedPoints.accessed).toEqual([]);
    expect(sealedPressures.accessed).toEqual([]);
    collectSuffixes(collected, sealed);

    const plan = expectedPlan(sourceIdentity, points, pressures, symmetry, true);
    expect(plan).not.toBeNull();
    expect(collected.get(sourceIdentity.strokeId)).toEqual({
      points: plan!.strokes[0]!.points,
      pressures: plan!.strokes[0]!.pressures,
    });
    expect(sealed.state.sourcePointCount).toBe(5);
    expect(sealed.state.renderedPointCount).toBe(plan!.renderedPointCount);
    expect(sealed.state.sealed).toBe(true);
  });

  it("maps only new fineliner pressure samples and matches the named-brush live plan", () => {
    const points = [0, 0, 5, 0, 10, 0];
    const pressures = [0, 0.5, 1];
    const symmetry = { type: "none", centerX: 0, centerY: 0 } as const;
    const sourceIdentity = variationIdentity(identity({
      brushAlias: "fineliner",
      selectedDiameter: 10,
      sampleSpacing: 0,
    }), symmetry);
    const start = stateFor(sourceIdentity);
    const advanced = advanceStudioGpuLiveSourceJournal(start, {
      identity: sourceIdentity,
      points,
      pressures,
      sealEndpoint: true,
    });
    const plan = expectedPlan(sourceIdentity, points, pressures, symmetry, true);

    expect(advanced.status).toBe("advanced");
    expect(advanced.state.effectiveDiameter).toBe(4.8);
    expect(advanced.suffixes[0]?.pressures).toEqual(
      plan?.strokes[0]?.pressures
    );
    expect(advanced.suffixes[0]?.pressures[0]).toBe(0.8);
    expect(advanced.suffixes[0]?.pressures.at(-1)).toBe(1);
  });

  it("keeps the named kneaded eraser diameter and pressure response in the live journal", () => {
    const sourceIdentity = identity({
      brushAlias: "kneaded-eraser",
      mode: "eraser",
      selectedDiameter: 26,
      opacity: 0.38,
      composite: "erase",
      sampleSpacing: 0,
    });
    const advanced = advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
      identity: sourceIdentity,
      points: [0, 0, 5, 0],
      pressures: [0.2, 1],
      sealEndpoint: true,
    });

    expect(advanced.status).toBe("advanced");
    expect(advanced.state.effectiveDiameter).toBeCloseTo(30.16);
    expect(advanced.suffixes[0]?.pressures).toEqual([
      mapStudioBrushAliasPressure("kneaded-eraser", 0.2, 1),
      mapStudioBrushAliasPressure("kneaded-eraser", 1, 1),
    ]);
  });

  it.each([
    [undefined, "pen", 0.5],
    [STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3, "pen", 1],
    [undefined, "ballpoint", mapStudioBrushAliasPressure("ballpoint", 0.5, 0.5)],
  ] as const)(
    "preserves missing-pressure fallback for model %s and alias %s",
    (pressureModel, brushAlias, expectedPressure) => {
      const sourceIdentity = identity({
        pressureModel,
        brushAlias,
        sampleSpacing: 0,
      });
      const advanced = advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
        identity: sourceIdentity,
        points: [0, 0, 5, 0],
      });

      expect(advanced.status).toBe("advanced");
      expect(advanced.suffixes[0]?.pressures).toEqual([
        expectedPressure,
        expectedPressure,
      ]);
      expect(advanced.state.pressurePointCount).toBe(0);
    }
  );

  it("returns retained while advancing source ownership for a below-spacing point", () => {
    const sourceIdentity = identity({ sampleSpacing: 5 });
    const first = advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
      identity: sourceIdentity,
      points: [0, 0],
      pressures: [0.25],
    });
    const second = advanceStudioGpuLiveSourceJournal(first.state, {
      identity: sourceIdentity,
      points: [0, 0, 1, 0],
      pressures: [0.25, 0.75],
    });

    expect(second).toMatchObject({
      status: "retained",
      sourcePointCountDelta: 1,
      renderedPointCountDelta: 0,
      samples: [],
      suffixes: [],
    });
    expect(second.state).not.toBe(first.state);
    expect(second.state.sourcePointCount).toBe(2);
    expect(second.state.renderedPointCount).toBe(1);
    expect(second.state.lastSourceSample?.sourceIndex).toBe(1);
    expect(second.state.lastRenderedSample?.sourceIndex).toBe(0);
  });

  it("admits V3 stationary pressure state exactly like the current causal selector", () => {
    const points = [0, 0, 0, 0, 0, 0, 5, 0];
    const pressures = [1, 0.25, 0.25, 0.5];
    const sourceIdentity = identity({ sampleSpacing: 4 });
    const advanced = advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
      identity: sourceIdentity,
      points,
      pressures,
    });
    const expected = selectStudioCausalInkSamples({
      points,
      pressures,
      pressureModel: sourceIdentity.pressureModel,
      minDistance: sourceIdentity.sampleSpacing,
      sealEndpoint: false,
    });

    expect(advanced.samples.map(({ sourceIndex }) => sourceIndex)).toEqual(
      expected.map(({ sourceIndex }) => sourceIndex)
    );
    expect(advanced.samples.map(({ sourcePressure }) => sourcePressure)).toEqual(
      expected.map(({ pressure }) => pressure)
    );

    const v2Identity = identity({
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
      sampleSpacing: 4,
    });
    const v2 = advanceStudioGpuLiveSourceJournal(stateFor(v2Identity), {
      identity: v2Identity,
      points,
      pressures,
    });
    expect(v2.samples.map(({ sourceIndex }) => sourceIndex)).toEqual([0, 3]);
  });

  it("emits every kaleidoscope variation in stable order with planner-identical coordinates", () => {
    const symmetry = {
      type: "kaleidoscope",
      centerX: 3,
      centerY: 2,
      radialCount: 4,
    } as const;
    const sourceIdentity = variationIdentity(identity({ sampleSpacing: 0 }), symmetry);
    const points = [2, 1, 4, 5, 8, 3];
    const pressures = [0.25, 0.6, 1];
    const advanced = advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
      identity: sourceIdentity,
      points,
      pressures,
      sealEndpoint: true,
    });
    const plan = expectedPlan(sourceIdentity, points, pressures, symmetry, true);

    expect(advanced.status).toBe("advanced");
    expect(advanced.suffixes).toHaveLength(8);
    expect(advanced.suffixes.map(({ id }) => id)).toEqual(
      plan?.strokes.map(({ id }) => id)
    );
    expect(advanced.suffixes.map(({ points: suffixPoints }) => suffixPoints)).toEqual(
      plan?.strokes.map(({ points: planPoints }) => planPoints)
    );
    expect(advanced.suffixes.every(({ pressures: suffixPressures }) => (
      suffixPressures === advanced.suffixes[0]?.pressures
    ))).toBe(true);
  });

  it("rejects stale epochs and style changes before reading any numeric source property", () => {
    const sourceIdentity = identity();
    const first = advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
      identity: sourceIdentity,
      points: [0, 0],
      pressures: [0.5],
    });
    const points = guardedSuffixView([0, 0], 2);
    const pressures = guardedSuffixView([0.5], 1);

    const stale = advanceStudioGpuLiveSourceJournal(first.state, {
      identity: { ...sourceIdentity, epoch: sourceIdentity.epoch - 1 },
      points: points.view,
      pressures: pressures.view,
    });
    const changed = advanceStudioGpuLiveSourceJournal(first.state, {
      identity: { ...sourceIdentity, color: "#abcdef" },
      points: points.view,
      pressures: pressures.view,
    });

    expect(stale).toMatchObject({ status: "rejected", reason: "stale-epoch" });
    expect(changed).toMatchObject({ status: "rejected", reason: "style-changed" });
    expect(stale.state).toBe(first.state);
    expect(changed.state).toBe(first.state);
    expect(points.accessed).toEqual([]);
    expect(pressures.accessed).toEqual([]);
  });

  it("rejects count regression and odd coordinate layouts without changing prior state", () => {
    const sourceIdentity = identity({ sampleSpacing: 0 });
    const first = advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
      identity: sourceIdentity,
      points: [0, 0, 4, 0],
      pressures: [0.4, 0.8],
    });
    const regression = advanceStudioGpuLiveSourceJournal(first.state, {
      identity: sourceIdentity,
      points: [0, 0],
      pressures: [0.4],
    });
    const odd = advanceStudioGpuLiveSourceJournal(first.state, {
      identity: sourceIdentity,
      points: [0, 0, 4, 0, 9],
      pressures: [0.4, 0.8],
    });

    expect(regression).toMatchObject({
      status: "rejected",
      reason: "source-count-regression",
      sourcePointCountDelta: 0,
      renderedPointCountDelta: 0,
    });
    expect(odd).toMatchObject({ status: "rejected", reason: "invalid-coordinate-layout" });
    expect(regression.state).toBe(first.state);
    expect(odd.state).toBe(first.state);
  });

  it("fails the whole delivery closed for a non-finite new coordinate or explicit pressure", () => {
    const sourceIdentity = identity({ sampleSpacing: 0 });
    const first = advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
      identity: sourceIdentity,
      points: [0, 0],
      pressures: [0.5],
    });
    const invalidCoordinate = advanceStudioGpuLiveSourceJournal(first.state, {
      identity: sourceIdentity,
      points: [0, 0, 5, 0, Number.NaN, 3],
      pressures: [0.5, 0.7, 0.9],
    });
    const invalidPressure = advanceStudioGpuLiveSourceJournal(first.state, {
      identity: sourceIdentity,
      points: [0, 0, 5, 0],
      pressures: [0.5, Number.POSITIVE_INFINITY],
    });

    expect(invalidCoordinate).toMatchObject({ status: "rejected", reason: "invalid-coordinate" });
    expect(invalidPressure).toMatchObject({ status: "rejected", reason: "invalid-pressure" });
    expect(advanceStudioGpuLiveSourceJournal(first.state, {
      identity: sourceIdentity,
      points: [0, 0, 1e100, 3],
      pressures: [0.5, 0.9],
    })).toMatchObject({ status: "rejected", reason: "invalid-coordinate" });
    expect(invalidCoordinate.state).toBe(first.state);
    expect(invalidPressure.state).toBe(first.state);
    expect(first.state).toMatchObject({ sourcePointCount: 1, renderedPointCount: 1, revision: 1 });
  });

  it("fails closed when a dense pressure view regresses or fills an already-rendered hole", () => {
    const sourceIdentity = identity({ sampleSpacing: 0 });
    const missingTail = advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
      identity: sourceIdentity,
      points: [0, 0, 5, 0],
      pressures: [0.5],
    });
    const filledOldHole = advanceStudioGpuLiveSourceJournal(missingTail.state, {
      identity: sourceIdentity,
      points: [0, 0, 5, 0],
      pressures: [0.5, 0.8],
    });
    expect(filledOldHole).toMatchObject({
      status: "rejected",
      reason: "pressure-prefix-growth",
    });
    expect(filledOldHole.state).toBe(missingTail.state);

    const dense = advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
      identity: sourceIdentity,
      points: [0, 0, 5, 0],
      pressures: [0.5, 0.8],
    });
    const regressed = advanceStudioGpuLiveSourceJournal(dense.state, {
      identity: sourceIdentity,
      points: [0, 0, 5, 0, 10, 0],
      pressures: [0.5],
    });
    const tooMany = advanceStudioGpuLiveSourceJournal(dense.state, {
      identity: sourceIdentity,
      points: [0, 0, 5, 0],
      pressures: [0.5, 0.8, 1],
    });
    expect(regressed).toMatchObject({
      status: "rejected",
      reason: "pressure-count-regression",
    });
    expect(tooMany).toMatchObject({
      status: "rejected",
      reason: "invalid-pressure-layout",
    });
  });

  it("seals the stored near endpoint once and rejects any post-seal growth", () => {
    const sourceIdentity = identity({ sampleSpacing: 5 });
    const unsealed = advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
      identity: sourceIdentity,
      points: [0, 0, 1, 0],
      pressures: [0.25, 0.9],
    });
    expect(unsealed.state.renderedPointCount).toBe(1);

    const points = guardedSuffixView([0, 0, 1, 0], 4);
    const pressures = guardedSuffixView([0.25, 0.9], 2);
    const sealed = advanceStudioGpuLiveSourceJournal(unsealed.state, {
      identity: sourceIdentity,
      points: points.view,
      pressures: pressures.view,
      sealEndpoint: true,
    });
    expect(sealed).toMatchObject({
      status: "advanced",
      renderedPointCountDelta: 1,
      state: { sealed: true, renderedPointCount: 2 },
    });
    expect(sealed.samples[0]).toMatchObject({ sourceIndex: 1, x: 1, y: 0 });
    expect(points.accessed).toEqual([]);
    expect(pressures.accessed).toEqual([]);

    const repeated = advanceStudioGpuLiveSourceJournal(sealed.state, {
      identity: sourceIdentity,
      points: points.view,
      pressures: pressures.view,
      sealEndpoint: true,
    });
    expect(repeated.status).toBe("retained");
    expect(repeated.state).toBe(sealed.state);

    const postSeal = advanceStudioGpuLiveSourceJournal(sealed.state, {
      identity: sourceIdentity,
      points: [0, 0, 1, 0, 10, 0],
      pressures: [0.25, 0.9, 1],
    });
    expect(postSeal).toMatchObject({ status: "rejected", reason: "sealed" });
    expect(postSeal.state).toBe(sealed.state);
  });

  it("rejects transformed non-finite output without publishing a partial variation group", () => {
    const sourceIdentity = identity({
      selectedDiameter: 1,
      variations: [
        { id: "identity", transform: IDENTITY_TRANSFORM },
        {
          id: "overflow",
          transform: {
            ...IDENTITY_TRANSFORM,
            a: 3e38,
          },
        },
      ],
    });
    const state = stateFor(sourceIdentity);
    const rejected = advanceStudioGpuLiveSourceJournal(state, {
      identity: sourceIdentity,
      points: [2, 0],
      pressures: [1],
    });

    expect(rejected).toMatchObject({
      status: "rejected",
      reason: "invalid-variation-output",
      samples: [],
      suffixes: [],
    });
    expect(rejected.state).toBe(state);

    expect(createStudioGpuLiveSourceJournal(identity({
      variations: [{
        id: "invalid-transform",
        transform: { ...IDENTITY_TRANSFORM, e: 1e100 },
      }],
    }))).toBeNull();
  });

  it("bounds one skipped delivery and the aggregate symmetry allocation", () => {
    const sourceIdentity = identity({ sampleSpacing: 0 });
    const oversizedSource: number[] = [];
    oversizedSource.length = (STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_ADVANCE_SOURCE_POINTS + 1) * 2;
    expect(advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
      identity: sourceIdentity,
      points: oversizedSource,
    })).toMatchObject({ status: "rejected", reason: "source-advance-budget" });

    const variations = Array.from(
      { length: STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_VARIATIONS },
      (_, index) => ({ id: `variation:${index}`, transform: IDENTITY_TRANSFORM })
    );
    const variationIdentitySource = identity({ sampleSpacing: 0, variations });
    const pointCount = Math.floor(
      STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_VARIATION_POINTS / variations.length
    ) + 1;
    const points = Array.from({ length: pointCount * 2 }, (_, index) => (
      index % 2 === 0 ? index / 2 : 0
    ));
    expect(advanceStudioGpuLiveSourceJournal(stateFor(variationIdentitySource), {
      identity: variationIdentitySource,
      points,
    })).toMatchObject({ status: "rejected", reason: "variation-budget" });
  });

  it("applies the symmetry allocation budget cumulatively across small advances", () => {
    const variations = Array.from(
      { length: STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_VARIATIONS },
      (_, index) => ({ id: `cumulative:${index}`, transform: IDENTITY_TRANSFORM })
    );
    const sourceIdentity = identity({ sampleSpacing: 0, variations });
    const perAdvancePointCount = Math.ceil(
      STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_VARIATION_POINTS / variations.length / 2
    );
    const firstPoints = Array.from({ length: perAdvancePointCount * 2 }, (_, index) => (
      index % 2 === 0 ? index / 2 : 0
    ));
    const first = advanceStudioGpuLiveSourceJournal(stateFor(sourceIdentity), {
      identity: sourceIdentity,
      points: firstPoints,
    });
    expect(first.status).toBe("advanced");

    const secondPoints = Array.from({ length: perAdvancePointCount * 4 }, (_, index) => (
      index % 2 === 0 ? index / 2 : 0
    ));
    const rejected = advanceStudioGpuLiveSourceJournal(first.state, {
      identity: sourceIdentity,
      points: secondPoints,
    });

    expect(rejected).toMatchObject({ status: "rejected", reason: "variation-budget" });
    expect(rejected.state).toBe(first.state);
  });

  it("rejects malformed initial paint and variation identities", () => {
    expect(createStudioGpuLiveSourceJournal(identity({
      mode: "pen",
      composite: "erase",
    }))).toBeNull();
    expect(createStudioGpuLiveSourceJournal(identity({
      brushAlias: "future-brush" as "pen",
    }))).toBeNull();
    expect(createStudioGpuLiveSourceJournal(identity({
      variations: [
        { id: "same", transform: IDENTITY_TRANSFORM },
        { id: "same", transform: IDENTITY_TRANSFORM },
      ],
    }))).toBeNull();
  });

  it("contains throwing identity and source access without escaping the render loop", () => {
    const hostileIdentity = new Proxy(identity(), {
      get(target, property, receiver) {
        if (property === "styleKey") throw new Error("identity access failed");
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => createStudioGpuLiveSourceJournal(hostileIdentity)).not.toThrow();
    expect(createStudioGpuLiveSourceJournal(hostileIdentity)).toBeNull();
    expect(sameStudioGpuLiveSourceJournalIdentity(identity(), hostileIdentity)).toBe(false);

    const sourceIdentity = identity({ sampleSpacing: 0 });
    const state = stateFor(sourceIdentity);
    const hostilePoints = new Proxy([0, 0], {
      get(target, property, receiver) {
        if (property === "0") throw new Error("point access failed");
        return Reflect.get(target, property, receiver);
      },
    });
    expect(advanceStudioGpuLiveSourceJournal(state, {
      identity: sourceIdentity,
      points: hostilePoints,
      pressures: [0.5],
    })).toMatchObject({ status: "rejected", reason: "input-access", state });
  });

  it("rejects copied state authority and non-boolean endpoint seals", () => {
    const sourceIdentity = identity({ sampleSpacing: 0 });
    const state = stateFor(sourceIdentity);
    const forged = Object.freeze({ ...state }) as StudioGpuLiveSourceJournalState;

    expect(advanceStudioGpuLiveSourceJournal(forged, {
      identity: sourceIdentity,
      points: [0, 0],
      pressures: [0.5],
    })).toMatchObject({ status: "rejected", reason: "invalid-state", state: forged });
    expect(advanceStudioGpuLiveSourceJournal(state, {
      identity: sourceIdentity,
      points: [0, 0, 1, 0],
      pressures: [0.5, 0.8],
      sealEndpoint: "yes" as unknown as boolean,
    })).toMatchObject({ status: "rejected", reason: "invalid-seal", state });
  });
});
