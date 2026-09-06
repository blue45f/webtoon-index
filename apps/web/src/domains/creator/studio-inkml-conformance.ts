/**
 * Deterministic conformance boundary for ToonSpectrum's bounded W3C InkML profile.
 *
 * This module validates only the public W3C InkML subset implemented by
 * `studio-inkml-codec.ts`. It does not parse or certify Wacom WILL/UIM payloads, and a receipt from
 * this validator must never be presented as Wacom or another vendor's compatibility approval.
 * Proprietary SDK support belongs behind a separately licensed provider adapter.
 */

import {
  STUDIO_INKML_LIMITS,
  STUDIO_INKML_MEDIA_TYPE,
  STUDIO_INKML_NAMESPACE,
  STUDIO_INKML_PROFILE,
  StudioInkMlCodecError,
  decodeStudioInkMl,
  encodeStudioInkMl,
  type StudioInkMlCodecOptions,
  type StudioInkMlDocument,
  type StudioInkMlTrace,
} from "./studio-inkml-codec";

export const STUDIO_INKML_CONFORMANCE_PROFILE_ID =
  "toonspectrum.inkml.w3c-safe-profile" as const;
export const STUDIO_INKML_CONFORMANCE_PROFILE_VERSION = 1 as const;
export const STUDIO_INKML_CONFORMANCE_RECEIPT_ID =
  "toonspectrum.inkml.conformance-receipt" as const;
export const STUDIO_INKML_CONFORMANCE_RECEIPT_VERSION = 1 as const;

export const STUDIO_INKML_CONFORMANCE_CAPABILITIES = Object.freeze([
  "brush:unsupported-fail-closed-v1",
  "channel:force-v1",
  "channel:position-v1",
  "channel:rotation-v1",
  "channel:speed-v1",
  "channel:tangential-pressure-v1",
  "channel:tilt-v1",
  "context:explicit-trace-format-ref-v1",
  "profile:bounded-basic-import-v1",
  "profile:deterministic-v1-export-v1",
  "provider:vendor-adapter-boundary-v1",
  "round-trip:fixed-tolerance-v1",
  "security:bounded-xml-v1",
  "trace-group:unsupported-fail-closed-v1",
] as const);

export type StudioInkMlConformanceCapability =
  (typeof STUDIO_INKML_CONFORMANCE_CAPABILITIES)[number];
export type StudioInkMlDocumentProfile = StudioInkMlDocument["profile"];
export type StudioInkMlSha256 = `sha256:${string}`;

export interface StudioInkMlChannelCapability {
  readonly name: "X" | "Y" | "F" | "OTx" | "OTy" | "OR" | "TS.S" | "TS.TP";
  readonly semantic:
    | "document-position"
    | "normalized-force"
    | "pointer-tilt"
    | "pointer-twist"
    | "pointer-speed"
    | "normalized-tangential-pressure";
  readonly import: "supported";
  readonly export: "supported";
  readonly profileUnits: readonly string[];
}

export interface StudioInkMlConformanceManifest {
  readonly id: typeof STUDIO_INKML_CONFORMANCE_PROFILE_ID;
  readonly version: typeof STUDIO_INKML_CONFORMANCE_PROFILE_VERSION;
  readonly specification: Readonly<{
    family: "W3C InkML";
    namespace: typeof STUDIO_INKML_NAMESPACE;
    profileClaim: "bounded-public-subset";
  }>;
  readonly documentProfiles: readonly Readonly<{
    id: StudioInkMlDocumentProfile;
    import: "supported";
    export: "supported" | "normalize-to-toonspectrum-v1";
  }>[];
  readonly capabilities: readonly StudioInkMlConformanceCapability[];
  readonly channels: readonly StudioInkMlChannelCapability[];
  readonly context: Readonly<{
    explicitTraceFormatReference: "supported";
    streamingCurrentContext: "rejected";
    inheritance: "rejected";
    canvasTransform: "rejected";
    childSemantics: "rejected";
  }>;
  readonly brush: Readonly<{
    definitions: "rejected";
    brushReference: "rejected";
    vendorPayload: "provider-adapter-only";
  }>;
  readonly traceGroup: Readonly<{
    elements: "rejected";
    inheritedContext: "rejected";
  }>;
  readonly xmlSecurity: Readonly<{
    boundary: "bounded-lexical-preflight-before-domparser-v1";
    dtd: "rejected";
    entities: "rejected";
    cdata: "rejected";
    comments: "rejected";
    processingInstructions: "rejected";
  }>;
  readonly resourceBudget: Readonly<typeof STUDIO_INKML_LIMITS>;
  readonly providerBoundary: Readonly<{
    publicInterchange: "W3C-InkML-safe-subset";
    proprietaryWireFormats: "outside-this-module";
    commercialSdk: "external-provider-adapter-only";
    officialVendorCompatibility: "not-claimed";
  }>;
}

