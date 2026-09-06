import {
  hashStudioCanonicalBrushPlan,
  parseStudioCanonicalBrushPlan,
  type StudioCanonicalBrushPlan,
} from "../studio-canonical-brush-plan";

export const STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_VERSION = 1 as const;

export const STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS = Object.freeze({
  maxProviders: 64,
  maxPendingRequests: 16,
  maxExtensionDepth: 8,
  maxExtensionNodes: 4_096,
  maxExtensionCodeUnits: 65_536,
  maxArrayLength: 1_024,
  maxObjectKeys: 256,
  maxIdentifierCodeUnits: 128,
} as const);

export type StudioEngineVNextBrushProviderIntent =
  | "canonical"
  | "professional"
  | "bristle-rake";

export type StudioEngineVNextBrushProviderCapability =
  | "tip:analytic"
  | "tip:texture"
  | "grain:none"
  | "grain:procedural"
  | "grain:texture"
  | "media:dry"
  | "media:wet"
  | "color:linear-srgb"
  | "color:linear-display-p3"
  | "porter-duff:source-over"
  | "porter-duff:destination-out"
  | "blend:normal"
  | "blend:multiply"
  | "blend:screen"
  | "blend:overlay"
  | "blend:darken"
  | "blend:lighten"
  | "paint:stroke-local"
  | "dynamics:retained"
  | "intent:canonical"
  | "intent:professional"
  | "intent:bristle-rake";

export interface StudioEngineVNextBrushProviderPlainDataArray
  extends ReadonlyArray<StudioEngineVNextBrushProviderPlainData> {
  readonly length: number;
}

export interface StudioEngineVNextBrushProviderPlainDataObject {
  readonly [key: string]: StudioEngineVNextBrushProviderPlainData;
}

export type StudioEngineVNextBrushProviderPlainData =
  | null
  | boolean
  | number
  | string
  | StudioEngineVNextBrushProviderPlainDataArray
  | StudioEngineVNextBrushProviderPlainDataObject;

export interface StudioEngineVNextBrushProviderDescriptor {
  readonly id: string;
  readonly version: number;
  readonly priority: number;
  readonly capabilities: readonly StudioEngineVNextBrushProviderCapability[];
}

export interface StudioEngineVNextBrushProviderRequest {
  readonly kind: "studio-engine-vnext-brush-provider/request";
  readonly version: typeof STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_VERSION;
  readonly requestSequence: number;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly intent: StudioEngineVNextBrushProviderIntent;
  readonly canonicalPlan: unknown;
  readonly extension: unknown;
}

export interface StudioEngineVNextBrushProviderExecution {
  readonly kind: "studio-engine-vnext-brush-provider/execution";
  readonly version: typeof STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_VERSION;
  readonly providerId: string;
  readonly providerVersion: number;
  readonly globalRequestSequence: number;
  readonly providerLocalSequence: number;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly intent: StudioEngineVNextBrushProviderIntent;
  readonly canonicalPlan: StudioCanonicalBrushPlan;
  readonly canonicalPlanHash: string;
  readonly requiredCapabilities:
    readonly StudioEngineVNextBrushProviderCapability[];
  readonly extension: StudioEngineVNextBrushProviderPlainData;
}

