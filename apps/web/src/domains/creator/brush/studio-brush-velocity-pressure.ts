/**
 * Product adapter between brush-family pressure semantics and the causal velocity low-pass.
 *
 * The lower-level response intentionally knows nothing about Studio brush ids. This adapter keeps
 * one pressure authority at the input boundary:
 *
 * - valid stylus/force-touch pressure keeps precedence;
 * - mouse and ordinary touch use the family profile's speed response;
 * - the first non-pressure point and velocity-disabled input retain the exact nominal width;
 * - the historical 0.75 speed-response span is preserved while adding temporal low-pass filtering.
 *
 * The returned `pressure` is the canonical value persisted in DrawEl.pressures. Renderers must not
 * apply this adapter again.
 */

import {
  resolveStudioHybridPressureProfile,
  resolveStudioHybridPressureSample,
} from "../hybrid-dcc/studio-hybrid-pressure-profile";
import { resolveBrushReleasePressureSample } from "../studio-brush";
import {
  advanceStudioVelocityPressure,
  type StudioVelocityPressurePointerSample,
  type StudioVelocityPressureSample,
  type StudioVelocityPressureState,
} from "../studio-velocity-pressure-response";

import {
  studioInkFallbackPressure,
  type StudioInkPressureModel,
} from "./studio-ink-pressure-model";


export const STUDIO_BRUSH_VELOCITY_PRESSURE_ADAPTER_VERSION =
  "brush-velocity-pressure-adapter-v1" as const;

export interface StudioBrushVelocityPressureSettings {
  readonly brushId?: unknown;
  readonly pressureCurve?: unknown;
  readonly pressureMinSize?: unknown;
  readonly useVelocityPressure?: boolean;
  readonly velocitySensitivity?: unknown;
  /** Causal nominal pressure for brushes without a family profile. */
  readonly fallbackPressure?: unknown;
}

export interface StudioBrushVelocityPressureTransition {
  readonly version: typeof STUDIO_BRUSH_VELOCITY_PRESSURE_ADAPTER_VERSION;
  readonly state: StudioVelocityPressureState;
  readonly sample: StudioVelocityPressureSample;
  /** Canonical pressure to persist and send to every renderer. */
  readonly pressure: number;
}

export interface StudioBrushReleasePressureInput
  extends StudioBrushVelocityPressureSettings {
  readonly pointerType?: unknown;
  readonly rawPressure?: unknown;
  readonly lastContactPressure?: unknown;
}

interface StudioBrushVelocityPressurePointerStart {
  readonly clientX?: unknown;
  readonly clientY?: unknown;
  readonly timeStamp?: unknown;
  readonly pointerType?: unknown;
  readonly pressure?: unknown;
}

interface StudioBrushVelocityPressureElementStart {
  readonly brush?: unknown;
  readonly pressures?: readonly number[];
  readonly pressureModel?: StudioInkPressureModel;
}

interface StudioBrushVelocityPressureInputSettings {
  readonly pressureCurve?: unknown;
  readonly pressureMinSize?: unknown;
  readonly useVelocityPressure?: boolean;
  readonly velocitySensitivity?: unknown;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: unknown, fallback: number): number {
  return clamp(finiteOr(value, fallback), 0, 1);
}

/**
 * Advances the state exactly once for one authoritative pointer sample.
 *
 * Predictions may call this function against a copied state, but must discard the returned state.
 */