const CHANNEL_CAPABILITIES = Object.freeze([
  Object.freeze({
    name: "X",
    semantic: "document-position",
    import: "supported",
    export: "supported",
    profileUnits: Object.freeze(["px"]),
  }),
  Object.freeze({
    name: "Y",
    semantic: "document-position",
    import: "supported",
    export: "supported",
    profileUnits: Object.freeze(["px"]),
  }),
  Object.freeze({
    name: "F",
    semantic: "normalized-force",
    import: "supported",
    export: "supported",
    profileUnits: Object.freeze(["%", "dev"]),
  }),
  Object.freeze({
    name: "OTx",
    semantic: "pointer-tilt",
    import: "supported",
    export: "supported",
    profileUnits: Object.freeze(["deg", "rad"]),
  }),
  Object.freeze({
    name: "OTy",
    semantic: "pointer-tilt",
    import: "supported",
    export: "supported",
    profileUnits: Object.freeze(["deg", "rad"]),
  }),
  Object.freeze({
    name: "OR",
    semantic: "pointer-twist",
    import: "supported",
    export: "supported",
    profileUnits: Object.freeze(["deg", "rad"]),
  }),
  Object.freeze({
    name: "TS.S",
    semantic: "pointer-speed",
    import: "supported",
    export: "supported",
    profileUnits: Object.freeze(["px/ms"]),
  }),
  Object.freeze({
    name: "TS.TP",
    semantic: "normalized-tangential-pressure",
    import: "supported",
    export: "supported",
    profileUnits: Object.freeze(["dev"]),
  }),
] as const satisfies readonly StudioInkMlChannelCapability[]);

export const STUDIO_INKML_CONFORMANCE_MANIFEST: StudioInkMlConformanceManifest =
  Object.freeze({
    id: STUDIO_INKML_CONFORMANCE_PROFILE_ID,
    version: STUDIO_INKML_CONFORMANCE_PROFILE_VERSION,
    specification: Object.freeze({
      family: "W3C InkML",
      namespace: STUDIO_INKML_NAMESPACE,
      profileClaim: "bounded-public-subset",
    }),
    documentProfiles: Object.freeze([
      Object.freeze({
        id: STUDIO_INKML_PROFILE,
        import: "supported",
        export: "supported",
      }),
      Object.freeze({
        id: "inkml-basic",
        import: "supported",
        export: "normalize-to-toonspectrum-v1",
      }),
    ]),
    capabilities: STUDIO_INKML_CONFORMANCE_CAPABILITIES,
    channels: CHANNEL_CAPABILITIES,
    context: Object.freeze({
      explicitTraceFormatReference: "supported",
      streamingCurrentContext: "rejected",
      inheritance: "rejected",
      canvasTransform: "rejected",
      childSemantics: "rejected",
    }),
    brush: Object.freeze({
      definitions: "rejected",
      brushReference: "rejected",
      vendorPayload: "provider-adapter-only",
    }),
    traceGroup: Object.freeze({
      elements: "rejected",
      inheritedContext: "rejected",
    }),
    xmlSecurity: Object.freeze({
      boundary: "bounded-lexical-preflight-before-domparser-v1",
      dtd: "rejected",
      entities: "rejected",
      cdata: "rejected",
      comments: "rejected",
      processingInstructions: "rejected",
    }),
    resourceBudget: STUDIO_INKML_LIMITS,
    providerBoundary: Object.freeze({
      publicInterchange: "W3C-InkML-safe-subset",
      proprietaryWireFormats: "outside-this-module",
      commercialSdk: "external-provider-adapter-only",
      officialVendorCompatibility: "not-claimed",
    }),
  });

