/**
 * Evaluation of public wet-ink / fluid demos for ToonSpectrum texture-first hybrid pins.
 *
 * Demos reviewed:
 * - WebGL Fluid Simulation (PavelDoGreat) — MIT
 * - Inkwash (johnowhitaker) — no LICENSE in repo → concepts only
 * - paint-webgl (piellardj) — ISC
 *
 * Texture-first policy: pin best texture stack; optimize later; no silent engine swap.
 */

import {
  STUDIO_WEBGL_STABLE_FLUID_CORE_VERSION,
  STUDIO_WEBGL_STABLE_FLUID_PROVENANCE,
} from "./render/studio-webgl-stable-fluid-core";

export const STUDIO_FLUID_DEMO_EVALUATION_VERSION =
  "studio-fluid-demo-evaluation-v1" as const;

export type StudioFluidDemoVerdict =
  | "adopt-as-primary-pin"
  | "adopt-as-supporting-kernel"
  | "inspire-living-ink-only"
  | "reference-not-product"
  | "blocked-no-license";

export interface StudioFluidDemoEvaluation {
  readonly id: string;
  readonly demoUrl: string;
  readonly sourceUrl: string;
  readonly license: string;
  readonly mayVendorSource: boolean;
  readonly textureFit: Readonly<{
    readonly wetInkBleed: number;
    readonly sumiInk: number;
    readonly oilPaint: number;
    readonly airbrush: number;
  }>;
  readonly mapsToStudio: readonly string[];
  readonly verdict: StudioFluidDemoVerdict;
  readonly productRecommendation: string;
  readonly risks: readonly string[];
}

export const STUDIO_FLUID_DEMO_EVALUATIONS = Object.freeze([
  Object.freeze({
    id: "pavel-webgl-fluid-simulation",
    demoUrl: "https://paveldogreat.github.io/WebGL-Fluid-Simulation/",
    sourceUrl: "https://github.com/PavelDoGreat/WebGL-Fluid-Simulation",
    license: "MIT",
    mayVendorSource: true,
    textureFit: Object.freeze({
      wetInkBleed: 0.85,
      sumiInk: 0.7,
      oilPaint: 0.15,
      airbrush: 0.55,
    }),
    mapsToStudio: Object.freeze([
      "studio-webgl-stable-fluid-core (typed CPU subset)",
      "studio-living-ink-field advection/vorticity ideas",
      "wet-watercolor / wet-inkwash hybrid pins",
    ]),
    verdict: "adopt-as-supporting-kernel" as const,
    productRecommendation:
      "Use Stam/Pavel advection + curl + Jacobi pressure as the wet transport kernel. "
      + "Do not replace Living Ink product pin wholesale with the full demo (bloom/sunrays/entertainment UI). "
      + "Ship typed subset under MIT attribution; GPU port can later mirror Living Ink WebGL2/WebGPU path.",
    risks: Object.freeze([
      "Demo optimizes colorful smoke, not paper absorbency / fixed ink",
      "Full script.js is large and interactive-demo oriented",
      "Must keep fail-closed: fluid kernel failure must not swap to airbrush pin",
    ]),
  }),
  Object.freeze({
    id: "johnowhitaker-inkwash",
    demoUrl: "https://johnowhitaker.github.io/inkwash/about",
    sourceUrl: "https://github.com/johnowhitaker/inkwash",
    license: "none-found",
    mayVendorSource: false,
    textureFit: Object.freeze({
      wetInkBleed: 0.95,
      sumiInk: 0.95,
      oilPaint: 0.1,
      airbrush: 0.25,
    }),
    mapsToStudio: Object.freeze([
      "studio-living-ink-field (ink / water / fixation vocabulary)",
      "pen vs water-brush dual tool UX",
      "velocity confined to wet paper + dry/fix",
    ]),
    verdict: "inspire-living-ink-only" as const,
    productRecommendation:
      "Best product-feel match for 수묵/수채. **Do not copy index.html** without a license. "
      + "Clean-room: keep Living Ink as authority; absorb field split (velocity, wet, mobile ink, fixed ink) "
      + "and pen/water dual input. Align hybrid wet-inkwash pin to Living Ink + wet-ink runtime.",
    risks: Object.freeze([
      "No LICENSE file — legal block on vendoring",
      "Single HTML monolith hard to productize even if licensed",
      "WebGL2 float texture requirements on low-end devices",
    ]),
  }),
  Object.freeze({
    id: "piellardj-paint-webgl",
    demoUrl: "https://piellardj.github.io/paint-webgl/",
    sourceUrl: "https://github.com/piellardj/paint-webgl",
    license: "ISC",
    mayVendorSource: true,
    textureFit: Object.freeze({
      wetInkBleed: 0.2,
      sumiInk: 0.15,
      oilPaint: 0.55,
      airbrush: 0.2,
    }),
    mapsToStudio: Object.freeze([
      "flowmap-driven oriented stroke particles (paint-bristle secondary)",
      "not a user ink deposition simulator",
    ]),
    verdict: "reference-not-product" as const,
    productRecommendation:
      "Visualization of particles on a flow map — good for animated bristle/orientation experiments, "
      + "not primary wet ink. Keep as reference; oil pin stays oil-ribbon + Hokusai film.",
    risks: Object.freeze([
      "Not an interactive painting tool for freehand pigment deposition",
      "Layered particle lifetime loop ≠ document-editable stroke model",
    ]),
  }),
] as const satisfies readonly StudioFluidDemoEvaluation[]);

