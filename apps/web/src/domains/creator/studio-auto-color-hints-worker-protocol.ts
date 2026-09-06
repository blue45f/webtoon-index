import {
  STUDIO_AUTO_COLOR_HINT_MAX_COMPONENTS,
  STUDIO_AUTO_COLOR_HINT_MAX_HINTS,
  STUDIO_AUTO_COLOR_HINT_MAX_ID_LENGTH,
  STUDIO_AUTO_COLOR_HINT_MAX_PALETTE_COLORS,
  STUDIO_AUTO_COLOR_HINT_MAX_PIXELS,
  STUDIO_AUTO_COLOR_HINT_MAX_RECOMMENDATIONS,
  type StudioAutoColorHintBudgets,
  type StudioAutoColorHintOptions,
  type StudioAutoColorHintPaletteLock,
  type StudioAutoColorHintPlan,
  type StudioAutoColorHintRecommendationPolicy,
  type StudioAutoColorHintRequest,
  type StudioAutoColorHintRgba,
  type StudioAutoColorHintSeed,
} from "./studio-auto-color-hints";

export const STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION = 1 as const;

export type StudioAutoColorHintsWorkerFailureCode =
  | "invalid-request"
  | "budget-exceeded"
  | "execution-failed"
  | "protocol-error";

export interface StudioAutoColorHintsWorkerRunMessage {
  readonly type: "studio-auto-color-hints/run";
  readonly version: typeof STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly generation: number;
  readonly request: StudioAutoColorHintRequest;
}

export interface StudioAutoColorHintsWorkerReadyMessage {
  readonly type: "studio-auto-color-hints/ready";
  readonly version: typeof STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION;
}

export interface StudioAutoColorHintsWorkerSuccessMessage {
  readonly type: "studio-auto-color-hints/success";
  readonly version: typeof STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly generation: number;
  readonly plan: StudioAutoColorHintPlan;
}

export interface StudioAutoColorHintsWorkerFailureMessage {
  readonly type: "studio-auto-color-hints/failure";
  readonly version: typeof STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly generation: number;
  readonly error: {
    readonly code: StudioAutoColorHintsWorkerFailureCode;
    readonly name: string;
    readonly message: string;
  };
}

export type StudioAutoColorHintsWorkerResponseMessage =
  | StudioAutoColorHintsWorkerReadyMessage
  | StudioAutoColorHintsWorkerSuccessMessage
  | StudioAutoColorHintsWorkerFailureMessage;

export interface StudioAutoColorHintsExpectedPlan {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly requestedHintCount: number;
}

function assertObject<Value>(value: Value, label: string): asserts value is Value & object {
  if (!value || typeof value !== "object") throw new TypeError(`${label} must be an object.`);
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === "object";
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function optionalInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  return value === undefined ? undefined : integer(value, label, minimum, maximum);
}

function cloneColor(value: StudioAutoColorHintRgba, label: string): StudioAutoColorHintRgba {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new TypeError(`${label} must contain exactly four RGBA channels.`);
  }
  return [
    integer(value[0], `${label}[0]`, 0, 255),
    integer(value[1], `${label}[1]`, 0, 255),
    integer(value[2], `${label}[2]`, 0, 255),
    integer(value[3], `${label}[3]`, 0, 255),
  ];
}

function cloneBudgets(value: StudioAutoColorHintBudgets | undefined): StudioAutoColorHintBudgets | undefined {
  if (value === undefined) return undefined;
  assertObject(value, "request.options.budgets");
  return {
    maxPixels: optionalInteger(
      value.maxPixels,
      "request.options.budgets.maxPixels",
      1,
      STUDIO_AUTO_COLOR_HINT_MAX_PIXELS,
    ),
    maxHints: optionalInteger(
      value.maxHints,
      "request.options.budgets.maxHints",
      1,
      STUDIO_AUTO_COLOR_HINT_MAX_HINTS,
    ),
    maxComponents: optionalInteger(
      value.maxComponents,
      "request.options.budgets.maxComponents",
      1,
      STUDIO_AUTO_COLOR_HINT_MAX_COMPONENTS,
    ),
  };
}

function cloneRecommendations(
  value: StudioAutoColorHintRecommendationPolicy | undefined,
): StudioAutoColorHintRecommendationPolicy | undefined {
  if (value === undefined) return undefined;
  assertObject(value, "request.options.recommendations");
  return {
    minimumArea: optionalInteger(
      value.minimumArea,
      "request.options.recommendations.minimumArea",
      1,
      STUDIO_AUTO_COLOR_HINT_MAX_PIXELS,
    ),
    minimumBackgroundArea: optionalInteger(
      value.minimumBackgroundArea,
      "request.options.recommendations.minimumBackgroundArea",
      1,
      STUDIO_AUTO_COLOR_HINT_MAX_PIXELS,
    ),
    minimumTransparentArea: optionalInteger(
      value.minimumTransparentArea,
      "request.options.recommendations.minimumTransparentArea",
      1,
      STUDIO_AUTO_COLOR_HINT_MAX_PIXELS,
    ),
    maximumRecommendations: optionalInteger(
      value.maximumRecommendations,
      "request.options.recommendations.maximumRecommendations",
      0,
      STUDIO_AUTO_COLOR_HINT_MAX_RECOMMENDATIONS,
    ),
  };
}

