/**
 * Exact bridge from the specialist provider router to the existing WebGPU brush receipt.
 *
 * The router owns provider selection, serialization, proof validation, cancellation and device
 * loss. This boundary adds the GPU-specific contract that a provider must satisfy before a
 * specialist stroke may advance to tile authority. It never lowers, approximates or falls back.
 */

import {
  hashStudioCanonicalBrushPlan,
  parseStudioCanonicalBrushPlan,
  STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS,
} from "../studio-canonical-brush-plan";

import {
  STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_VERSION,
  type StudioEngineVNextBrushProviderCapability,
  type StudioEngineVNextBrushProviderDescriptor,
  type StudioEngineVNextBrushProviderExecution,
  type StudioEngineVNextBrushProviderProof,
  type StudioEngineVNextBrushProviderRouterResult,
  StudioEngineVNextBrushProviderRouter,
} from "./studio-engine-vnext-brush-provider-router";
import {
  STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
  STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
  STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
  STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION,
  STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
  STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
} from "./studio-engine-webgpu-brush-runtime";

import type {
  StudioCanonicalBrushPlan,
} from "../studio-canonical-brush-plan";
import type {
  StudioCanonicalBrushSpecialistLoweringRequirement,
} from "../studio-canonical-brush-webgpu-lowering";
import type {
  StudioEngineWebGpuBrushRasterRect,
  StudioEngineWebGpuBrushReceipt,
} from "./studio-engine-webgpu-brush-runtime";

export const STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION = 1 as const;

const MAX_IDENTIFIER_CHARACTERS = 160;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u;
const SPECIALIST_REQUIREMENT_ORDER = [
  "texture-tip",
  "grain",
  "wet-media",
  "retained-dynamics",
  "stroke-local-compositor",
] as const satisfies readonly StudioCanonicalBrushSpecialistLoweringRequirement[];
const PROVIDER_GPU_REQUEST_KEYS = [
  "kind",
  "version",
  "requestSequence",
  "sessionEpoch",
  "strokeEpoch",
  "deviceEpoch",
  "resizeEpoch",
  "mode",
  "rasterRect",
  "strokeId",
  "canonicalPlanHash",
  "requirements",
  "canonicalPlan",
] as const;
const PROVIDER_GPU_EXTENSION_KEYS = [
  "kind",
  "version",
  "gpuRequestSequence",
  "mode",
  "rasterRect",
  "strokeId",
  "canonicalPlanHash",
  "requirements",
] as const;
const PROVIDER_GPU_OUTPUT_KEYS = [
  "kind",
  "version",
  "providerId",
  "providerVersion",
  "providerRequestSequence",
  "gpuRequestSequence",
  "sessionEpoch",
  "strokeEpoch",
  "deviceEpoch",
  "resizeEpoch",
  "canonicalPlanHash",
  "strokeId",
  "receiptKind",
  "receiptRevision",
  "backend",
  "width",
  "height",
  "textureFormat",
  "colorModel",
  "workingColorSpace",
  "inputColorEncoding",
  "presentationColorSpace",
  "mode",
  "loweringVersion",
  "dabCount",
  "batchCount",
  "batchOrder",
  "queueState",
  "complete",
  "executionDigest",
] as const;
const PRESENTED_RESULT_KEYS = ["status", "receipt", "proof"] as const;
const RECEIPT_KEYS = [
  "kind",
  "revision",
  "backend",
  "requestSequence",
  "resizeEpoch",
  "deviceEpoch",
  "width",
  "height",
  "textureFormat",
  "colorModel",
  "workingColorSpace",
  "inputColorEncoding",
  "presentationColorSpace",
  "mode",
  "strokeId",
  "loweringVersion",
  "dabCount",
  "batchCount",
  "batchOrder",
  "planFingerprint",
  "queueState",
  "complete",
] as const;
const PROOF_KEYS = [
  "kind",
  "version",
  "providerId",
  "providerVersion",
  "providerPriority",
  "globalRequestSequence",
  "providerLocalSequence",
  "sessionEpoch",
  "strokeEpoch",
  "deviceEpoch",
  "resizeEpoch",
  "canonicalPlanHash",
  "requiredCapabilities",
  "executionDigest",
] as const;
const CANONICAL_PLAN_KEYS = [
  "kind",
  "version",
  "sessionEpoch",
  "strokeEpoch",
  "commandSequence",
  "strokeId",
  "seed",
  "coordinateSpace",
  "transform",
  "color",
  "composite",
  "recipe",
  "source",
] as const;
const CANONICAL_SOURCE_KEYS = [
  "encoding",
  "firstSequence",
  "lastSequence",
  "samples",
] as const;
const CANONICAL_SOURCE_SAMPLE_KEYS = [
  "sequence",
  "x",
  "y",
  "pressure",
  "tangentialPressure",
  "tiltX",
  "tiltY",
  "twist",
  "timeMilliseconds",
  "pointerId",
  "flags",
] as const;

