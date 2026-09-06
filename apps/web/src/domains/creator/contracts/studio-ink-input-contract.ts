/**
 * Vendor-neutral digital-ink input provenance.
 *
 * The contract records how a stroke's aligned sample arrays were captured without persisting a
 * hardware identifier. It deliberately describes browser-standard Pointer Events semantics rather
 * than a commercial SDK or file format, so saved strokes remain replayable when the input backend
 * changes.
 */

export const STUDIO_INK_INPUT_CONTRACT_KIND =
  "studio-ink-input-contract" as const;
export const STUDIO_INK_INPUT_CONTRACT_VERSION = 1 as const;
export const STUDIO_INK_INPUT_CONTRACT_V2_VERSION = 2 as const;
export const STUDIO_INK_INPUT_TRANSPORT =
  "pointer-events-level-3-v1" as const;
export const STUDIO_INK_INPUT_AUTHORITATIVE_SAMPLE_POLICY =
  "coalesced-or-dispatched-v1" as const;
export const STUDIO_INK_INPUT_PREDICTION_POLICY =
  "preview-only-never-persisted-v1" as const;
export const STUDIO_INK_INPUT_PRIVACY_POLICY =
  "no-device-identifier-v1" as const;
export const STUDIO_INK_INPUT_V2_MAX_CONTACT_DIMENSION = 65_536 as const;
/** One continuous pointer gesture cannot persist an unbounded/browser-absolute clock. */
export const STUDIO_INK_INPUT_V2_MAX_TIME_OFFSET_MS = 86_400_000 as const;

export type StudioInkPointerType = "pen" | "touch" | "mouse" | "unknown";
export type StudioInkPressureSource = "device-or-browser" | "simulated";

export interface StudioInkInputChannelSemanticsV1 {
  readonly position: "studio-document-px";
  readonly pressure: "normalized-0-1";
  readonly orientation: "pointer-event-degrees-or-neutral";
  readonly speed: "client-css-px-per-ms-derived";
  readonly tangentialPressure: "normalized-minus1-to1-or-neutral";
  readonly timestamps: "not-persisted-v1";
}

export interface StudioInkInputChannelSemanticsV2 {
  readonly position: "studio-document-px";
  readonly pressure: "normalized-0-1";
  readonly tilt: "pointer-event-degrees-or-neutral";
  readonly altitudeAngle: "pointer-event-radians-0-pi-over-2-or-neutral";
  readonly azimuthAngle: "pointer-event-radians-0-2pi-or-neutral";
  readonly twist: "pointer-event-degrees-0-360-or-neutral";
  readonly contactGeometry: "pointer-event-css-px-or-neutral";
  readonly speed: "client-css-px-per-ms-derived";
  readonly tangentialPressure: "normalized-minus1-to1-or-neutral";
  readonly timestamps: "authoritative-gesture-relative-ms-v1";
}

export interface StudioInkInputContractV1 {
  readonly kind: typeof STUDIO_INK_INPUT_CONTRACT_KIND;
  readonly version: typeof STUDIO_INK_INPUT_CONTRACT_VERSION;
  readonly transport: typeof STUDIO_INK_INPUT_TRANSPORT;
  readonly authoritativeSamples: typeof STUDIO_INK_INPUT_AUTHORITATIVE_SAMPLE_POLICY;
  readonly predictedSamples: typeof STUDIO_INK_INPUT_PREDICTION_POLICY;
  readonly privacy: typeof STUDIO_INK_INPUT_PRIVACY_POLICY;
  readonly pointerType: StudioInkPointerType;
  readonly pressureSource: StudioInkPressureSource;
  readonly channels: StudioInkInputChannelSemanticsV1;
}

export interface StudioInkInputContractV2 {
  readonly kind: typeof STUDIO_INK_INPUT_CONTRACT_KIND;
  readonly version: typeof STUDIO_INK_INPUT_CONTRACT_V2_VERSION;
  readonly transport: typeof STUDIO_INK_INPUT_TRANSPORT;
  readonly authoritativeSamples: typeof STUDIO_INK_INPUT_AUTHORITATIVE_SAMPLE_POLICY;
  readonly predictedSamples: typeof STUDIO_INK_INPUT_PREDICTION_POLICY;
  readonly privacy: typeof STUDIO_INK_INPUT_PRIVACY_POLICY;
  readonly pointerType: StudioInkPointerType;
  readonly pressureSource: StudioInkPressureSource;
  readonly channels: StudioInkInputChannelSemanticsV2;
}