export interface StudioEngineVNextBrushProvider {
  readonly descriptor: StudioEngineVNextBrushProviderDescriptor;
  execute(
    execution: StudioEngineVNextBrushProviderExecution,
    signal: AbortSignal,
  ): Promise<unknown> | unknown;
  notifyDeviceLoss?(input: Readonly<{
    readonly deviceEpoch: number;
    readonly reason: string;
  }>): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

export interface StudioEngineVNextBrushProviderProof {
  readonly kind: "studio-engine-vnext-brush-provider/proof";
  readonly version: typeof STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_VERSION;
  readonly providerId: string;
  readonly providerVersion: number;
  readonly providerPriority: number;
  readonly globalRequestSequence: number;
  readonly providerLocalSequence: number;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly canonicalPlanHash: string;
  readonly requiredCapabilities:
    readonly StudioEngineVNextBrushProviderCapability[];
  readonly executionDigest: string;
}

export type StudioEngineVNextBrushProviderRouterResult =
  | Readonly<{
      status: "completed";
      consumed: true;
      proof: StudioEngineVNextBrushProviderProof;
      output: StudioEngineVNextBrushProviderPlainData;
    }>
  | Readonly<{
      status: "rejected";
      consumed: boolean;
      reason:
        | "invalid-request"
        | "request-sequence-conflict"
        | "request-sequence-gap"
        | "session-epoch-mismatch"
        | "device-epoch-mismatch"
        | "resize-epoch-mismatch"
        | "unsupported"
        | "ambiguous-provider"
        | "backpressure"
        | "cancelled"
        | "device-lost"
        | "disposed"
        | "provider-failed"
        | "provider-proof-mismatch";
      providerId?: string;
      globalRequestSequence?: number;
      providerLocalSequence?: number;
    }>;

export interface StudioEngineVNextBrushProviderRouterOptions {
  readonly sessionEpoch: number;
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly providers: readonly StudioEngineVNextBrushProvider[];
  readonly maxPendingRequests?: number;
}

export interface StudioEngineVNextBrushProviderRouterSnapshot {
  readonly phase: "ready" | "device-lost" | "disposing" | "disposed";
  readonly sessionEpoch: number;
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly nextGlobalRequestSequence: number;
  readonly activeRequestSequence: number | null;
  readonly queuedRequestSequences: readonly number[];
  readonly providers: readonly Readonly<{
    descriptor: StudioEngineVNextBrushProviderDescriptor;
    nextLocalSequence: number;
  }>[];
}

interface PlainSnapshotState {
  nodes: number;
  codeUnits: number;
  readonly ancestors: WeakSet<object>;
}

interface ParsedRequest {
  readonly requestSequence: number;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly deviceEpoch: number;
  readonly resizeEpoch: number;
  readonly intent: StudioEngineVNextBrushProviderIntent;
  readonly canonicalPlan: StudioCanonicalBrushPlan;
  readonly canonicalPlanHash: string;
  readonly extension: StudioEngineVNextBrushProviderPlainData;
  readonly requiredCapabilities:
    readonly StudioEngineVNextBrushProviderCapability[];
}

interface ProviderRecord {
  readonly provider: StudioEngineVNextBrushProvider;
  readonly descriptor: StudioEngineVNextBrushProviderDescriptor;
  readonly execute: StudioEngineVNextBrushProvider["execute"];
  readonly notifyDeviceLoss:
    | NonNullable<StudioEngineVNextBrushProvider["notifyDeviceLoss"]>
    | null;
  readonly dispose:
    | NonNullable<StudioEngineVNextBrushProvider["dispose"]>
    | null;
  nextLocalSequence: number;
}

interface PendingJob {
  readonly request: ParsedRequest;
  readonly provider: ProviderRecord;
  readonly providerLocalSequence: number;
  readonly execution: StudioEngineVNextBrushProviderExecution;
  readonly callerSignal?: AbortSignal;
  readonly callerAbort?: () => void;
  readonly resolve: (
    result: StudioEngineVNextBrushProviderRouterResult,
  ) => void;
  controller: AbortController | null;
  settled: boolean;
  terminalReason: "cancelled" | "device-lost" | "disposed" | null;
}

const CAPABILITY_ORDER: readonly StudioEngineVNextBrushProviderCapability[] = [
  "tip:analytic",
  "tip:texture",
  "grain:none",
  "grain:procedural",
  "grain:texture",
  "media:dry",
  "media:wet",
  "color:linear-srgb",
  "color:linear-display-p3",
  "porter-duff:source-over",
  "porter-duff:destination-out",
  "blend:normal",
  "blend:multiply",
  "blend:screen",
  "blend:overlay",
  "blend:darken",
  "blend:lighten",
  "paint:stroke-local",
  "dynamics:retained",
  "intent:canonical",
  "intent:professional",
  "intent:bristle-rake",
] as const;
const CAPABILITIES = new Set<StudioEngineVNextBrushProviderCapability>(
  CAPABILITY_ORDER,
);
const REQUEST_KEYS = [
  "kind",
  "version",
  "requestSequence",
  "sessionEpoch",
  "strokeEpoch",
  "deviceEpoch",
  "resizeEpoch",
  "intent",
  "canonicalPlan",
  "extension",
] as const;
const DESCRIPTOR_KEYS = [
  "id",
  "version",
  "priority",
  "capabilities",
] as const;
const ROUTER_OPTION_REQUIRED_KEYS = [
  "sessionEpoch",
  "deviceEpoch",
  "resizeEpoch",
  "providers",
] as const;
const ROUTER_OPTION_OPTIONAL_KEYS = ["maxPendingRequests"] as const;
const SUBMIT_OPTION_KEYS = ["signal"] as const;
const RESULT_KEYS = ["status", "proof", "output"] as const;
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
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u;

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function identifier(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length
      <= STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS
        .maxIdentifierCodeUnits
    && SAFE_ID.test(value)
  );
}

function ownDataRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))
  ) {
    return null;
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !("value" in descriptor)
    ) {
      return null;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function ownDataRecordWithOptional(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some(key => typeof key !== "string" || !allowed.has(key))
    || requiredKeys.some(key => !ownKeys.includes(key))
  ) {
    return null;
  }
  const result: Record<string, unknown> = {};
  for (const key of ownKeys) {
    if (typeof key !== "string") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !("value" in descriptor)
    ) {
      return null;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function ownOrPrototypeDataMethod(
  value: object,
  key: string,
): ((...input: never[]) => unknown) | null | undefined {
  let cursor: object | null = value;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!("value" in descriptor)) return null;
      return typeof descriptor.value === "function"
        ? descriptor.value as (...input: never[]) => unknown
        : null;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  return undefined;
}

function nativeAbortSignalState(
  value: unknown,
): Readonly<{ signal: AbortSignal; aborted: boolean }> | null {
  if (
    typeof AbortSignal === "undefined"
    || typeof value !== "object"
    || value === null
  ) {
    return null;
  }
  const abortedGetter = Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    "aborted",
  )?.get;
  if (!abortedGetter) return null;
  try {
    const aborted = abortedGetter.call(value);
    return typeof aborted === "boolean"
      ? { signal: value as AbortSignal, aborted }
      : null;
  } catch {
    return null;
  }
}

function nativeAbortSignalReason(signal: AbortSignal): unknown {
  const reasonGetter = Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    "reason",
  )?.get;
  if (!reasonGetter) return undefined;
  try {
    return reasonGetter.call(signal);
  } catch {
    return undefined;
  }
}

function parseSubmitOptions(
  value: unknown,
): Readonly<{ signal: AbortSignal | null; aborted: boolean }> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length === 0) return { signal: null, aborted: false };
  const record = ownDataRecord(value, SUBMIT_OPTION_KEYS);
  if (!record) return null;
  if (record.signal === undefined) return { signal: null, aborted: false };
  const state = nativeAbortSignalState(record.signal);
  return state
    ? { signal: state.signal, aborted: state.aborted }
    : null;
}

function denseDataArray(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;
  if (
    value.length
      > STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS.maxArrayLength
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    return null;
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1 || !names.includes("length")) {
    return null;
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || !descriptor.enumerable
      || !("value" in descriptor)
    ) {
      return null;
    }
    output.push(descriptor.value);
  }
  return output;
}

function snapshotPlainData(
  value: unknown,
  depth = 0,
  state: PlainSnapshotState = {
    nodes: 0,
    codeUnits: 0,
    ancestors: new WeakSet(),
  },
): StudioEngineVNextBrushProviderPlainData | null | undefined {
  state.nodes += 1;
  if (
    state.nodes
      > STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS.maxExtensionNodes
    || depth
      > STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS.maxExtensionDepth
  ) {
    return undefined;
  }
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : undefined;
  }
  if (typeof value === "string") {
    state.codeUnits += value.length;
    return state.codeUnits
      <= STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS.maxExtensionCodeUnits
      ? value
      : undefined;
  }
  if (typeof value !== "object") return undefined;
  if (state.ancestors.has(value)) return undefined;
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const array = denseDataArray(value);
      if (!array) return undefined;
      const output: StudioEngineVNextBrushProviderPlainData[] = [];
      for (const child of array) {
        const snapshot = snapshotPlainData(child, depth + 1, state);
        if (snapshot === undefined) return undefined;
        output.push(snapshot);
      }
      return Object.freeze(output);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length
        > STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS.maxObjectKeys
      || keys.some(key => typeof key !== "string")
    ) {
      return undefined;
    }
    const sortedKeys = (keys as string[]).toSorted();
    const output: Record<string, StudioEngineVNextBrushProviderPlainData> = {};
    for (const key of sortedKeys) {
      state.codeUnits += key.length;
      if (
        state.codeUnits
        > STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS
          .maxExtensionCodeUnits
      ) {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !descriptor.enumerable
        || !("value" in descriptor)
      ) {
        return undefined;
      }
      const snapshot = snapshotPlainData(
        descriptor.value,
        depth + 1,
        state,
      );
      if (snapshot === undefined) return undefined;
      output[key] = snapshot;
    }
    return Object.freeze(output);
  } finally {
    state.ancestors.delete(value);
  }
}