export interface StudioEngineVNextBrushProviderGpuRequest {
  readonly kind: "studio-engine-vnext-brush-provider-gpu/request";
  readonly version: typeof STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION;
  /** GPU transaction sequence. Provider-router sequences are independent and proof-bound. */
  readonly requestSequence: number;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly mode: "append" | "rebuild";
  readonly rasterRect: StudioEngineWebGpuBrushRasterRect;
  readonly strokeId: string;
  readonly canonicalPlanHash: string;
  readonly requirements:
    readonly StudioCanonicalBrushSpecialistLoweringRequirement[];
  readonly canonicalPlan: StudioCanonicalBrushPlan;
}

export interface StudioEngineVNextBrushProviderGpuPlainOutput {
  readonly kind: "studio-engine-vnext-brush-provider-gpu/output";
  readonly version: typeof STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION;
  readonly providerId: string;
  readonly providerVersion: number;
  readonly providerRequestSequence: number;
  readonly gpuRequestSequence: number;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly canonicalPlanHash: string;
  readonly strokeId: string;
  readonly receiptKind: "studio-engine-webgpu-brush-receipt";
  readonly receiptRevision: typeof STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION;
  readonly backend: "webgpu";
  readonly width: number;
  readonly height: number;
  readonly textureFormat: typeof STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT;
  readonly colorModel: typeof STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL;
  readonly workingColorSpace: typeof STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE;
  readonly inputColorEncoding: typeof STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING;
  readonly presentationColorSpace:
    typeof STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE;
  readonly mode: "append" | "rebuild";
  readonly loweringVersion: number;
  readonly dabCount: number;
  readonly batchCount: number;
  readonly batchOrder: readonly ("source-over" | "destination-out")[];
  readonly queueState: "submitted";
  readonly complete: true;
  readonly executionDigest: string;
}

export interface StudioEngineVNextBrushProviderGpuCompletionInput {
  readonly executionDigest: string;
  readonly width: number;
  readonly height: number;
  readonly loweringVersion: number;
  readonly dabCount: number;
  readonly batchCount: number;
  readonly batchOrder: readonly ("source-over" | "destination-out")[];
}

export type StudioEngineVNextBrushProviderGpuBoundaryRejectionReason =
  | Extract<
      StudioEngineVNextBrushProviderRouterResult,
      { readonly status: "rejected" }
  >["reason"]
  | "invalid-abort-signal"
  | "invalid-boundary-request"
  | "invalid-provider-output";

export type StudioEngineVNextBrushProviderGpuBoundaryResult =
  | Readonly<{
      status: "presented";
      receipt: StudioEngineWebGpuBrushReceipt;
      proof: StudioEngineVNextBrushProviderProof;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioEngineVNextBrushProviderGpuBoundaryRejectionReason;
      consumed: boolean;
    }>;