export interface StudioInkMlRoundTripTolerance {
  readonly position: number;
  readonly pressure: number;
  readonly tiltDegrees: number;
  readonly twistDegrees: number;
  readonly speed: number;
  readonly tangentialPressure: number;
}

/**
 * The deterministic v1 writer emits at most six decimal places. These tolerances cover its
 * half-unit rounding error while remaining strict enough to catch a changed channel transform.
 */
export const STUDIO_INKML_ROUND_TRIP_TOLERANCE: StudioInkMlRoundTripTolerance =
  Object.freeze({
    position: 0.000001,
    pressure: 0.000001,
    tiltDegrees: 0.000001,
    twistDegrees: 0.000001,
    speed: 0.000001,
    tangentialPressure: 0.000001,
  });

export interface StudioInkMlConformanceRequest {
  readonly id: typeof STUDIO_INKML_CONFORMANCE_PROFILE_ID;
  readonly version: typeof STUDIO_INKML_CONFORMANCE_PROFILE_VERSION;
  readonly acceptedDocumentProfiles: readonly StudioInkMlDocumentProfile[];
  readonly requiredCapabilities: readonly StudioInkMlConformanceCapability[];
}

export type StudioInkMlConformanceErrorCode =
  | StudioInkMlCodecError["code"]
  | "DIGEST_RUNTIME_UNAVAILABLE"
  | "INVALID_CONFORMANCE_REQUEST"
  | "ROUND_TRIP_TOLERANCE_EXCEEDED"
  | "UNKNOWN_FUTURE_PROFILE_VERSION"
  | "UNEXPECTED_FAILURE"
  | "UNSUPPORTED_CAPABILITY"
  | "UNSUPPORTED_DOCUMENT_PROFILE"
  | "UNSUPPORTED_PROFILE";

export type StudioInkMlConformanceNegotiation =
  | Readonly<{
      status: "accepted";
      request: StudioInkMlConformanceRequest;
      error: null;
    }>
  | Readonly<{
      status: "rejected";
      request: null;
      error: Readonly<{
        code: Extract<
          StudioInkMlConformanceErrorCode,
          | "INVALID_CONFORMANCE_REQUEST"
          | "UNKNOWN_FUTURE_PROFILE_VERSION"
          | "UNSUPPORTED_CAPABILITY"
          | "UNSUPPORTED_PROFILE"
        >;
      }>;
    }>;

export interface StudioInkMlConformanceOptions extends StudioInkMlCodecOptions {
  /**
   * Runtime negotiation input. Unknown fields, future versions, profiles, and capabilities fail
   * closed before XML decoding.
   */
  readonly request?: unknown;
}

export interface StudioInkMlRoundTripErrorSummary {
  readonly position: number;
  readonly pressure: number;
  readonly tiltDegrees: number;
  readonly twistDegrees: number;
  readonly speed: number;
  readonly tangentialPressure: number;
}

export interface StudioInkMlConformanceReceipt {
  readonly receipt: Readonly<{
    id: typeof STUDIO_INKML_CONFORMANCE_RECEIPT_ID;
    version: typeof STUDIO_INKML_CONFORMANCE_RECEIPT_VERSION;
    digest: StudioInkMlSha256 | null;
  }>;
  readonly negotiation: StudioInkMlConformanceNegotiation;
  readonly source: Readonly<{
    mediaType: typeof STUDIO_INKML_MEDIA_TYPE;
    utf8Bytes: number | null;
    digest: StudioInkMlSha256 | null;
  }>;
  readonly profile: Readonly<{
    input: StudioInkMlDocumentProfile | null;
    normalized: typeof STUDIO_INKML_PROFILE | null;
    capabilities: readonly StudioInkMlConformanceCapability[];
  }>;
  readonly result: Readonly<{
    conformance: "passed" | "rejected";
    normalization: "stable" | "failed" | "not-run";
    traceCount: number | null;
    sampleCount: number | null;
    ignoredChannels: readonly string[];
    normalizedUtf8Bytes: number | null;
    normalizedDigest: StudioInkMlSha256 | null;
    maximumAbsoluteError: StudioInkMlRoundTripErrorSummary | null;
  }>;
  readonly security: Readonly<{
    xml: Readonly<{
      boundary: "bounded-lexical-preflight-before-domparser-v1";
      outcome: "passed" | "rejected" | "not-evaluated";
      blockedConstructs: readonly [
        "DTD",
        "entity",
        "CDATA",
        "comment",
        "processing-instruction",
      ];
    }>;
    budget: Readonly<{
      outcome:
        | "within-budget"
        | "budget-exceeded"
        | "enforced"
        | "not-evaluated";
      limits: Readonly<{
        maxBytes: number | null;
        maxStrokes: number | null;
        maxSamples: number | null;
        maxSamplesPerStroke: number | null;
        maxXmlDepth: number;
        maxElements: number;
        maxTraceFormats: number;
        maxContexts: number;
        maxChannelsPerFormat: number;
        maxNumericTokenCharacters: number;
      }>;
    }>;
  }>;
  readonly error: Readonly<{
    code: StudioInkMlConformanceErrorCode;
    phase: "negotiation" | "decode" | "round-trip" | "receipt";
  }> | null;
  readonly limitations: readonly string[];
}

