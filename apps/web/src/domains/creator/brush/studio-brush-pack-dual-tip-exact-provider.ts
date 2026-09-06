/**
 * Upper brush-pack provider boundary for exact dual-tip execution.
 *
 * The CPU f32 oracle may plan and validate the packed deposition stream, but it has no pixel or
 * save authority in this WebGPU-selected provider. CPU pixel execution is exposed through a
 * separate API that callers must select before work begins. Version 1 independent-mask plans are
 * intentionally absent from this product route.
 */

import {
  STUDIO_DUAL_TIP_CONTRACT_ID,
  STUDIO_DUAL_TIP_PACKED_LAYOUT,
  STUDIO_DUAL_TIP_PACKED_STRIDE,
} from "../studio-dual-brush-tip-engine";

import {
  materializeStudioBrushPackDualTipR8,
  renderStudioBrushPackDualTipIfConfigured,
} from "./studio-brush-pack-runtime";
import {
  encodeStudioBrushTipAlphaMapBase64,
} from "./studio-brush-tip-stamp";

import type {
  StudioBrushPackDualTipRenderInput,
  StudioBrushPackSelection,
} from "./studio-brush-pack-runtime";
import type {
  StudioDualTipArtifact,
  StudioDualTipExactPorterDuff,
  StudioDualTipPackedCommands,
  StudioDualTipReceipt,
} from "../studio-dual-brush-tip-engine";
import type {
  StudioDynamicDualTipExactPlanV2,
  StudioDynamicDualTipExactR8AssetInputV2,
  StudioDynamicDualTipExactWebGpuExecutionResultV2,
  StudioDynamicDualTipExactWebGpuReceiptV2,
  StudioDynamicDualTipExactWebGpuRuntimeV2,
} from "../studio-dynamic-dual-tip-webgpu-runtime-v2";

export const STUDIO_BRUSH_PACK_DUAL_TIP_EXACT_PROVIDER_VERSION = 2 as const;
export const STUDIO_BRUSH_PACK_DUAL_TIP_EXACT_REPLAY_VERSION = 2 as const;
export const STUDIO_BRUSH_PACK_DUAL_TIP_CPU_REFERENCE_EVIDENCE_VERSION = 1 as const;
export const STUDIO_BRUSH_PACK_DUAL_TIP_EXPLICIT_CPU_RECEIPT_VERSION = 1 as const;

const MAX_REPLAY_BASE64_CODE_UNITS = 32 * 1024 * 1024;
const MAX_REPLAY_DEPOSITIONS = 65_536;
const MAX_IDENTIFIER_CHARACTERS = 256;

type ExactRuntimeModule = typeof import("../studio-dynamic-dual-tip-webgpu-runtime-v2");

export interface StudioBrushPackDualTipExactProviderOptions {
  readonly device: GPUDevice | null;
  readonly width: number;
  readonly height: number;
  readonly initialDeviceEpoch?: number;
  readonly maximumDepositions?: number;
  readonly maximumResidentAssetBytes?: number;
  readonly ownsDevice?: boolean;
  readonly moduleLoader?: () => Promise<ExactRuntimeModule>;
}

export interface StudioBrushPackDualTipExactExecution {
  readonly mode: "append" | "rebuild";
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly strokeId: string;
  readonly commandSequence: number;
  readonly porterDuff?: StudioDualTipExactPorterDuff;
}

export type StudioBrushPackDualTipExactUnavailableReason =
  | "webgpu-unavailable"
  | "module-load-failed"
  | "runtime-initialization-failed"
  | "unsupported-plan"
  | "resident-asset-budget"
  | "request-limit"
  | "device-lost"
  | "provider-failed"
  | "disposed";

