import {
  STUDIO_ONNX_HARD_LIMITS,
  findStudioOnnxModelDescriptor,
  studioOnnxElementByteLength,
  studioOnnxModelKey,
  studioOnnxTensorElementCount,
  validateStudioOnnxModelDescriptor,
  type StudioOnnxModelDescriptor,
  type StudioOnnxModelRegistry,
  type StudioOnnxTensorData,
  type StudioOnnxTensorElementType,
  type StudioOnnxTensorSchema,
} from "./studio-onnx-model-registry";
import { sha256HexPortable } from "./studio-sha256";

import type { InferenceSession, Tensor } from "onnxruntime-web";

export const STUDIO_ONNX_RUNTIME_VERSION = "1.27.0" as const;
export const STUDIO_ONNX_EXECUTION_PROVIDERS = [
  "webgpu",
  "wasm",
] as const;

export const DEFAULT_STUDIO_ONNX_INFERENCE_BUDGETS =
  Object.freeze<StudioOnnxInferenceBudgets>({
    maxModelBytes: STUDIO_ONNX_HARD_LIMITS.maxModelBytes,
    maxTensorElements: STUDIO_ONNX_HARD_LIMITS.maxTensorElements,
    maxTensorBytes: STUDIO_ONNX_HARD_LIMITS.maxTensorBytes,
    maxRequestInputBytes: STUDIO_ONNX_HARD_LIMITS.maxTensorBytes,
    maxResultBytes: STUDIO_ONNX_HARD_LIMITS.maxTensorBytes,
  });

export type StudioOnnxExecutionProvider = "webgpu" | "wasm";

export type StudioOnnxInferenceErrorCode =
  | "aborted"
  | "disposed"
  | "invalid-epoch"
  | "stale-result"
  | "unknown-model"
  | "model-source-required"
  | "model-url-rejected"
  | "model-load-failed"
  | "model-byte-budget-exceeded"
  | "model-digest-mismatch"
  | "session-create-failed"
  | "model-schema-mismatch"
  | "invalid-input"
  | "malformed-output"
  | "tensor-budget-exceeded";

export class StudioOnnxInferenceError extends Error {
  readonly code: StudioOnnxInferenceErrorCode;

  constructor(
    code: StudioOnnxInferenceErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message);
    this.name = code === "aborted" ? "AbortError" : "StudioOnnxInferenceError";
    this.code = code;
    if (options && "cause" in options) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: options.cause,
      });
    }
  }
}

export interface StudioOnnxRuntime {
  readonly InferenceSession: typeof InferenceSession;
  readonly Tensor: typeof Tensor;
}

export type StudioOnnxRuntimeLoader = () => Promise<StudioOnnxRuntime>;

export interface StudioOnnxInferenceBudgets {
  readonly maxModelBytes: number;
  readonly maxTensorElements: number;
  readonly maxTensorBytes: number;
  readonly maxRequestInputBytes: number;
  readonly maxResultBytes: number;
}

export interface StudioOnnxUrlPolicy {
  readonly baseUrl?: string;
  readonly allowedOrigins?: readonly string[];
  readonly allowHttpLocalhost?: boolean;
  readonly maxUrlCharacters?: number;
}

export interface StudioOnnxModelByteLoadRequest {
  readonly url: string;
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

export type StudioOnnxModelByteLoader = (
  request: StudioOnnxModelByteLoadRequest,
) => Promise<Uint8Array>;

export type StudioOnnxModelSource =
  | {
      readonly kind: "bytes";
      readonly bytes: Uint8Array;
    }
  | {
      readonly kind: "url";
      readonly url: string;
    };

export interface StudioOnnxEpoch {
  readonly request: number;
  readonly stroke: number;
  readonly document: number;
}

export interface StudioOnnxTensorValue {
  readonly name: string;
  readonly elementType: StudioOnnxTensorElementType;
  readonly dims: readonly number[];
  readonly data: StudioOnnxTensorData;
}

export interface StudioOnnxSessionReceipt {
  readonly providerId: "onnxruntime-web";
  readonly runtimeVersion: typeof STUDIO_ONNX_RUNTIME_VERSION;
  readonly model: {
    readonly id: string;
    readonly version: string;
    readonly sha256: `sha256:${string}`;
    readonly byteLength: number;
  };
  readonly selectedExecutionProvider: StudioOnnxExecutionProvider;
  readonly attemptedExecutionProviders: readonly [StudioOnnxExecutionProvider];
  readonly activeExecutionProvider: StudioOnnxExecutionProvider;
  readonly attemptCount: 1;
  readonly failureIsolation: "fail-closed";
}

export interface StudioOnnxInferenceResult {
  readonly epoch: StudioOnnxEpoch;
  readonly receipt: StudioOnnxSessionReceipt;
  readonly outputs: Readonly<Record<string, StudioOnnxTensorValue>>;
}

export interface StudioOnnxLoadModelRequest {
  readonly modelId: string;
  readonly version: string;
  readonly source: StudioOnnxModelSource;
  readonly signal?: AbortSignal;
}

export interface StudioOnnxInferenceRequest {
  readonly modelId: string;
  readonly version: string;
  readonly source?: StudioOnnxModelSource;
  readonly epoch: StudioOnnxEpoch;
  readonly inputs: readonly StudioOnnxTensorValue[];
  /** Applied to model loading. A running WebGPU dispatch is checked after completion. */
  readonly signal?: AbortSignal;
}

export interface StudioOnnxInferenceProvider {
  readonly destroyed: boolean;
  readonly epoch: StudioOnnxEpoch;
  setEpoch(epoch: StudioOnnxEpoch): void;
  loadModel(request: StudioOnnxLoadModelRequest): Promise<StudioOnnxSessionReceipt>;
  infer(request: StudioOnnxInferenceRequest): Promise<StudioOnnxInferenceResult>;
  disposeModel(modelId: string, version: string): Promise<boolean>;
  dispose(): Promise<void>;
}

export interface CreateStudioOnnxInferenceProviderOptions {
  readonly registry: StudioOnnxModelRegistry;
  /** Immutable for this provider. A failed provider is never replaced in-flight. */
  readonly executionProvider?: StudioOnnxExecutionProvider;
  readonly budgets?: Partial<StudioOnnxInferenceBudgets>;
  readonly urlPolicy?: StudioOnnxUrlPolicy;
  readonly loadRuntime?: StudioOnnxRuntimeLoader;
  readonly loadModelBytes?: StudioOnnxModelByteLoader;
  readonly webGpuApiAvailable?: () => boolean;
  readonly initialEpoch?: StudioOnnxEpoch;
}

interface CachedStudioOnnxSession {
  readonly descriptor: StudioOnnxModelDescriptor;
  readonly runtime: StudioOnnxRuntime;
  readonly session: InferenceSession;
  readonly receipt: StudioOnnxSessionReceipt;
  activeLeases: number;
  readonly idleResolvers: Array<() => void>;
}

function inferenceError(
  code: StudioOnnxInferenceErrorCode,
  message: string,
  cause?: unknown,
): StudioOnnxInferenceError {
  return new StudioOnnxInferenceError(code, message, { cause });
}

function abortedError(): StudioOnnxInferenceError {
  return inferenceError("aborted", "ONNX model loading was cancelled.");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortedError();
}

function ownDataValue(
  source: object,
  key: string,
  code: StudioOnnxInferenceErrorCode = "invalid-input",
  required = false,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor) {
    if (required) {
      throw inferenceError(code, `ONNX ${key} must be an own data property.`);
    }
    return undefined;
  }
  if (!("value" in descriptor)) {
    throw inferenceError(code, `ONNX ${key} must not be an accessor property.`);
  }
  return descriptor.value;
}