function cloneOptions(value: StudioAutoColorHintOptions | undefined): StudioAutoColorHintOptions | undefined {
  if (value === undefined) return undefined;
  assertObject(value, "request.options");
  const connectivity = value.connectivity;
  if (connectivity !== undefined && connectivity !== 4 && connectivity !== 8) {
    throw new RangeError("request.options.connectivity must be 4 or 8.");
  }
  return {
    boundaryInkThreshold: optionalInteger(
      value.boundaryInkThreshold,
      "request.options.boundaryInkThreshold",
      1,
      255,
    ),
    transparentAlphaThreshold: optionalInteger(
      value.transparentAlphaThreshold,
      "request.options.transparentAlphaThreshold",
      0,
      255,
    ),
    connectivity,
    budgets: cloneBudgets(value.budgets),
    recommendations: cloneRecommendations(value.recommendations),
  };
}

function cloneSeeds(
  value: readonly StudioAutoColorHintSeed[],
  width: number,
  height: number,
  maxHints: number,
): StudioAutoColorHintSeed[] {
  if (!Array.isArray(value)) throw new TypeError("request.seeds must be an array.");
  if (value.length > maxHints) {
    throw new RangeError(`request.seeds exceeds the ${maxHints} hint request budget.`);
  }
  const ids = new Set<string>();
  return value.map((seed, index) => {
    assertObject(seed, `request.seeds[${index}]`);
    if (typeof seed.id !== "string" || seed.id.trim().length === 0) {
      throw new TypeError(`request.seeds[${index}].id must be a non-empty string.`);
    }
    if (seed.id.length > STUDIO_AUTO_COLOR_HINT_MAX_ID_LENGTH) {
      throw new RangeError(
        `request.seeds[${index}].id exceeds the ${STUDIO_AUTO_COLOR_HINT_MAX_ID_LENGTH} character safety limit.`,
      );
    }
    if (ids.has(seed.id)) throw new RangeError(`request.seeds contains duplicate id ${JSON.stringify(seed.id)}.`);
    ids.add(seed.id);
    return {
      id: seed.id,
      x: integer(seed.x, `request.seeds[${index}].x`, 0, width - 1),
      y: integer(seed.y, `request.seeds[${index}].y`, 0, height - 1),
      color: cloneColor(seed.color, `request.seeds[${index}].color`),
    };
  });
}

function clonePaletteLock(
  value: StudioAutoColorHintPaletteLock | undefined,
): StudioAutoColorHintPaletteLock | undefined {
  if (value === undefined) return undefined;
  assertObject(value, "request.paletteLock");
  if (!Array.isArray(value.colors)) throw new TypeError("request.paletteLock.colors must be an array.");
  if (value.colors.length > STUDIO_AUTO_COLOR_HINT_MAX_PALETTE_COLORS) {
    throw new RangeError(
      `request.paletteLock.colors exceeds the ${STUDIO_AUTO_COLOR_HINT_MAX_PALETTE_COLORS} color safety limit.`,
    );
  }
  return { colors: value.colors.map((color, index) => cloneColor(color, `request.paletteLock.colors[${index}]`)) };
}

/**
 * Validates and narrows a request to the protocol's clone-safe data contract. The RGBA view is
 * always copied so transferring the returned request never detaches caller-owned pixels.
 */
export function cloneStudioAutoColorHintsWorkerRequest(
  request: StudioAutoColorHintRequest,
): StudioAutoColorHintRequest {
  assertObject(request, "request");
  const options = cloneOptions(request.options);
  const maxPixels = options?.budgets?.maxPixels ?? STUDIO_AUTO_COLOR_HINT_MAX_PIXELS;
  const maxHints = options?.budgets?.maxHints ?? STUDIO_AUTO_COLOR_HINT_MAX_HINTS;
  assertObject(request.image, "request.image");
  const width = integer(request.image.width, "request.image.width", 1, maxPixels);
  const height = integer(request.image.height, "request.image.height", 1, maxPixels);
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > maxPixels) {
    throw new RangeError(`request.image exceeds the ${maxPixels} pixel request budget.`);
  }
  if (!(request.image.data instanceof Uint8ClampedArray)) {
    throw new TypeError("request.image.data must be a Uint8ClampedArray.");
  }
  if (request.image.data.length !== pixelCount * 4) {
    throw new RangeError("request.image.data length must equal width * height * 4.");
  }

  const seeds = cloneSeeds(request.seeds, width, height, maxHints);
  const paletteLock = clonePaletteLock(request.paletteLock);
  return {
    image: { data: new Uint8ClampedArray(request.image.data), width, height },
    seeds,
    paletteLock,
    options,
  };
}

function positiveCorrelationInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

