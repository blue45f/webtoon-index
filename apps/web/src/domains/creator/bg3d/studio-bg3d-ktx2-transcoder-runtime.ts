import {
  admitStudioBg3dKtx2Transcode,
  attestStudioBg3dKtx2TranscoderAssets,
  STUDIO_BG3D_KTX2_TRANSCODE_MAX_SOURCE_BYTES,
  type StudioBg3dAttestedKtx2Transcoder,
  type StudioBg3dKtx2Digest,
  type StudioBg3dKtx2TranscoderAssets,
} from "./studio-bg3d-ktx2-transcoder-contract";

const RGBA32_TRANSCODER_FORMAT = 13;
const FNV1A_OFFSET_BASIS = 0x811c9dc5;
const FNV1A_PRIME = 0x01000193;

interface StudioBasisKtx2File {
  close(): void;
  delete(): void;
  getFaces(): number;
  getHeight(): number;
  getImageTranscodedSizeInBytes(
    level: number,
    layer: number,
    face: number,
    format: number,
  ): number;
  getLayers(): number;
  getLevels(): number;
  getWidth(): number;
  isETC1S(): boolean;
  isUASTC(): boolean;
  isValid(): boolean;
  startTranscoding(): number;
  transcodeImage(
    destination: Uint8Array,
    level: number,
    layer: number,
    face: number,
    format: number,
    unused: number,
    getAlphaForOpaqueFormats: number,
    channel0: number,
  ): number;
}

export interface StudioBg3dBasisModule {
  readonly KTX2File: new (bytes: Uint8Array) => StudioBasisKtx2File;
  initializeBasis(): void;
}

export type StudioBg3dBasisFactory = (options: {
  readonly wasmBinary: Uint8Array;
  readonly print: () => void;
  readonly printErr: () => void;
}) => Promise<StudioBg3dBasisModule>;

export type StudioBg3dBasisFactoryEvaluator = (
  javascript: Uint8Array,
) => StudioBg3dBasisFactory;

export interface StudioBg3dKtx2TranscoderRuntimeMetrics {
  readonly generation: number;
  readonly initializedAtMs: number;
  readonly initializationDurationMs: number;
  readonly attestedAssetBytes: number;
  readonly jobsStarted: number;
  readonly jobsSucceeded: number;
  readonly jobsFailed: number;
  readonly jobsCancelled: number;
  readonly sourceBytesAdmitted: number;
  readonly decodedBytesVerified: number;
  readonly peakMipAllocationBytes: number;
  /** Conservative runtime-job peak: callback/admission/WASM source copies plus one RGBA mip. */
  readonly peakEstimatedJobHeapBytes: number;
  readonly filesCreated: number;
  readonly filesClosed: number;
  readonly filesDeleted: number;
  readonly liveFiles: number;
  readonly cleanupFailures: number;
  readonly disposed: boolean;
}

export interface StudioBg3dKtx2PretranscodeOptions {
  readonly expectedSha256?: string;
  readonly maxSourceBytes?: number;
  readonly maxDecodedBytes?: number;
  readonly digest?: StudioBg3dKtx2Digest;
  readonly signal?: AbortSignal;
}

export interface StudioBg3dKtx2PretranscodeResult {
  readonly sourceSha256: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly levelCount: number;
  readonly colorModel: "etc1s" | "uastc";
  readonly supercompression: "none" | "basis-lz" | "zstandard";
  readonly decodedByteLength: number;
  /** A bounded diagnostic over the decoded RGBA32 mip chain, not an integrity digest. */
  readonly rgba32Fnv1a: `fnv1a32:${string}`;
}

export type StudioBg3dKtx2TranscoderRuntimeErrorCode =
  | "aborted"
  | "asset-fetch"
  | "asset-integrity"
  | "disposed"
  | "invalid-payload"
  | "runtime-init"
  | "transcode-failed";

export class StudioBg3dKtx2TranscoderRuntimeError extends Error {
  constructor(readonly code: StudioBg3dKtx2TranscoderRuntimeErrorCode) {
    super(`studio-bg3d-ktx2-transcoder:${code}`);
    this.name = "StudioBg3dKtx2TranscoderRuntimeError";
  }
}

export interface CreateStudioBg3dKtx2TranscoderRuntimeOptions {
  readonly loadAssets: (signal?: AbortSignal) => Promise<StudioBg3dKtx2TranscoderAssets>;
  readonly evaluateFactory?: StudioBg3dBasisFactoryEvaluator;
  readonly digest?: StudioBg3dKtx2Digest;
  readonly generation?: number;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
}