const SUPPORTED_PROFILE_SET = new Set<string>([
  STUDIO_INKML_PROFILE,
  "inkml-basic",
]);
const CAPABILITY_SET = new Set<string>(
  STUDIO_INKML_CONFORMANCE_CAPABILITIES,
);
const REQUEST_KEYS = new Set([
  "acceptedDocumentProfiles",
  "id",
  "requiredCapabilities",
  "version",
]);
const BLOCKED_XML_CONSTRUCTS = Object.freeze([
  "DTD",
  "entity",
  "CDATA",
  "comment",
  "processing-instruction",
] as const);
const LIMITATIONS = Object.freeze([
  "This receipt validates ToonSpectrum's bounded public W3C InkML subset, not every W3C InkML processor feature.",
  "This receipt is not Wacom WILL/UIM compatibility, licensing, trademark approval, or third-party certification.",
  "A separately licensed provider adapter must make and verify any proprietary SDK compatibility claim.",
] as const);

const DEFAULT_REQUEST: StudioInkMlConformanceRequest = Object.freeze({
  id: STUDIO_INKML_CONFORMANCE_PROFILE_ID,
  version: STUDIO_INKML_CONFORMANCE_PROFILE_VERSION,
  acceptedDocumentProfiles: Object.freeze([
    STUDIO_INKML_PROFILE,
    "inkml-basic",
  ] as const),
  requiredCapabilities: Object.freeze([]),
});

function plainRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor?.enumerable !== true
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

function rejectedNegotiation(
  code: StudioInkMlConformanceNegotiation["error"] extends infer Error
    ? Error extends { readonly code: infer Code }
      ? Code
      : never
    : never,
): StudioInkMlConformanceNegotiation {
  return Object.freeze({
    status: "rejected",
    request: null,
    error: Object.freeze({ code }),
  });
}

function orderedCapabilities(
  values: readonly string[],
): readonly StudioInkMlConformanceCapability[] {
  const requested = new Set(values);
  return Object.freeze(
    STUDIO_INKML_CONFORMANCE_CAPABILITIES.filter((capability) =>
      requested.has(capability)
    ),
  );
}

function orderedProfiles(
  values: readonly string[],
): readonly StudioInkMlDocumentProfile[] {
  const requested = new Set(values);
  return Object.freeze(
    [STUDIO_INKML_PROFILE, "inkml-basic"].filter((profile) =>
      requested.has(profile)
    ) as StudioInkMlDocumentProfile[],
  );
}

/**
 * Negotiates the single published conformance profile without interpreting future fields.
 * Rejections are data rather than exceptions so UI, CLI, and CI use the same fail-closed result.
 */