function ownArrayValues(
  source: readonly unknown[],
  label: string,
  code: StudioOnnxInferenceErrorCode = "invalid-input",
): unknown[] {
  const values: unknown[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
    if (!descriptor || !("value" in descriptor)) {
      throw inferenceError(
        code,
        `ONNX ${label}[${index}] must be an own data property.`,
      );
    }
    values.push(descriptor.value);
  }
  return values;
}

function awaitWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortedError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (cause: unknown) => {
        cleanup();
        reject(cause);
      },
    );
  });
}

function awaitSessionWithAbort(
  promise: Promise<InferenceSession>,
  signal?: AbortSignal,
): Promise<InferenceSession> {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.then(
      (session) => session.release(),
      () => undefined,
    );
    return Promise.reject(abortedError());
  }
  return new Promise<InferenceSession>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      cleanup();
      reject(abortedError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (session) => {
        cleanup();
        if (aborted) {
          void session.release().catch(() => undefined);
          return;
        }
        resolve(session);
      },
      (cause: unknown) => {
        cleanup();
        if (!aborted) reject(cause);
      },
    );
  });
}

function isAbortError(cause: unknown): boolean {
  return (
    cause instanceof StudioOnnxInferenceError
      ? cause.code === "aborted"
      : cause instanceof Error && cause.name === "AbortError"
  );
}

function assertEpoch(epoch: StudioOnnxEpoch): void {
  for (const value of [epoch.request, epoch.stroke, epoch.document]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw inferenceError(
        "invalid-epoch",
        "ONNX request, stroke, and document epochs must be non-negative safe integers.",
      );
    }
  }
}

function epochsEqual(left: StudioOnnxEpoch, right: StudioOnnxEpoch): boolean {
  return (
    left.request === right.request &&
    left.stroke === right.stroke &&
    left.document === right.document
  );
}

function cloneEpoch(epoch: StudioOnnxEpoch): StudioOnnxEpoch {
  return Object.freeze({ ...epoch });
}

function validateBudgets(
  partial: Partial<StudioOnnxInferenceBudgets> | undefined,
): StudioOnnxInferenceBudgets {
  const budgets = {
    ...DEFAULT_STUDIO_ONNX_INFERENCE_BUDGETS,
    ...partial,
  };
  const entries = [
    ["maxModelBytes", budgets.maxModelBytes, STUDIO_ONNX_HARD_LIMITS.maxModelBytes],
    [
      "maxTensorElements",
      budgets.maxTensorElements,
      STUDIO_ONNX_HARD_LIMITS.maxTensorElements,
    ],
    ["maxTensorBytes", budgets.maxTensorBytes, STUDIO_ONNX_HARD_LIMITS.maxTensorBytes],
    [
      "maxRequestInputBytes",
      budgets.maxRequestInputBytes,
      STUDIO_ONNX_HARD_LIMITS.maxTensorBytes,
    ],
    ["maxResultBytes", budgets.maxResultBytes, STUDIO_ONNX_HARD_LIMITS.maxTensorBytes],
  ] as const;
  for (const [name, value, hardMaximum] of entries) {
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > hardMaximum
    ) {
      throw new RangeError(`${name} exceeds the ONNX provider hard budget.`);
    }
  }
  return Object.freeze(budgets);
}

function defaultWebGpuApiAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

async function loadStudioOnnxRuntime(): Promise<StudioOnnxRuntime> {
  return await import("onnxruntime-web/webgpu");
}