export interface StudioBrushPackDualTipCpuReferenceEvidence {
  readonly kind: "studio-brush-pack-dual-tip-cpu-reference-evidence";
  readonly version: typeof STUDIO_BRUSH_PACK_DUAL_TIP_CPU_REFERENCE_EVIDENCE_VERSION;
  readonly providerVersion: typeof STUDIO_BRUSH_PACK_DUAL_TIP_EXACT_PROVIDER_VERSION;
  readonly executionRoute: "cpu-f32-oracle-reference";
  readonly purpose: "plan-validation-and-qa-reference";
  readonly authority: "none";
  readonly pixelAuthority: false;
  readonly saveAuthority: false;
  readonly providerSelection: "not-selected";
  readonly alphaContract: "premultiplied-linear-rgba-f32";
  readonly packedCommandContract: "gpu-wasm-ready-f32-v1";
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly commandSequence: number;
  readonly porterDuff: StudioDualTipExactPorterDuff;
  readonly stampCount: number;
  readonly width: number;
  readonly height: number;
  readonly oracleContract: Omit<StudioDualTipReceipt, "authority">;
  readonly complete: true;
}

export interface StudioBrushPackDualTipExplicitCpuReceipt {
  readonly kind: "studio-brush-pack-dual-tip-explicit-cpu-receipt";
  readonly version: typeof STUDIO_BRUSH_PACK_DUAL_TIP_EXPLICIT_CPU_RECEIPT_VERSION;
  readonly providerVersion: typeof STUDIO_BRUSH_PACK_DUAL_TIP_EXACT_PROVIDER_VERSION;
  readonly executionRoute: "cpu-f32-oracle-explicit";
  readonly providerSelection: "explicit-before-execution";
  readonly authority: "cpu-f32-oracle";
  readonly cpuReceipt: StudioDualTipReceipt;
  readonly complete: true;
}

export type StudioBrushPackDualTipExplicitCpuResult =
  | Readonly<{ status: "not-configured" }>
  | Readonly<{ status: "rejected"; reason: "cpu-oracle-rejected" }>
  | Readonly<{
      status: "cpu-explicit";
      artifact: StudioDualTipArtifact;
      receipt: StudioBrushPackDualTipExplicitCpuReceipt;
    }>;

export interface StudioBrushPackDualTipExactReplayAsset {
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
  readonly channel: "alpha";
  readonly encoding: "base64-r8-row-major";
  readonly bytesBase64: string;
}

export interface StudioBrushPackDualTipExactReplay {
  readonly kind: "studio-brush-pack-dual-tip-exact-replay";
  readonly version: typeof STUDIO_BRUSH_PACK_DUAL_TIP_EXACT_REPLAY_VERSION;
  readonly executionRoute: "webgpu-exact-packed-deposition-v2";
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly commandSequence: number;
  readonly porterDuff: StudioDualTipExactPorterDuff;
  readonly primaryAsset: StudioBrushPackDualTipExactReplayAsset;
  readonly secondaryAsset: StudioBrushPackDualTipExactReplayAsset;
  readonly commands: StudioDualTipPackedCommands;
  /** Non-authoritative planning/QA evidence; CPU pixels are never serialized into this replay. */
  readonly cpuReferenceEvidence: StudioBrushPackDualTipCpuReferenceEvidence;
  readonly exactPlanFingerprint: `sha256:${string}`;
}

export interface StudioBrushPackDualTipExactCompletionReceipt {
  readonly kind: "studio-brush-pack-dual-tip-exact-completion-receipt";
  readonly version: typeof STUDIO_BRUSH_PACK_DUAL_TIP_EXACT_PROVIDER_VERSION;
  readonly executionRoute: "webgpu-exact-packed-deposition-v2";
  readonly gpu: StudioDynamicDualTipExactWebGpuReceiptV2;
  /** QA/reference evidence only. It cannot authorize pixels, save output, or recovery. */
  readonly cpuReferenceEvidence: StudioBrushPackDualTipCpuReferenceEvidence;
  readonly replayFingerprint: `sha256:${string}`;
  readonly complete: true;
}