export function negotiateStudioInkMlConformance(
  value: unknown = undefined,
): StudioInkMlConformanceNegotiation {
  if (value === undefined) {
    return Object.freeze({
      status: "accepted",
      request: DEFAULT_REQUEST,
      error: null,
    });
  }
  const request = plainRecord(value);
  if (
    !request
    || Object.keys(request).length !== REQUEST_KEYS.size
    || Object.keys(request).some((key) => !REQUEST_KEYS.has(key))
  ) {
    return rejectedNegotiation("INVALID_CONFORMANCE_REQUEST");
  }
  if (request.id !== STUDIO_INKML_CONFORMANCE_PROFILE_ID) {
    return rejectedNegotiation("UNSUPPORTED_PROFILE");
  }
  if (
    typeof request.version !== "number"
    || !Number.isSafeInteger(request.version)
    || request.version < 1
  ) {
    return rejectedNegotiation("INVALID_CONFORMANCE_REQUEST");
  }
  if (request.version > STUDIO_INKML_CONFORMANCE_PROFILE_VERSION) {
    return rejectedNegotiation("UNKNOWN_FUTURE_PROFILE_VERSION");
  }
  if (request.version !== STUDIO_INKML_CONFORMANCE_PROFILE_VERSION) {
    return rejectedNegotiation("UNSUPPORTED_PROFILE");
  }
  if (
    !Array.isArray(request.acceptedDocumentProfiles)
    || request.acceptedDocumentProfiles.length < 1
    || request.acceptedDocumentProfiles.length > SUPPORTED_PROFILE_SET.size
    || request.acceptedDocumentProfiles.some(
      (profile) =>
        typeof profile !== "string" || !SUPPORTED_PROFILE_SET.has(profile),
    )
  ) {
    return rejectedNegotiation("UNSUPPORTED_PROFILE");
  }
  if (
    new Set(request.acceptedDocumentProfiles).size
      !== request.acceptedDocumentProfiles.length
  ) {
    return rejectedNegotiation("INVALID_CONFORMANCE_REQUEST");
  }
  if (
    !Array.isArray(request.requiredCapabilities)
    || request.requiredCapabilities.length
      > STUDIO_INKML_CONFORMANCE_CAPABILITIES.length
    || request.requiredCapabilities.some(
      (capability) =>
        typeof capability !== "string" || !CAPABILITY_SET.has(capability),
    )
  ) {
    return rejectedNegotiation("UNSUPPORTED_CAPABILITY");
  }
  if (
    new Set(request.requiredCapabilities).size
      !== request.requiredCapabilities.length
  ) {
    return rejectedNegotiation("INVALID_CONFORMANCE_REQUEST");
  }
  return Object.freeze({
    status: "accepted",
    request: Object.freeze({
      id: STUDIO_INKML_CONFORMANCE_PROFILE_ID,
      version: STUDIO_INKML_CONFORMANCE_PROFILE_VERSION,
      acceptedDocumentProfiles: orderedProfiles(
        request.acceptedDocumentProfiles as readonly string[],
      ),
      requiredCapabilities: orderedCapabilities(
        request.requiredCapabilities as readonly string[],
      ),
    }),
    error: null,
  });
}

function reportedLimit(
  value: unknown,
  fallback: number,
): number | null {
  if (value === undefined) return fallback;
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    ? value
    : null;
}

