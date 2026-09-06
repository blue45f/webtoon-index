import { RemoteKillSwitch } from "@toonspectrum/studio-engine-registry";
import { describe, expect, it } from "vitest";

import { INK_DEFAULT_PARAMS } from "../../../../../../packages/studio-brush-platform/src/ink-modeler";
import {
  STABILIZER_BACKEND_IDS,
  selectStabilizerBackend,
} from "../../../../../../packages/studio-brush-platform/src/stabilizer-provider";
import { studioStrokeRouteBrushFamilyKey } from "../brush/studio-stroke-route-tournament";

import {
  STUDIO_LIVE_INK_ROLLOUT_BUCKET_STORAGE_KEY,
  resolveStudioLiveInkRollout,
  type StudioLiveInkRolloutDecision,
  type StudioLiveInkRolloutRandom,
  type StudioLiveInkRolloutStorage,
} from "./studio-live-ink-rollout";
import {
  STUDIO_LIVE_INK_STABILIZER_INK_MIN_OUTPUT_RATE_CEILING_HZ,
  STUDIO_LIVE_INK_STABILIZER_INK_MIN_OUTPUT_RATE_FLOOR_HZ,
  observeLiveInkPlanParity,
  planLiveInkStabilizer,
  runStudioLiveInkStabilizerPlan,
  studioLiveInkStabilizerBucket,
  studioLiveInkStabilizerInkMinOutputRate,
  studioLiveInkStabilizerProviderId,
  studioLiveInkStabilizerRateBand,
  type StudioLiveInkStabilizerPlanInput,
} from "./studio-live-ink-stabilizer-plan";

import type { ModeledSampleIR, StabilizerGraphIR } from "@toonspectrum/studio-project-model";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function graph(overrides: Partial<StabilizerGraphIR> = {}): StabilizerGraphIR {
  return { kind: "ema", strength: 0.35, predictionMs: 0, ...overrides };
}

function planInput(
  overrides: Partial<StudioLiveInkStabilizerPlanInput> = {},
): StudioLiveInkStabilizerPlanInput {
  return {
    stabilizer: graph(),
    brushFamily: "G-Pen",
    pointRateHz: 120,
    pointerType: "pen",
    ...overrides,
  };
}

function sample(
  x: number,
  y: number,
  tMs: number,
  pressure = 0.5,
  velocity = 0,
): ModeledSampleIR {
  return { x, y, tMs, pressure, velocity, altitudeDeg: 90, azimuthDeg: 0 };
}

/** Deterministic pseudo-random stream — no Math.random in this suite. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function rampSamples(count: number): ModeledSampleIR[] {
  const out: ModeledSampleIR[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push(sample(index * 3, 10 + index * 0.5, index * (1000 / 120), 0.2 + (index % 5) * 0.1));
  }
  return out;
}

function jitterSamples(count: number, seed: number): ModeledSampleIR[] {
  const next = lcg(seed);
  const out: ModeledSampleIR[] = [];
  let x = 40;
  let y = 40;
  for (let index = 0; index < count; index += 1) {
    x += next() * 6 - 3;
    y += next() * 6 - 3;
    out.push(sample(x, y, index * 4 + next(), next(), next() * 2));
  }
  return out;
}

const SAMPLE_SETS: readonly (readonly ModeledSampleIR[])[] = [
  [],
  [sample(5, 5, 0)],
  [sample(0, 0, 0), sample(4, 2, 8)],
  [sample(0, 0, 0), sample(4, 2, 8), sample(9, 3, 16)],
  rampSamples(16),
  jitterSamples(64, 1234),
];

const GRID_KINDS = ["none", "ema", "spring"] as const;
const GRID_STRENGTHS = [0, 0.05, 0.35, 0.62, 1] as const;
const GRID_PREDICTIONS = [0, 12.5, 50] as const;

/* Rollout fixtures — real resolveStudioLiveInkRollout decisions (실측 계약). */