export type StudioBrushPackDualTipExactProviderResult =
  | Readonly<{ status: "not-configured" }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-execution" | "cpu-oracle-rejected" | "invalid-replay";
    }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{
      status: "webgpu-exact";
      plan: StudioDynamicDualTipExactPlanV2;
      replay: StudioBrushPackDualTipExactReplay;
      receipt: StudioBrushPackDualTipExactCompletionReceipt;
    }>
  | Readonly<{
      status: "unavailable";
      reason: StudioBrushPackDualTipExactUnavailableReason;
      referenceEvidence: StudioBrushPackDualTipCpuReferenceEvidence;
    }>;

export type StudioBrushPackDualTipExactProviderCreationResult =
  | Readonly<{
      status: "ready";
      provider: StudioBrushPackDualTipExactProvider;
      webGpu: "ready";
    }>
  | Readonly<{
      status: "unavailable";
      reason:
        | "webgpu-unavailable"
        | "module-load-failed"
        | "runtime-initialization-failed";
    }>
  | Readonly<{ status: "rejected"; reason: "invalid-options" }>;

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_CHARACTERS;
}

function validExecution(
  execution: StudioBrushPackDualTipExactExecution,
): boolean {
  return Boolean(
    execution
    && (execution.mode === "append" || execution.mode === "rebuild")
    && positiveSafeInteger(execution.requestSequence)
    && positiveSafeInteger(execution.deviceEpoch)
    && validIdentifier(execution.strokeId)
    && positiveSafeInteger(execution.commandSequence)
    && (
      execution.porterDuff === undefined
      || execution.porterDuff === "source-over"
      || execution.porterDuff === "destination-out"
    ),
  );
}

function referenceEvidence(
  execution: StudioBrushPackDualTipExactExecution,
  artifact: StudioDualTipArtifact,
): StudioBrushPackDualTipCpuReferenceEvidence {
  const { authority: _authority, ...oracleContract } = artifact.receipt;
  void _authority;
  return Object.freeze({
    kind: "studio-brush-pack-dual-tip-cpu-reference-evidence",
    version: STUDIO_BRUSH_PACK_DUAL_TIP_CPU_REFERENCE_EVIDENCE_VERSION,
    providerVersion: STUDIO_BRUSH_PACK_DUAL_TIP_EXACT_PROVIDER_VERSION,
    executionRoute: "cpu-f32-oracle-reference",
    purpose: "plan-validation-and-qa-reference",
    authority: "none",
    pixelAuthority: false,
    saveAuthority: false,
    providerSelection: "not-selected",
    alphaContract: "premultiplied-linear-rgba-f32",
    packedCommandContract: "gpu-wasm-ready-f32-v1",
    mode: execution.mode,
    strokeId: execution.strokeId,
    commandSequence: execution.commandSequence,
    porterDuff: execution.porterDuff ?? "source-over",
    stampCount: artifact.stampCount,
    width: artifact.width,
    height: artifact.height,
    oracleContract: Object.freeze(oracleContract),
    complete: true,
  });
}

/** Explicit CPU provider API. Callers must choose this route before the operation begins. */
export function executeStudioBrushPackDualTipWithExplicitCpuProvider(
  selection: StudioBrushPackSelection,
  input: StudioBrushPackDualTipRenderInput,
): StudioBrushPackDualTipExplicitCpuResult {
  const cpu = renderStudioBrushPackDualTipIfConfigured(selection, input);
  if (cpu === null) return Object.freeze({ status: "not-configured" });
  if (!cpu.ok) {
    return Object.freeze({ status: "rejected", reason: "cpu-oracle-rejected" });
  }
  return Object.freeze({
    status: "cpu-explicit",
    artifact: cpu.artifact,
    receipt: Object.freeze({
      kind: "studio-brush-pack-dual-tip-explicit-cpu-receipt",
      version: STUDIO_BRUSH_PACK_DUAL_TIP_EXPLICIT_CPU_RECEIPT_VERSION,
      providerVersion: STUDIO_BRUSH_PACK_DUAL_TIP_EXACT_PROVIDER_VERSION,
      executionRoute: "cpu-f32-oracle-explicit",
      providerSelection: "explicit-before-execution",
      authority: "cpu-f32-oracle",
      cpuReceipt: cpu.artifact.receipt,
      complete: true,
    }),
  });
}