function defaultBaseUrl(): string {
  if (typeof location !== "undefined") return location.href;
  return "https://studio.local.invalid/";
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

export function resolveStudioOnnxModelUrl(
  rawUrl: string,
  policy: StudioOnnxUrlPolicy = {},
): string {
  const maximum = policy.maxUrlCharacters ?? 2_048;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum <= 0 ||
    maximum > 16_384 ||
    rawUrl.length === 0 ||
    rawUrl.length > maximum
  ) {
    throw inferenceError("model-url-rejected", "ONNX model URL length is invalid.");
  }

  let base: URL;
  let resolved: URL;
  try {
    base = new URL(policy.baseUrl ?? defaultBaseUrl());
    resolved = new URL(rawUrl, base);
  } catch (cause) {
    throw inferenceError("model-url-rejected", "ONNX model URL is malformed.", cause);
  }

  if (
    (resolved.protocol !== "https:" && resolved.protocol !== "http:") ||
    resolved.username.length > 0 ||
    resolved.password.length > 0 ||
    resolved.hash.length > 0 ||
    !resolved.pathname.toLowerCase().endsWith(".onnx")
  ) {
    throw inferenceError(
      "model-url-rejected",
      "ONNX model URL must be an HTTP(S) .onnx resource without credentials or fragments.",
    );
  }
  if (
    resolved.protocol === "http:" &&
    !(policy.allowHttpLocalhost === true && isLocalhost(resolved.hostname))
  ) {
    throw inferenceError(
      "model-url-rejected",
      "Plain HTTP ONNX model URLs are restricted to explicitly allowed localhost use.",
    );
  }

  const allowedOrigins = new Set([
    base.origin,
    ...(policy.allowedOrigins ?? []),
  ]);
  if (!allowedOrigins.has(resolved.origin)) {
    throw inferenceError(
      "model-url-rejected",
      "ONNX model URL origin is not allowed by the local model policy.",
    );
  }
  return resolved.href;
}