interface MutableRuntimeMetrics {
  generation: number;
  initializedAtMs: number;
  initializationDurationMs: number;
  attestedAssetBytes: number;
  jobsStarted: number;
  jobsSucceeded: number;
  jobsFailed: number;
  jobsCancelled: number;
  sourceBytesAdmitted: number;
  decodedBytesVerified: number;
  peakMipAllocationBytes: number;
  peakEstimatedJobHeapBytes: number;
  filesCreated: number;
  filesClosed: number;
  filesDeleted: number;
  liveFiles: number;
  cleanupFailures: number;
  disposed: boolean;
}

function saturatingAdd(left: number, right: number): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || right < 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  return left > Number.MAX_SAFE_INTEGER - right ? Number.MAX_SAFE_INTEGER : left + right;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new StudioBg3dKtx2TranscoderRuntimeError("aborted");
}

function expectedRgba32MipBytes(width: number, height: number, level: number): number {
  return Math.max(1, Math.floor(width / (2 ** level)))
    * Math.max(1, Math.floor(height / (2 ** level)))
    * 4;
}

function appendFnv1a(checksum: number, bytes: Uint8Array): number {
  let next = checksum >>> 0;
  for (const byte of bytes) next = Math.imul((next ^ byte) >>> 0, FNV1A_PRIME) >>> 0;
  return next;
}

function isBasisModule(value: unknown): value is StudioBg3dBasisModule {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StudioBg3dBasisModule>;
  return typeof candidate.KTX2File === "function" && typeof candidate.initializeBasis === "function";
}

/**
 * Evaluates only the exact JavaScript snapshot that already passed the pinned SHA-256 contract.
 * Environments whose CSP blocks dynamic code fail closed with `runtime-init`.
 */
export function evaluateAttestedStudioBg3dBasisFactory(
  javascript: Uint8Array,
): StudioBg3dBasisFactory {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(javascript);
  const factoryLoader = globalThis.Function(
    `"use strict";\n${source}\nreturn typeof BASIS === "function" ? BASIS : null;`,
  ) as () => unknown;
  const factory = factoryLoader();
  if (typeof factory !== "function") {
    throw new StudioBg3dKtx2TranscoderRuntimeError("runtime-init");
  }
  return factory as StudioBg3dBasisFactory;
}