function snapshotCapabilities(
  value: unknown,
): readonly StudioEngineVNextBrushProviderCapability[] | null {
  const array = denseDataArray(value);
  if (!array || array.length < 1 || array.length > CAPABILITY_ORDER.length) {
    return null;
  }
  const capabilities: StudioEngineVNextBrushProviderCapability[] = [];
  const seen = new Set<StudioEngineVNextBrushProviderCapability>();
  for (const capability of array) {
    if (
      typeof capability !== "string"
      || !CAPABILITIES.has(
        capability as StudioEngineVNextBrushProviderCapability,
      )
      || seen.has(capability as StudioEngineVNextBrushProviderCapability)
    ) {
      return null;
    }
    const typed = capability as StudioEngineVNextBrushProviderCapability;
    seen.add(typed);
    capabilities.push(typed);
  }
  capabilities.sort(
    (left, right) =>
      CAPABILITY_ORDER.indexOf(left) - CAPABILITY_ORDER.indexOf(right),
  );
  return Object.freeze(capabilities);
}

function descriptorSnapshot(
  value: unknown,
): StudioEngineVNextBrushProviderDescriptor | null {
  const descriptor = ownDataRecord(value, DESCRIPTOR_KEYS);
  if (
    !descriptor
    || !identifier(descriptor.id)
    || !positiveSafeInteger(descriptor.version)
    || !safeInteger(descriptor.priority)
  ) {
    return null;
  }
  const capabilities = snapshotCapabilities(descriptor.capabilities);
  return capabilities
    ? Object.freeze({
      id: descriptor.id,
      version: descriptor.version,
      priority: descriptor.priority,
      capabilities,
    })
    : null;
}

function requiredCapabilities(
  plan: StudioCanonicalBrushPlan,
  intent: StudioEngineVNextBrushProviderIntent,
): readonly StudioEngineVNextBrushProviderCapability[] {
  const values: StudioEngineVNextBrushProviderCapability[] = [
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
    `intent:${intent}`,
  ];
  values.sort(
    (left, right) =>
      CAPABILITY_ORDER.indexOf(left) - CAPABILITY_ORDER.indexOf(right),
  );
  return Object.freeze(values);
}

function parseRequest(input: unknown): ParsedRequest | null {
  const request = ownDataRecord(input, REQUEST_KEYS);
  if (
    !request
    || request.kind !== "studio-engine-vnext-brush-provider/request"
    || request.version !== STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_VERSION
    || !positiveSafeInteger(request.requestSequence)
    || !positiveSafeInteger(request.sessionEpoch)
    || !positiveSafeInteger(request.strokeEpoch)
    || !positiveSafeInteger(request.deviceEpoch)
    || !positiveSafeInteger(request.resizeEpoch)
    || (
      request.intent !== "canonical"
      && request.intent !== "professional"
      && request.intent !== "bristle-rake"
    )
  ) {
    return null;
  }
  const extension = snapshotPlainData(request.extension);
  if (
    extension === undefined
    || (request.intent === "canonical" && extension !== null)
    || (request.intent !== "canonical" && extension === null)
  ) {
    return null;
  }
  const plan = parseStudioCanonicalBrushPlan(request.canonicalPlan, {
    sessionEpoch: request.sessionEpoch,
    strokeEpoch: request.strokeEpoch,
    lastAcceptedCommandSequence: (
      typeof request.canonicalPlan === "object"
      && request.canonicalPlan !== null
      && Number.isSafeInteger(
        Object.getOwnPropertyDescriptor(
          request.canonicalPlan,
          "commandSequence",
        )?.value,
      )
    )
      ? (
        Object.getOwnPropertyDescriptor(
          request.canonicalPlan,
          "commandSequence",
        )!.value as number
      ) - 1
      : 0,
  });
  if (!plan.ok) return null;
  const capabilities = requiredCapabilities(plan.value.plan, request.intent);
  return Object.freeze({
    requestSequence: request.requestSequence,
    sessionEpoch: request.sessionEpoch,
    strokeEpoch: request.strokeEpoch,
    deviceEpoch: request.deviceEpoch,
    resizeEpoch: request.resizeEpoch,
    intent: request.intent,
    canonicalPlan: plan.value.plan,
    canonicalPlanHash: hashStudioCanonicalBrushPlan(plan.value.plan),
    extension,
    requiredCapabilities: capabilities,
  });
}

