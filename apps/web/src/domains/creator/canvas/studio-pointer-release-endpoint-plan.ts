/**
 * Pure stabilizer-endpoint planning for one released Studio stroke.
 *
 * The Page owns pointer transport, stabilizer state, CRDT publication, render surfaces, and the
 * final React/history commit. This leaf only decides whether a flushed endpoint extends the
 * immutable stroke and keeps every persisted hardware channel aligned with that new point.
 */

import {
  resolveStudioBrushDynamicsPresetId,
  resolveStudioCapturedBrushDynamicsPresetId,
} from "../brush/studio-brush-dynamics";
import { resolveStudioBrushReleasePressure } from "../brush/studio-brush-velocity-pressure";
import { studioInkFallbackPressure } from "../brush/studio-ink-pressure-model";
import {
  normalizeCalligraphyStylusInput,
} from "../studio-brush";
import { normalizeStudioPersistedPointerChannels } from "../studio-persisted-pointer-channels";

import type { DrawEl } from "../studio-element-model";

import { isStudioInkInputContractV2 } from "@/shared/lib/studio-ink-input-contract";

const RELEASE_ENDPOINT_EPSILON = 1e-6;

export interface StudioPointerReleaseEndpointSample {
  readonly pointerType?: unknown;
  readonly pressure?: unknown;
  readonly tiltX?: unknown;
  readonly tiltY?: unknown;
  readonly twist?: unknown;
  readonly tangentialPressure?: unknown;
  readonly altitudeAngle?: unknown;
  readonly azimuthAngle?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  /** Already privacy-normalized to the active pointer-down origin by the Studio coordinator. */
  readonly sampleTimeOffset?: unknown;
}

export interface StudioPointerReleaseEndpointPlanInput {
  readonly stroke: DrawEl;
  readonly endpoint: Readonly<{ x: number; y: number }>;
  readonly pointer: StudioPointerReleaseEndpointSample;
  readonly pressureCurve: number;
  readonly pressureMinSize?: number;
}

export interface StudioPointerReleaseEndpointPlan {
  readonly stroke: DrawEl;
  readonly appended: boolean;
}

function appendAlignedChannel(
  values: readonly number[] | undefined,
  previousPointCount: number,
  value: number,
  fallback = 0
): number[] {
  return [
    ...Array.from(
      { length: previousPointCount },
      (_, index) => values?.[index] ?? fallback
    ),
    value,
  ];
}

/** Plans the immutable endpoint extension without reading refs or publishing the new sample. */
export function planStudioPointerReleaseEndpoint(
  input: StudioPointerReleaseEndpointPlanInput
): StudioPointerReleaseEndpointPlan {
  const { endpoint, pointer, stroke } = input;
  const lastX = stroke.points[stroke.points.length - 2] ?? endpoint.x;
  const lastY = stroke.points[stroke.points.length - 1] ?? endpoint.y;
  if (!(Math.hypot(endpoint.x - lastX, endpoint.y - lastY) > RELEASE_ENDPOINT_EPSILON)) {
    return { stroke, appended: false };
  }

  const previousPointCount = Math.floor(stroke.points.length / 2);
  const fallbackPressure = studioInkFallbackPressure(stroke.pressureModel);
  const lastPressure = stroke.pressures?.at(-1) ?? fallbackPressure;
  const pressure = pointer.pointerType === "pen"
    ? resolveStudioBrushReleasePressure({
        brushId: stroke.brush,
        pointerType: "pen",
        rawPressure: pointer.pressure,
        lastContactPressure: lastPressure,
        pressureCurve: input.pressureCurve,
        pressureMinSize: input.pressureMinSize,
        fallbackPressure: lastPressure,
      })
    : lastPressure;
  const capturePointerDynamics =
    stroke.mode === "pen"
    && (resolveStudioBrushDynamicsPresetId(stroke.brush) !== null || resolveStudioCapturedBrushDynamicsPresetId(stroke) !== null);
  const captureInkSensorChannels =
    stroke.mode === "pen" && stroke.inkInput !== undefined;
  const captureExtendedInkSensorChannels =
    stroke.mode === "pen" && isStudioInkInputContractV2(stroke.inkInput);
  const captureStylus =
    stroke.mode === "pen"
    && (stroke.brush === "calligraphy" || capturePointerDynamics || captureInkSensorChannels);
  const stylus = captureStylus ? normalizeCalligraphyStylusInput(pointer) : null;
  const tangentialPressure =
    typeof pointer.tangentialPressure === "number"
    && Number.isFinite(pointer.tangentialPressure)
      ? Math.min(1, Math.max(-1, pointer.tangentialPressure))
      : (stroke.tangentialPressures?.at(-1) ?? 0);
  const persistedPointerChannels = normalizeStudioPersistedPointerChannels(pointer, {
    timeOriginMilliseconds: 0,
    sourceTimeMilliseconds:
      typeof pointer.sampleTimeOffset === "number"
        ? pointer.sampleTimeOffset
        : stroke.sampleTimeOffsets?.at(-1) ?? 0,
    previousTimeOffsetMilliseconds: stroke.sampleTimeOffsets?.at(-1) ?? 0,
  });

  return {
    appended: true,
    stroke: {
      ...stroke,
      points: [...stroke.points, endpoint.x, endpoint.y],
      pressures: appendAlignedChannel(
        stroke.pressures,
        previousPointCount,
        pressure,
        fallbackPressure
      ),
      tiltXs: stylus
        ? appendAlignedChannel(stroke.tiltXs, previousPointCount, stylus.tiltX)
        : stroke.tiltXs,
      tiltYs: stylus
        ? appendAlignedChannel(stroke.tiltYs, previousPointCount, stylus.tiltY)
        : stroke.tiltYs,
      twists: stylus
        ? appendAlignedChannel(stroke.twists, previousPointCount, stylus.twist)
        : stroke.twists,
      speeds: capturePointerDynamics || captureInkSensorChannels
        ? appendAlignedChannel(
            stroke.speeds,
            previousPointCount,
            stroke.speeds?.at(-1) ?? 0
          )
        : stroke.speeds,
      tangentialPressures: capturePointerDynamics || captureInkSensorChannels
        ? appendAlignedChannel(
            stroke.tangentialPressures,
            previousPointCount,
            tangentialPressure
          )
        : stroke.tangentialPressures,
      altitudeAngles: captureExtendedInkSensorChannels
        ? appendAlignedChannel(
            stroke.altitudeAngles,
            previousPointCount,
            persistedPointerChannels.altitudeAngle,
            Math.PI / 2,
          )
        : stroke.altitudeAngles,
      azimuthAngles: captureExtendedInkSensorChannels
        ? appendAlignedChannel(
            stroke.azimuthAngles,
            previousPointCount,
            persistedPointerChannels.azimuthAngle,
          )
        : stroke.azimuthAngles,
      contactWidths: captureExtendedInkSensorChannels
        ? appendAlignedChannel(
            stroke.contactWidths,
            previousPointCount,
            persistedPointerChannels.contactWidth,
            1,
          )
        : stroke.contactWidths,
      contactHeights: captureExtendedInkSensorChannels
        ? appendAlignedChannel(
            stroke.contactHeights,
            previousPointCount,
            persistedPointerChannels.contactHeight,
            1,
          )
        : stroke.contactHeights,
      sampleTimeOffsets: captureExtendedInkSensorChannels
        ? appendAlignedChannel(
            stroke.sampleTimeOffsets,
            previousPointCount,
            persistedPointerChannels.timeOffsetMilliseconds,
          )
        : stroke.sampleTimeOffsets,
    },
  };
}