export class StudioBg3dKtx2TranscoderRuntime {
  readonly #capability: StudioBg3dAttestedKtx2Transcoder;
  readonly #module: StudioBg3dBasisModule;
  readonly #metrics: MutableRuntimeMetrics;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    capability: StudioBg3dAttestedKtx2Transcoder,
    module: StudioBg3dBasisModule,
    metrics: MutableRuntimeMetrics,
  ) {
    this.#capability = capability;
    this.#module = module;
    this.#metrics = metrics;
  }

  get capability(): StudioBg3dAttestedKtx2Transcoder {
    return this.#capability;
  }

  get metrics(): StudioBg3dKtx2TranscoderRuntimeMetrics {
    return Object.freeze({ ...this.#metrics });
  }

  pretranscode(
    input: Uint8Array,
    options: StudioBg3dKtx2PretranscodeOptions = {},
  ): Promise<StudioBg3dKtx2PretranscodeResult> {
    this.#metrics.jobsStarted = saturatingAdd(this.#metrics.jobsStarted, 1);
    if (!(input instanceof Uint8Array)) {
      this.#metrics.jobsFailed = saturatingAdd(this.#metrics.jobsFailed, 1);
      return Promise.reject(new StudioBg3dKtx2TranscoderRuntimeError("invalid-payload"));
    }
    const configuredSourceLimit = options.maxSourceBytes;
    if (
      input.byteLength < 1 || input.byteLength > STUDIO_BG3D_KTX2_TRANSCODE_MAX_SOURCE_BYTES ||
      (
        configuredSourceLimit !== undefined &&
        (
          !Number.isSafeInteger(configuredSourceLimit) || configuredSourceLimit < 1 ||
          input.byteLength > configuredSourceLimit
        )
      )
    ) {
      this.#metrics.jobsFailed = saturatingAdd(this.#metrics.jobsFailed, 1);
      return Promise.reject(new StudioBg3dKtx2TranscoderRuntimeError("invalid-payload"));
    }
    // Own bytes at enqueue time. A caller cannot change the job while it waits behind another mip
    // chain, and admission will take the second private snapshot it hashes.
    const snapshot = Uint8Array.from(input);
    const jobOptions = Object.freeze({ ...options });
    const execute = () => this.#pretranscodeNow(snapshot, jobOptions);
    const job = this.#queue.then(execute, execute);
    this.#queue = job.then(() => undefined, () => undefined);
    return job;
  }

  dispose(): void {
    this.#metrics.disposed = true;
  }

  async #pretranscodeNow(
    input: Uint8Array,
    options: StudioBg3dKtx2PretranscodeOptions,
  ): Promise<StudioBg3dKtx2PretranscodeResult> {
    let file: StudioBasisKtx2File | null = null;
    let result: StudioBg3dKtx2PretranscodeResult | null = null;
    let failure: StudioBg3dKtx2TranscoderRuntimeError | null = null;
    try {
      if (this.#metrics.disposed) {
        throw new StudioBg3dKtx2TranscoderRuntimeError("disposed");
      }
      throwIfAborted(options.signal);
      const admission = await admitStudioBg3dKtx2Transcode(input, {
        capability: this.#capability,
        expectedSha256: options.expectedSha256,
        maxSourceBytes: options.maxSourceBytes,
        maxDecodedBytes: options.maxDecodedBytes,
        digest: options.digest,
      });
      throwIfAborted(options.signal);
      if (this.#metrics.disposed) {
        throw new StudioBg3dKtx2TranscoderRuntimeError("disposed");
      }
      if (!admission) throw new StudioBg3dKtx2TranscoderRuntimeError("invalid-payload");

      this.#metrics.sourceBytesAdmitted = saturatingAdd(
        this.#metrics.sourceBytesAdmitted,
        admission.sourceByteLength,
      );
      file = new this.#module.KTX2File(admission.copyVerifiedSource());
      this.#metrics.filesCreated = saturatingAdd(this.#metrics.filesCreated, 1);
      this.#metrics.liveFiles = saturatingAdd(this.#metrics.liveFiles, 1);
      if (
        !file.isValid() || file.getFaces() !== 1 || file.getLayers() !== 0 ||
        file.getWidth() !== admission.width || file.getHeight() !== admission.height ||
        file.getLevels() !== admission.levelCount ||
        file.isETC1S() !== (admission.colorModel === "etc1s") ||
        file.isUASTC() !== (admission.colorModel === "uastc") ||
        file.startTranscoding() !== 1
      ) {
        throw new StudioBg3dKtx2TranscoderRuntimeError("transcode-failed");
      }

      let decodedByteLength = 0;
      let rgba32Fnv1a = FNV1A_OFFSET_BASIS;
      for (let level = 0; level < admission.levelCount; level += 1) {
        throwIfAborted(options.signal);
        const expectedBytes = expectedRgba32MipBytes(admission.width, admission.height, level);
        const outputBytes = file.getImageTranscodedSizeInBytes(
          level,
          0,
          0,
          RGBA32_TRANSCODER_FORMAT,
        );
        if (
          !Number.isSafeInteger(outputBytes) || outputBytes !== expectedBytes || outputBytes < 1 ||
          outputBytes > admission.estimatedDecodedBytes - decodedByteLength
        ) {
          throw new StudioBg3dKtx2TranscoderRuntimeError("transcode-failed");
        }
        this.#metrics.peakMipAllocationBytes = Math.max(
          this.#metrics.peakMipAllocationBytes,
          outputBytes,
        );
        const sourceCopies = saturatingAdd(
          saturatingAdd(admission.sourceByteLength, admission.sourceByteLength),
          admission.sourceByteLength,
        );
        this.#metrics.peakEstimatedJobHeapBytes = Math.max(
          this.#metrics.peakEstimatedJobHeapBytes,
          saturatingAdd(sourceCopies, outputBytes),
        );
        const output = new Uint8Array(outputBytes);
        if (
          file.transcodeImage(
            output,
            level,
            0,
            0,
            RGBA32_TRANSCODER_FORMAT,
            0,
            -1,
            -1,
          ) !== 1
        ) {
          throw new StudioBg3dKtx2TranscoderRuntimeError("transcode-failed");
        }
        rgba32Fnv1a = appendFnv1a(rgba32Fnv1a, output);
        decodedByteLength += outputBytes;
      }
      throwIfAborted(options.signal);
      if (decodedByteLength !== admission.estimatedDecodedBytes) {
        throw new StudioBg3dKtx2TranscoderRuntimeError("transcode-failed");
      }
      this.#metrics.decodedBytesVerified = saturatingAdd(
        this.#metrics.decodedBytesVerified,
        decodedByteLength,
      );
      this.#metrics.jobsSucceeded = saturatingAdd(this.#metrics.jobsSucceeded, 1);
      result = Object.freeze({
        sourceSha256: admission.sourceSha256,
        width: admission.width,
        height: admission.height,
        levelCount: admission.levelCount,
        colorModel: admission.colorModel,
        supercompression: admission.supercompression,
        decodedByteLength,
        rgba32Fnv1a: `fnv1a32:${rgba32Fnv1a.toString(16).padStart(8, "0")}`,
      });
    } catch (error) {
      if (
        error instanceof StudioBg3dKtx2TranscoderRuntimeError &&
        error.code === "aborted"
      ) {
        this.#metrics.jobsCancelled = saturatingAdd(this.#metrics.jobsCancelled, 1);
      } else {
        this.#metrics.jobsFailed = saturatingAdd(this.#metrics.jobsFailed, 1);
      }
      failure = error instanceof StudioBg3dKtx2TranscoderRuntimeError
        ? error
        : new StudioBg3dKtx2TranscoderRuntimeError("transcode-failed");
    }

    let cleanupFailed = false;
    if (file) {
      try {
        file.close();
        this.#metrics.filesClosed = saturatingAdd(this.#metrics.filesClosed, 1);
      } catch {
        cleanupFailed = true;
        this.#metrics.cleanupFailures = saturatingAdd(this.#metrics.cleanupFailures, 1);
      }
      try {
        file.delete();
        this.#metrics.filesDeleted = saturatingAdd(this.#metrics.filesDeleted, 1);
      } catch {
        cleanupFailed = true;
        this.#metrics.cleanupFailures = saturatingAdd(this.#metrics.cleanupFailures, 1);
      }
      this.#metrics.liveFiles = Math.max(0, this.#metrics.liveFiles - 1);
    }
    if (cleanupFailed) {
      // A failed Embind cleanup poisons this WASM heap. Stop admitting work; the Worker caller will
      // surface a fatal error and recreate the realm rather than accumulate leaked decoder files.
      this.#metrics.disposed = true;
      if (result) {
        this.#metrics.jobsSucceeded = Math.max(0, this.#metrics.jobsSucceeded - 1);
        this.#metrics.jobsFailed = saturatingAdd(this.#metrics.jobsFailed, 1);
        result = null;
      }
      failure ??= new StudioBg3dKtx2TranscoderRuntimeError("transcode-failed");
    }
    if (failure) throw failure;
    if (!result) throw new StudioBg3dKtx2TranscoderRuntimeError("transcode-failed");
    return result;
  }
}