function sameCapabilities(
  left: readonly StudioEngineVNextBrushProviderCapability[],
  right: readonly StudioEngineVNextBrushProviderCapability[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function projectProviderResult(
  input: unknown,
  job: PendingJob,
): Readonly<{
  proof: StudioEngineVNextBrushProviderProof;
  output: StudioEngineVNextBrushProviderPlainData;
}> | null {
  const result = ownDataRecord(input, RESULT_KEYS);
  if (!result || result.status !== "completed") return null;
  const proof = ownDataRecord(result.proof, PROOF_KEYS);
  const capabilities = proof
    ? snapshotCapabilities(proof.requiredCapabilities)
    : null;
  const descriptor = job.provider.descriptor;
  if (
    !proof
    || proof.kind !== "studio-engine-vnext-brush-provider/proof"
    || proof.version !== STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_VERSION
    || proof.providerId !== descriptor.id
    || proof.providerVersion !== descriptor.version
    || proof.providerPriority !== descriptor.priority
    || proof.globalRequestSequence !== job.request.requestSequence
    || proof.providerLocalSequence !== job.providerLocalSequence
    || proof.sessionEpoch !== job.request.sessionEpoch
    || proof.strokeEpoch !== job.request.strokeEpoch
    || proof.deviceEpoch !== job.request.deviceEpoch
    || proof.resizeEpoch !== job.request.resizeEpoch
    || proof.canonicalPlanHash !== job.request.canonicalPlanHash
    || !capabilities
    || !sameCapabilities(capabilities, job.request.requiredCapabilities)
    || !identifier(proof.executionDigest)
  ) {
    return null;
  }
  const output = snapshotPlainData(result.output);
  if (output === undefined) return null;
  return Object.freeze({
    proof: Object.freeze({
      kind: "studio-engine-vnext-brush-provider/proof",
      version: STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_VERSION,
      providerId: descriptor.id,
      providerVersion: descriptor.version,
      providerPriority: descriptor.priority,
      globalRequestSequence: job.request.requestSequence,
      providerLocalSequence: job.providerLocalSequence,
      sessionEpoch: job.request.sessionEpoch,
      strokeEpoch: job.request.strokeEpoch,
      deviceEpoch: job.request.deviceEpoch,
      resizeEpoch: job.request.resizeEpoch,
      canonicalPlanHash: job.request.canonicalPlanHash,
      requiredCapabilities: job.request.requiredCapabilities,
      executionDigest: proof.executionDigest,
    }),
    output,
  });
}

function rejected(
  reason: Extract<
    StudioEngineVNextBrushProviderRouterResult,
    { readonly status: "rejected" }
  >["reason"],
  consumed: boolean,
  job?: PendingJob,
): StudioEngineVNextBrushProviderRouterResult {
  return Object.freeze({
    status: "rejected",
    consumed,
    reason,
    ...(job
      ? {
        providerId: job.provider.descriptor.id,
        globalRequestSequence: job.request.requestSequence,
        providerLocalSequence: job.providerLocalSequence,
      }
      : {}),
  });
}

export class StudioEngineVNextBrushProviderRouter {
  public readonly sessionEpoch: number;
  public readonly resizeEpoch: number;

  readonly #providers: ProviderRecord[];
  readonly #maxPendingRequests: number;
  readonly #queue: PendingJob[] = [];
  #deviceEpoch: number;
  #nextGlobalRequestSequence = 1;
  #active: PendingJob | null = null;
  #draining = false;
  #phase: StudioEngineVNextBrushProviderRouterSnapshot["phase"] = "ready";
  #disposePromise: Promise<void> | null = null;

  public constructor(options: StudioEngineVNextBrushProviderRouterOptions) {
    const parsedOptions = ownDataRecordWithOptional(
      options,
      ROUTER_OPTION_REQUIRED_KEYS,
      ROUTER_OPTION_OPTIONAL_KEYS,
    );
    const providers = parsedOptions
      ? denseDataArray(parsedOptions.providers)
      : null;
    if (
      !parsedOptions
      || !positiveSafeInteger(parsedOptions.sessionEpoch)
      || !positiveSafeInteger(parsedOptions.deviceEpoch)
      || !positiveSafeInteger(parsedOptions.resizeEpoch)
      || !providers
      || providers.length < 1
      || providers.length
        > STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS.maxProviders
    ) {
      throw new Error("Invalid Studio brush provider router options.");
    }
    const maxPendingRequests =
      parsedOptions.maxPendingRequests
      ?? STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS.maxPendingRequests;
    if (
      !positiveSafeInteger(maxPendingRequests)
      || maxPendingRequests
        > STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_BUDGETS.maxPendingRequests
    ) {
      throw new Error("Invalid Studio brush provider router queue budget.");
    }
    const ids = new Set<string>();
    this.#providers = providers.map(rawProvider => {
      if (typeof rawProvider !== "object" || rawProvider === null) {
        throw new Error("Invalid Studio brush provider.");
      }
      const provider = rawProvider as StudioEngineVNextBrushProvider;
      const rawDescriptor = Object.getOwnPropertyDescriptor(
        provider,
        "descriptor",
      );
      if (!rawDescriptor || !("value" in rawDescriptor)) {
        throw new Error("Provider descriptor must be an own data property.");
      }
      const descriptor = descriptorSnapshot(rawDescriptor.value);
      if (!descriptor || ids.has(descriptor.id)) {
        throw new Error("Invalid or duplicate Studio brush provider.");
      }
      ids.add(descriptor.id);
      const execute = ownOrPrototypeDataMethod(provider, "execute");
      const notifyDeviceLoss = ownOrPrototypeDataMethod(
        provider,
        "notifyDeviceLoss",
      );
      const dispose = ownOrPrototypeDataMethod(provider, "dispose");
      if (
        !execute
        || notifyDeviceLoss === null
        || dispose === null
      ) {
        throw new Error("Studio brush provider execute() is unavailable.");
      }
      return {
        provider,
        descriptor,
        execute: execute as StudioEngineVNextBrushProvider["execute"],
        notifyDeviceLoss: (notifyDeviceLoss ?? null) as
          ProviderRecord["notifyDeviceLoss"],
        dispose: (dispose ?? null) as ProviderRecord["dispose"],
        nextLocalSequence: 1,
      };
    }).sort((left, right) => (
      left.descriptor.id < right.descriptor.id
        ? -1
        : left.descriptor.id > right.descriptor.id
          ? 1
          : 0
    ));
    this.sessionEpoch = parsedOptions.sessionEpoch;
    this.#deviceEpoch = parsedOptions.deviceEpoch;
    this.resizeEpoch = parsedOptions.resizeEpoch;
    this.#maxPendingRequests = maxPendingRequests;
  }

  public descriptors(): readonly StudioEngineVNextBrushProviderDescriptor[] {
    return Object.freeze(this.#providers.map(provider => provider.descriptor));
  }

  public submit(
    input: unknown,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<StudioEngineVNextBrushProviderRouterResult> {
    const submitOptions = parseSubmitOptions(options);
    if (!submitOptions) {
      return Promise.resolve(rejected("invalid-request", false));
    }
    if (this.#phase === "device-lost") {
      return Promise.resolve(rejected("device-lost", false));
    }
    if (this.#phase !== "ready") {
      return Promise.resolve(rejected("disposed", false));
    }
    if (submitOptions.aborted) {
      return Promise.resolve(rejected("cancelled", false));
    }
    const request = parseRequest(input);
    if (!request) return Promise.resolve(rejected("invalid-request", false));
    if (request.sessionEpoch !== this.sessionEpoch) {
      return Promise.resolve(rejected("session-epoch-mismatch", false));
    }
    if (request.deviceEpoch !== this.#deviceEpoch) {
      return Promise.resolve(rejected("device-epoch-mismatch", false));
    }
    if (request.resizeEpoch !== this.resizeEpoch) {
      return Promise.resolve(rejected("resize-epoch-mismatch", false));
    }
    if (request.requestSequence < this.#nextGlobalRequestSequence) {
      return Promise.resolve(rejected("request-sequence-conflict", false));
    }
    if (request.requestSequence > this.#nextGlobalRequestSequence) {
      return Promise.resolve(rejected("request-sequence-gap", false));
    }
    const selection = this.#select(request.requiredCapabilities);
    if (selection.status !== "selected") {
      return Promise.resolve(rejected(selection.status, false));
    }
    if (
      this.#queue.length + (this.#active ? 1 : 0)
      >= this.#maxPendingRequests
    ) {
      return Promise.resolve(rejected("backpressure", false));
    }

    const provider = selection.provider;
    const providerLocalSequence = provider.nextLocalSequence;
    const execution = Object.freeze({
      kind: "studio-engine-vnext-brush-provider/execution" as const,
      version: STUDIO_ENGINE_VNEXT_BRUSH_PROVIDER_ROUTER_VERSION,
      providerId: provider.descriptor.id,
      providerVersion: provider.descriptor.version,
      globalRequestSequence: request.requestSequence,
      providerLocalSequence,
      sessionEpoch: request.sessionEpoch,
      strokeEpoch: request.strokeEpoch,
      deviceEpoch: request.deviceEpoch,
      resizeEpoch: request.resizeEpoch,
      intent: request.intent,
      canonicalPlan: request.canonicalPlan,
      canonicalPlanHash: request.canonicalPlanHash,
      requiredCapabilities: request.requiredCapabilities,
      extension: request.extension,
    });
    this.#nextGlobalRequestSequence += 1;
    provider.nextLocalSequence += 1;
    return new Promise(resolve => {
      const job: PendingJob = {
        request,
        provider,
        providerLocalSequence,
        execution,
        callerSignal: submitOptions.signal ?? undefined,
        resolve,
        controller: null,
        settled: false,
        terminalReason: null,
      };
      if (submitOptions.signal) {
        const abort = () => {
          this.cancel(request.requestSequence);
        };
        Object.defineProperty(job, "callerAbort", {
          value: abort,
          enumerable: true,
        });
        EventTarget.prototype.addEventListener.call(
          submitOptions.signal,
          "abort",
          abort,
          { once: true },
        );
      }
      this.#queue.push(job);
      void this.#drain();
    });
  }

  public cancel(globalRequestSequence: number): boolean {
    if (!positiveSafeInteger(globalRequestSequence)) return false;
    if (this.#active?.request.requestSequence === globalRequestSequence) {
      if (this.#active.terminalReason !== null) return false;
      this.#active.terminalReason = "cancelled";
      this.#active.controller?.abort(new Error("Router request cancelled."));
      this.#settle(
        this.#active,
        rejected("cancelled", true, this.#active),
      );
      return true;
    }
    const index = this.#queue.findIndex(
      job => job.request.requestSequence === globalRequestSequence,
    );
    if (index < 0) return false;
    const [job] = this.#queue.splice(index, 1);
    if (!job) return false;
    job.terminalReason = "cancelled";
    this.#settle(job, rejected("cancelled", true, job));
    return true;
  }

  public notifyDeviceLoss(reason = "device-lost"): void {
    if (this.#phase !== "ready") return;
    this.#phase = "device-lost";
    this.#deviceEpoch = this.#deviceEpoch < Number.MAX_SAFE_INTEGER
      ? this.#deviceEpoch + 1
      : Number.MAX_SAFE_INTEGER;
    const active = this.#active;
    if (active) {
      active.terminalReason = "device-lost";
      active.controller?.abort(new Error(reason));
      this.#settle(active, rejected("device-lost", true, active));
      this.#active = null;
    }
    for (const job of this.#queue.splice(0)) {
      job.terminalReason = "device-lost";
      this.#settle(job, rejected("device-lost", true, job));
    }
    for (const provider of this.#providers) {
      try {
        const notification = provider.notifyDeviceLoss?.call(
          provider.provider,
          {
          deviceEpoch: this.#deviceEpoch,
          reason,
          },
        );
        if (notification) {
          void Promise.resolve(notification).catch(() => undefined);
        }
      } catch {
        // Device loss is already terminal.
      }
    }
  }

  public snapshot(): StudioEngineVNextBrushProviderRouterSnapshot {
    return Object.freeze({
      phase: this.#phase,
      sessionEpoch: this.sessionEpoch,
      deviceEpoch: this.#deviceEpoch,
      resizeEpoch: this.resizeEpoch,
      nextGlobalRequestSequence: this.#nextGlobalRequestSequence,
      activeRequestSequence: this.#active?.request.requestSequence ?? null,
      queuedRequestSequences: Object.freeze(
        this.#queue.map(job => job.request.requestSequence),
      ),
      providers: Object.freeze(this.#providers.map(provider => Object.freeze({
        descriptor: provider.descriptor,
        nextLocalSequence: provider.nextLocalSequence,
      }))),
    });
  }

  public dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#phase = "disposing";
    const active = this.#active;
    if (active) {
      active.terminalReason = "disposed";
      active.controller?.abort(new Error("Router disposed."));
      this.#settle(active, rejected("disposed", true, active));
      this.#active = null;
    }
    for (const job of this.#queue.splice(0)) {
      job.terminalReason = "disposed";
      this.#settle(job, rejected("disposed", true, job));
    }
    this.#disposePromise = this.#disposeSerial();
    return this.#disposePromise;
  }

  #select(
    required: readonly StudioEngineVNextBrushProviderCapability[],
  ):
    | Readonly<{ status: "selected"; provider: ProviderRecord }>
    | Readonly<{ status: "unsupported" | "ambiguous-provider" }> {
    const eligible = this.#providers.filter(provider => {
      const available = new Set(provider.descriptor.capabilities);
      return required.every(capability => available.has(capability));
    });
    if (eligible.length === 0) return { status: "unsupported" };
    const maximumPriority = Math.max(
      ...eligible.map(provider => provider.descriptor.priority),
    );
    const preferred = eligible.filter(
      provider => provider.descriptor.priority === maximumPriority,
    );
    return preferred.length === 1
      ? { status: "selected", provider: preferred[0]! }
      : { status: "ambiguous-provider" };
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#phase === "ready" && this.#queue.length > 0) {
        const job = this.#queue.shift()!;
        this.#active = job;
        const controller = new AbortController();
        job.controller = controller;
        const callerSignalState = job.callerSignal
          ? nativeAbortSignalState(job.callerSignal)
          : null;
        if (callerSignalState?.aborted && job.callerSignal) {
          controller.abort(nativeAbortSignalReason(job.callerSignal));
        }
        let rawResult: unknown;
        try {
          rawResult = await job.provider.execute.call(
            job.provider.provider,
            job.execution,
            controller.signal,
          );
        } catch {
          if (job.terminalReason !== null) {
            this.#settle(
              job,
              rejected(job.terminalReason, true, job),
            );
          } else if (controller.signal.aborted) {
            this.#settle(job, rejected("cancelled", true, job));
          } else {
            this.#settle(job, rejected("provider-failed", true, job));
          }
          if (this.#active === job) this.#active = null;
          continue;
        }
        if (job.terminalReason !== null) {
          this.#settle(job, rejected(job.terminalReason, true, job));
        } else if (controller.signal.aborted) {
          this.#settle(job, rejected("cancelled", true, job));
        } else {
          const projected = projectProviderResult(rawResult, job);
          this.#settle(job, projected
            ? Object.freeze({
              status: "completed",
              consumed: true,
              proof: projected.proof,
              output: projected.output,
            })
            : rejected("provider-proof-mismatch", true, job));
        }
        if (this.#active === job) this.#active = null;
      }
    } finally {
      this.#draining = false;
      if (this.#phase === "ready" && this.#queue.length > 0) {
        void this.#drain();
      }
    }
  }

  #detachCaller(job: PendingJob): void {
    if (job.callerSignal && job.callerAbort) {
      EventTarget.prototype.removeEventListener.call(
        job.callerSignal,
        "abort",
        job.callerAbort,
      );
    }
  }

  #settle(
    job: PendingJob,
    result: StudioEngineVNextBrushProviderRouterResult,
  ): void {
    if (job.settled) return;
    job.settled = true;
    this.#detachCaller(job);
    job.resolve(result);
  }

  async #disposeSerial(): Promise<void> {
    for (const provider of this.#providers) {
      try {
        await provider.dispose?.call(provider.provider);
      } catch {
        // Disposal is terminal and continues through every provider.
      }
    }
    this.#phase = "disposed";
  }
}