export function advanceStudioBrushVelocityPressure(
  state: StudioVelocityPressureState | null | undefined,
  pointer: StudioVelocityPressurePointerSample,
  settings: StudioBrushVelocityPressureSettings
): StudioBrushVelocityPressureTransition {
  // The default pen already has a persisted residual-pressure contract whose stationary nominal
  // width is 1. Treating it as the newer "ink" family would make the first move jump from 1 to
  // 0.72 even though the pointer pressure did not change. Named ink aliases still opt into their
  // family profile, while the default pen only gains the temporal velocity low-pass here.
  const family = settings.brushId === "pen"
    ? null
    : resolveStudioHybridPressureProfile(settings.brushId);
  const nominalPressure = family?.nominalPressure
    ?? clamp01(settings.fallbackPressure, 0.5);
  const velocityEnabled = settings.useVelocityPressure !== false;
  const artistVelocitySensitivity = clamp01(settings.velocitySensitivity, 1);
  // The artist floor can strengthen a family default, but never weaken it. Profiled brushes
  // persist canonical pigment pressure; their actual diameter floor is snapshotted into
  // brushDynamics at pointer start and applied by the shared dab planner.
  const minimumWidthRatio = Math.max(
    family?.minimumWidthRatio ?? 0,
    clamp01(settings.pressureMinSize, 0)
  );
  const pressureExponent = clamp(
    finiteOr(settings.pressureCurve, 1) * (family?.pressureExponent ?? 1),
    0.05,
    8
  );
  const transition = advanceStudioVelocityPressure(state, pointer, {
    nominalPressure,
    // The preceding pressure resolver used a 0.75 response span. Preserve that calibrated range
    // and change only the temporal behavior by adding the causal low-pass.
    velocitySensitivity: velocityEnabled
      ? (family?.velocitySensitivity ?? artistVelocitySensitivity)
        * (family ? artistVelocitySensitivity : 1)
        * 0.75
      : 0,
    velocityForMinimumPressure: family?.maxVelocity ?? 1.6,
    minimumWidthRatio,
    pressureExponent,
    penPolicy: "hardware-precedence",
  });
  const nonHardware = transition.sample.hardwarePressure === null;
  const pressure = nonHardware
    && (transition.sample.source === "nominal" || !velocityEnabled)
    // Nominal cursor width is not a simulated pressure sample: pressure curves and min-size floors
    // must not make the first stationary mouse/touch point thicker or thinner.
    ? nominalPressure
    : family
      // Persist the canonical pigment pressure. Width floors belong to geometry renderers; mixing
      // them into DrawEl.pressures prevents pencils, charcoal and paint from reaching a genuinely
      // light deposit even when a stylus reports pressure near zero.
      ? transition.sample.pressure
      : transition.sample.widthRatio;

  return Object.freeze({
    version: STUDIO_BRUSH_VELOCITY_PRESSURE_ADAPTER_VERSION,
    state: transition.state,
    sample: transition.sample,
    pressure,
  });
}

/** Initializes the causal pressure journal at the same boundary as the first draw element. */
export function initializeStudioBrushVelocityPressure(
  drawMode: unknown,
  pointer: StudioBrushVelocityPressurePointerStart,
  element: StudioBrushVelocityPressureElementStart,
  settings: StudioBrushVelocityPressureInputSettings | null | undefined,
): StudioVelocityPressureState | null {
  if (drawMode === "shape" || drawMode === "pixel") return null;
  return advanceStudioBrushVelocityPressure(
    null,
    {
      x: pointer.clientX,
      y: pointer.clientY,
      timeMs: pointer.timeStamp,
      pointerType: pointer.pointerType,
      pressure: pointer.pressure,
    },
    {
      brushId: element.brush,
      pressureCurve: settings?.pressureCurve,
      pressureMinSize: settings?.pressureMinSize,
      useVelocityPressure: settings?.useVelocityPressure,
      velocitySensitivity: settings?.velocitySensitivity,
      fallbackPressure:
        element.pressures?.[0] ?? studioInkFallbackPressure(element.pressureModel),
    },
  ).state;
}

/**
 * Resolves the last physical pen contact through the same family curve used during pointermove.
 * Pointer Events commonly reports zero after the nib has already left the surface; that release
 * sentinel must retain the last authoritative contact instead of erasing or pinching the tail.
 */
export function resolveStudioBrushReleasePressure(
  input: StudioBrushReleasePressureInput
): number {
  const lastContactPressure = clamp01(input.lastContactPressure, 0.5);
  const rawPressure = finiteOr(input.rawPressure, Number.NaN);
  if (
    input.pointerType === "pen"
    && !(rawPressure > 0 && rawPressure <= 1)
  ) {
    // Missing, zero and malformed pointerup pressure all mean there is no trustworthy new contact
    // sample. Replacing the last real contact with the family nominal would make a fast tail pop
    // wider or darker on browsers/devices that omit release pressure.
    return lastContactPressure;
  }

  const family = input.brushId === "pen"
    ? null
    : resolveStudioHybridPressureProfile(input.brushId);
  if (family && input.pointerType === "pen") {
    return resolveStudioHybridPressureSample(input.brushId, {
      pointerType: "pen",
      rawPressure,
      pressureCurve: input.pressureCurve,
      simulateVelocity: false,
    })?.pressure ?? lastContactPressure;
  }

  return resolveBrushReleasePressureSample({
    pointerType: input.pointerType,
    rawPressure,
    lastContactPressure,
    velocityFallbackEnabled: false,
    pressureCurve: input.pressureCurve,
    minSizeRatio: input.pressureMinSize,
    fallbackPressure: lastContactPressure,
  });
}