export type StudioInkInputContract =
  | StudioInkInputContractV1
  | StudioInkInputContractV2;

const CONTRACT_KEYS = [
  "kind",
  "version",
  "transport",
  "authoritativeSamples",
  "predictedSamples",
  "privacy",
  "pointerType",
  "pressureSource",
  "channels",
] as const;

const CHANNEL_KEYS = [
  "position",
  "pressure",
  "orientation",
  "speed",
  "tangentialPressure",
  "timestamps",
] as const;

const V2_CHANNEL_KEYS = [
  "position",
  "pressure",
  "tilt",
  "altitudeAngle",
  "azimuthAngle",
  "twist",
  "contactGeometry",
  "speed",
  "tangentialPressure",
  "timestamps",
] as const;

const POINTER_TYPES = new Set<StudioInkPointerType>([
  "pen",
  "touch",
  "mouse",
  "unknown",
]);

function plainRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !("value" in descriptor)
      ) {
        return null;
      }
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && keys.every((key) => expected.includes(key));
}

function pointerTypeOf(value: unknown): StudioInkPointerType {
  return typeof value === "string" && POINTER_TYPES.has(value as StudioInkPointerType)
    ? value as StudioInkPointerType
    : "unknown";
}

function freezeContractV1(
  pointerType: StudioInkPointerType,
  pressureSource: StudioInkPressureSource,
): StudioInkInputContractV1 {
  const channels: StudioInkInputChannelSemanticsV1 = Object.freeze({
    position: "studio-document-px",
    pressure: "normalized-0-1",
    orientation: "pointer-event-degrees-or-neutral",
    speed: "client-css-px-per-ms-derived",
    tangentialPressure: "normalized-minus1-to1-or-neutral",
    timestamps: "not-persisted-v1",
  });
  return Object.freeze({
    kind: STUDIO_INK_INPUT_CONTRACT_KIND,
    version: STUDIO_INK_INPUT_CONTRACT_VERSION,
    transport: STUDIO_INK_INPUT_TRANSPORT,
    authoritativeSamples: STUDIO_INK_INPUT_AUTHORITATIVE_SAMPLE_POLICY,
    predictedSamples: STUDIO_INK_INPUT_PREDICTION_POLICY,
    privacy: STUDIO_INK_INPUT_PRIVACY_POLICY,
    pointerType,
    pressureSource,
    channels,
  });
}

function freezeContractV2(
  pointerType: StudioInkPointerType,
  pressureSource: StudioInkPressureSource,
): StudioInkInputContractV2 {
  const channels: StudioInkInputChannelSemanticsV2 = Object.freeze({
    position: "studio-document-px",
    pressure: "normalized-0-1",
    tilt: "pointer-event-degrees-or-neutral",
    altitudeAngle: "pointer-event-radians-0-pi-over-2-or-neutral",
    azimuthAngle: "pointer-event-radians-0-2pi-or-neutral",
    twist: "pointer-event-degrees-0-360-or-neutral",
    contactGeometry: "pointer-event-css-px-or-neutral",
    speed: "client-css-px-per-ms-derived",
    tangentialPressure: "normalized-minus1-to1-or-neutral",
    timestamps: "authoritative-gesture-relative-ms-v1",
  });
  return Object.freeze({
    kind: STUDIO_INK_INPUT_CONTRACT_KIND,
    version: STUDIO_INK_INPUT_CONTRACT_V2_VERSION,
    transport: STUDIO_INK_INPUT_TRANSPORT,
    authoritativeSamples: STUDIO_INK_INPUT_AUTHORITATIVE_SAMPLE_POLICY,
    predictedSamples: STUDIO_INK_INPUT_PREDICTION_POLICY,
    privacy: STUDIO_INK_INPUT_PRIVACY_POLICY,
    pointerType,
    pressureSource,
    channels,
  });
}