export interface StudioEngineVNextBrushProviderGpuExecutionBoundary {
  execute(
    request: StudioEngineVNextBrushProviderGpuRequest,
    signal: AbortSignal,
  ):
    | Promise<StudioEngineVNextBrushProviderGpuBoundaryResult>
    | StudioEngineVNextBrushProviderGpuBoundaryResult;
  notifyDeviceLoss?(reason: string): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

interface ParsedGpuRequest {
  readonly requestSequence: number;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly mode: "append" | "rebuild";
  readonly rasterRect: StudioEngineWebGpuBrushRasterRect;
  readonly strokeId: string;
  readonly canonicalPlanHash: string;
  readonly requirements:
    readonly StudioCanonicalBrushSpecialistLoweringRequirement[];
  readonly canonicalPlan: StudioCanonicalBrushPlan;
  /** Exact transport candidate expected by the canonical parser/provider router. */
  readonly routerCanonicalPlan: unknown;
  readonly requiredCapabilities:
    readonly StudioEngineVNextBrushProviderCapability[];
}

interface ParsedGpuExtension {
  readonly gpuRequestSequence: number;
  readonly mode: "append" | "rebuild";
  readonly rasterRect: StudioEngineWebGpuBrushRasterRect;
  readonly strokeId: string;
  readonly canonicalPlanHash: string;
  readonly requirements:
    readonly StudioCanonicalBrushSpecialistLoweringRequirement[];
}

interface ParsedGpuOutput {
  readonly providerId: string;
  readonly providerVersion: number;
  readonly providerRequestSequence: number;
  readonly gpuRequestSequence: number;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly canonicalPlanHash: string;
  readonly strokeId: string;
  readonly width: number;
  readonly height: number;
  readonly mode: "append" | "rebuild";
  readonly loweringVersion: number;
  readonly dabCount: number;
  readonly batchCount: number;
  readonly batchOrder: readonly ("source-over" | "destination-out")[];
  readonly executionDigest: string;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_CHARACTERS
    && SAFE_IDENTIFIER.test(value);
}

function exactRecord(
  input: unknown,
  fields: readonly string[],
): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length
    || keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) return null;
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) return null;
    values[field] = descriptor.value;
  }
  return values;
}

function denseArray(input: unknown, maximumLength: number): readonly unknown[] | null {
  if (
    !Array.isArray(input)
    || input.length > maximumLength
    || Object.getOwnPropertySymbols(input).length > 0
  ) return null;
  const values: unknown[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) return null;
    values.push(descriptor.value);
  }
  return values;
}