function replayAsset(
  asset: StudioDynamicDualTipExactR8AssetInputV2,
): StudioBrushPackDualTipExactReplayAsset {
  return Object.freeze({
    assetId: asset.assetId,
    width: asset.width,
    height: asset.height,
    channel: "alpha",
    encoding: "base64-r8-row-major",
    bytesBase64: encodeStudioBrushTipAlphaMapBase64(asset.bytes),
  });
}

function exactReplay(
  execution: StudioBrushPackDualTipExactExecution,
  primaryAsset: StudioDynamicDualTipExactR8AssetInputV2,
  secondaryAsset: StudioDynamicDualTipExactR8AssetInputV2,
  commands: StudioDualTipPackedCommands,
  cpuReferenceEvidence: StudioBrushPackDualTipCpuReferenceEvidence,
  plan: StudioDynamicDualTipExactPlanV2,
): StudioBrushPackDualTipExactReplay {
  return Object.freeze({
    kind: "studio-brush-pack-dual-tip-exact-replay",
    version: STUDIO_BRUSH_PACK_DUAL_TIP_EXACT_REPLAY_VERSION,
    executionRoute: "webgpu-exact-packed-deposition-v2",
    mode: execution.mode,
    strokeId: execution.strokeId,
    commandSequence: execution.commandSequence,
    porterDuff: execution.porterDuff ?? "source-over",
    primaryAsset: replayAsset(primaryAsset),
    secondaryAsset: replayAsset(secondaryAsset),
    commands,
    cpuReferenceEvidence,
    exactPlanFingerprint: plan.fingerprint,
  });
}

function validOracleArtifact(
  artifact: StudioDualTipArtifact,
  commands: StudioDualTipPackedCommands,
): boolean {
  try {
    return artifact.kind === "studio-dual-tip-artifact"
      && positiveSafeInteger(artifact.width)
      && positiveSafeInteger(artifact.height)
      && positiveSafeInteger(artifact.stampCount)
      && artifact.stampCount === commands.count
      && artifact.commands.kind === commands.kind
      && artifact.commands.layoutVersion === commands.layoutVersion
      && artifact.commands.stride === commands.stride
      && artifact.commands.count === commands.count
      && artifact.commands.values.length === commands.values.length
      && artifact.commands.values.every(
        (value, index) => value === commands.values[index],
      )
      && artifact.premultipliedLinearRgba.length === artifact.width * artifact.height * 4
      && artifact.receipt.authority === "cpu-f32-oracle"
      && artifact.receipt.packedCommandContract === "gpu-wasm-ready-f32-v1";
  } catch {
    return false;
  }
}

function validCpuReferenceEvidence(
  evidence: StudioBrushPackDualTipCpuReferenceEvidence,
  commands: StudioDualTipPackedCommands,
): boolean {
  try {
    return evidence.kind === "studio-brush-pack-dual-tip-cpu-reference-evidence"
      && evidence.version === STUDIO_BRUSH_PACK_DUAL_TIP_CPU_REFERENCE_EVIDENCE_VERSION
      && evidence.providerVersion === STUDIO_BRUSH_PACK_DUAL_TIP_EXACT_PROVIDER_VERSION
      && evidence.executionRoute === "cpu-f32-oracle-reference"
      && evidence.purpose === "plan-validation-and-qa-reference"
      && evidence.authority === "none"
      && evidence.pixelAuthority === false
      && evidence.saveAuthority === false
      && evidence.providerSelection === "not-selected"
      && evidence.alphaContract === "premultiplied-linear-rgba-f32"
      && evidence.packedCommandContract === "gpu-wasm-ready-f32-v1"
      && (evidence.mode === "append" || evidence.mode === "rebuild")
      && validIdentifier(evidence.strokeId)
      && positiveSafeInteger(evidence.commandSequence)
      && (
        evidence.porterDuff === "source-over"
        || evidence.porterDuff === "destination-out"
      )
      && positiveSafeInteger(evidence.stampCount)
      && evidence.stampCount === commands.count
      && positiveSafeInteger(evidence.width)
      && positiveSafeInteger(evidence.height)
      && evidence.oracleContract.contractId === STUDIO_DUAL_TIP_CONTRACT_ID
      && evidence.oracleContract.alphaContract === "premultiplied-linear-rgba-f32"
      && evidence.oracleContract.packedCommandContract === "gpu-wasm-ready-f32-v1"
      && !("authority" in evidence.oracleContract)
      && evidence.complete === true;
  } catch {
    return false;
  }
}