export async function createStudioBg3dKtx2TranscoderRuntime(
  options: CreateStudioBg3dKtx2TranscoderRuntimeOptions,
): Promise<StudioBg3dKtx2TranscoderRuntime> {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  throwIfAborted(options.signal);

  let assets: StudioBg3dKtx2TranscoderAssets;
  try {
    assets = await options.loadAssets(options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw new StudioBg3dKtx2TranscoderRuntimeError("aborted");
    if (error instanceof StudioBg3dKtx2TranscoderRuntimeError) throw error;
    throw new StudioBg3dKtx2TranscoderRuntimeError("asset-fetch");
  }
  throwIfAborted(options.signal);
  const capability = await attestStudioBg3dKtx2TranscoderAssets(assets, options.digest);
  throwIfAborted(options.signal);
  if (!capability) throw new StudioBg3dKtx2TranscoderRuntimeError("asset-integrity");

  try {
    const verifiedAssets = capability.copyVerifiedAssets();
    const factory = (options.evaluateFactory ?? evaluateAttestedStudioBg3dBasisFactory)(
      verifiedAssets.javascript,
    );
    const module = await factory({
      wasmBinary: verifiedAssets.wasm,
      print: () => undefined,
      printErr: () => undefined,
    });
    throwIfAborted(options.signal);
    if (!isBasisModule(module)) {
      throw new StudioBg3dKtx2TranscoderRuntimeError("runtime-init");
    }
    module.initializeBasis();
    const finishedAt = now();
    const generation = options.generation ?? 1;
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new StudioBg3dKtx2TranscoderRuntimeError("runtime-init");
    }
    return new StudioBg3dKtx2TranscoderRuntime(capability, module, {
      generation,
      initializedAtMs: finishedAt,
      initializationDurationMs: Math.max(0, finishedAt - startedAt),
      attestedAssetBytes: verifiedAssets.javascript.byteLength + verifiedAssets.wasm.byteLength,
      jobsStarted: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      jobsCancelled: 0,
      sourceBytesAdmitted: 0,
      decodedBytesVerified: 0,
      peakMipAllocationBytes: 0,
      peakEstimatedJobHeapBytes: 0,
      filesCreated: 0,
      filesClosed: 0,
      filesDeleted: 0,
      liveFiles: 0,
      cleanupFailures: 0,
      disposed: false,
    });
  } catch (error) {
    if (options.signal?.aborted) throw new StudioBg3dKtx2TranscoderRuntimeError("aborted");
    if (error instanceof StudioBg3dKtx2TranscoderRuntimeError) throw error;
    throw new StudioBg3dKtx2TranscoderRuntimeError("runtime-init");
  }
}