async function fetchStudioOnnxModelBytes(
  request: StudioOnnxModelByteLoadRequest,
): Promise<Uint8Array> {
  if (typeof fetch !== "function") {
    throw inferenceError(
      "model-load-failed",
      "Browser fetch is unavailable for the ONNX model URL.",
    );
  }
  const response = await fetch(request.url, {
    signal: request.signal,
    credentials: "omit",
    redirect: "error",
    cache: "force-cache",
  });
  if (!response.ok) {
    throw inferenceError(
      "model-load-failed",
      `ONNX model request failed with status ${response.status}.`,
    );
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength <= 0 ||
      parsedLength > request.maxBytes
    ) {
      throw inferenceError(
        "model-byte-budget-exceeded",
        "ONNX model Content-Length exceeds its byte budget.",
      );
    }
  }
  if (!response.body) {
    throw inferenceError(
      "model-load-failed",
      "A streaming response body is required for bounded ONNX model loading.",
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      throwIfAborted(request.signal);
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > request.maxBytes) {
        await reader.cancel("ONNX model byte budget exceeded");
        throw inferenceError(
          "model-byte-budget-exceeded",
          "ONNX model response exceeded its byte budget.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (byteLength === 0) {
    throw inferenceError("model-load-failed", "ONNX model response was empty.");
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function tensorDataMatchesElementType(
  elementType: StudioOnnxTensorElementType,
  data: StudioOnnxTensorData,
): boolean {
  switch (elementType) {
    case "float32":
      return data instanceof Float32Array;
    case "float64":
      return data instanceof Float64Array;
    case "float16":
    case "uint16":
      return data instanceof Uint16Array;
    case "int8":
      return data instanceof Int8Array;
    case "uint8":
    case "bool":
      return data instanceof Uint8Array;
    case "int16":
      return data instanceof Int16Array;
    case "int32":
      return data instanceof Int32Array;
    case "uint32":
      return data instanceof Uint32Array;
  }
}

function sameShape(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((dimension, index) => dimension === right[index])
  );
}

function validateTensorValue(
  value: StudioOnnxTensorValue,
  schema: StudioOnnxTensorSchema,
  budgets: StudioOnnxInferenceBudgets,
  code: "invalid-input" | "malformed-output",
): number {
  if (
    value.name !== schema.name ||
    value.elementType !== schema.elementType ||
    !sameShape(value.dims, schema.shape) ||
    !tensorDataMatchesElementType(value.elementType, value.data)
  ) {
    throw inferenceError(
      code,
      `ONNX tensor "${schema.name}" does not match its declared schema.`,
    );
  }

  let elements: number;
  try {
    elements = studioOnnxTensorElementCount(value.dims);
  } catch (cause) {
    throw inferenceError("tensor-budget-exceeded", "ONNX tensor shape is unsafe.", cause);
  }
  const expectedBytes =
    elements * studioOnnxElementByteLength(value.elementType);
  if (
    elements > budgets.maxTensorElements ||
    expectedBytes > budgets.maxTensorBytes ||
    value.data.length !== elements ||
    value.data.byteLength !== expectedBytes
  ) {
    throw inferenceError(
      "tensor-budget-exceeded",
      `ONNX tensor "${schema.name}" exceeds or contradicts its element and byte budgets.`,
    );
  }
  return expectedBytes;
}

function createRuntimeTensor(
  runtime: StudioOnnxRuntime,
  input: StudioOnnxTensorValue,
): Tensor {
  switch (input.elementType) {
    case "float32":
      return new runtime.Tensor(
        "float32",
        input.data as Float32Array,
        input.dims,
      );
    case "float64":
      return new runtime.Tensor(
        "float64",
        input.data as Float64Array,
        input.dims,
      );
    case "float16":
      return new runtime.Tensor(
        "float16",
        input.data as Uint16Array,
        input.dims,
      );
    case "int8":
      return new runtime.Tensor("int8", input.data as Int8Array, input.dims);
    case "uint8":
      return new runtime.Tensor("uint8", input.data as Uint8Array, input.dims);
    case "int16":
      return new runtime.Tensor(
        "int16",
        input.data as Int16Array,
        input.dims,
      );
    case "uint16":
      return new runtime.Tensor(
        "uint16",
        input.data as Uint16Array,
        input.dims,
      );
    case "int32":
      return new runtime.Tensor(
        "int32",
        input.data as Int32Array,
        input.dims,
      );
    case "uint32":
      return new runtime.Tensor(
        "uint32",
        input.data as Uint32Array,
        input.dims,
      );
    case "bool":
      return new runtime.Tensor("bool", input.data as Uint8Array, input.dims);
  }
}

function tensorLike(value: unknown): value is Tensor {
  return (
    typeof value === "object" &&
    value !== null &&
    "dims" in value &&
    "type" in value &&
    "getData" in value &&
    typeof value.getData === "function" &&
    "dispose" in value &&
    typeof value.dispose === "function"
  );
}

function copyRuntimeTensorData(
  elementType: StudioOnnxTensorElementType,
  data: Tensor["data"],
): StudioOnnxTensorData {
  switch (elementType) {
    case "float32":
      return new Float32Array(data as Float32Array);
    case "float64":
      return new Float64Array(data as Float64Array);
    case "float16":
    case "uint16":
      return new Uint16Array(data as Uint16Array);
    case "int8":
      return new Int8Array(data as Int8Array);
    case "uint8":
    case "bool":
      return new Uint8Array(data as Uint8Array);
    case "int16":
      return new Int16Array(data as Int16Array);
    case "int32":
      return new Int32Array(data as Int32Array);
    case "uint32":
      return new Uint32Array(data as Uint32Array);
  }
}

function runtimeTensorElementType(
  value: string,
): StudioOnnxTensorElementType | null {
  switch (value) {
    case "float32":
    case "float64":
    case "float16":
    case "int8":
    case "uint8":
    case "int16":
    case "uint16":
    case "int32":
    case "uint32":
    case "bool":
      return value;
    default:
      return null;
  }
}

function freezeReceipt(input: {
  readonly descriptor: StudioOnnxModelDescriptor;
  readonly byteLength: number;
  readonly executionProvider: StudioOnnxExecutionProvider;
}): StudioOnnxSessionReceipt {
  return Object.freeze({
    providerId: "onnxruntime-web",
    runtimeVersion: STUDIO_ONNX_RUNTIME_VERSION,
    model: Object.freeze({
      id: input.descriptor.id,
      version: input.descriptor.version,
      sha256: input.descriptor.sha256,
      byteLength: input.byteLength,
    }),
    selectedExecutionProvider: input.executionProvider,
    attemptedExecutionProviders: Object.freeze([
      input.executionProvider,
    ]) as readonly [StudioOnnxExecutionProvider],
    activeExecutionProvider: input.executionProvider,
    attemptCount: 1,
    failureIsolation: "fail-closed",
  });
}

function disposeOnnxValues(values: Record<string, unknown>): void {
  for (const value of Object.values(values)) {
    if (tensorLike(value)) value.dispose();
  }
}

class OnnxStudioInferenceProvider implements StudioOnnxInferenceProvider {
  private readonly registry: StudioOnnxModelRegistry;
  private readonly budgets: StudioOnnxInferenceBudgets;
  private readonly urlPolicy: StudioOnnxUrlPolicy;
  private readonly loadRuntime: StudioOnnxRuntimeLoader;
  private readonly loadModelBytes: StudioOnnxModelByteLoader;
  private readonly executionProvider: StudioOnnxExecutionProvider;
  private readonly webGpuApiAvailable: () => boolean;
  private readonly sessions = new Map<string, CachedStudioOnnxSession>();
  private currentEpoch: StudioOnnxEpoch;
  private isDestroyed = false;
  private activeInferenceCount = 0;
  private readonly idleResolvers: Array<() => void> = [];
  private disposePromise: Promise<void> | null = null;

  constructor(options: CreateStudioOnnxInferenceProviderOptions) {
    this.registry = options.registry;
    this.budgets = validateBudgets(options.budgets);
    this.urlPolicy = Object.freeze({ ...options.urlPolicy });
    this.loadRuntime = options.loadRuntime ?? loadStudioOnnxRuntime;
    this.loadModelBytes = options.loadModelBytes ?? fetchStudioOnnxModelBytes;
    this.executionProvider = options.executionProvider ?? "webgpu";
    this.webGpuApiAvailable =
      options.webGpuApiAvailable ?? defaultWebGpuApiAvailable;
    const initialEpoch = options.initialEpoch ?? {
      request: 0,
      stroke: 0,
      document: 0,
    };
    assertEpoch(initialEpoch);
    this.currentEpoch = cloneEpoch(initialEpoch);
    for (const descriptor of options.registry.models) {
      validateStudioOnnxModelDescriptor(descriptor);
    }
  }

  get destroyed(): boolean {
    return this.isDestroyed;
  }

  get epoch(): StudioOnnxEpoch {
    return this.currentEpoch;
  }

  private assertAlive(): void {
    if (this.isDestroyed) {
      throw inferenceError("disposed", "The ONNX inference provider is disposed.");
    }
  }

  private descriptor(modelId: string, version: string): StudioOnnxModelDescriptor {
    const descriptor = findStudioOnnxModelDescriptor(
      this.registry,
      modelId,
      version,
    );
    if (!descriptor) {
      throw inferenceError(
        "unknown-model",
        `Unknown ONNX model descriptor "${modelId}@${version}".`,
      );
    }
    return descriptor;
  }

  private assertCurrentEpoch(epoch: StudioOnnxEpoch): void {
    assertEpoch(epoch);
    if (!epochsEqual(epoch, this.currentEpoch)) {
      throw inferenceError(
        "stale-result",
        "The ONNX result belongs to an obsolete request, stroke, or document epoch.",
      );
    }
  }

  setEpoch(epoch: StudioOnnxEpoch): void {
    this.assertAlive();
    assertEpoch(epoch);
    if (
      epoch.request < this.currentEpoch.request ||
      epoch.stroke < this.currentEpoch.stroke ||
      epoch.document < this.currentEpoch.document
    ) {
      throw inferenceError(
        "invalid-epoch",
        "ONNX epochs are monotonic and cannot move backwards.",
      );
    }
    this.currentEpoch = cloneEpoch(epoch);
  }

  private async modelBytes(
    descriptor: StudioOnnxModelDescriptor,
    source: StudioOnnxModelSource,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    throwIfAborted(signal);
    const maximum = Math.min(descriptor.byteBudget, this.budgets.maxModelBytes);
    let bytes: Uint8Array;
    if (!source || typeof source !== "object") {
      throw inferenceError("model-load-failed", "ONNX model source is invalid.");
    }
    const kind = ownDataValue(source, "kind", "model-load-failed", true);
    if (kind === "bytes") {
      const sourceBytes = ownDataValue(
        source,
        "bytes",
        "model-load-failed",
        true,
      );
      if (!(sourceBytes instanceof Uint8Array)) {
        throw inferenceError("model-load-failed", "ONNX model bytes are invalid.");
      }
      if (sourceBytes.byteLength === 0 || sourceBytes.byteLength > maximum) {
        throw inferenceError(
          "model-byte-budget-exceeded",
          "ONNX model bytes exceed the descriptor or provider byte budget.",
        );
      }
      bytes = new Uint8Array(sourceBytes);
    } else if (kind === "url") {
      const sourceUrl = ownDataValue(
        source,
        "url",
        "model-load-failed",
        true,
      );
      if (typeof sourceUrl !== "string") {
        throw inferenceError("model-load-failed", "ONNX model URL is invalid.");
      }
      const url = resolveStudioOnnxModelUrl(sourceUrl, this.urlPolicy);
      try {
        const loadedBytes = await awaitWithAbort(
          this.loadModelBytes({ url, maxBytes: maximum, signal }),
          signal,
        );
        if (
          !(loadedBytes instanceof Uint8Array)
          || loadedBytes.byteLength === 0
          || loadedBytes.byteLength > maximum
        ) {
          throw inferenceError(
            "model-byte-budget-exceeded",
            "ONNX model loader output exceeds its byte budget.",
          );
        }
        bytes = new Uint8Array(loadedBytes);
      } catch (cause) {
        if (signal?.aborted || isAbortError(cause)) throw abortedError();
        if (cause instanceof StudioOnnxInferenceError) throw cause;
        throw inferenceError(
          "model-load-failed",
          "ONNX model byte loading failed.",
          cause,
        );
      }
    } else {
      throw inferenceError("model-load-failed", "ONNX model source kind is invalid.");
    }
    throwIfAborted(signal);

    if (bytes.byteLength === 0 || bytes.byteLength > maximum) {
      throw inferenceError(
        "model-byte-budget-exceeded",
        "ONNX model bytes exceed the descriptor or provider byte budget.",
      );
    }
    const digest = `sha256:${sha256HexPortable(bytes)}`;
    throwIfAborted(signal);
    if (digest !== descriptor.sha256) {
      throw inferenceError(
        "model-digest-mismatch",
        "ONNX model bytes do not match the registered SHA-256 digest.",
      );
    }
    return bytes;
  }

  private async createSession(
    runtime: StudioOnnxRuntime,
    descriptor: StudioOnnxModelDescriptor,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<CachedStudioOnnxSession> {
    throwIfAborted(signal);
    if (
      this.executionProvider === "webgpu"
      && !this.webGpuApiAvailable()
    ) {
      throw inferenceError(
        "session-create-failed",
        "The selected ONNX WebGPU execution provider is unavailable.",
      );
    }

    let session: InferenceSession;
    try {
      session = await awaitSessionWithAbort(
        runtime.InferenceSession.create(bytes, {
          executionProviders:
            this.executionProvider === "webgpu"
              ? [{ name: "webgpu", validationMode: "basic" }]
              : ["wasm"],
          graphOptimizationLevel: "all",
          executionMode: "sequential",
        }),
        signal,
      );
    } catch (cause) {
      if (signal?.aborted || isAbortError(cause)) throw abortedError();
      throw inferenceError(
        "session-create-failed",
        `ONNX Runtime could not create the selected ${this.executionProvider} session.`,
        cause,
      );
    }

    if (signal?.aborted || this.isDestroyed) {
      await session.release();
      if (signal?.aborted) throw abortedError();
      throw inferenceError("disposed", "The ONNX provider was disposed while loading.");
    }

    const expectedInputs = descriptor.inputs.map(({ name }) => name);
    const expectedOutputs = descriptor.outputs.map(({ name }) => name);
    if (
      !expectedInputs.every((name) => session.inputNames.includes(name)) ||
      !expectedOutputs.every((name) => session.outputNames.includes(name))
    ) {
      await session.release();
      throw inferenceError(
        "model-schema-mismatch",
        "ONNX session input/output names do not match the registered descriptor.",
      );
    }

    return {
      descriptor,
      runtime,
      session,
      receipt: freezeReceipt({
        descriptor,
        byteLength: bytes.byteLength,
        executionProvider: this.executionProvider,
      }),
      activeLeases: 0,
      idleResolvers: [],
    };
  }

  private async ensureSession(
    descriptor: StudioOnnxModelDescriptor,
    source: StudioOnnxModelSource | undefined,
    signal?: AbortSignal,
  ): Promise<CachedStudioOnnxSession> {
    this.assertAlive();
    throwIfAborted(signal);
    const key = studioOnnxModelKey(descriptor.id, descriptor.version);
    const cached = this.sessions.get(key);
    if (cached) return cached;
    if (!source) {
      throw inferenceError(
        "model-source-required",
        "The ONNX model must be loaded before inference or supplied with the request.",
      );
    }

    const bytes = await this.modelBytes(descriptor, source, signal);
    const runtime = await awaitWithAbort(this.loadRuntime(), signal);
    throwIfAborted(signal);
    const created = await this.createSession(runtime, descriptor, bytes, signal);
    const winner = this.sessions.get(key);
    if (winner) {
      await created.session.release();
      return winner;
    }
    if (this.isDestroyed) {
      await created.session.release();
      throw inferenceError("disposed", "The ONNX provider was disposed while loading.");
    }
    this.sessions.set(key, created);
    return created;
  }

  private async acquireSession(
    descriptor: StudioOnnxModelDescriptor,
    source: StudioOnnxModelSource | undefined,
    signal?: AbortSignal,
  ): Promise<CachedStudioOnnxSession> {
    this.assertAlive();
    throwIfAborted(signal);
    const key = studioOnnxModelKey(descriptor.id, descriptor.version);
    const cached = this.sessions.get(key);
    if (cached) {
      cached.activeLeases += 1;
      this.activeInferenceCount += 1;
      return cached;
    }
    if (!source) {
      throw inferenceError(
        "model-source-required",
        "The ONNX model must be loaded before inference or supplied with the request.",
      );
    }

    const bytes = await this.modelBytes(descriptor, source, signal);
    const runtime = await awaitWithAbort(this.loadRuntime(), signal);
    throwIfAborted(signal);
    const created = await this.createSession(runtime, descriptor, bytes, signal);
    const winner = this.sessions.get(key);
    const leased = winner ?? created;
    if (winner) {
      await created.session.release();
    } else {
      if (this.isDestroyed) {
        await created.session.release();
        throw inferenceError("disposed", "The ONNX provider was disposed while loading.");
      }
      this.sessions.set(key, created);
    }
    leased.activeLeases += 1;
    this.activeInferenceCount += 1;
    return leased;
  }

  private releaseSessionLease(cached: CachedStudioOnnxSession): void {
    cached.activeLeases -= 1;
    this.activeInferenceCount -= 1;
    if (cached.activeLeases === 0) {
      for (const resolve of cached.idleResolvers.splice(0)) resolve();
    }
    if (this.activeInferenceCount === 0) {
      for (const resolve of this.idleResolvers.splice(0)) resolve();
    }
  }

  private preflightOutputs(descriptor: StudioOnnxModelDescriptor): void {
    let totalBytes = 0;
    for (const schema of descriptor.outputs) {
      let elements: number;
      try {
        elements = studioOnnxTensorElementCount(schema.shape);
      } catch (cause) {
        throw inferenceError(
          "tensor-budget-exceeded",
          `ONNX output "${schema.name}" has an unsafe shape.`,
          cause,
        );
      }
      const bytes = elements * studioOnnxElementByteLength(schema.elementType);
      if (
        elements > this.budgets.maxTensorElements
        || bytes > this.budgets.maxTensorBytes
      ) {
        throw inferenceError(
          "tensor-budget-exceeded",
          `ONNX output "${schema.name}" exceeds its pre-materialization budget.`,
        );
      }
      totalBytes += bytes;
      if (
        !Number.isSafeInteger(totalBytes)
        || totalBytes > this.budgets.maxResultBytes
      ) {
        throw inferenceError(
          "tensor-budget-exceeded",
          "ONNX outputs exceed the aggregate pre-materialization result budget.",
        );
      }
    }
  }

  async loadModel(
    request: StudioOnnxLoadModelRequest,
  ): Promise<StudioOnnxSessionReceipt> {
    if (!request || typeof request !== "object") {
      throw inferenceError("invalid-input", "ONNX model load request is invalid.");
    }
    const modelId = ownDataValue(request, "modelId", "invalid-input", true);
    const version = ownDataValue(request, "version", "invalid-input", true);
    const source = ownDataValue(request, "source", "invalid-input", true);
    const signalValue = ownDataValue(request, "signal");
    if (
      typeof modelId !== "string"
      || typeof version !== "string"
      || !source
      || typeof source !== "object"
      || (
        signalValue !== undefined
        && (
          typeof AbortSignal === "undefined"
          || !(signalValue instanceof AbortSignal)
        )
      )
    ) {
      throw inferenceError("invalid-input", "ONNX model load request is invalid.");
    }
    const descriptor = this.descriptor(modelId, version);
    const cached = await this.ensureSession(
      descriptor,
      source as StudioOnnxModelSource,
      signalValue as AbortSignal | undefined,
    );
    return cached.receipt;
  }

  private snapshotInputs(
    descriptor: StudioOnnxModelDescriptor,
    inputs: readonly StudioOnnxTensorValue[],
  ): readonly StudioOnnxTensorValue[] {
    if (!Array.isArray(inputs) || inputs.length !== descriptor.inputs.length) {
      throw inferenceError(
        "invalid-input",
        "ONNX inference input count does not match the model descriptor.",
      );
    }
    const snapshots = ownArrayValues(inputs, "inputs").map(
      (input, index): StudioOnnxTensorValue => {
      if (!input || typeof input !== "object") {
        throw inferenceError("invalid-input", `ONNX input ${index} is invalid.`);
      }
      const name = ownDataValue(input, "name", "invalid-input", true);
      const elementType = ownDataValue(
        input,
        "elementType",
        "invalid-input",
        true,
      );
      const dims = ownDataValue(input, "dims", "invalid-input", true);
      const data = ownDataValue(input, "data", "invalid-input", true);
      if (
        typeof name !== "string"
        || typeof elementType !== "string"
        || !Array.isArray(dims)
        || !ArrayBuffer.isView(data)
      ) {
        throw inferenceError("invalid-input", `ONNX input ${index} is invalid.`);
      }
      const dimensionValues = ownArrayValues(dims, `inputs[${index}].dims`);
      const snapshot: StudioOnnxTensorValue = {
        name,
        elementType: elementType as StudioOnnxTensorElementType,
        dims: Object.freeze(dimensionValues as number[]),
        data: data as StudioOnnxTensorData,
      };
      const schema = descriptor.inputs.find((candidate) => candidate.name === name);
      if (!schema) {
        throw inferenceError("invalid-input", `Unknown ONNX input "${name}".`);
      }
      validateTensorValue(snapshot, schema, this.budgets, "invalid-input");
      return snapshot;
      },
    );
    const byName = new Map(snapshots.map((input) => [input.name, input]));
    if (byName.size !== inputs.length) {
      throw inferenceError("invalid-input", "ONNX inference input names must be unique.");
    }

    let totalBytes = 0;
    for (const schema of descriptor.inputs) {
      const input = byName.get(schema.name);
      if (!input) {
        throw inferenceError(
          "invalid-input",
          `Missing ONNX inference input "${schema.name}".`,
        );
      }
      totalBytes += validateTensorValue(
        input,
        schema,
        this.budgets,
        "invalid-input",
      );
      if (totalBytes > this.budgets.maxRequestInputBytes) {
        throw inferenceError(
          "tensor-budget-exceeded",
          "ONNX inference inputs exceed the aggregate request byte budget.",
        );
      }
    }
    return Object.freeze(snapshots.map((snapshot) => Object.freeze({
      ...snapshot,
      data: copyRuntimeTensorData(snapshot.elementType, snapshot.data),
    })));
  }

  private async copyOutputs(
    descriptor: StudioOnnxModelDescriptor,
    rawOutputs: InferenceSession.ReturnType,
  ): Promise<Readonly<Record<string, StudioOnnxTensorValue>>> {
    const copied: Record<string, StudioOnnxTensorValue> = Object.create(null);
    let totalBytes = 0;
    for (const schema of descriptor.outputs) {
      const raw = rawOutputs[schema.name];
      if (!tensorLike(raw)) {
        throw inferenceError(
          "malformed-output",
          `Missing or non-tensor ONNX output "${schema.name}".`,
        );
      }
      const elementType = runtimeTensorElementType(raw.type);
      if (
        elementType === null ||
        elementType !== schema.elementType ||
        !sameShape(raw.dims, schema.shape)
      ) {
        throw inferenceError(
          "malformed-output",
          `ONNX output "${schema.name}" does not match its declared type or dimensions.`,
        );
      }
      const runtimeData = await raw.getData(true);
      const expectedElements = studioOnnxTensorElementCount(schema.shape);
      const expectedBytes =
        expectedElements * studioOnnxElementByteLength(elementType);
      const typedRuntimeData = runtimeData as StudioOnnxTensorData;
      if (
        !tensorDataMatchesElementType(
          elementType,
          typedRuntimeData,
        )
        || runtimeData.length !== expectedElements
        || typedRuntimeData.byteLength !== expectedBytes
      ) {
        throw inferenceError(
          "malformed-output",
          `ONNX output "${schema.name}" returned an invalid data buffer.`,
        );
      }
      const data = copyRuntimeTensorData(elementType, runtimeData);
      const value: StudioOnnxTensorValue = {
        name: schema.name,
        elementType,
        dims: Object.freeze([...raw.dims]),
        data,
      };
      totalBytes += validateTensorValue(
        value,
        schema,
        this.budgets,
        "malformed-output",
      );
      if (totalBytes > this.budgets.maxResultBytes) {
        throw inferenceError(
          "tensor-budget-exceeded",
          "ONNX outputs exceed the aggregate result byte budget.",
        );
      }
      copied[schema.name] = Object.freeze(value);
    }
    return Object.freeze(copied);
  }

  async infer(
    request: StudioOnnxInferenceRequest,
  ): Promise<StudioOnnxInferenceResult> {
    this.assertAlive();
    if (!request || typeof request !== "object") {
      throw inferenceError("invalid-input", "ONNX inference request is invalid.");
    }
    const modelId = ownDataValue(request, "modelId", "invalid-input", true);
    const version = ownDataValue(request, "version", "invalid-input", true);
    const source = ownDataValue(request, "source") as
      StudioOnnxModelSource | undefined;
    const epochValue = ownDataValue(request, "epoch", "invalid-input", true);
    const inputsValue = ownDataValue(request, "inputs", "invalid-input", true);
    const signalValue = ownDataValue(request, "signal");
    if (
      typeof modelId !== "string"
      || typeof version !== "string"
      || !epochValue
      || typeof epochValue !== "object"
      || !Array.isArray(inputsValue)
      || (
        signalValue !== undefined
        && (
          typeof AbortSignal === "undefined"
          || !(signalValue instanceof AbortSignal)
        )
      )
    ) {
      throw inferenceError("invalid-input", "ONNX inference request is invalid.");
    }
    const epoch: StudioOnnxEpoch = {
      request: ownDataValue(epochValue, "request", "invalid-epoch", true) as number,
      stroke: ownDataValue(epochValue, "stroke", "invalid-epoch", true) as number,
      document: ownDataValue(epochValue, "document", "invalid-epoch", true) as number,
    };
    const signal = signalValue as AbortSignal | undefined;
    this.assertCurrentEpoch(epoch);
    throwIfAborted(signal);
    const descriptor = this.descriptor(modelId, version);
    const inputs = this.snapshotInputs(descriptor, inputsValue);
    const cached = await this.acquireSession(
      descriptor,
      source,
      signal,
    );
    try {
      this.assertCurrentEpoch(epoch);
      throwIfAborted(signal);
      this.assertAlive();
      this.preflightOutputs(descriptor);
      const feeds: InferenceSession.FeedsType = Object.create(null);
      const inputTensors: Tensor[] = [];
      let rawOutputs: InferenceSession.ReturnType;
      try {
        for (const input of inputs) {
          const tensor = createRuntimeTensor(cached.runtime, input);
          inputTensors.push(tensor);
          (feeds as Record<string, Tensor>)[input.name] = tensor;
        }
        rawOutputs = await cached.session.run(
          feeds,
          descriptor.outputs.map(({ name }) => name),
        );
      } finally {
        for (const tensor of inputTensors) tensor.dispose();
      }
      let outputs: Readonly<Record<string, StudioOnnxTensorValue>>;
      try {
        this.assertCurrentEpoch(epoch);
        throwIfAborted(signal);
        outputs = await this.copyOutputs(descriptor, rawOutputs);
        this.assertCurrentEpoch(epoch);
      } finally {
        disposeOnnxValues(rawOutputs);
      }

      return Object.freeze({
        epoch: cloneEpoch(epoch),
        receipt: cached.receipt,
        outputs,
      });
    } finally {
      this.releaseSessionLease(cached);
    }
  }

  async disposeModel(modelId: string, version: string): Promise<boolean> {
    this.assertAlive();
    const key = studioOnnxModelKey(modelId, version);
    const cached = this.sessions.get(key);
    if (!cached) return false;
    this.sessions.delete(key);
    if (cached.activeLeases > 0) {
      await new Promise<void>((resolve) => {
        cached.idleResolvers.push(resolve);
      });
    }
    await cached.session.release();
    return true;
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.isDestroyed = true;
    this.disposePromise = (async () => {
      if (this.activeInferenceCount > 0) {
        await new Promise<void>((resolve) => {
          this.idleResolvers.push(resolve);
        });
      }
      const sessions = [...this.sessions.values()];
      this.sessions.clear();
      await Promise.all(sessions.map(({ session }) => session.release()));
    })();
    return this.disposePromise;
  }
}

export function createStudioOnnxInferenceProvider(
  options: CreateStudioOnnxInferenceProviderOptions,
): StudioOnnxInferenceProvider {
  return new OnnxStudioInferenceProvider(options);
}

export interface StudioOnnxThresholdMaskOptions {
  readonly mode: "threshold";
  readonly data: Float32Array | Float64Array;
  readonly width: number;
  readonly height: number;
  readonly threshold?: number;
  readonly offset?: number;
  readonly rowStride?: number;
  readonly pixelStride?: number;
}

export interface StudioOnnxSoftmaxMaskOptions {
  readonly mode: "softmax";
  readonly data: Float32Array | Float64Array;
  readonly width: number;
  readonly height: number;
  readonly classCount: number;
  readonly targetClass: number;
  readonly probabilityThreshold?: number;
  readonly offset?: number;
  readonly rowStride?: number;
  readonly pixelStride?: number;
  readonly classStride?: number;
}

export type StudioOnnxMaskOptions =
  | StudioOnnxThresholdMaskOptions
  | StudioOnnxSoftmaxMaskOptions;

function positiveSafeInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${path} must be a positive safe integer.`);
  }
  return value;
}

function nonNegativeSafeInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${path} must be a non-negative safe integer.`);
  }
  return value;
}