function decodeReplayAsset(
  asset: StudioBrushPackDualTipExactReplayAsset,
): StudioDynamicDualTipExactR8AssetInputV2 | null {
  if (
    !asset
    || !validIdentifier(asset.assetId)
    || !positiveSafeInteger(asset.width)
    || !positiveSafeInteger(asset.height)
    || asset.channel !== "alpha"
    || asset.encoding !== "base64-r8-row-major"
    || typeof asset.bytesBase64 !== "string"
    || asset.bytesBase64.length > MAX_REPLAY_BASE64_CODE_UNITS
  ) return null;
  const expectedBytes = asset.width * asset.height;
  const expectedCodeUnits = Math.ceil(expectedBytes / 3) * 4;
  if (
    !Number.isSafeInteger(expectedBytes)
    || expectedCodeUnits > MAX_REPLAY_BASE64_CODE_UNITS
    || asset.bytesBase64.length !== expectedCodeUnits
    || !/^[A-Za-z0-9+/]*={0,2}$/u.test(asset.bytesBase64)
  ) return null;
  let binary: string;
  try {
    binary = globalThis.atob(asset.bytesBase64);
  } catch {
    return null;
  }
  if (binary.length !== expectedBytes) return null;
  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  // Saved replays use one canonical padded base64 spelling. This also rejects strings whose
  // otherwise-valid final sextet contains non-zero unused bits.
  if (encodeStudioBrushTipAlphaMapBase64(bytes) !== asset.bytesBase64) return null;
  return Object.freeze({
    assetId: asset.assetId,
    width: asset.width,
    height: asset.height,
    channel: "alpha",
    bytes,
  });
}

function validReplayEnvelope(
  replay: StudioBrushPackDualTipExactReplay,
): boolean {
  try {
    return replay.kind === "studio-brush-pack-dual-tip-exact-replay"
      && replay.version === STUDIO_BRUSH_PACK_DUAL_TIP_EXACT_REPLAY_VERSION
      && replay.executionRoute === "webgpu-exact-packed-deposition-v2"
      && (replay.mode === "append" || replay.mode === "rebuild")
      && validIdentifier(replay.strokeId)
      && positiveSafeInteger(replay.commandSequence)
      && (
        replay.porterDuff === "source-over"
        || replay.porterDuff === "destination-out"
      )
      && /^sha256:[0-9a-f]{64}$/u.test(replay.exactPlanFingerprint)
      && replay.commands.kind === "studio-dual-tip-packed-f32"
      && replay.commands.layoutVersion === 1
      && replay.commands.scalar === "float32"
      && replay.commands.byteOrder === "little-endian"
      && replay.commands.stride === STUDIO_DUAL_TIP_PACKED_STRIDE
      && replay.commands.layout.length === STUDIO_DUAL_TIP_PACKED_LAYOUT.length
      && replay.commands.layout.every(
        (field, index) => field === STUDIO_DUAL_TIP_PACKED_LAYOUT[index],
      )
      && positiveSafeInteger(replay.commands.count)
      && replay.commands.count <= MAX_REPLAY_DEPOSITIONS
      && Array.isArray(replay.commands.values)
      && replay.commands.values.length
        === replay.commands.count * replay.commands.stride
      && replay.commands.values.every(
        (item) => typeof item === "number" && Number.isFinite(item),
      )
      && replay.cpuReferenceEvidence.mode === replay.mode
      && replay.cpuReferenceEvidence.strokeId === replay.strokeId
      && replay.cpuReferenceEvidence.commandSequence === replay.commandSequence
      && replay.cpuReferenceEvidence.porterDuff === replay.porterDuff
      && validCpuReferenceEvidence(replay.cpuReferenceEvidence, replay.commands);
  } catch {
    return false;
  }
}

