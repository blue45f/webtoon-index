import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_SCENE_LAYER_LIFT_BUDGETS,
  STUDIO_SCENE_LAYER_LIFT_SEMANTIC_LAYER_ROLES,
} from "./studio-layer-lift-contract";

import type {
  StudioSceneLayerLiftSemanticLayerRole,
  StudioSceneLayerLiftSha256,
} from "./studio-layer-lift-contract";

export const STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_KIND =
  "toonspectrum.scene-layer-lift/composition-receipt" as const;
export const STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_VERSION = 1 as const;

export const STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_LIMITS = Object.freeze({
  maximumIdentifierCharacters:
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumIdentifierCharacters,
  maximumVersionCharacters:
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumProviderVersionCharacters,
  maximumLayerCount: STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumLayerCount,
} as const);

export interface StudioLayerLiftCompositionPlaneProvenance {
  readonly sha256: StudioSceneLayerLiftSha256;
}

export interface StudioLayerLiftCompositionProviderLayerProvenance {
  readonly layerId: string;
  readonly role: StudioSceneLayerLiftSemanticLayerRole;
  /** Canonical back-to-front provider order. Must be a dense zero-based sequence. */
  readonly order: number;
  readonly rgba: StudioLayerLiftCompositionPlaneProvenance;
  readonly mask: StudioLayerLiftCompositionPlaneProvenance;
}

export interface StudioLayerLiftCompositionCompositorProvenance {
  readonly id: string;
  readonly version: string;
}

export interface StudioLayerLiftCompositionOutputProvenance {
  readonly outputId: string;
  readonly artifactSha256: StudioSceneLayerLiftSha256;
  /**
   * Provider layer IDs contributing to this artifact, in their original provider order.
   * Background and foreground together must be an exact partition of every provider layer.
   */
  readonly contributorLayerIds: readonly string[];
}

export interface StudioLayerLiftCompositionReceiptInput {
  readonly requestId: string;
  readonly sourceSha256: StudioSceneLayerLiftSha256;
  readonly providerReceiptSha256: StudioSceneLayerLiftSha256;
  readonly providerLayers: readonly StudioLayerLiftCompositionProviderLayerProvenance[];
  readonly compositor: StudioLayerLiftCompositionCompositorProvenance;
  readonly background: StudioLayerLiftCompositionOutputProvenance;
  readonly foreground: StudioLayerLiftCompositionOutputProvenance;
}

export interface StudioLayerLiftCompositionReceipt
  extends StudioLayerLiftCompositionReceiptInput {
  readonly kind: typeof STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_KIND;
  readonly version: typeof STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_VERSION;
  readonly receiptSha256: StudioSceneLayerLiftSha256;
}

export type StudioLayerLiftCompositionReceiptErrorCode =
  | "invalid-shape"
  | "invalid-value"
  | "unsupported-kind"
  | "unsupported-version"
  | "inconsistent-data"
  | "receipt-mismatch";

export class StudioLayerLiftCompositionReceiptError extends Error {
  readonly code: StudioLayerLiftCompositionReceiptErrorCode;
  readonly detail: string;

  constructor(
    code: StudioLayerLiftCompositionReceiptErrorCode,
    detail: string,
  ) {
    super("Scene Layer Lift composition provenance receipt is invalid.");
    this.name = "StudioLayerLiftCompositionReceiptError";
    this.code = code;
    this.detail = detail;
  }
}

export type StudioLayerLiftCompositionReceiptParseResult =
  | Readonly<{
      readonly ok: true;
      readonly value: StudioLayerLiftCompositionReceipt;
    }>
  | Readonly<{
      readonly ok: false;
      readonly reason: StudioLayerLiftCompositionReceiptErrorCode;
      readonly detail: string;
    }>;