function validateMaskDimensions(
  width: number,
  height: number,
): number {
  positiveSafeInteger(width, "mask.width");
  positiveSafeInteger(height, "mask.height");
  const pixels = width * height;
  if (
    !Number.isSafeInteger(pixels) ||
    pixels > STUDIO_ONNX_HARD_LIMITS.maxTensorElements
  ) {
    throw new RangeError("Mask dimensions exceed the ONNX tensor element budget.");
  }
  return pixels;
}

export function studioOnnxLogitsToUint8Mask(
  options: StudioOnnxMaskOptions,
): Uint8Array {
  const pixels = validateMaskDimensions(options.width, options.height);
  const offset = nonNegativeSafeInteger(options.offset ?? 0, "mask.offset");
  const output = new Uint8Array(pixels);

  if (options.mode === "threshold") {
    const pixelStride = positiveSafeInteger(
      options.pixelStride ?? 1,
      "mask.pixelStride",
    );
    const rowStride = positiveSafeInteger(
      options.rowStride ?? options.width * pixelStride,
      "mask.rowStride",
    );
    const threshold = options.threshold ?? 0;
    if (!Number.isFinite(threshold)) {
      throw new RangeError("mask.threshold must be finite.");
    }
    const lastIndex =
      offset +
      (options.height - 1) * rowStride +
      (options.width - 1) * pixelStride;
    if (!Number.isSafeInteger(lastIndex) || lastIndex >= options.data.length) {
      throw new RangeError("Threshold mask dimensions and strides exceed its data.");
    }

    let outputIndex = 0;
    for (let y = 0; y < options.height; y += 1) {
      for (let x = 0; x < options.width; x += 1) {
        const value = options.data[offset + y * rowStride + x * pixelStride];
        if (!Number.isFinite(value)) {
          throw new TypeError("Threshold mask logits must be finite.");
        }
        output[outputIndex] = value >= threshold ? 255 : 0;
        outputIndex += 1;
      }
    }
    return output;
  }

  const classCount = positiveSafeInteger(
    options.classCount,
    "mask.classCount",
  );
  const targetClass = nonNegativeSafeInteger(
    options.targetClass,
    "mask.targetClass",
  );
  if (targetClass >= classCount) {
    throw new RangeError("mask.targetClass must be smaller than classCount.");
  }
  const classStride = positiveSafeInteger(
    options.classStride ?? 1,
    "mask.classStride",
  );
  const pixelStride = positiveSafeInteger(
    options.pixelStride ?? classCount * classStride,
    "mask.pixelStride",
  );
  const rowStride = positiveSafeInteger(
    options.rowStride ?? options.width * pixelStride,
    "mask.rowStride",
  );
  const probabilityThreshold = options.probabilityThreshold ?? 0.5;
  if (
    !Number.isFinite(probabilityThreshold) ||
    probabilityThreshold < 0 ||
    probabilityThreshold > 1
  ) {
    throw new RangeError("mask.probabilityThreshold must be in the range 0..1.");
  }
  const lastIndex =
    offset +
    (options.height - 1) * rowStride +
    (options.width - 1) * pixelStride +
    (classCount - 1) * classStride;
  if (!Number.isSafeInteger(lastIndex) || lastIndex >= options.data.length) {
    throw new RangeError("Softmax mask dimensions and strides exceed its data.");
  }

  let outputIndex = 0;
  for (let y = 0; y < options.height; y += 1) {
    for (let x = 0; x < options.width; x += 1) {
      const base = offset + y * rowStride + x * pixelStride;
      let maximum = Number.NEGATIVE_INFINITY;
      for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
        const value = options.data[base + classIndex * classStride];
        if (!Number.isFinite(value)) {
          throw new TypeError("Softmax mask logits must be finite.");
        }
        maximum = Math.max(maximum, value);
      }
      let denominator = 0;
      let targetExponent = 0;
      for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
        const exponent = Math.exp(
          options.data[base + classIndex * classStride] - maximum,
        );
        denominator += exponent;
        if (classIndex === targetClass) targetExponent = exponent;
      }
      output[outputIndex] =
        targetExponent / denominator >= probabilityThreshold ? 255 : 0;
      outputIndex += 1;
    }
  }
  return output;
}