/**
 * Canonical WebGPU replay boundary. R8 bytes and packed commands are replayable, while the CPU
 * record remains non-authoritative QA evidence and contains no pixel artifact.
 */
export function serializeStudioBrushPackDualTipExactReplay(
  replay: StudioBrushPackDualTipExactReplay,
): string | null {
  if (
    !validReplayEnvelope(replay)
    || !decodeReplayAsset(replay.primaryAsset)
    || !decodeReplayAsset(replay.secondaryAsset)
  ) return null;
  return JSON.stringify(replay);
}

export function parseStudioBrushPackDualTipExactReplay(
  value: unknown,
): StudioBrushPackDualTipExactReplay | null {
  let candidate: unknown = value;
  if (typeof value === "string") {
    if (value.length > MAX_REPLAY_BASE64_CODE_UNITS * 3) return null;
    try {
      candidate = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const replay = candidate as StudioBrushPackDualTipExactReplay;
  if (
    !validReplayEnvelope(replay)
    || !decodeReplayAsset(replay.primaryAsset)
    || !decodeReplayAsset(replay.secondaryAsset)
  ) return null;
  return replay;
}

export class StudioBrushPackDualTipExactProvider {
  readonly #width: number;
  readonly #height: number;
  readonly #module: ExactRuntimeModule;
  readonly #runtime: StudioDynamicDualTipExactWebGpuRuntimeV2;
  #unavailableReason: StudioBrushPackDualTipExactUnavailableReason = "provider-failed";
  #gpuEnabled = true;
  #disposed = false;

  public constructor(
    width: number,
    height: number,
    module: ExactRuntimeModule,
    runtime: StudioDynamicDualTipExactWebGpuRuntimeV2,
  ) {
    this.#width = width;
    this.#height = height;
    this.#module = module;
    this.#runtime = runtime;
  }

  public async execute(
    selection: StudioBrushPackSelection,
    input: StudioBrushPackDualTipRenderInput,
    execution: StudioBrushPackDualTipExactExecution,
    signal?: AbortSignal,
  ): Promise<StudioBrushPackDualTipExactProviderResult> {
    if (!validExecution(execution)) {
      return Object.freeze({ status: "rejected", reason: "invalid-execution" });
    }
    const cpu = renderStudioBrushPackDualTipIfConfigured(selection, input);
    if (cpu === null) return Object.freeze({ status: "not-configured" });
    if (!cpu.ok) {
      return Object.freeze({ status: "rejected", reason: "cpu-oracle-rejected" });
    }
    if (!validOracleArtifact(cpu.artifact, cpu.artifact.commands)) {
      return Object.freeze({ status: "rejected", reason: "cpu-oracle-rejected" });
    }
    const materialized = materializeStudioBrushPackDualTipR8(selection);
    if (!materialized) {
      return Object.freeze({ status: "rejected", reason: "cpu-oracle-rejected" });
    }
    if (signal?.aborted) return Object.freeze({ status: "cancelled" });
    const evidence = referenceEvidence(execution, cpu.artifact);
    if (
      cpu.artifact.width !== this.#width
      || cpu.artifact.height !== this.#height
    ) {
      return this.#unavailable(
        "unsupported-plan",
        evidence,
      );
    }
    return this.#executePrepared(
      execution,
      cpu.artifact.commands,
      evidence,
      materialized.primary,
      materialized.secondary,
      signal,
    );
  }

  public async replay(
    value: unknown,
    request: Readonly<{ requestSequence: number; deviceEpoch: number }>,
    signal?: AbortSignal,
  ): Promise<StudioBrushPackDualTipExactProviderResult> {
    const replay = parseStudioBrushPackDualTipExactReplay(value);
    if (
      !replay
      || !positiveSafeInteger(request?.requestSequence)
      || !positiveSafeInteger(request?.deviceEpoch)
    ) return Object.freeze({ status: "rejected", reason: "invalid-replay" });
    const primary = decodeReplayAsset(replay.primaryAsset)!;
    const secondary = decodeReplayAsset(replay.secondaryAsset)!;
    const execution: StudioBrushPackDualTipExactExecution = {
      mode: replay.mode,
      requestSequence: request.requestSequence,
      deviceEpoch: request.deviceEpoch,
      strokeId: replay.strokeId,
      commandSequence: replay.commandSequence,
      porterDuff: replay.porterDuff,
    };
    if (
      replay.cpuReferenceEvidence.width !== this.#width
      || replay.cpuReferenceEvidence.height !== this.#height
    ) {
      return this.#unavailable(
        "unsupported-plan",
        replay.cpuReferenceEvidence,
      );
    }
    return this.#executePrepared(
      execution,
      replay.commands,
      replay.cpuReferenceEvidence,
      primary,
      secondary,
      signal,
      replay.exactPlanFingerprint,
    );
  }

  async #executePrepared(
    execution: StudioBrushPackDualTipExactExecution,
    commands: StudioDualTipPackedCommands,
    evidence: StudioBrushPackDualTipCpuReferenceEvidence,
    primaryAsset: StudioDynamicDualTipExactR8AssetInputV2,
    secondaryAsset: StudioDynamicDualTipExactR8AssetInputV2,
    signal?: AbortSignal,
    expectedFingerprint?: `sha256:${string}`,
  ): Promise<StudioBrushPackDualTipExactProviderResult> {
    if (!this.#gpuEnabled || this.#disposed) {
      return this.#unavailable(
        this.#disposed ? "disposed" : this.#unavailableReason,
        evidence,
      );
    }
    const planResult = this.#module
      .buildStudioDynamicDualTipExactPlanV2FromPackedCommands({
        mode: execution.mode,
        strokeId: execution.strokeId,
        commandSequence: execution.commandSequence,
        primaryAsset,
        secondaryAsset,
        commands,
        porterDuff: execution.porterDuff ?? "source-over",
      });
    if (
      planResult.status !== "ready"
      || (
        expectedFingerprint !== undefined
        && planResult.plan.fingerprint !== expectedFingerprint
      )
    ) {
      return this.#unavailable(
        "unsupported-plan",
        evidence,
      );
    }
    const replay = exactReplay(
      execution,
      primaryAsset,
      secondaryAsset,
      commands,
      evidence,
      planResult.plan,
    );
    let result: StudioDynamicDualTipExactWebGpuExecutionResultV2;
    try {
      result = await this.#runtime.execute({
        requestSequence: execution.requestSequence,
        deviceEpoch: execution.deviceEpoch,
        plan: planResult.plan,
      }, signal);
    } catch {
      this.#unavailableReason = "provider-failed";
      this.#gpuEnabled = false;
      return this.#unavailable("provider-failed", evidence);
    }
    if (result.status === "cancelled") {
      return Object.freeze({ status: "cancelled" });
    }
    if (result.status === "completed") {
      return Object.freeze({
        status: "webgpu-exact",
        plan: planResult.plan,
        replay,
        receipt: Object.freeze({
          kind: "studio-brush-pack-dual-tip-exact-completion-receipt",
          version: STUDIO_BRUSH_PACK_DUAL_TIP_EXACT_PROVIDER_VERSION,
          executionRoute: "webgpu-exact-packed-deposition-v2",
          gpu: result.receipt,
          cpuReferenceEvidence: evidence,
          replayFingerprint: planResult.plan.fingerprint,
          complete: true,
        }),
      });
    }
    let reason: StudioBrushPackDualTipExactUnavailableReason = "provider-failed";
    if (result.status === "device-lost") {
      reason = "device-lost";
    } else if (
      result.status === "rejected"
      && result.reason === "resident-asset-budget"
    ) {
      reason = "resident-asset-budget";
    } else if (
      result.status === "rejected"
      && result.reason === "request-limit"
    ) {
      reason = "request-limit";
    } else if (
      result.status === "rejected"
      && result.reason === "device-epoch"
    ) {
      reason = "device-lost";
    } else if (result.status === "disposed") {
      reason = "disposed";
    }
    if (
      reason === "device-lost"
      || reason === "provider-failed"
      || reason === "disposed"
    ) {
      this.#unavailableReason = reason;
      this.#gpuEnabled = false;
    }
    return this.#unavailable(reason, evidence);
  }

  #unavailable(
    reason: StudioBrushPackDualTipExactUnavailableReason,
    referenceEvidenceValue: StudioBrushPackDualTipCpuReferenceEvidence,
  ): StudioBrushPackDualTipExactProviderResult {
    return Object.freeze({
      status: "unavailable",
      reason,
      referenceEvidence: referenceEvidenceValue,
    });
  }

  public notifyDeviceLost(): void {
    if (this.#disposed) return;
    this.#unavailableReason = "device-lost";
    this.#gpuEnabled = false;
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unavailableReason = "disposed";
    this.#gpuEnabled = false;
    this.#runtime.dispose();
  }
}

