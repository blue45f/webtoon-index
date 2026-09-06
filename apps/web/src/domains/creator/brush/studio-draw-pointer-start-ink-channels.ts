import { normalizeStudioPersistedPointerChannels } from "../studio-persisted-pointer-channels";

import type { NormalizedCalligraphyStylusInput } from "../studio-brush";
import type { DrawEl } from "../studio-element-model";

import { captureStudioInkInputContractV2 } from "@/shared/lib/studio-ink-input-contract";

interface StudioPointerStartInkSample {
  readonly pointerType?: unknown;
  readonly tangentialPressure?: unknown;
  readonly altitudeAngle?: unknown;
  readonly azimuthAngle?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly timeStamp: number;
}

type StudioPointerStartInkChannels = Pick<
  DrawEl,
  | "inkInput"
  | "tiltXs"
  | "tiltYs"
  | "twists"
  | "speeds"
  | "tangentialPressures"
  | "altitudeAngles"
  | "azimuthAngles"
  | "contactWidths"
  | "contactHeights"
  | "sampleTimeOffsets"
>;

function tangentialPressureOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(-1, value))
    : 0;
}

/**
 * Captures the initial persisted sensor sample as one cohesive v2 ink contract.
 * Keeping this leaf separate prevents the pure pointer-start planner from becoming a sensor codec.
 */
export function captureStudioPointerStartInkChannels(
  pointer: StudioPointerStartInkSample,
  stylus: NormalizedCalligraphyStylusInput,
): StudioPointerStartInkChannels {
  const persisted = normalizeStudioPersistedPointerChannels(pointer, {
    timeOriginMilliseconds: pointer.timeStamp,
  });
  return Object.freeze({
    inkInput: captureStudioInkInputContractV2(pointer.pointerType),
    tiltXs: [stylus.tiltX],
    tiltYs: [stylus.tiltY],
    twists: [stylus.twist],
    speeds: [0],
    tangentialPressures: [tangentialPressureOf(pointer.tangentialPressure)],
    altitudeAngles: [persisted.altitudeAngle],
    azimuthAngles: [persisted.azimuthAngle],
    contactWidths: [persisted.contactWidth],
    contactHeights: [persisted.contactHeight],
    sampleTimeOffsets: [persisted.timeOffsetMilliseconds],
  });
}