function reportedLimits(
  options: StudioInkMlConformanceOptions,
): StudioInkMlConformanceReceipt["security"]["budget"]["limits"] {
  return Object.freeze({
    maxBytes: reportedLimit(options.maxBytes, STUDIO_INKML_LIMITS.maxBytes),
    maxStrokes: reportedLimit(
      options.maxStrokes,
      STUDIO_INKML_LIMITS.maxStrokes,
    ),
    maxSamples: reportedLimit(
      options.maxSamples,
      STUDIO_INKML_LIMITS.maxSamples,
    ),
    maxSamplesPerStroke: reportedLimit(
      options.maxSamplesPerStroke,
      STUDIO_INKML_LIMITS.maxSamplesPerStroke,
    ),
    maxXmlDepth: STUDIO_INKML_LIMITS.maxXmlDepth,
    maxElements: STUDIO_INKML_LIMITS.maxElements,
    maxTraceFormats: STUDIO_INKML_LIMITS.maxTraceFormats,
    maxContexts: STUDIO_INKML_LIMITS.maxContexts,
    maxChannelsPerFormat: STUDIO_INKML_LIMITS.maxChannelsPerFormat,
    maxNumericTokenCharacters: STUDIO_INKML_LIMITS.maxNumericTokenCharacters,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = plainRecord(value);
  if (!record) {
    throw new TypeError("InkML conformance receipt contains a non-canonical value.");
  }
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

async function sha256(value: string): Promise<StudioInkMlSha256 | null> {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(value);
  const copy = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `sha256:${hex}`;
}

function sourceBytes(value: unknown): number | null {
  return typeof value === "string"
    ? new TextEncoder().encode(value).byteLength
    : null;
}

function sampleCount(document: StudioInkMlDocument): number {
  return document.traces.reduce(
    (total, trace) => total + trace.points.length / 2,
    0,
  );
}

/**
 * The base codec accepts inert standard metadata in the bounded basic-import mode. Conformance is
 * stricter for semantic features that the manifest explicitly marks unsupported: merely declaring
 * a brush or trace group must not be mistaken for support when no trace references it.
 *
 * This DOM inspection runs only after the codec's lexical XML security preflight and successful
 * bounded decode, so DOMParser is not the resource or entity-expansion security boundary.
 */
function hasUnsupportedSemanticCapability(source: string): boolean {
  if (typeof DOMParser === "undefined") return true;
  const document = new DOMParser().parseFromString(source, "application/xml");
  for (const localName of ["brush", "brushProperty", "traceGroup"]) {
    if (
      document.getElementsByTagNameNS(STUDIO_INKML_NAMESPACE, localName).length
        > 0
    ) {
      return true;
    }
  }
  const elements = document.getElementsByTagName("*");
  for (let index = 0; index < elements.length; index += 1) {
    if (elements.item(index)?.hasAttribute("brushRef")) return true;
  }
  return false;
}

function maximumArrayError(
  left: readonly number[],
  right: readonly number[],
  circularFullTurn = false,
): number | null {
  if (left.length !== right.length) return null;
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const absolute = Math.abs(left[index]! - right[index]!);
    const difference = circularFullTurn
      ? Math.min(absolute, Math.abs(360 - absolute))
      : absolute;
    maximum = Math.max(maximum, difference);
  }
  return maximum;
}

function maximumTraceError(
  left: StudioInkMlTrace,
  right: StudioInkMlTrace,
): StudioInkMlRoundTripErrorSummary | null {
  if (left.id !== right.id) return null;
  const position = maximumArrayError(left.points, right.points);
  const pressure = maximumArrayError(left.pressures, right.pressures);
  const tiltX = maximumArrayError(left.tiltXs, right.tiltXs);
  const tiltY = maximumArrayError(left.tiltYs, right.tiltYs);
  const twistDegrees = maximumArrayError(left.twists, right.twists, true);
  const speed = maximumArrayError(left.speeds, right.speeds);
  const tangentialPressure = maximumArrayError(
    left.tangentialPressures,
    right.tangentialPressures,
  );
  if (
    position === null
    || pressure === null
    || tiltX === null
    || tiltY === null
    || twistDegrees === null
    || speed === null
    || tangentialPressure === null
  ) {
    return null;
  }
  return Object.freeze({
    position,
    pressure,
    tiltDegrees: Math.max(tiltX, tiltY),
    twistDegrees,
    speed,
    tangentialPressure,
  });
}

function maximumDocumentError(
  left: StudioInkMlDocument,
  right: StudioInkMlDocument,
): StudioInkMlRoundTripErrorSummary | null {
  if (left.traces.length !== right.traces.length) return null;
  let position = 0;
  let pressure = 0;
  let tiltDegrees = 0;
  let twistDegrees = 0;
  let speed = 0;
  let tangentialPressure = 0;
  for (let index = 0; index < left.traces.length; index += 1) {
    const traceError = maximumTraceError(
      left.traces[index]!,
      right.traces[index]!,
    );
    if (!traceError) return null;
    position = Math.max(position, traceError.position);
    pressure = Math.max(pressure, traceError.pressure);
    tiltDegrees = Math.max(
      tiltDegrees,
      traceError.tiltDegrees,
    );
    twistDegrees = Math.max(
      twistDegrees,
      traceError.twistDegrees,
    );
    speed = Math.max(speed, traceError.speed);
    tangentialPressure = Math.max(
      tangentialPressure,
      traceError.tangentialPressure,
    );
  }
  return Object.freeze({
    position,
    pressure,
    tiltDegrees,
    twistDegrees,
    speed,
    tangentialPressure,
  });
}

function errorsWithinTolerance(
  error: StudioInkMlRoundTripErrorSummary | null,
): boolean {
  return error !== null
    && error.position <= STUDIO_INKML_ROUND_TRIP_TOLERANCE.position
    && error.pressure <= STUDIO_INKML_ROUND_TRIP_TOLERANCE.pressure
    && error.tiltDegrees <= STUDIO_INKML_ROUND_TRIP_TOLERANCE.tiltDegrees
    && error.twistDegrees <= STUDIO_INKML_ROUND_TRIP_TOLERANCE.twistDegrees
    && error.speed <= STUDIO_INKML_ROUND_TRIP_TOLERANCE.speed
    && error.tangentialPressure
      <= STUDIO_INKML_ROUND_TRIP_TOLERANCE.tangentialPressure;
}

interface UnsealedReceipt
  extends Omit<StudioInkMlConformanceReceipt, "receipt"> {
  readonly receipt: Readonly<{
    id: typeof STUDIO_INKML_CONFORMANCE_RECEIPT_ID;
    version: typeof STUDIO_INKML_CONFORMANCE_RECEIPT_VERSION;
  }>;
}

async function sealReceipt(
  value: UnsealedReceipt,
): Promise<StudioInkMlConformanceReceipt> {
  const digest = await sha256(canonicalJson(value));
  return Object.freeze({
    ...value,
    receipt: Object.freeze({
      ...value.receipt,
      digest,
    }),
  });
}

function unsealedReceipt(
  negotiation: StudioInkMlConformanceNegotiation,
  source: StudioInkMlConformanceReceipt["source"],
  options: StudioInkMlConformanceOptions,
  input: StudioInkMlDocumentProfile | null,
  result: StudioInkMlConformanceReceipt["result"],
  error: StudioInkMlConformanceReceipt["error"],
  xmlOutcome: StudioInkMlConformanceReceipt["security"]["xml"]["outcome"],
  budgetOutcome: StudioInkMlConformanceReceipt["security"]["budget"]["outcome"],
): UnsealedReceipt {
  return Object.freeze({
    receipt: Object.freeze({
      id: STUDIO_INKML_CONFORMANCE_RECEIPT_ID,
      version: STUDIO_INKML_CONFORMANCE_RECEIPT_VERSION,
    }),
    negotiation,
    source,
    profile: Object.freeze({
      input,
      normalized:
        result.normalization === "stable" ? STUDIO_INKML_PROFILE : null,
      capabilities: STUDIO_INKML_CONFORMANCE_CAPABILITIES,
    }),
    result,
    security: Object.freeze({
      xml: Object.freeze({
        boundary: "bounded-lexical-preflight-before-domparser-v1",
        outcome: xmlOutcome,
        blockedConstructs: BLOCKED_XML_CONSTRUCTS,
      }),
      budget: Object.freeze({
        outcome: budgetOutcome,
        limits: reportedLimits(options),
      }),
    }),
    error,
    limitations: LIMITATIONS,
  });
}

function emptyResult(): StudioInkMlConformanceReceipt["result"] {
  return Object.freeze({
    conformance: "rejected",
    normalization: "not-run",
    traceCount: null,
    sampleCount: null,
    ignoredChannels: Object.freeze([]),
    normalizedUtf8Bytes: null,
    normalizedDigest: null,
    maximumAbsoluteError: null,
  });
}

async function sourceDescriptor(
  source: unknown,
): Promise<StudioInkMlConformanceReceipt["source"]> {
  return Object.freeze({
    mediaType: STUDIO_INKML_MEDIA_TYPE,
    utf8Bytes: sourceBytes(source),
    digest: typeof source === "string" ? await sha256(source) : null,
  });
}

/**
 * Validates, normalizes, re-encodes, and re-decodes a bounded InkML document.
 *
 * The returned receipt contains no clock, randomness, hardware identifier, or vendor token. Its
 * SHA-256 covers the canonical receipt payload with the digest field omitted, so identical input,
 * request, codec limits, and validator version produce an identical receipt.
 */
export async function validateStudioInkMlConformance(
  source: unknown,
  options: StudioInkMlConformanceOptions = {},
): Promise<StudioInkMlConformanceReceipt> {
  const negotiation = negotiateStudioInkMlConformance(options.request);
  const describedSource = await sourceDescriptor(source);
  if (negotiation.status === "rejected") {
    return sealReceipt(unsealedReceipt(
      negotiation,
      describedSource,
      options,
      null,
      emptyResult(),
      Object.freeze({
        code: negotiation.error.code,
        phase: "negotiation",
      }),
      "not-evaluated",
      "not-evaluated",
    ));
  }

  try {
    const decoded = decodeStudioInkMl(source as string, options);
    if (hasUnsupportedSemanticCapability(source as string)) {
      return sealReceipt(unsealedReceipt(
        negotiation,
        describedSource,
        options,
        decoded.profile,
        emptyResult(),
        Object.freeze({
          code: "UNSUPPORTED_CAPABILITY",
          phase: "decode",
        }),
        "passed",
        "within-budget",
      ));
    }
    if (
      !negotiation.request.acceptedDocumentProfiles.includes(decoded.profile)
    ) {
      return sealReceipt(unsealedReceipt(
        negotiation,
        describedSource,
        options,
        decoded.profile,
        emptyResult(),
        Object.freeze({
          code: "UNSUPPORTED_DOCUMENT_PROFILE",
          phase: "negotiation",
        }),
        "passed",
        "within-budget",
      ));
    }

    const normalizedSource = encodeStudioInkMl(decoded.traces, options);
    const normalized = decodeStudioInkMl(normalizedSource, options);
    const maximumAbsoluteError = maximumDocumentError(decoded, normalized);
    const normalizationStable = errorsWithinTolerance(maximumAbsoluteError);
    const normalizedDigest = await sha256(normalizedSource);
    if (!describedSource.digest || !normalizedDigest) {
      return sealReceipt(unsealedReceipt(
        negotiation,
        describedSource,
        options,
        decoded.profile,
        Object.freeze({
          conformance: "rejected",
          normalization: "failed",
          traceCount: decoded.traces.length,
          sampleCount: sampleCount(decoded),
          ignoredChannels: Object.freeze([...decoded.ignoredChannels]),
          normalizedUtf8Bytes: sourceBytes(normalizedSource),
          normalizedDigest,
          maximumAbsoluteError,
        }),
        Object.freeze({
          code: "DIGEST_RUNTIME_UNAVAILABLE",
          phase: "receipt",
        }),
        "passed",
        "within-budget",
      ));
    }
    if (!normalizationStable) {
      return sealReceipt(unsealedReceipt(
        negotiation,
        describedSource,
        options,
        decoded.profile,
        Object.freeze({
          conformance: "rejected",
          normalization: "failed",
          traceCount: decoded.traces.length,
          sampleCount: sampleCount(decoded),
          ignoredChannels: Object.freeze([...decoded.ignoredChannels]),
          normalizedUtf8Bytes: sourceBytes(normalizedSource),
          normalizedDigest,
          maximumAbsoluteError,
        }),
        Object.freeze({
          code: "ROUND_TRIP_TOLERANCE_EXCEEDED",
          phase: "round-trip",
        }),
        "passed",
        "within-budget",
      ));
    }
    return sealReceipt(unsealedReceipt(
      negotiation,
      describedSource,
      options,
      decoded.profile,
      Object.freeze({
        conformance: "passed",
        normalization: "stable",
        traceCount: decoded.traces.length,
        sampleCount: sampleCount(decoded),
        ignoredChannels: Object.freeze([...decoded.ignoredChannels]),
        normalizedUtf8Bytes: sourceBytes(normalizedSource),
        normalizedDigest,
        maximumAbsoluteError,
      }),
      null,
      "passed",
      "within-budget",
    ));
  } catch (error) {
    const code: StudioInkMlConformanceErrorCode =
      error instanceof StudioInkMlCodecError
        ? error.code
        : "UNEXPECTED_FAILURE";
    return sealReceipt(unsealedReceipt(
      negotiation,
      describedSource,
      options,
      null,
      emptyResult(),
      Object.freeze({
        code,
        phase: "decode",
      }),
      "rejected",
      code === "limit-exceeded" ? "budget-exceeded" : "enforced",
    ));
  }
}