export function studioAutoColorHintsResponseCorrelation(
  value: unknown,
): { requestId: number; generation: number } | null {
  if (!isObject(value)) return null;
  if (!positiveCorrelationInteger(value.requestId) || !positiveCorrelationInteger(value.generation)) {
    return null;
  }
  return { requestId: value.requestId, generation: value.generation };
}

export function isStudioAutoColorHintsWorkerRunMessage(
  value: unknown,
): value is StudioAutoColorHintsWorkerRunMessage {
  return (
    isObject(value) &&
    value.type === "studio-auto-color-hints/run" &&
    value.version === STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION &&
    positiveCorrelationInteger(value.requestId) &&
    positiveCorrelationInteger(value.generation) &&
    isObject(value.request)
  );
}

export function isStudioAutoColorHintsWorkerReadyMessage(
  value: unknown,
): value is StudioAutoColorHintsWorkerReadyMessage {
  return (
    isObject(value) &&
    value.type === "studio-auto-color-hints/ready" &&
    value.version === STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION
  );
}

export function isStudioAutoColorHintsWorkerSuccessMessage(
  value: unknown,
): value is StudioAutoColorHintsWorkerSuccessMessage {
  return (
    isObject(value) &&
    value.type === "studio-auto-color-hints/success" &&
    value.version === STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION &&
    positiveCorrelationInteger(value.requestId) &&
    positiveCorrelationInteger(value.generation) &&
    isObject(value.plan)
  );
}

const FAILURE_CODES: ReadonlySet<string> = new Set<StudioAutoColorHintsWorkerFailureCode>([
  "invalid-request",
  "budget-exceeded",
  "execution-failed",
  "protocol-error",
]);

export function isStudioAutoColorHintsWorkerFailureMessage(
  value: unknown,
): value is StudioAutoColorHintsWorkerFailureMessage {
  if (
    !isObject(value) ||
    value.type !== "studio-auto-color-hints/failure" ||
    value.version !== STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION ||
    !positiveCorrelationInteger(value.requestId) ||
    !positiveCorrelationInteger(value.generation) ||
    !isObject(value.error)
  ) {
    return false;
  }
  return (
    typeof value.error.code === "string" &&
    FAILURE_CODES.has(value.error.code) &&
    typeof value.error.name === "string" &&
    value.error.name.length <= 128 &&
    typeof value.error.message === "string" &&
    value.error.message.length <= 2_048
  );
}

/** Lightweight correlated-result check that avoids a second O(pixelCount) scan on the UI thread. */
export function isStudioAutoColorHintsWorkerPlan(
  value: unknown,
  expected: StudioAutoColorHintsExpectedPlan,
): value is StudioAutoColorHintPlan {
  if (!isObject(value) || value.engine !== "connected-region-hints") return false;
  if (value.status !== "ready" && value.status !== "blocked") return false;
  if (!(value.labels instanceof Uint32Array) || value.labels.length !== expected.pixelCount) return false;
  if (
    !Array.isArray(value.components) ||
    !Array.isArray(value.operations) ||
    !Array.isArray(value.conflicts) ||
    !Array.isArray(value.deduplicatedHints) ||
    !Array.isArray(value.rejectedHints) ||
    !Array.isArray(value.recommendations) ||
    !isObject(value.diagnostics)
  ) {
    return false;
  }
  const diagnostics = value.diagnostics;
  if (
    diagnostics.width !== expected.width ||
    diagnostics.height !== expected.height ||
    diagnostics.pixelCount !== expected.pixelCount ||
    diagnostics.requestedHintCount !== expected.requestedHintCount ||
    diagnostics.componentCount !== value.components.length ||
    diagnostics.operationCount !== value.operations.length ||
    diagnostics.conflictCount !== value.conflicts.length ||
    diagnostics.rejectedHintCount !== value.rejectedHints.length ||
    diagnostics.deduplicatedHintCount !== value.deduplicatedHints.length
  ) {
    return false;
  }
  if (
    !integerInRange(diagnostics.boundaryPixelCount, 0, expected.pixelCount) ||
    !integerInRange(diagnostics.acceptedHintCount, 0, expected.requestedHintCount) ||
    !integerInRange(diagnostics.rejectedHintCount, 0, expected.requestedHintCount) ||
    diagnostics.acceptedHintCount + diagnostics.rejectedHintCount !== expected.requestedHintCount ||
    value.components.length > STUDIO_AUTO_COLOR_HINT_MAX_COMPONENTS ||
    value.recommendations.length > STUDIO_AUTO_COLOR_HINT_MAX_RECOMMENDATIONS
  ) {
    return false;
  }
  if (value.status === "blocked" && value.operations.length !== 0) return false;
  if (value.status === "ready" && (value.conflicts.length !== 0 || value.rejectedHints.length !== 0)) {
    return false;
  }
  return true;
}

export function studioAutoColorHintsRequestTransfers(
  message: StudioAutoColorHintsWorkerRunMessage,
): Transferable[] {
  const buffer = message.request.image.data.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}

export function studioAutoColorHintsSuccessTransfers(
  message: StudioAutoColorHintsWorkerSuccessMessage,
): Transferable[] {
  const buffer = message.plan.labels.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}