function finiteRect(input: unknown): StudioEngineWebGpuBrushRasterRect | null {
  const record = exactRecord(input, ["x", "y", "width", "height"]);
  if (!record) return null;
  const { x, y, width, height } = record;
  if (
    typeof x !== "number"
    || typeof y !== "number"
    || typeof width !== "number"
    || typeof height !== "number"
    || !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) return null;
  return Object.freeze({ x, y, width, height });
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function requirementsForPlan(
  plan: StudioCanonicalBrushPlan,
): readonly StudioCanonicalBrushSpecialistLoweringRequirement[] {
  const requirements: StudioCanonicalBrushSpecialistLoweringRequirement[] = [];
  if (plan.recipe.tip.kind === "texture") requirements.push("texture-tip");
  if (plan.recipe.grain !== null) requirements.push("grain");
  if (plan.recipe.engine === "wet-media-v1" || plan.recipe.wetMedia !== null) {
    requirements.push("wet-media");
  }
  if (plan.recipe.version === 2) {
    if (plan.recipe.retainedDynamics !== null) requirements.push("retained-dynamics");
    requirements.push("stroke-local-compositor");
  }
  return Object.freeze(requirements);
}

function parseRequirements(
  input: unknown,
): readonly StudioCanonicalBrushSpecialistLoweringRequirement[] | null {
  const values = denseArray(input, SPECIALIST_REQUIREMENT_ORDER.length);
  if (!values || values.length === 0) return null;
  const requirements: StudioCanonicalBrushSpecialistLoweringRequirement[] = [];
  for (const value of values) {
    if (
      typeof value !== "string"
      || !SPECIALIST_REQUIREMENT_ORDER.includes(
        value as StudioCanonicalBrushSpecialistLoweringRequirement,
      )
      || requirements.includes(
        value as StudioCanonicalBrushSpecialistLoweringRequirement,
      )
    ) return null;
    requirements.push(value as StudioCanonicalBrushSpecialistLoweringRequirement);
  }
  requirements.sort(
    (left, right) => (
      SPECIALIST_REQUIREMENT_ORDER.indexOf(left)
      - SPECIALIST_REQUIREMENT_ORDER.indexOf(right)
    ),
  );
  return Object.freeze(requirements);
}

function requiredCapabilities(
  plan: StudioCanonicalBrushPlan,
): readonly StudioEngineVNextBrushProviderCapability[] {
  return Object.freeze([
    plan.recipe.tip.kind === "analytic" ? "tip:analytic" : "tip:texture",
    plan.recipe.grain === null
      ? "grain:none"
      : plan.recipe.grain.kind === "texture"
        ? "grain:texture"
        : "grain:procedural",
    plan.recipe.engine === "wet-media-v1" ? "media:wet" : "media:dry",
    `color:${plan.color.space}`,
    `porter-duff:${plan.composite.porterDuff}`,
    `blend:${plan.composite.blendMode}`,
    ...(plan.recipe.version === 2
      ? [
          "paint:stroke-local" as const,
          ...(plan.recipe.retainedDynamics === null
            ? []
            : ["dynamics:retained" as const]),
        ]
      : []),
    "intent:professional",
  ]);
}

function canonicalParserCandidate(input: unknown): unknown | null {
  const plan = exactRecord(input, CANONICAL_PLAN_KEYS);
  const source = plan ? exactRecord(plan.source, CANONICAL_SOURCE_KEYS) : null;
  const rawSamples = source
    ? denseArray(
      source.samples,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSamples,
    )
    : null;
  if (!plan || !source || !rawSamples || rawSamples.length === 0) return null;
  const samples: Record<string, unknown>[] = [];
  for (const rawSample of rawSamples) {
    const sample = exactRecord(rawSample, CANONICAL_SOURCE_SAMPLE_KEYS);
    if (!sample) return null;
    samples.push({
      role: "authoritative",
      ...sample,
    });
  }
  return {
    kind: plan.kind,
    version: plan.version,
    sessionEpoch: plan.sessionEpoch,
    strokeEpoch: plan.strokeEpoch,
    commandSequence: plan.commandSequence,
    strokeId: plan.strokeId,
    seed: plan.seed,
    coordinateSpace: plan.coordinateSpace,
    transform: plan.transform,
    color: plan.color,
    composite: plan.composite,
    recipe: plan.recipe,
    source: {
      encoding: source.encoding,
      firstSequence: source.firstSequence,
      lastSequence: source.lastSequence,
      samples,
    },
  };
}

function parseGpuRequest(input: unknown): ParsedGpuRequest | null {
  const record = exactRecord(input, PROVIDER_GPU_REQUEST_KEYS);
  if (!record) return null;
  if (
    record.kind !== "studio-engine-vnext-brush-provider-gpu/request"
    || record.version !== STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION
    || !positiveSafeInteger(record.requestSequence)
    || !positiveSafeInteger(record.sessionEpoch)
    || !positiveSafeInteger(record.strokeEpoch)
    || !positiveSafeInteger(record.deviceEpoch)
    || !positiveSafeInteger(record.resizeEpoch)
    || (record.mode !== "append" && record.mode !== "rebuild")
    || !safeIdentifier(record.strokeId)
    || !safeIdentifier(record.canonicalPlanHash)
  ) return null;
  const rasterRect = finiteRect(record.rasterRect);
  const requirements = parseRequirements(record.requirements);
  const routerCanonicalPlan = canonicalParserCandidate(record.canonicalPlan);
  const commandSequence = (
    typeof routerCanonicalPlan === "object"
    && routerCanonicalPlan !== null
  )
    ? Object.getOwnPropertyDescriptor(
      routerCanonicalPlan,
      "commandSequence",
    )?.value
    : null;
  if (
    !rasterRect
    || !requirements
    || !routerCanonicalPlan
    || !positiveSafeInteger(commandSequence)
  ) return null;
  const parsed = parseStudioCanonicalBrushPlan(routerCanonicalPlan, {
    sessionEpoch: record.sessionEpoch,
    strokeEpoch: record.strokeEpoch,
    lastAcceptedCommandSequence: commandSequence - 1,
  });
  if (!parsed.ok) return null;
  if (
    parsed.value.plan.strokeId !== record.strokeId
    || hashStudioCanonicalBrushPlan(parsed.value.plan) !== record.canonicalPlanHash
  ) return null;
  const expectedRequirements = requirementsForPlan(parsed.value.plan);
  if (!sameStringArray(requirements, expectedRequirements)) return null;
  return Object.freeze({
    requestSequence: record.requestSequence,
    sessionEpoch: record.sessionEpoch,
    strokeEpoch: record.strokeEpoch,
    deviceEpoch: record.deviceEpoch,
    resizeEpoch: record.resizeEpoch,
    mode: record.mode,
    rasterRect,
    strokeId: record.strokeId,
    canonicalPlanHash: record.canonicalPlanHash,
    requirements,
    canonicalPlan: parsed.value.plan,
    routerCanonicalPlan,
    requiredCapabilities: requiredCapabilities(parsed.value.plan),
  });
}

function parseGpuExtension(input: unknown): ParsedGpuExtension | null {
  const record = exactRecord(input, PROVIDER_GPU_EXTENSION_KEYS);
  if (
    !record
    || record.kind !== "studio-engine-vnext-brush-provider-gpu/extension"
    || record.version !== STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION
    || !positiveSafeInteger(record.gpuRequestSequence)
    || (record.mode !== "append" && record.mode !== "rebuild")
    || !safeIdentifier(record.strokeId)
    || !safeIdentifier(record.canonicalPlanHash)
  ) return null;
  const rasterRect = finiteRect(record.rasterRect);
  const requirements = parseRequirements(record.requirements);
  if (!rasterRect || !requirements) return null;
  return Object.freeze({
    gpuRequestSequence: record.gpuRequestSequence,
    mode: record.mode,
    rasterRect,
    strokeId: record.strokeId,
    canonicalPlanHash: record.canonicalPlanHash,
    requirements,
  });
}

function parseBatchOrder(
  input: unknown,
  expectedLength: number,
): readonly ("source-over" | "destination-out")[] | null {
  const values = denseArray(input, expectedLength);
  if (!values || values.length !== expectedLength) return null;
  const order: ("source-over" | "destination-out")[] = [];
  for (const value of values) {
    if (value !== "source-over" && value !== "destination-out") return null;
    order.push(value);
  }
  return Object.freeze(order);
}

function parseGpuOutput(
  input: unknown,
  request: ParsedGpuRequest,
  proof: StudioEngineVNextBrushProviderProof,
): ParsedGpuOutput | null {
  const record = exactRecord(input, PROVIDER_GPU_OUTPUT_KEYS);
  if (
    !record
    || record.kind !== "studio-engine-vnext-brush-provider-gpu/output"
    || record.version !== STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION
    || record.providerId !== proof.providerId
    || record.providerVersion !== proof.providerVersion
    || record.providerRequestSequence !== proof.globalRequestSequence
    || record.gpuRequestSequence !== request.requestSequence
    || record.sessionEpoch !== request.sessionEpoch
    || record.strokeEpoch !== request.strokeEpoch
    || record.deviceEpoch !== request.deviceEpoch
    || record.resizeEpoch !== request.resizeEpoch
    || record.canonicalPlanHash !== request.canonicalPlanHash
    || record.strokeId !== request.strokeId
    || record.receiptKind !== "studio-engine-webgpu-brush-receipt"
    || record.receiptRevision !== STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION
    || record.backend !== "webgpu"
    || !positiveSafeInteger(record.width)
    || !positiveSafeInteger(record.height)
    || record.textureFormat !== STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT
    || record.colorModel !== STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL
    || record.workingColorSpace !== STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE
    || record.inputColorEncoding !== STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING
    || record.presentationColorSpace
      !== STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE
    || record.mode !== request.mode
    || !positiveSafeInteger(record.loweringVersion)
    || !nonNegativeSafeInteger(record.dabCount)
    || !positiveSafeInteger(record.batchCount)
    || record.queueState !== "submitted"
    || record.complete !== true
    || record.executionDigest !== proof.executionDigest
    || !safeIdentifier(record.executionDigest)
  ) return null;
  const batchOrder = parseBatchOrder(record.batchOrder, record.batchCount);
  if (
    !batchOrder
    || batchOrder.some(
      (value) => value !== request.canonicalPlan.composite.porterDuff,
    )
  ) return null;
  return Object.freeze({
    providerId: record.providerId,
    providerVersion: record.providerVersion,
    providerRequestSequence: record.providerRequestSequence,
    gpuRequestSequence: record.gpuRequestSequence,
    sessionEpoch: record.sessionEpoch,
    strokeEpoch: record.strokeEpoch,
    deviceEpoch: record.deviceEpoch,
    resizeEpoch: record.resizeEpoch,
    canonicalPlanHash: record.canonicalPlanHash,
    strokeId: record.strokeId,
    width: record.width,
    height: record.height,
    mode: request.mode,
    loweringVersion: record.loweringVersion,
    dabCount: record.dabCount,
    batchCount: record.batchCount,
    batchOrder,
    executionDigest: record.executionDigest,
  });
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hash = Math.imul(hash ^ (code & 0xff), 0x01000193) >>> 0;
    hash = Math.imul(hash ^ (code >>> 8), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function providerFingerprint(
  request: ParsedGpuRequest,
  proof: StudioEngineVNextBrushProviderProof,
  output: Pick<
    ParsedGpuOutput,
    "width" | "height" | "loweringVersion" | "dabCount" | "batchCount" | "batchOrder"
  >,
): string {
  const digest = hashText(JSON.stringify({
    gpuRequestSequence: request.requestSequence,
    providerRequestSequence: proof.globalRequestSequence,
    providerLocalSequence: proof.providerLocalSequence,
    providerPriority: proof.providerPriority,
    canonicalPlanHash: request.canonicalPlanHash,
    executionDigest: proof.executionDigest,
    mode: request.mode,
    width: output.width,
    height: output.height,
    loweringVersion: output.loweringVersion,
    dabCount: output.dabCount,
    batchCount: output.batchCount,
    batchOrder: output.batchOrder,
  }));
  return `vnext-provider:${proof.providerId}@${proof.providerVersion}:${digest}`;
}

function proofMatchesRequest(
  proof: unknown,
  request: ParsedGpuRequest,
): proof is StudioEngineVNextBrushProviderProof {
  const record = exactRecord(proof, PROOF_KEYS);
  const capabilities = record
    ? denseArray(record.requiredCapabilities, request.requiredCapabilities.length)
    : null;
  return Boolean(
    record
    && record.kind === "studio-engine-vnext-brush-provider/proof"
    && record.version === STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_VERSION
    && safeIdentifier(record.providerId)
    && positiveSafeInteger(record.providerVersion)
    && typeof record.providerPriority === "number"
    && Number.isSafeInteger(record.providerPriority)
    && positiveSafeInteger(record.globalRequestSequence)
    && positiveSafeInteger(record.providerLocalSequence)
    && record.sessionEpoch === request.sessionEpoch
    && record.strokeEpoch === request.strokeEpoch
    && record.deviceEpoch === request.deviceEpoch
    && record.resizeEpoch === request.resizeEpoch
    && record.canonicalPlanHash === request.canonicalPlanHash
    && capabilities
    && sameStringArray(
      capabilities as readonly string[],
      request.requiredCapabilities,
    )
    && safeIdentifier(record.executionDigest),
  );
}

function projectReceipt(
  request: ParsedGpuRequest,
  proof: StudioEngineVNextBrushProviderProof,
  output: ParsedGpuOutput,
): StudioEngineWebGpuBrushReceipt {
  return Object.freeze({
    kind: "studio-engine-webgpu-brush-receipt",
    revision: STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION,
    backend: "webgpu",
    requestSequence: request.requestSequence,
    resizeEpoch: request.resizeEpoch,
    deviceEpoch: request.deviceEpoch,
    width: output.width,
    height: output.height,
    textureFormat: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
    colorModel: STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
    workingColorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
    inputColorEncoding: STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
    presentationColorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
    mode: request.mode,
    strokeId: request.strokeId,
    loweringVersion: output.loweringVersion,
    dabCount: output.dabCount,
    batchCount: output.batchCount,
    batchOrder: output.batchOrder,
    planFingerprint: providerFingerprint(request, proof, output),
    queueState: "submitted",
    complete: true,
  });
}

function rejected(
  reason: StudioEngineVNextBrushProviderGpuBoundaryRejectionReason,
  consumed: boolean,
): StudioEngineVNextBrushProviderGpuBoundaryResult {
  return Object.freeze({ status: "rejected", reason, consumed });
}

function nativeAbortSignal(input: unknown): input is AbortSignal {
  if (
    typeof AbortSignal === "undefined"
    || typeof input !== "object"
    || input === null
  ) return false;
  const getter = Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    "aborted",
  )?.get;
  if (!getter) return false;
  try {
    return typeof getter.call(input) === "boolean";
  } catch {
    return false;
  }
}

/**
 * Provider-side helper for producing the exact proof/output envelope accepted by this boundary.
 * The helper does not execute GPU work; callers invoke it only after their ordered GPU queue
 * completion has succeeded.
 */
export function createStudioEngineVNextBrushProviderGpuCompletion(
  descriptor: StudioEngineVNextBrushProviderDescriptor,
  execution: StudioEngineVNextBrushProviderExecution,
  completion: StudioEngineVNextBrushProviderGpuCompletionInput,
): Readonly<{
  status: "completed";
  proof: StudioEngineVNextBrushProviderProof;
  output: StudioEngineVNextBrushProviderGpuPlainOutput;
}> {
  const extension = parseGpuExtension(execution.extension);
  if (
    execution.intent !== "professional"
    || descriptor.id !== execution.providerId
    || descriptor.version !== execution.providerVersion
    || !extension
    || extension.strokeId !== execution.canonicalPlan.strokeId
    || extension.canonicalPlanHash !== execution.canonicalPlanHash
    || !sameStringArray(
      extension.requirements,
      requirementsForPlan(execution.canonicalPlan),
    )
    || !safeIdentifier(completion.executionDigest)
    || !positiveSafeInteger(completion.width)
    || !positiveSafeInteger(completion.height)
    || !positiveSafeInteger(completion.loweringVersion)
    || !nonNegativeSafeInteger(completion.dabCount)
    || !positiveSafeInteger(completion.batchCount)
    || completion.batchOrder.length !== completion.batchCount
    || completion.batchOrder.some(
      (value) => value !== execution.canonicalPlan.composite.porterDuff,
    )
  ) {
    throw new TypeError("Specialist provider GPU completion is invalid.");
  }
  const proof = Object.freeze({
    kind: "studio-engine-vnext-brush-provider/proof" as const,
    version: STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_VERSION,
    providerId: execution.providerId,
    providerVersion: execution.providerVersion,
    providerPriority: descriptor.priority,
    globalRequestSequence: execution.globalRequestSequence,
    providerLocalSequence: execution.providerLocalSequence,
    sessionEpoch: execution.sessionEpoch,
    strokeEpoch: execution.strokeEpoch,
    deviceEpoch: execution.deviceEpoch,
    resizeEpoch: execution.resizeEpoch,
    canonicalPlanHash: execution.canonicalPlanHash,
    requiredCapabilities: execution.requiredCapabilities,
    executionDigest: completion.executionDigest,
  } satisfies StudioEngineVNextBrushProviderProof);
  const output = Object.freeze({
    kind: "studio-engine-vnext-brush-provider-gpu/output" as const,
    version: STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION,
    providerId: execution.providerId,
    providerVersion: execution.providerVersion,
    providerRequestSequence: execution.globalRequestSequence,
    gpuRequestSequence: extension.gpuRequestSequence,
    sessionEpoch: execution.sessionEpoch,
    strokeEpoch: execution.strokeEpoch,
    deviceEpoch: execution.deviceEpoch,
    resizeEpoch: execution.resizeEpoch,
    canonicalPlanHash: execution.canonicalPlanHash,
    strokeId: execution.canonicalPlan.strokeId,
    receiptKind: "studio-engine-webgpu-brush-receipt" as const,
    receiptRevision: STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION,
    backend: "webgpu" as const,
    width: completion.width,
    height: completion.height,
    textureFormat: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
    colorModel: STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
    workingColorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE,
    inputColorEncoding: STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
    presentationColorSpace: STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE,
    mode: extension.mode,
    loweringVersion: completion.loweringVersion,
    dabCount: completion.dabCount,
    batchCount: completion.batchCount,
    batchOrder: Object.freeze([...completion.batchOrder]),
    queueState: "submitted" as const,
    complete: true as const,
    executionDigest: completion.executionDigest,
  } satisfies StudioEngineVNextBrushProviderGpuPlainOutput);
  return Object.freeze({ status: "completed" as const, proof, output });
}

/**
 * Re-validates an arbitrary specialist boundary result at the controller trust boundary.
 */
export function isStudioEngineVNextBrushProviderGpuPresentation(
  input: unknown,
  requestInput: unknown,
): input is Extract<
  StudioEngineVNextBrushProviderGpuBoundaryResult,
  { readonly status: "presented" }
> {
  const request = parseGpuRequest(requestInput);
  const result = exactRecord(input, PRESENTED_RESULT_KEYS);
  if (!request || !result || result.status !== "presented") return false;
  if (!proofMatchesRequest(result.proof, request)) return false;
  const receipt = exactRecord(result.receipt, RECEIPT_KEYS);
  if (
    !receipt
    || receipt.kind !== "studio-engine-webgpu-brush-receipt"
    || receipt.revision !== STUDIO_ENGINE_WEBGPU_BRUSH_RECEIPT_REVISION
    || receipt.backend !== "webgpu"
    || receipt.requestSequence !== request.requestSequence
    || receipt.resizeEpoch !== request.resizeEpoch
    || receipt.deviceEpoch !== request.deviceEpoch
    || !positiveSafeInteger(receipt.width)
    || !positiveSafeInteger(receipt.height)
    || receipt.textureFormat !== STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT
    || receipt.colorModel !== STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL
    || receipt.workingColorSpace !== STUDIO_ENGINE_WEBGPU_BRUSH_WORKING_COLOR_SPACE
    || receipt.inputColorEncoding !== STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING
    || receipt.presentationColorSpace
      !== STUDIO_ENGINE_WEBGPU_BRUSH_PRESENTATION_COLOR_SPACE
    || receipt.mode !== request.mode
    || receipt.strokeId !== request.strokeId
    || !positiveSafeInteger(receipt.loweringVersion)
    || !nonNegativeSafeInteger(receipt.dabCount)
    || !positiveSafeInteger(receipt.batchCount)
    || receipt.queueState !== "submitted"
    || receipt.complete !== true
  ) return false;
  const batchOrder = parseBatchOrder(receipt.batchOrder, receipt.batchCount);
  if (
    !batchOrder
    || batchOrder.some(
      (value) => value !== request.canonicalPlan.composite.porterDuff,
    )
  ) return false;
  return receipt.planFingerprint === providerFingerprint(
    request,
    result.proof,
    {
      width: receipt.width,
      height: receipt.height,
      loweringVersion: receipt.loweringVersion,
      dabCount: receipt.dabCount,
      batchCount: receipt.batchCount,
      batchOrder,
    },
  );
}

export class StudioEngineVNextBrushProviderGpuBoundaryAdapter
implements StudioEngineVNextBrushProviderGpuExecutionBoundary {
  readonly #router: StudioEngineVNextBrushProviderRouter;

  public constructor(router: StudioEngineVNextBrushProviderRouter) {
    if (!(router instanceof StudioEngineVNextBrushProviderRouter)) {
      throw new TypeError("Specialist provider GPU router is invalid.");
    }
    this.#router = router;
  }

  public async execute(
    input: StudioEngineVNextBrushProviderGpuRequest,
    signal: AbortSignal,
  ): Promise<StudioEngineVNextBrushProviderGpuBoundaryResult> {
    const request = parseGpuRequest(input);
    if (!request) {
      return rejected("invalid-boundary-request", false);
    }
    if (!nativeAbortSignal(signal)) return rejected("invalid-abort-signal", false);
    if (signal.aborted) return rejected("cancelled", false);
    const providerRequestSequence = this.#router.snapshot().nextGlobalRequestSequence;
    const extension = Object.freeze({
      kind: "studio-engine-vnext-brush-provider-gpu/extension" as const,
      version: STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_GPU_BOUNDARY_VERSION,
      gpuRequestSequence: request.requestSequence,
      mode: request.mode,
      rasterRect: request.rasterRect,
      strokeId: request.strokeId,
      canonicalPlanHash: request.canonicalPlanHash,
      requirements: request.requirements,
    });
    let routed: StudioEngineVNextBrushProviderRouterResult;
    try {
      routed = await this.#router.submit({
        kind: "studio-engine-vnext-brush-provider/request",
        version: STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_VERSION,
        requestSequence: providerRequestSequence,
        sessionEpoch: request.sessionEpoch,
        strokeEpoch: request.strokeEpoch,
        deviceEpoch: request.deviceEpoch,
        resizeEpoch: request.resizeEpoch,
        intent: "professional",
        canonicalPlan: request.routerCanonicalPlan,
        extension,
      }, { signal });
    } catch {
      const consumed = (
        this.#router.snapshot().nextGlobalRequestSequence
        > providerRequestSequence
      );
      return rejected("provider-failed", consumed);
    }
    if (routed.status === "rejected") {
      return rejected(routed.reason, routed.consumed);
    }
    if (
      routed.proof.globalRequestSequence !== providerRequestSequence
      || !proofMatchesRequest(routed.proof, request)
    ) {
      return rejected("provider-proof-mismatch", true);
    }
    const output = parseGpuOutput(routed.output, request, routed.proof);
    if (!output) return rejected("invalid-provider-output", true);
    const receipt = projectReceipt(request, routed.proof, output);
    return Object.freeze({
      status: "presented",
      receipt,
      proof: routed.proof,
    });
  }

  public notifyDeviceLoss(reason: string): void {
    this.#router.notifyDeviceLoss(
      safeIdentifier(reason) ? reason : "specialist-provider-device-lost",
    );
  }

  public dispose(): Promise<void> {
    return this.#router.dispose();
  }
}