/** Captures one immutable provenance snapshot at pointer-down. */
export function captureStudioInkInputContractV1(
  pointerType: unknown,
): StudioInkInputContractV1 {
  const normalizedPointerType = pointerTypeOf(pointerType);
  return freezeContractV1(
    normalizedPointerType,
    normalizedPointerType === "pen" ? "device-or-browser" : "simulated",
  );
}

/** Captures the current authoritative sensor-channel contract for a newly authored stroke. */
export function captureStudioInkInputContractV2(
  pointerType: unknown,
): StudioInkInputContractV2 {
  const normalizedPointerType = pointerTypeOf(pointerType);
  return freezeContractV2(
    normalizedPointerType,
    normalizedPointerType === "pen" ? "device-or-browser" : "simulated",
  );
}

/**
 * Strictly validates persisted/collaborative data. Unknown future contracts fail closed so a
 * renderer never silently assigns current sensor semantics to an incompatible payload.
 */
export function normalizeStudioInkInputContract(
  value: unknown,
): StudioInkInputContract | null {
  const contract = plainRecord(value);
  if (!contract || !hasExactKeys(contract, CONTRACT_KEYS)) return null;
  const channels = plainRecord(contract.channels);
  if (!channels) return null;

  const sharedInvalid =
    contract.kind !== STUDIO_INK_INPUT_CONTRACT_KIND
    || contract.transport !== STUDIO_INK_INPUT_TRANSPORT
    || contract.authoritativeSamples !== STUDIO_INK_INPUT_AUTHORITATIVE_SAMPLE_POLICY
    || contract.predictedSamples !== STUDIO_INK_INPUT_PREDICTION_POLICY
    || contract.privacy !== STUDIO_INK_INPUT_PRIVACY_POLICY
    || typeof contract.pointerType !== "string"
    || !POINTER_TYPES.has(contract.pointerType as StudioInkPointerType)
    || (
      contract.pressureSource !== "device-or-browser"
      && contract.pressureSource !== "simulated"
    )
    || (
      contract.pointerType === "pen"
        ? contract.pressureSource !== "device-or-browser"
        : contract.pressureSource !== "simulated"
    );
  if (sharedInvalid) return null;

  const pointerType = contract.pointerType as StudioInkPointerType;
  const pressureSource = contract.pressureSource as StudioInkPressureSource;
  if (contract.version === STUDIO_INK_INPUT_CONTRACT_VERSION) {
    if (
      !hasExactKeys(channels, CHANNEL_KEYS)
      || channels.position !== "studio-document-px"
      || channels.pressure !== "normalized-0-1"
      || channels.orientation !== "pointer-event-degrees-or-neutral"
      || channels.speed !== "client-css-px-per-ms-derived"
      || channels.tangentialPressure !== "normalized-minus1-to1-or-neutral"
      || channels.timestamps !== "not-persisted-v1"
    ) return null;
    return freezeContractV1(pointerType, pressureSource);
  }

  if (contract.version === STUDIO_INK_INPUT_CONTRACT_V2_VERSION) {
    if (
      !hasExactKeys(channels, V2_CHANNEL_KEYS)
      || channels.position !== "studio-document-px"
      || channels.pressure !== "normalized-0-1"
      || channels.tilt !== "pointer-event-degrees-or-neutral"
      || channels.altitudeAngle !== "pointer-event-radians-0-pi-over-2-or-neutral"
      || channels.azimuthAngle !== "pointer-event-radians-0-2pi-or-neutral"
      || channels.twist !== "pointer-event-degrees-0-360-or-neutral"
      || channels.contactGeometry !== "pointer-event-css-px-or-neutral"
      || channels.speed !== "client-css-px-per-ms-derived"
      || channels.tangentialPressure !== "normalized-minus1-to1-or-neutral"
      || channels.timestamps !== "authoritative-gesture-relative-ms-v1"
    ) return null;
    return freezeContractV2(pointerType, pressureSource);
  }

  return null;
}

export function isStudioInkInputContractV1(
  value: unknown,
): value is StudioInkInputContractV1 {
  return normalizeStudioInkInputContract(value)?.version
    === STUDIO_INK_INPUT_CONTRACT_VERSION;
}

export function isStudioInkInputContractV2(
  value: unknown,
): value is StudioInkInputContractV2 {
  return normalizeStudioInkInputContract(value)?.version
    === STUDIO_INK_INPUT_CONTRACT_V2_VERSION;
}