const INPUT_KEYS = [
  "requestId",
  "sourceSha256",
  "providerReceiptSha256",
  "providerLayers",
  "compositor",
  "background",
  "foreground",
] as const;
const RECEIPT_KEYS = [
  "kind",
  "version",
  ...INPUT_KEYS,
  "receiptSha256",
] as const;
const PROVIDER_LAYER_KEYS = [
  "layerId",
  "role",
  "order",
  "rgba",
  "mask",
] as const;
const PLANE_KEYS = ["sha256"] as const;
const COMPOSITOR_KEYS = ["id", "version"] as const;
const OUTPUT_KEYS = [
  "outputId",
  "artifactSha256",
  "contributorLayerIds",
] as const;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SEMANTIC_ROLES = new Set<string>(
  STUDIO_SCENE_LAYER_LIFT_SEMANTIC_LAYER_ROLES,
);
const TEXT_ENCODER = new TextEncoder();
const TRUSTED_RECEIPTS = new WeakSet<object>();

type ExactRecord = Readonly<Record<string, unknown>>;

function fail(
  code: StudioLayerLiftCompositionReceiptErrorCode,
  detail: string,
): never {
  throw new StudioLayerLiftCompositionReceiptError(code, detail);
}

/**
 * Snapshots only own data properties. Accessors, symbols, custom prototypes,
 * missing fields and unknown fields all fail closed without invoking a getter.
 */
function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  detail: string,
): ExactRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("invalid-shape", detail);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail("invalid-shape", detail);
  }

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length
    || ownKeys.some(
      (key) => typeof key !== "string" || !expectedKeys.includes(key),
    )
  ) {
    return fail("invalid-shape", detail);
  }

  const snapshot: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) {
      return fail("invalid-shape", detail);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function exactArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  detail: string,
): readonly unknown[] {
  if (
    !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || !Number.isSafeInteger(value.length)
    || value.length < minimumLength
    || value.length > maximumLength
  ) {
    return fail("invalid-shape", detail);
  }

  const expectedKeys = Array.from(
    { length: value.length },
    (_, index) => String(index),
  );
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length + 1
    || ownKeys.some(
      (key) =>
        typeof key !== "string"
        || (key !== "length" && !expectedKeys.includes(key)),
    )
  ) {
    return fail("invalid-shape", detail);
  }

  const snapshot: unknown[] = [];
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) {
      return fail("invalid-shape", detail);
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function identifier(
  value: unknown,
  maximumCharacters: number,
  detail: string,
): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximumCharacters
    || value !== value.normalize("NFC")
    || value.trim() !== value
    || value === "."
    || value === ".."
    || value.includes("/")
    || value.includes("\\")
  ) {
    return fail("invalid-value", detail);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return fail("invalid-value", detail);
    }
  }
  return value;
}

function sha256(value: unknown, detail: string): StudioSceneLayerLiftSha256 {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    return fail("invalid-value", detail);
  }
  return value as StudioSceneLayerLiftSha256;
}

function parsePlane(
  value: unknown,
  detail: string,
): StudioLayerLiftCompositionPlaneProvenance {
  const input = exactRecord(value, PLANE_KEYS, detail);
  return Object.freeze({
    sha256: sha256(input.sha256, `${detail}.sha256`),
  });
}

function parseProviderLayer(
  value: unknown,
  expectedOrder: number,
): StudioLayerLiftCompositionProviderLayerProvenance {
  const detail = `providerLayers.${expectedOrder}`;
  const input = exactRecord(value, PROVIDER_LAYER_KEYS, detail);
  if (input.order !== expectedOrder) {
    return fail("inconsistent-data", `${detail}.order`);
  }
  if (typeof input.role !== "string" || !SEMANTIC_ROLES.has(input.role)) {
    return fail("invalid-value", `${detail}.role`);
  }
  return Object.freeze({
    layerId: identifier(
      input.layerId,
      STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_LIMITS.maximumIdentifierCharacters,
      `${detail}.layerId`,
    ),
    role: input.role as StudioSceneLayerLiftSemanticLayerRole,
    order: expectedOrder,
    rgba: parsePlane(input.rgba, `${detail}.rgba`),
    mask: parsePlane(input.mask, `${detail}.mask`),
  });
}