export async function createStudioBrushPackDualTipExactProvider(
  options: StudioBrushPackDualTipExactProviderOptions,
): Promise<StudioBrushPackDualTipExactProviderCreationResult> {
  if (
    !options
    || !positiveSafeInteger(options.width)
    || !positiveSafeInteger(options.height)
    || (
      options.initialDeviceEpoch !== undefined
      && !positiveSafeInteger(options.initialDeviceEpoch)
    )
    || (
      options.maximumDepositions !== undefined
      && !positiveSafeInteger(options.maximumDepositions)
    )
    || (
      options.maximumResidentAssetBytes !== undefined
      && !positiveSafeInteger(options.maximumResidentAssetBytes)
    )
    || (
      options.moduleLoader !== undefined
      && typeof options.moduleLoader !== "function"
    )
  ) return Object.freeze({ status: "rejected", reason: "invalid-options" });
  if (!options.device) {
    return Object.freeze({ status: "unavailable", reason: "webgpu-unavailable" });
  }
  let module: ExactRuntimeModule;
  try {
    module = await (options.moduleLoader
      ?? (() => import("../studio-dynamic-dual-tip-webgpu-runtime-v2")))();
  } catch {
    return Object.freeze({ status: "unavailable", reason: "module-load-failed" });
  }
  let runtime: ReturnType<
    ExactRuntimeModule["createStudioDynamicDualTipExactWebGpuRuntimeV2"]
  >;
  try {
    runtime = module.createStudioDynamicDualTipExactWebGpuRuntimeV2({
      device: options.device,
      width: options.width,
      height: options.height,
      ...(options.initialDeviceEpoch === undefined
        ? {}
        : { initialDeviceEpoch: options.initialDeviceEpoch }),
      ...(options.maximumDepositions === undefined
        ? {}
        : { maximumDepositions: options.maximumDepositions }),
      ...(options.maximumResidentAssetBytes === undefined
        ? {}
        : { maximumResidentAssetBytes: options.maximumResidentAssetBytes }),
      ...(options.ownsDevice === undefined
        ? {}
        : { ownsDevice: options.ownsDevice }),
    });
  } catch {
    return Object.freeze({
      status: "unavailable",
      reason: "runtime-initialization-failed",
    });
  }
  if (runtime.status !== "ready") {
    return Object.freeze({
      status: "unavailable",
      reason: "runtime-initialization-failed",
    });
  }
  return Object.freeze({
    status: "ready",
    provider: new StudioBrushPackDualTipExactProvider(
      options.width,
      options.height,
      module,
      runtime.runtime,
    ),
    webGpu: "ready",
  });
}