function memoryStorage(initialBucket?: string): StudioLiveInkRolloutStorage {
  const values = new Map<string, string>();
  if (initialBucket !== undefined) {
    values.set(STUDIO_LIVE_INK_ROLLOUT_BUCKET_STORAGE_KEY, initialBucket);
  }
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function fixedRandom(value: number): StudioLiveInkRolloutRandom {
  return {
    getRandomValues: (array) => {
      array[0] = value;
      return array;
    },
  };
}

function admittedRollout(): StudioLiveInkRolloutDecision {
  return resolveStudioLiveInkRollout({ webgpuApiAvailable: true });
}

/* ------------------------------------------------------------------ */
/* Pristine reproduction of the shipped dispatch                       */
/* ------------------------------------------------------------------ */

describe("live-ink stabilizer plan — pristine reproduction of the shipped dispatch", () => {
  it("plans the ema lane with graph params verbatim for the schema-default graph", () => {
    const plan = planLiveInkStabilizer(planInput());
    expect(plan.lane).toBe("ema");
    expect(plan.backendId).toBe("ema");
    expect(plan.params).toEqual({ strength: 0.35, predictionMs: 0 });
    expect(plan.providerId).toBe("stabilizer-lane-ema");
    expect(plan.reason).toBe("first-party-current");
    expect(plan.status).toBe("selected");
    expect(plan.unavailableReason).toBeNull();
    expect(plan.inkExclusion).toBe("not-opted-in");
  });

  it("plans the spring lane for a spring graph, params verbatim", () => {
    const plan = planLiveInkStabilizer(
      planInput({ stabilizer: graph({ kind: "spring", strength: 0.8, predictionMs: 12 }) }),
    );
    expect(plan.lane).toBe("spring");
    expect(plan.params).toEqual({ strength: 0.8, predictionMs: 12 });
    expect(plan.providerId).toBe("stabilizer-lane-spring");
    expect(plan.reason).toBe("first-party-current");
  });

  it("maps kind none to the disabled passthrough lane (applyStabilizer verbatim-copy path)", () => {
    const plan = planLiveInkStabilizer(planInput({ stabilizer: graph({ kind: "none" }) }));
    expect(plan.lane).toBe("none");
    expect(plan.backendId).toBeNull();
    expect(plan.params).toBeNull();
    expect(plan.providerId).toBeNull();
    expect(plan.reason).toBe("stabilizer-disabled");
  });

  it("maps strength 0 to the disabled lane for both first-party kinds", () => {
    for (const kind of ["ema", "spring"] as const) {
      const plan = planLiveInkStabilizer(planInput({ stabilizer: graph({ kind, strength: 0 }) }));
      expect(plan.lane).toBe("none");
      expect(plan.reason).toBe("stabilizer-disabled");
    }
  });

  it("reproduces the legacy lane choice across the full kind × strength × prediction grid", () => {
    let checked = 0;
    for (const kind of GRID_KINDS) {
      for (const strength of GRID_STRENGTHS) {
        for (const predictionMs of GRID_PREDICTIONS) {
          const plan = planLiveInkStabilizer(
            planInput({ stabilizer: { kind, strength, predictionMs } }),
          );
          // Quoted legacy dispatch: kind "none" or strength 0 → passthrough,
          // otherwise kind "ema" → ema, else spring.
          const expected = kind === "none" || strength === 0 ? "none" : kind;
          expect(plan.lane).toBe(expected);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(GRID_KINDS.length * GRID_STRENGTHS.length * GRID_PREDICTIONS.length);
  });
});

/* ------------------------------------------------------------------ */
/* Parity observation                                                  */
/* ------------------------------------------------------------------ */

describe("live-ink stabilizer plan — zero-mismatch parity against applyStabilizer", () => {
  it("matches the legacy output across the full grid × sample-set space (0 mismatches)", () => {
    let comparisons = 0;
    const mismatches: string[] = [];
    for (const kind of GRID_KINDS) {
      for (const strength of GRID_STRENGTHS) {
        for (const predictionMs of GRID_PREDICTIONS) {
          const stabilizer: StabilizerGraphIR = { kind, strength, predictionMs };
          const plan = planLiveInkStabilizer(planInput({ stabilizer }));
          for (const samples of SAMPLE_SETS) {
            const report = observeLiveInkPlanParity({ plan, graph: stabilizer, samples });
            comparisons += 1;
            if (!report.comparable || !report.matched) {
              mismatches.push(
                `${kind}/s${strength}/p${predictionMs}/n${samples.length}: ${JSON.stringify(report)}`,
              );
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(comparisons).toBe(
      GRID_KINDS.length * GRID_STRENGTHS.length * GRID_PREDICTIONS.length * SAMPLE_SETS.length,
    );
  });

  it("actually detects divergence — a tampered plan reports a mismatch index", () => {
    const stabilizer = graph({ kind: "spring", strength: 0.9 });
    const honest = planLiveInkStabilizer(planInput({ stabilizer }));
    const tampered = { ...honest, backendId: "ema" as const, params: { strength: 0.1, predictionMs: 0 } };
    const report = observeLiveInkPlanParity({
      plan: tampered,
      graph: stabilizer,
      samples: jitterSamples(32, 77),
    });
    expect(report.comparable).toBe(true);
    if (report.comparable) {
      expect(report.matched).toBe(false);
      expect(report.mismatchIndex).not.toBeNull();
    }
  });

  it("reports the ink lane as non-comparable instead of vacuously green", () => {
    const plan = planLiveInkStabilizer(
      planInput({ inkOptIn: true, rollout: admittedRollout() }),
    );
    expect(plan.lane).toBe("ink-stroke-modeler");
    const report = observeLiveInkPlanParity({
      plan,
      graph: graph(),
      samples: rampSamples(8),
    });
    expect(report).toEqual({
      comparable: false,
      reason: "ink-lane-has-no-legacy-baseline",
      sampleCount: 8,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Ink lane gates                                                      */
/* ------------------------------------------------------------------ */

describe("live-ink stabilizer plan — ink lane gates", () => {
  it("admits ink only through opt-in + admitted rollout, with the derived output rate", () => {
    const plan = planLiveInkStabilizer(
      planInput({ inkOptIn: true, rollout: admittedRollout() }),
    );
    expect(plan).toMatchObject({
      lane: "ink-stroke-modeler",
      backendId: "ink-stroke-modeler",
      providerId: "stabilizer-lane-ink-stroke-modeler",
      reason: "ink-opt-in",
      status: "selected",
      unavailableReason: null,
      inkExclusion: null,
      params: { ink: { minOutputRate: 180 } },
    });
  });

  it("keeps the quarantine default without the opt-in flag even when the rollout admits", () => {
    const plan = planLiveInkStabilizer(planInput({ rollout: admittedRollout() }));
    expect(plan.lane).toBe("ema");
    expect(plan.inkExclusion).toBe("not-opted-in");
  });

  it("fails closed to first-party when the observation caller has no rollout decision", () => {
    const plan = planLiveInkStabilizer(planInput({ inkOptIn: true }));
    expect(plan.lane).toBe("ema");
    expect(plan.inkExclusion).toBe("rollout-missing");
  });

  it("admits only a selected WebGPU rollout and never interprets unavailable as Canvas2D", () => {
    const decisions: ReadonlyArray<readonly [string, StudioLiveInkRolloutDecision]> = [
      ["kill-switch", resolveStudioLiveInkRollout({ killSwitch: true, webgpuApiAvailable: true })],
      [
        "canvas2d-explicit",
        resolveStudioLiveInkRollout({ backendPreference: "canvas2d", webgpuApiAvailable: true }),
      ],
      [
        "rollout-disabled",
        resolveStudioLiveInkRollout({ rolloutPercent: 0, webgpuApiAvailable: true }),
      ],
      ["webgpu-api-unavailable", resolveStudioLiveInkRollout({ webgpuApiAvailable: false })],
      [
        "cohort-excluded",
        resolveStudioLiveInkRollout({
          rolloutPercent: 50,
          webgpuApiAvailable: true,
          storage: memoryStorage(),
          random: fixedRandom(9990),
        }),
      ],
      [
        "cohort-unavailable",
        resolveStudioLiveInkRollout({
          rolloutPercent: 50,
          webgpuApiAvailable: true,
          storage: null,
          random: null,
        }),
      ],
      [
        "webgpu-explicit",
        resolveStudioLiveInkRollout({ backendPreference: "webgpu", webgpuApiAvailable: false }),
      ],
      ["cohort-included", resolveStudioLiveInkRollout({ webgpuApiAvailable: true })],
      [
        "cohort-included",
        resolveStudioLiveInkRollout({
          rolloutPercent: 50,
          webgpuApiAvailable: true,
          storage: memoryStorage(),
          random: fixedRandom(10),
        }),
      ],
    ];
    for (const [expectedReason, rollout] of decisions) {
      expect(rollout.reason).toBe(expectedReason);
      const plan = planLiveInkStabilizer(planInput({ inkOptIn: true, rollout }));
      if (rollout.preference === "webgpu" && rollout.status === "selected") {
        expect(plan.lane).toBe("ink-stroke-modeler");
        expect(plan.inkExclusion).toBeNull();
      } else {
        expect(plan.lane).toBe("ema");
        expect(plan.inkExclusion).toBe("rollout-not-admitted");
      }
    }
  });

  it("honors the stroke-scoped live-ink backend decision when provided", () => {
    const base = planInput({ inkOptIn: true, rollout: admittedRollout() });
    const excluded = planLiveInkStabilizer({
      ...base,
      liveInkBackend: {
        status: "unavailable",
        backend: null,
        selectedBackend: "webgpu",
        reason: "eraser",
      },
    });
    expect(excluded.lane).toBe("ema");
    expect(excluded.inkExclusion).toBe("backend-not-webgpu");

    const admitted = planLiveInkStabilizer({
      ...base,
      liveInkBackend: {
        status: "ready",
        backend: "webgpu",
        selectedBackend: "webgpu",
        reason: "webgpu-ready",
      },
    });
    expect(admitted.lane).toBe("ink-stroke-modeler");
  });

  it("marks the exact killed provider unavailable without selecting another stabilizer", () => {
    const killSwitch = new RemoteKillSwitch();
    const inkProviderId = studioLiveInkStabilizerProviderId("ink-stroke-modeler");
    const base = planInput({ inkOptIn: true, rollout: admittedRollout(), killSwitch });

    killSwitch.kill(inkProviderId, "canary regression");
    const killed = planLiveInkStabilizer(base);
    expect(killed).toMatchObject({
      lane: "ink-stroke-modeler",
      providerId: inkProviderId,
      status: "unavailable",
      unavailableReason: "selected-provider-killed",
      inkExclusion: null,
    });
    expect(() => runStudioLiveInkStabilizerPlan(killed, rampSamples(8))).toThrow(
      /selected Studio stabilizer provider is unavailable/iu,
    );
    expect(observeLiveInkPlanParity({
      plan: killed,
      graph: graph(),
      samples: rampSamples(8),
    })).toEqual({
      comparable: false,
      reason: "selected-provider-unavailable",
      sampleCount: 8,
    });

    killSwitch.revive(inkProviderId);
    expect(planLiveInkStabilizer(base)).toMatchObject({
      lane: "ink-stroke-modeler",
      status: "selected",
      unavailableReason: null,
    });

    const emaProviderId = studioLiveInkStabilizerProviderId("ema");
    killSwitch.kill(emaProviderId, "ema fault");
    const ema = planLiveInkStabilizer(planInput({ killSwitch }));
    expect(ema).toMatchObject({
      lane: "ema",
      providerId: emaProviderId,
      status: "unavailable",
      unavailableReason: "selected-provider-killed",
    });
    expect(ema.lane).not.toBe("spring");

    const springProviderId = studioLiveInkStabilizerProviderId("spring");
    killSwitch.kill(springProviderId, "spring fault");
    const spring = planLiveInkStabilizer(
      planInput({ stabilizer: graph({ kind: "spring" }), killSwitch }),
    );
    expect(spring).toMatchObject({
      lane: "spring",
      providerId: springProviderId,
      status: "unavailable",
      unavailableReason: "selected-provider-killed",
    });
    expect(() => runStudioLiveInkStabilizerPlan(spring, rampSamples(8))).toThrow(
      /selected-provider-killed/u,
    );
  });

  it("never lets ink resurrect smoothing an artist disabled", () => {
    const plan = planLiveInkStabilizer(
      planInput({
        stabilizer: graph({ kind: "none" }),
        inkOptIn: true,
        rollout: admittedRollout(),
      }),
    );
    expect(plan.lane).toBe("none");
    expect(plan.inkExclusion).toBe("stabilizer-disabled");
  });
});

/* ------------------------------------------------------------------ */
/* Parameters, bucket, determinism, seam id space                      */
/* ------------------------------------------------------------------ */

describe("live-ink stabilizer plan — parameter derivation and identity", () => {
  it("derives the ink minimum output rate from the device cadence within shipped bounds", () => {
    expect(STUDIO_LIVE_INK_STABILIZER_INK_MIN_OUTPUT_RATE_FLOOR_HZ).toBe(
      INK_DEFAULT_PARAMS.minOutputRate,
    );
    expect(studioLiveInkStabilizerInkMinOutputRate(240)).toBe(240);
    expect(studioLiveInkStabilizerInkMinOutputRate(250.4)).toBe(251);
    expect(studioLiveInkStabilizerInkMinOutputRate(120)).toBe(180);
    expect(studioLiveInkStabilizerInkMinOutputRate(60)).toBe(180);
    expect(studioLiveInkStabilizerInkMinOutputRate(5000)).toBe(
      STUDIO_LIVE_INK_STABILIZER_INK_MIN_OUTPUT_RATE_CEILING_HZ,
    );
    expect(studioLiveInkStabilizerInkMinOutputRate(Number.NaN)).toBe(180);
    expect(studioLiveInkStabilizerInkMinOutputRate(0)).toBe(180);
    expect(studioLiveInkStabilizerInkMinOutputRate(-5)).toBe(180);

    const highRate = planLiveInkStabilizer(
      planInput({ inkOptIn: true, rollout: admittedRollout(), pointRateHz: 240 }),
    );
    expect(highRate.params).toEqual({ ink: { minOutputRate: 240 } });
  });

  it("clamps out-of-model graph numbers into the seam-accepted range (never throws)", () => {
    const overRange = planLiveInkStabilizer(
      planInput({ stabilizer: graph({ strength: 1.5, predictionMs: 60 }) }),
    );
    expect(overRange.params).toEqual({ strength: 1, predictionMs: 50 });

    const nonFinite = planLiveInkStabilizer(
      planInput({
        stabilizer: graph({ strength: Number.POSITIVE_INFINITY, predictionMs: Number.NaN }),
      }),
    );
    // Non-finite input falls back to stabilizerGraphIRSchema defaults.
    expect(nonFinite.params).toEqual({ strength: 0.35, predictionMs: 0 });
    expect(() =>
      runStudioLiveInkStabilizerPlan(nonFinite, rampSamples(8)),
    ).not.toThrow();

    const negative = planLiveInkStabilizer(planInput({ stabilizer: graph({ predictionMs: -3 }) }));
    expect(negative.params).toEqual({ strength: 0.35, predictionMs: 0 });
  });

  it("buckets workloads by shared brush-family key, rate band and pointer class", () => {
    expect(studioLiveInkStabilizerRateBand(60)).toBe("low");
    expect(studioLiveInkStabilizerRateBand(89.9)).toBe("low");
    expect(studioLiveInkStabilizerRateBand(90)).toBe("standard");
    expect(studioLiveInkStabilizerRateBand(179)).toBe("standard");
    expect(studioLiveInkStabilizerRateBand(180)).toBe("high");
    expect(studioLiveInkStabilizerRateBand(Number.NaN)).toBe("standard");
    expect(studioLiveInkStabilizerRateBand(-1)).toBe("standard");

    const bucket = studioLiveInkStabilizerBucket({
      brushFamily: "G-Pen ✒️",
      pointRateHz: 240,
      pointerType: "pen",
    });
    expect(bucket).toBe("studio-live-ink-stabilizer|g-pen|rate:high|ptr:pen");
    expect(bucket).toContain(studioStrokeRouteBrushFamilyKey("G-Pen ✒️"));

    const unknownPointer = studioLiveInkStabilizerBucket({
      brushFamily: "",
      pointRateHz: Number.NaN,
      pointerType: "stylus-of-doom",
    });
    expect(unknownPointer).toBe("studio-live-ink-stabilizer|unknown|rate:standard|ptr:unknown");

    expect(planLiveInkStabilizer(planInput()).bucket).toBe(
      "studio-live-ink-stabilizer|g-pen|rate:standard|ptr:pen",
    );
  });

  it("is deterministic: identical inputs produce identical plans and parity reports", () => {
    const input = planInput({ stabilizer: graph({ kind: "spring", strength: 0.7 }) });
    const first = planLiveInkStabilizer(input);
    const second = planLiveInkStabilizer(input);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const samples = jitterSamples(24, 42);
    const reportA = observeLiveInkPlanParity({ plan: first, graph: input.stabilizer, samples });
    const reportB = observeLiveInkPlanParity({ plan: second, graph: input.stabilizer, samples });
    expect(reportB).toEqual(reportA);
  });

  it("emits only backend ids the provider seam accepts, preserving its fail-loud contracts", () => {
    for (const kind of ["ema", "spring"] as const) {
      const plan = planLiveInkStabilizer(planInput({ stabilizer: graph({ kind }) }));
      expect(STABILIZER_BACKEND_IDS).toContain(plan.backendId);
      expect(() => runStudioLiveInkStabilizerPlan(plan, rampSamples(16))).not.toThrow();
    }

    const inkPlan = planLiveInkStabilizer(planInput({ inkOptIn: true, rollout: admittedRollout() }));
    expect(STABILIZER_BACKEND_IDS).toContain(inkPlan.backendId);
    // Quarantine held: the seam still refuses the ink id without allowInk.
    expect(() => selectStabilizerBackend(inkPlan.backendId ?? "")).toThrow(/quarantined opt-in/u);
    // Fail-loud held: an ink plan without a preloaded wasm modeler throws, never degrades silently.
    expect(() => runStudioLiveInkStabilizerPlan(inkPlan, rampSamples(16))).toThrow(
      /no loaded wasm modeler/u,
    );
  });

  it("keeps the disabled lane byte-identical to the legacy passthrough copy semantics", () => {
    const plan = planLiveInkStabilizer(planInput({ stabilizer: graph({ kind: "none" }) }));
    const samples = rampSamples(4);
    const output = runStudioLiveInkStabilizerPlan(plan, samples);
    expect(output).not.toBe(samples);
    // Same contract as applyStabilizer's `[...samples]`: fresh array, same sample objects.
    for (let index = 0; index < samples.length; index += 1) {
      expect(output[index]).toBe(samples[index]);
    }
  });
});
