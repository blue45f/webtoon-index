import {
  STUDIO_INK_INPUT_V2_MAX_CONTACT_DIMENSION,
  STUDIO_INK_INPUT_V2_MAX_TIME_OFFSET_MS,
} from "@/shared/lib/studio-ink-input-contract";

const HALF_PI = Math.PI / 2;
const TWO_PI = Math.PI * 2;

export interface StudioPersistedPointerChannelSample {
  readonly pointerType?: unknown;
  readonly altitudeAngle?: unknown;
  readonly azimuthAngle?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly timeStamp?: unknown;
}

export interface StudioPersistedPointerChannels {
  readonly altitudeAngle: number;
  readonly azimuthAngle: number;
  readonly contactWidth: number;
  readonly contactHeight: number;
  readonly timeOffsetMilliseconds: number;
}

function finiteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
      ? Object.is(value, -0) ? 0 : value
      : fallback;
}

function normalizedAzimuth(value: unknown): number {
  const angle = finiteInRange(value, 0, TWO_PI, 0);
  return angle === TWO_PI ? 0 : angle;
}

function pointerTypeOf(value: unknown): "pen" | "touch" | "mouse" | "unknown" {
  return value === "pen" || value === "touch" || value === "mouse"
    ? value
    : "unknown";
}

/**
 * Normalizes browser-standard channels before they enter retained document arrays.
 *
 * Missing or broken optional driver fields use neutral values so drawing itself remains available.
 * Persistence validators are intentionally stricter and reject any malformed retained payload.
 * The time channel is relative to one transient gesture origin; the absolute browser clock is never
 * included in the returned value.
 */
export function normalizeStudioPersistedPointerChannels(
  sample: StudioPersistedPointerChannelSample,
  options: Readonly<{
    timeOriginMilliseconds: number;
    previousTimeOffsetMilliseconds?: number;
    sourceTimeMilliseconds?: number;
  }>,
): StudioPersistedPointerChannels {
  const pointerType = pointerTypeOf(sample.pointerType);
  const altitudeAngle = pointerType === "pen"
    ? finiteInRange(sample.altitudeAngle, 0, HALF_PI, HALF_PI)
    : HALF_PI;
  const azimuthAngle = pointerType === "pen"
    ? normalizedAzimuth(sample.azimuthAngle)
    : 0;
  const contactWidth = finiteInRange(
    sample.width,
    0,
    STUDIO_INK_INPUT_V2_MAX_CONTACT_DIMENSION,
    1,
  );
  const contactHeight = finiteInRange(
    sample.height,
    0,
    STUDIO_INK_INPUT_V2_MAX_CONTACT_DIMENSION,
    1,
  );
  const origin = finiteInRange(
    options.timeOriginMilliseconds,
    0,
    Number.MAX_SAFE_INTEGER,
    0,
  );
  const source = finiteInRange(
    options.sourceTimeMilliseconds ?? sample.timeStamp,
    0,
    Number.MAX_SAFE_INTEGER,
    origin,
  );
  const previous = finiteInRange(
    options.previousTimeOffsetMilliseconds,
    0,
    STUDIO_INK_INPUT_V2_MAX_TIME_OFFSET_MS,
    0,
  );
  const timeOffsetMilliseconds = Math.max(
    previous,
    Math.min(
      STUDIO_INK_INPUT_V2_MAX_TIME_OFFSET_MS,
      Math.max(0, source - origin),
    ),
  );
  return {
    altitudeAngle,
    azimuthAngle,
    contactWidth,
    contactHeight,
    timeOffsetMilliseconds,
  };
}