function parseCompositor(
  value: unknown,
): StudioLayerLiftCompositionCompositorProvenance {
  const input = exactRecord(value, COMPOSITOR_KEYS, "compositor");
  return Object.freeze({
    id: identifier(
      input.id,
      STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_LIMITS.maximumIdentifierCharacters,
      "compositor.id",
    ),
    version: identifier(
      input.version,
      STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_LIMITS.maximumVersionCharacters,
      "compositor.version",
    ),
  });
}

function parseOutput(
  value: unknown,
  role: "background" | "foreground",
): StudioLayerLiftCompositionOutputProvenance {
  const input = exactRecord(value, OUTPUT_KEYS, role);
  const rawContributorIds = exactArray(
    input.contributorLayerIds,
    0,
    STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_LIMITS.maximumLayerCount,
    `${role}.contributorLayerIds`,
  );
  const contributorLayerIds = rawContributorIds.map((candidate, index) =>
    identifier(
      candidate,
      STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_LIMITS.maximumIdentifierCharacters,
      `${role}.contributorLayerIds.${index}`,
    ),
  );
  return Object.freeze({
    outputId: identifier(
      input.outputId,
      STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_LIMITS.maximumIdentifierCharacters,
      `${role}.outputId`,
    ),
    artifactSha256: sha256(
      input.artifactSha256,
      `${role}.artifactSha256`,
    ),
    contributorLayerIds: Object.freeze(contributorLayerIds),
  });
}

function validateContributorPartition(
  providerLayers: readonly StudioLayerLiftCompositionProviderLayerProvenance[],
  background: StudioLayerLiftCompositionOutputProvenance,
  foreground: StudioLayerLiftCompositionOutputProvenance,
): void {
  const providerIndex = new Map<string, number>();
  for (const [index, layer] of providerLayers.entries()) {
    if (providerIndex.has(layer.layerId)) {
      return fail("inconsistent-data", "providerLayers.duplicateLayerId");
    }
    providerIndex.set(layer.layerId, index);
  }

  const seen = new Set<string>();
  for (const [role, output] of [
    ["background", background],
    ["foreground", foreground],
  ] as const) {
    let previousProviderIndex = -1;
    for (const layerId of output.contributorLayerIds) {
      const index = providerIndex.get(layerId);
      if (index === undefined) {
        return fail(
          "inconsistent-data",
          `${role}.contributorLayerIds.unknown`,
        );
      }
      if (seen.has(layerId)) {
        return fail(
          "inconsistent-data",
          `${role}.contributorLayerIds.duplicate`,
        );
      }
      if (index <= previousProviderIndex) {
        return fail(
          "inconsistent-data",
          `${role}.contributorLayerIds.order`,
        );
      }
      previousProviderIndex = index;
      seen.add(layerId);
    }
  }

  if (seen.size !== providerLayers.length) {
    return fail("inconsistent-data", "outputs.missingContributorLayer");
  }
}

function parseUnsignedReceipt(
  input: ExactRecord,
): StudioLayerLiftCompositionReceiptInput {
  const rawProviderLayers = exactArray(
    input.providerLayers,
    1,
    STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_LIMITS.maximumLayerCount,
    "providerLayers",
  );
  const providerLayers = rawProviderLayers.map((layer, index) =>
    parseProviderLayer(layer, index),
  );
  const background = parseOutput(input.background, "background");
  const foreground = parseOutput(input.foreground, "foreground");
  if (background.outputId === foreground.outputId) {
    return fail("inconsistent-data", "outputs.duplicateOutputId");
  }
  validateContributorPartition(providerLayers, background, foreground);

  return Object.freeze({
    requestId: identifier(
      input.requestId,
      STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_LIMITS.maximumIdentifierCharacters,
      "requestId",
    ),
    sourceSha256: sha256(input.sourceSha256, "sourceSha256"),
    providerReceiptSha256: sha256(
      input.providerReceiptSha256,
      "providerReceiptSha256",
    ),
    providerLayers: Object.freeze(providerLayers),
    compositor: parseCompositor(input.compositor),
    background,
    foreground,
  });
}

