import {
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
  studioDryMediaKernelDabProgramPin,
} from "./studio-brush-dynamics-program-pins";
import { resolveStudioBrushEngineLaneColorPigmentTuning } from "./studio-brush-engine-lane-catalog";

import type {
  StudioBrushDynamicsPresetId,
  StudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";

type StudioBrushDynamicsVariant = {
  presetId: StudioBrushDynamicsPresetId;
  overrides: StudioBrushDynamicsSettings;
};

export const STUDIO_BRUSH_DYNAMICS_VARIANTS_MEDIA: Readonly<Record<string, StudioBrushDynamicsVariant>> = {
  "soft-brush": {
    presetId: "airbrush",
    overrides: {
      seed: 211,
      maxSpeed: 1.4,
      tip: { shape: "round", softness: 0.78 },
      width: {
        base: 36,
        mappings: [{ source: "pressure", from: 0.82, to: 1.18 }],
        jitter: { mode: "multiply", amount: 0.015 },
      },
      opacity: { base: 0.52, mappings: [{ source: "pressure", from: 0.55, to: 1 }] },
      flow: {
        base: 0.4,
        mappings: [{ source: "pressure", from: 0.5, to: 0.9 }],
        jitter: null,
      },
      spacingRatio: 0.09,
      spacing: {
        mappings: [],
        jitter: null,
      },
      // Distinct from crayon 0.035 so air/dry toolbar signatures stay unique.
      scatterRatio: 0.028,
      scatter: {
        mappings: [{ source: "pressure", from: 1, to: 0.65 }],
        jitter: null,
      },
      angle: { base: 0, mappings: [], jitter: null },
      roundness: {
        base: 0.93,
        mappings: [{ source: "tilt-magnitude", from: 0.98, to: 0.85 }],
        jitter: null,
      },
    },
  },
  watercolor: {
    presetId: "airbrush",
    overrides: {
      seed: 401,
      fallbackPressure: 0.55,
      maxSpeed: 1.05,
      taper: {
        enabled: true,
        startLength: 0.035,
        endLength: 0.08,
        minSizeRatio: 0.4,
        minOpacityRatio: 0.52,
        curve: 1,
      },
      tip: { shape: "soft", softness: 0.86 },
      width: {
        base: 28,
        mappings: [{ source: "pressure", from: 0.76, to: 1.3 }],
        jitter: { mode: "multiply", amount: 0.08 },
      },
      opacity: { base: 1, mappings: [{ source: "pressure", from: 0.55, to: 1 }] },
      flow: {
        base: 0.45,
        mappings: [
          { source: "pressure", from: 0.35, to: 1 },
          { source: "speed", from: 1.06, to: 0.68 },
        ],
      },
      grain: { space: "canvas-fixed", amount: 0.16, scale: 16, contrast: 0.34, seed: 401 },
      dualBrush: {
        enabled: true,
        tip: { shape: "sponge", softness: 0.66 },
        blendMode: "screen",
        sizeRatio: 1.42,
      },
      spacingRatio: 0.09,
      spacing: { mappings: [], jitter: null },
      scatterRatio: 0.025,
      scatter: { mappings: [], jitter: null },
      angle: { base: 0, mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }], jitter: null },
      roundness: { base: 0.94, mappings: [], jitter: null },
    },
  },
  "ink-wash": {
    presetId: "airbrush",
    overrides: {
      seed: 402,
      fallbackPressure: 0.55,
      maxSpeed: 1.1,
      taper: {
        enabled: true,
        startLength: 0.04,
        endLength: 0.22,
        minSizeRatio: 0.18,
        minOpacityRatio: 0.48,
        curve: 1.5,
      },
      tip: { shape: "bristle", softness: 0.1 },
      width: {
        base: 30,
        mappings: [
          { source: "pressure", from: 0.22, to: 1.78, curve: 1.15 },
          { source: "speed", from: 1.04, to: 0.72 },
        ],
        jitter: { mode: "multiply", amount: 0.07 },
      },
      opacity: {
        base: 1,
        mappings: [{ source: "pressure", from: 0.38, to: 1, curve: 0.9 }],
      },
      flow: {
        base: 0.72,
        mappings: [
          { source: "pressure", from: 0.32, to: 1, curve: 0.85 },
          { source: "speed", from: 1.04, to: 0.55 },
        ],
      },
      // Stroke-fixed paper tooth under the wet core — not isotropic wash blur.
      grain: { space: "stroke-fixed", amount: 0.38, scale: 3.6, contrast: 0.62, seed: 402 },
      dualBrush: {
        enabled: true,
        tip: { shape: "bristle", softness: 0.03 },
        blendMode: "multiply",
        sizeRatio: 0.76,
      },
      spacingRatio: 0.07,
      spacing: { mappings: [], jitter: null },
      scatterRatio: 0.015,
      scatter: { mappings: [], jitter: null },
      angle: { base: 0, mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }], jitter: null },
      roundness: { base: 0.66, mappings: [], jitter: null },
    },
  },
  "inkwash-pen": {
    presetId: "ink-particle",
    overrides: {
      seed: 403,
      fallbackPressure: 0.55,
      maxSpeed: 1.2,
      taper: { enabled: true, startLength: 0.04, endLength: 0.22, minSizeRatio: 0.14, minOpacityRatio: 0.5, curve: 1.35 },
      tip: { shape: "hard", softness: 0.08 },
      width: { base: 8, mappings: [{ source: "pressure", from: 0.18, to: 1.5, curve: 1.2 }], jitter: null },
      opacity: { base: 1, mappings: [{ source: "pressure", from: 0.45, to: 1 }] },
      flow: { base: 0.78, mappings: [{ source: "pressure", from: 0.52, to: 1 }] },
      grain: { amount: 0 },
      dualBrush: { enabled: false },
      spacingRatio: 0.075,
      spacing: { mappings: [], jitter: null },
      scatterRatio: 0,
      scatter: { mappings: [], jitter: null },
      angle: { base: 0, mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }], jitter: null },
      roundness: { base: 0.78, mappings: [], jitter: null },
    },
  },
  "inkwash-water-brush": {
    presetId: "airbrush",
    overrides: {
      seed: 404,
      fallbackPressure: 0.55,
      maxSpeed: 1,
      taper: { enabled: true, startLength: 0.03, endLength: 0.09, minSizeRatio: 0.5, minOpacityRatio: 0.45, curve: 0.9 },
      tip: { shape: "soft", softness: 0.92 },
      width: { base: 32, mappings: [{ source: "pressure", from: 0.82, to: 1.24 }], jitter: null },
      opacity: { base: 1, mappings: [{ source: "pressure", from: 0.4, to: 0.75 }] },
      flow: { base: 0.33, mappings: [{ source: "pressure", from: 0.3, to: 0.68 }] },
      grain: { space: "canvas-fixed", amount: 0.08, scale: 18, contrast: 0.2, seed: 404 },
      dualBrush: { enabled: false },
      spacingRatio: 0.1,
      // A perfectly fixed station interval leaves a faint comb in this low-pigment wash. Seeded
      // spacing variation preserves deterministic replay while de-correlating adjacent soft edges.
      spacing: { mappings: [], jitter: { mode: "multiply", amount: 0.08 } },
      scatterRatio: 0.015,
      scatter: { mappings: [], jitter: null },
      angle: { base: 0, mappings: [], jitter: null },
      roundness: { base: 1, mappings: [], jitter: null },
    },
  },
  "inkwash-bleed-wash": {
    presetId: "airbrush",
    overrides: {
      seed: 405,
      fallbackPressure: 0.55,
      maxSpeed: 1.05,
      taper: { enabled: true, startLength: 0.035, endLength: 0.1, minSizeRatio: 0.42, minOpacityRatio: 0.48, curve: 1 },
      tip: { shape: "soft", softness: 0.9 },
      width: { base: 36, mappings: [{ source: "pressure", from: 0.72, to: 1.38 }], jitter: { mode: "multiply", amount: 0.07 } },
      opacity: { base: 1, mappings: [{ source: "pressure", from: 0.5, to: 1 }] },
      flow: { base: 0.4, mappings: [{ source: "pressure", from: 0.32, to: 1 }, { source: "speed", from: 1.08, to: 0.64 }] },
      grain: { space: "canvas-fixed", amount: 0.14, scale: 18, contrast: 0.3, seed: 405 },
      dualBrush: { enabled: true, tip: { shape: "sponge", softness: 0.7 }, blendMode: "screen", sizeRatio: 1.5 },
      spacingRatio: 0.085,
      spacing: { mappings: [], jitter: null },
      scatterRatio: 0.025,
      scatter: { mappings: [], jitter: null },
      angle: { base: 0, mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }], jitter: null },
      roundness: { base: 0.96, mappings: [], jitter: null },
    },
  },
  "inkwash-white-ink": {
    presetId: "ink-particle",
    overrides: {
      seed: 406,
      fallbackPressure: 0.55,
      maxSpeed: 1.1,
      taper: { enabled: true, startLength: 0.04, endLength: 0.14, minSizeRatio: 0.32, minOpacityRatio: 0.58, curve: 1.1 },
      tip: { shape: "sponge", softness: 0.18 },
      width: { base: 16, mappings: [{ source: "pressure", from: 0.45, to: 1.3 }], jitter: null },
      opacity: { base: 1, mappings: [{ source: "pressure", from: 0.68, to: 1 }] },
      flow: { base: 0.82, mappings: [{ source: "pressure", from: 0.7, to: 1 }] },
      grain: { amount: 0 },
      dualBrush: { enabled: false },
      spacingRatio: 0.08,
      spacing: { mappings: [], jitter: null },
      scatterRatio: 0,
      scatter: { mappings: [], jitter: null },
      angle: { base: 0, mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }], jitter: null },
      roundness: { base: 0.9, mappings: [], jitter: null },
    },
  },
  spray: {
    presetId: "airbrush",
    overrides: {
      seed: 223,
      taper: { enabled: false },
      tip: { shape: "flake", softness: 0.12 },
      width: {
        base: 16,
        mappings: [{ source: "pressure", from: 0.85, to: 1.12 }],
        jitter: { mode: "multiply", amount: 0.45 },
      },
      opacity: {
        base: 0.46,
        mappings: [{ source: "pressure", from: 0.55, to: 1 }],
        jitter: { mode: "multiply", amount: 0.22 },
      },
      flow: {
        base: 0.3,
        mappings: [{ source: "pressure", from: 0.7, to: 1 }],
        jitter: { mode: "multiply", amount: 0.18 },
      },
      spacingRatio: 0.34,
      spacing: {
        mappings: [{ source: "speed", from: 0.75, to: 1.7 }],
        jitter: { mode: "multiply", amount: 0.18 },
      },
      // The catalogue exposes this tool as a 40 px spray footprint. A ratio above 1 scattered the
      // only dab of a tap well outside both the cursor and the user's hand on roughly one third of
      // seeds, so a quick click could look as if it had not painted at all. Keep the flake/noise tip
      // character, but constrain its centre to the visible footprint; `splatter` remains the wide
      // throw alternative.
      scatterRatio: 0.2,
      scatter: {
        mappings: [{ source: "pressure", from: 1.6, to: 0.75 }],
        jitter: { mode: "multiply", amount: 0.35 },
      },
      angle: { base: 0, mappings: [], jitter: { mode: "add", amount: 180 } },
      roundness: {
        base: 0.74,
        mappings: [],
        jitter: { mode: "multiply", amount: 0.22 },
      },
    },
  },
  splatter: {
    presetId: "airbrush",
    overrides: {
      seed: 227,
      taper: { enabled: false },
      tip: { shape: "flake", softness: 0.08 },
      width: {
        base: 45,
        mappings: [{ source: "pressure", from: 0.72, to: 1.28 }],
        jitter: { mode: "multiply", amount: 0.58 },
      },
      opacity: {
        base: 0.48,
        mappings: [{ source: "pressure", from: 0.5, to: 1 }],
        jitter: { mode: "multiply", amount: 0.3 },
      },
      flow: {
        base: 0.32,
        mappings: [{ source: "pressure", from: 0.62, to: 1 }],
        jitter: { mode: "multiply", amount: 0.22 },
      },
      spacingRatio: 0.5,
      spacing: {
        mappings: [{ source: "speed", from: 0.8, to: 1.45 }],
        jitter: { mode: "multiply", amount: 0.24 },
      },
      // Unlike the cursor-anchored spray, splatter deliberately throws flake centres beyond the
      // nib footprint. The explicit variant keeps causal retained/SVG replay from collapsing to
      // the canonical soft airbrush now that those paths consume the dynamics snapshot directly.
      scatterRatio: 1.15,
      scatter: {
        mappings: [{ source: "pressure", from: 1.45, to: 0.72 }],
        jitter: { mode: "multiply", amount: 0.42 },
      },
      angle: { base: 0, mappings: [], jitter: { mode: "add", amount: 180 } },
      roundness: {
        base: 0.68,
        mappings: [],
        jitter: { mode: "multiply", amount: 0.28 },
      },
    },
  },
  // Second-wave causal stamp-grid rule v2 (fresh authoring only): the canonical causal presets
  // are themselves toolbar brushes, so their exact ids mint the width-adaptive lattice pin here
  // at the brush-id resolution seam — exactly like the dry-media variants below — instead of
  // inside `STUDIO_BRUSH_DYNAMICS_PRESETS`, whose settings are the merge base for every derived
  // alias (hard-airbrush, spray, web-* …) and would silently pin families the rollout has not
  // audited. `airbrush` is deliberately NOT minted: its analytic soft-falloff tip renders as one
  // analytic-radial command (`tipUsesAnalyticSoftFalloff`), so the sampled stamp lattice — the
  // only thing the rule selects — never applies to it.
  "ink-particle": {
    presetId: "ink-particle",
    overrides: {
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
    },
  },
  "dry-media": {
    presetId: "dry-media",
    overrides: {
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
    },
  },
  crayon: {
    presetId: "dry-media",
    overrides: {
      // Fresh-authoring kernel opt-in (T1 de-polygon). Only these authored core snapshots mint
      // the marker; persisted documents never gain it, so their union replay stays byte-stable.
      dryMediaKernelProgram: studioDryMediaKernelDabProgramPin(),
      // Fresh-authoring causal stamp-grid rule v2: large nibs of these causal alpha-tip media
      // lattice 5/7 instead of the fixed causal grid 3, selected once at stroke start
      // (`selectStudioDynamicBrushCausalStampGrid`). Persisted snapshots never gain the pin.
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 307,
      tip: { shape: "hard", softness: 0.32 },
      width: {
        base: 10,
        mappings: [{ source: "pressure", from: 0.26, to: 1.38, curve: 0.78 }],
        jitter: { mode: "multiply", amount: 0.08 },
      },
      opacity: {
        base: 0.92,
        mappings: [{ source: "pressure", from: 0.48, to: 1, curve: 0.72 }],
        jitter: { mode: "multiply", amount: 0.08 },
      },
      flow: {
        base: 0.78,
        mappings: [{ source: "pressure", from: 0.52, to: 1, curve: 0.76 }],
        jitter: { mode: "multiply", amount: 0.05 },
      },
      // Continuous wax bed without packing ~2 dabs/sample (was 0.095 → freeze on long strokes).
      // Anisotropic multi-lane bridge still owns fibre tooth at this spacing.
      spacingRatio: 0.13,
      spacing: {
        mappings: [{ source: "speed", from: 0.92, to: 1.18 }],
        jitter: { mode: "multiply", amount: 0.04 },
      },
      scatterRatio: 0.05,
      scatter: {
        mappings: [{ source: "speed", from: 0.75, to: 1.12 }],
        jitter: { mode: "multiply", amount: 0.03 },
      },
      angle: {
        base: 0,
        mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }],
        jitter: { mode: "add", amount: 3.5 },
      },
      roundness: {
        base: 0.58,
        mappings: [{ source: "tilt-magnitude", from: 1, to: 0.52 }],
        jitter: { mode: "multiply", amount: 0.05 },
      },
    },
  },
  chalk: {
    presetId: "dry-media",
    overrides: {
      dryMediaKernelProgram: studioDryMediaKernelDabProgramPin(),
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 311,
      tip: { shape: "sponge", softness: 0.48 },
      width: {
        base: 14,
        mappings: [{ source: "pressure", from: 0.55, to: 1.18 }],
        jitter: { mode: "multiply", amount: 0.16 },
      },
      opacity: {
        base: 0.78,
        mappings: [{ source: "pressure", from: 0.45, to: 1 }],
        jitter: { mode: "multiply", amount: 0.2 },
      },
      flow: {
        base: 0.44,
        mappings: [{ source: "pressure", from: 0.6, to: 1 }],
        jitter: { mode: "multiply", amount: 0.14 },
      },
      spacingRatio: 0.18,
      spacing: {
        mappings: [{ source: "speed", from: 0.95, to: 1.12 }],
        jitter: { mode: "multiply", amount: 0.08 },
      },
      scatterRatio: 0.1,
      scatter: {
        mappings: [{ source: "speed", from: 0.8, to: 1.15 }],
        jitter: { mode: "multiply", amount: 0.12 },
      },
      angle: {
        base: 0,
        mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }],
        jitter: { mode: "add", amount: 10 },
      },
      roundness: {
        base: 0.5,
        mappings: [{ source: "tilt-magnitude", from: 1, to: 0.42 }],
        jitter: { mode: "multiply", amount: 0.1 },
      },
    },
  },
  charcoal: {
    presetId: "dry-media",
    overrides: {
      dryMediaKernelProgram: studioDryMediaKernelDabProgramPin(),
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 317,
      tip: { shape: "bristle", softness: 0.58 },
      width: {
        base: 18,
        mappings: [{ source: "pressure", from: 0.28, to: 1.38 }],
        jitter: { mode: "multiply", amount: 0.15 },
      },
      opacity: {
        base: 0.82,
        mappings: [{ source: "pressure", from: 0.32, to: 1 }],
        jitter: { mode: "multiply", amount: 0.19 },
      },
      flow: {
        base: 0.62,
        mappings: [{ source: "pressure", from: 0.4, to: 1 }],
        jitter: { mode: "multiply", amount: 0.13 },
      },
      spacingRatio: 0.14,
      spacing: {
        mappings: [{ source: "speed", from: 0.95, to: 1.12 }],
        jitter: { mode: "multiply", amount: 0.08 },
      },
      scatterRatio: 0.075,
      scatter: {
        mappings: [{ source: "speed", from: 0.8, to: 1.15 }],
        jitter: { mode: "multiply", amount: 0.12 },
      },
      angle: {
        base: 0,
        mappings: [
          { source: "direction", mode: "add", from: 0, to: 360 },
          { source: "tilt-azimuth", mode: "add", from: 0, to: 360, amount: 0.15 },
        ],
        jitter: { mode: "add", amount: 9 },
      },
      roundness: {
        base: 0.24,
        mappings: [{ source: "tilt-magnitude", from: 1, to: 0.24 }],
        jitter: { mode: "multiply", amount: 0.09 },
      },
    },
  },
  pastel: {
    presetId: "dry-media",
    overrides: {
      dryMediaKernelProgram: studioDryMediaKernelDabProgramPin(),
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 331,
      taper: {
        enabled: true,
        startLength: 0.06,
        endLength: 0.1,
        minSizeRatio: 0.52,
        minOpacityRatio: 0.46,
        curve: 0.9,
      },
      tip: { shape: "sponge", softness: 0.62 },
      width: {
        base: 20,
        // Was a 2x swing, and that is why a pastel feather touch rendered like a pressed one: with
        // so little contact collapse the stamp overlap along the centreline measures 27 boxes at
        // BOTH 0.12 and 0.90 pressure, so every dab lands on an already-saturated pixel and the
        // per-dab alpha has nothing left to say. crayon is the working reference here — the only
        // dry medium whose light touch reads correctly — and its mapping is 0.26 -> 1.38 curve
        // 0.78, a 5.3x swing whose overlap moves 4 <-> 11.
        mappings: [{ source: "pressure", from: 0.30, to: 1.30, curve: 0.78 }],
        jitter: { mode: "multiply", amount: 0.08 },
      },
      opacity: {
        base: 0.72,
        mappings: [{ source: "pressure", from: 0.46, to: 1 }],
        jitter: { mode: "multiply", amount: 0.08 },
      },
      flow: {
        base: 0.52,
        mappings: [{ source: "pressure", from: 0.58, to: 1 }],
        jitter: { mode: "multiply", amount: 0.06 },
      },
      grain: {
        space: "canvas-fixed",
        amount: 0.3,
        scale: 8.5,
        contrast: 0.62,
        seed: 331,
      },
      spacingRatio: 0.12,
      // Spacing follows CONTACT as well as speed. Without the pressure term a feather touch lays
      // exactly as many stations per pixel as a hard press, which is the other half of why the
      // overlap never moved. A stick barely touching skips; that is also where a light stroke's
      // broken tooth comes from.
      spacing: {
        mappings: [
          { source: "pressure", from: 1.75, to: 0.92 },
          { source: "speed", from: 0.94, to: 1.08 },
        ],
        jitter: null,
      },
      scatterRatio: 0.04,
      scatter: {
        mappings: [{ source: "speed", from: 0.9, to: 1.08 }],
        jitter: null,
      },
      angle: {
        base: 0,
        mappings: [
          { source: "direction", mode: "add", from: 0, to: 360 },
          { source: "tilt-azimuth", mode: "add", from: 0, to: 360, amount: 0.2 },
        ],
        jitter: { mode: "add", amount: 4 },
      },
      roundness: {
        base: 0.38,
        mappings: [{ source: "tilt-magnitude", from: 0.9, to: 0.3 }],
        jitter: { mode: "multiply", amount: 0.05 },
      },
    },
  },
  "oil-pastel": {
    presetId: "dry-media",
    overrides: {
      dryMediaKernelProgram: studioDryMediaKernelDabProgramPin(),
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 337,
      taper: {
        enabled: true,
        startLength: 0.05,
        endLength: 0.08,
        minSizeRatio: 0.58,
        minOpacityRatio: 0.62,
        curve: 0.86,
      },
      tip: { shape: "bristle", softness: 0.38 },
      width: {
        base: 18,
        // Same collapse as pastel, same reason. An oil pastel is genuinely occlusive so this
        // widens the range it travels; it does not lighten the pressed end.
        mappings: [{ source: "pressure", from: 0.32, to: 1.24, curve: 0.78 }],
        jitter: { mode: "multiply", amount: 0.06 },
      },
      opacity: {
        base: 0.88,
        mappings: [{ source: "pressure", from: 0.62, to: 1 }],
        jitter: { mode: "multiply", amount: 0.05 },
      },
      flow: {
        base: 0.7,
        mappings: [{ source: "pressure", from: 0.7, to: 1 }],
        jitter: { mode: "multiply", amount: 0.04 },
      },
      grain: {
        space: "stroke-fixed",
        amount: 0.16,
        scale: 6,
        contrast: 0.48,
        seed: 337,
      },
      spacingRatio: 0.1,
      // Same missing contact term as pastel above.
      spacing: {
        mappings: [
          { source: "pressure", from: 1.7, to: 0.94 },
          { source: "speed", from: 0.96, to: 1.06 },
        ],
        jitter: null,
      },
      scatterRatio: 0.025,
      scatter: {
        mappings: [{ source: "speed", from: 0.94, to: 1.05 }],
        jitter: null,
      },
      angle: {
        base: 0,
        mappings: [
          { source: "direction", mode: "add", from: 0, to: 360 },
          { source: "tilt-azimuth", mode: "add", from: 0, to: 360, amount: 0.12 },
        ],
        jitter: { mode: "add", amount: 3 },
      },
      roundness: {
        base: 0.46,
        mappings: [{ source: "tilt-magnitude", from: 0.96, to: 0.4 }],
        jitter: { mode: "multiply", amount: 0.04 },
      },
    },
  },
  "airbrush--klecks-grit": {
    presetId: "airbrush",
    overrides: {
      seed: 9011,
      tip: { shape: "soft", softness: 0.42 },
      spacingRatio: 0.09,
      scatterRatio: 0.22,
      grain: { space: "canvas-fixed", amount: 0.55, scale: 5.5, contrast: 0.72, seed: 9011 },
      flow: { base: 0.48, mappings: [{ source: "pressure", from: 0.4, to: 1 }], jitter: { mode: "multiply", amount: 0.12 } },
    },
  },
  "airbrush--hard-envelope": {
    presetId: "ink-particle",
    overrides: {
      seed: 9023,
      tip: { shape: "hard", softness: 0.02 },
      spacingRatio: 0.07,
      scatterRatio: 0.02,
      grain: { amount: 0 },
      width: { base: 30, mappings: [{ source: "pressure", from: 0.5, to: 1.3, curve: 0.8 }], jitter: null },
      flow: { base: 0.78, mappings: [{ source: "pressure", from: 0.6, to: 1 }], jitter: null },
    },
  },
  "spray--equal-area": {
    presetId: "airbrush",
    overrides: {
      seed: 9037,
      tip: { shape: "flake", softness: 0.2 },
      spacingRatio: 0.14,
      scatterRatio: 0.55,
      grain: { space: "canvas-fixed", amount: 0.4, scale: 3.2, contrast: 0.8, seed: 9037 },
    },
  },
  "splatter--burst-cloud": {
    presetId: "airbrush",
    overrides: {
      seed: 9043,
      tip: { shape: "flake", softness: 0.12 },
      spacingRatio: 0.2,
      scatterRatio: 0.75,
      grain: { space: "canvas-fixed", amount: 0.5, scale: 4.1, contrast: 0.85, seed: 9043 },
    },
  },
  "oil--tube-extrude": {
    presetId: "ink-particle",
    overrides: {
      seed: 9051,
      tip: { shape: "hard", softness: 0.05 },
      spacingRatio: 0.08,
      scatterRatio: 0.03,
      grain: { amount: 0.15, scale: 6, contrast: 0.5, seed: 9051 },
    },
  },
  "oil--knife-edge": {
    presetId: "ink-particle",
    overrides: {
      seed: 9059,
      tip: { shape: "hard", softness: 0.01 },
      spacingRatio: 0.05,
      scatterRatio: 0.01,
      grain: { amount: 0 },
      width: { base: 34, mappings: [{ source: "pressure", from: 0.4, to: 1.5 }], jitter: null },
    },
  },
  "acrylic--polymer-flat": {
    presetId: "ink-particle",
    overrides: { seed: 9067, tip: { shape: "hard", softness: 0.08 }, spacingRatio: 0.1, scatterRatio: 0.02 },
  },
  "charcoal--vine-soft": {
    presetId: "dry-media",
    overrides: {
      // Second-wave causal stamp-grid rule v2 mint for the engine-lane dry-media variants: their
      // sampled alpha tips lattice 5/7 on large fresh nibs (see the crayon mint above). Fresh
      // authoring only — replay re-derivation strips the pin, so persisted lane strokes keep the
      // fixed causal grid 3.
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 9071, tip: { shape: "sponge", softness: 0.7 }, spacingRatio: 0.16, scatterRatio: 0.12,
      grain: { space: "canvas-fixed", amount: 0.45, scale: 9, contrast: 0.55, seed: 9071 },
    },
  },
  "charcoal--compressed-edge": {
    presetId: "dry-media",
    overrides: {
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 9079, tip: { shape: "hard", softness: 0.15 }, spacingRatio: 0.11, scatterRatio: 0.06,
      grain: { space: "canvas-fixed", amount: 0.35, scale: 6, contrast: 0.7, seed: 9079 },
    },
  },
  "crayon--wax-scrape": {
    presetId: "dry-media",
    overrides: {
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 9083, tip: { shape: "hard", softness: 0.12 }, spacingRatio: 0.13, scatterRatio: 0.05,
      grain: { space: "canvas-fixed", amount: 0.5, scale: 7, contrast: 0.65, seed: 9083 },
    },
  },
  "chalk--klecks-powder": {
    presetId: "dry-media",
    overrides: {
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 9091, tip: { shape: "sponge", softness: 0.55 }, spacingRatio: 0.15, scatterRatio: 0.18,
      grain: { space: "canvas-fixed", amount: 0.6, scale: 4.5, contrast: 0.75, seed: 9091 },
    },
  },
  "pastel--cake-soft": {
    presetId: "dry-media",
    overrides: {
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 9103, tip: { shape: "sponge", softness: 0.68 }, spacingRatio: 0.12, scatterRatio: 0.08,
    },
  },
  "oil-pastel--waxy-film": {
    presetId: "dry-media",
    overrides: {
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 9109, tip: { shape: "bristle", softness: 0.35 }, spacingRatio: 0.1, scatterRatio: 0.04,
    },
  },
  // F3(2026-08-13): waxy-film과 같은 dry-media 물성 위에서 색 파이프라인만 다르다 — 카탈로그의
  // spectral-wgm-v1 핀 + 종이톤 배경 + dab별 지터가 이 레인의 유일한 SSOT(값 중복 금지). 핀이
  // colorDynamics 스냅샷에 실려 저장되므로 Canvas/SVG/협업 재생이 같은 혼합을 본다.
  "oil-pastel--wgm-mix": {
    presetId: "dry-media",
    overrides: {
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 9137,
      tip: { shape: "bristle", softness: 0.35 },
      spacingRatio: 0.1,
      scatterRatio: 0.04,
      colorDynamics:
        resolveStudioBrushEngineLaneColorPigmentTuning("oil-pastel--wgm-mix"),
    },
  },
  "brush--dry-rake": {
    presetId: "dry-media",
    overrides: {
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
      seed: 9113, tip: { shape: "bristle", softness: 0.25 }, spacingRatio: 0.14, scatterRatio: 0.2,
    },
  },
  "ink-particle--scatter-cloud": {
    presetId: "ink-particle",
    overrides: { seed: 9121, tip: { shape: "flake", softness: 0.3 }, spacingRatio: 0.18, scatterRatio: 0.45 },
  },
  "marker--soft-dynamic": {
    presetId: "airbrush",
    overrides: { seed: 9127, tip: { shape: "soft", softness: 0.55 }, spacingRatio: 0.11, scatterRatio: 0.06 },
  },
  "pencil--erodible-wear": {
    presetId: "ink-particle",
    overrides: { seed: 9131, tip: { shape: "grain", softness: 0.2 }, spacingRatio: 0.09, scatterRatio: 0.03 },
  },

};