export interface StudioFluidDemoAdoptionPlan {
  readonly version: typeof STUDIO_FLUID_DEMO_EVALUATION_VERSION;
  readonly fluidCoreVersion: typeof STUDIO_WEBGL_STABLE_FLUID_CORE_VERSION;
  readonly provenance: typeof STUDIO_WEBGL_STABLE_FLUID_PROVENANCE;
  readonly evaluations: typeof STUDIO_FLUID_DEMO_EVALUATIONS;
  readonly wetPinPolicy: Readonly<{
    readonly primaryPin: "living-ink-and-wet-ink-runtime";
    readonly supportingKernel: "studio-webgl-stable-fluid-core";
    readonly inkwashRole: "concept-inspiration-only";
    readonly paintWebglRole: "reference-not-product";
    readonly crossEngineFallback: false;
  }>;
  readonly nextSteps: readonly string[];
}

/**
 * Product adoption plan for wet/sumi fluid demos under texture-first hybrid policy.
 */
export function resolveStudioFluidDemoAdoptionPlan(): StudioFluidDemoAdoptionPlan {
  return Object.freeze({
    version: STUDIO_FLUID_DEMO_EVALUATION_VERSION,
    fluidCoreVersion: STUDIO_WEBGL_STABLE_FLUID_CORE_VERSION,
    provenance: STUDIO_WEBGL_STABLE_FLUID_PROVENANCE,
    evaluations: STUDIO_FLUID_DEMO_EVALUATIONS,
    wetPinPolicy: Object.freeze({
      primaryPin: "living-ink-and-wet-ink-runtime" as const,
      supportingKernel: "studio-webgl-stable-fluid-core" as const,
      inkwashRole: "concept-inspiration-only" as const,
      paintWebglRole: "reference-not-product" as const,
      crossEngineFallback: false as const,
    }),
    nextSteps: Object.freeze([
      "Keep Living Ink as wet-watercolor / wet-inkwash product authority when admitted",
      "Port vetted advection/vorticity steps from stable-fluid core into Living Ink GPU shaders under MIT notice",
      "Do not vendor inkwash HTML until license is obtained",
      "Do not use paint-webgl as oil/wet ink pin",
      "Evaluate GPU fluid only after texture parity on Living Ink CPU oracle",
    ]),
  });
}

export function studioFluidDemoEvaluationById(
  id: string,
): StudioFluidDemoEvaluation | null {
  return STUDIO_FLUID_DEMO_EVALUATIONS.find((entry) => entry.id === id) ?? null;
}