function canonicalBindingText(
  receipt: StudioLayerLiftCompositionReceiptInput,
): string {
  return JSON.stringify([
    STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_KIND,
    STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_VERSION,
    receipt.requestId,
    receipt.sourceSha256,
    receipt.providerReceiptSha256,
    receipt.providerLayers.map((layer) => [
      layer.layerId,
      layer.role,
      layer.order,
      layer.rgba.sha256,
      layer.mask.sha256,
    ]),
    [receipt.compositor.id, receipt.compositor.version],
    [
      receipt.background.outputId,
      receipt.background.artifactSha256,
      receipt.background.contributorLayerIds,
    ],
    [
      receipt.foreground.outputId,
      receipt.foreground.artifactSha256,
      receipt.foreground.contributorLayerIds,
    ],
  ]);
}

function calculateReceiptSha256(
  receipt: StudioLayerLiftCompositionReceiptInput,
): StudioSceneLayerLiftSha256 {
  return `sha256:${sha256HexPortable(
    TEXT_ENCODER.encode(canonicalBindingText(receipt)),
  )}`;
}

function trustedReceipt(
  input: StudioLayerLiftCompositionReceiptInput,
  receiptSha256: StudioSceneLayerLiftSha256,
): StudioLayerLiftCompositionReceipt {
  const receipt: StudioLayerLiftCompositionReceipt = Object.freeze({
    kind: STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_KIND,
    version: STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_VERSION,
    requestId: input.requestId,
    sourceSha256: input.sourceSha256,
    providerReceiptSha256: input.providerReceiptSha256,
    providerLayers: input.providerLayers,
    compositor: input.compositor,
    background: input.background,
    foreground: input.foreground,
    receiptSha256,
  });
  TRUSTED_RECEIPTS.add(receipt);
  return receipt;
}

/**
 * Creates a product-owned immutable provenance receipt. The input is still
 * runtime-validated so an `as` cast cannot bypass the canonical contract.
 */
export function createStudioLayerLiftCompositionReceipt(
  value: StudioLayerLiftCompositionReceiptInput,
): StudioLayerLiftCompositionReceipt {
  const input = parseUnsignedReceipt(exactRecord(value, INPUT_KEYS, "receipt"));
  return trustedReceipt(input, calculateReceiptSha256(input));
}

/**
 * Re-establishes trust after JSON or structured-clone transport. The supplied
 * object itself never becomes trusted; only the validated, deeply frozen
 * product-owned snapshot returned here is admitted to the private WeakSet.
 */
export function parseStudioLayerLiftCompositionReceipt(
  value: unknown,
): StudioLayerLiftCompositionReceiptParseResult {
  try {
    const receipt = exactRecord(value, RECEIPT_KEYS, "receipt");
    if (receipt.kind !== STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_KIND) {
      return fail("unsupported-kind", "receipt.kind");
    }
    if (receipt.version !== STUDIO_LAYER_LIFT_COMPOSITION_RECEIPT_VERSION) {
      return fail("unsupported-version", "receipt.version");
    }
    const input = parseUnsignedReceipt(receipt);
    const candidateSha256 = sha256(
      receipt.receiptSha256,
      "receipt.receiptSha256",
    );
    if (candidateSha256 !== calculateReceiptSha256(input)) {
      return fail("receipt-mismatch", "receipt.receiptSha256");
    }
    return Object.freeze({
      ok: true,
      value: trustedReceipt(input, candidateSha256),
    });
  } catch (error) {
    if (error instanceof StudioLayerLiftCompositionReceiptError) {
      return Object.freeze({
        ok: false,
        reason: error.code,
        detail: error.detail,
      });
    }
    return Object.freeze({
      ok: false,
      reason: "invalid-shape",
      detail: "receipt.unreadable",
    });
  }
}

/**
 * Identity-based runtime trust. A structural clone or hand-built object cannot
 * claim admission merely by copying receipt fields.
 */
export function isTrustedStudioLayerLiftCompositionReceipt(
  value: unknown,
): value is StudioLayerLiftCompositionReceipt {
  return (
    typeof value === "object"
    && value !== null
    && TRUSTED_RECEIPTS.has(value)
  );
}
