/**
 * Product-facing pointer transaction for the V12 VRM surface brush.
 *
 * This controller deliberately owns no pixels, Three geometry, or GPU resources. It retains a
 * bounded list of R3F/PointerEvent samples and real Three ray hits, lowers them to the shared
 * BrushProgramIR + StrokeIR contracts, then gives the whole transaction to the existing
 * StudioVrmSurfaceProjectionProvider/StudioVrmTexturePaintRuntime bridge. The runtime remains the
 * only atlas, upload, and undo owner, so a completed pointer gesture produces exactly one canonical
 * atlas commit and cancellation never needs a GPU readback. Once this tool/provider is selected,
 * admission failures fail closed: the source atlas and last successful receipt stay intact, and an
 * alternate provider or tool can be selected only for a later operation by an explicit caller.
 */

import { modelRawInput } from "@toonspectrum/studio-brush-platform";

import {
  executeStudioVrmSurfaceBrushStroke,
  StudioVrmSurfaceBrushBridgeError,
} from "./studio-vrm-surface-brush-provider";

import type {
  StudioVrmTexturePaintRayHit,
  StudioVrmTexturePaintRuntime,
} from "./studio-vrm-texture-paint-runtime";
import type { SurfaceBrushExecutionResult } from "../../../../../../packages/studio-brush-platform/src/brush-composition";
import type {
  BrushProgramIR,
  DeviceCalibrationIR,
  RawInputSampleIR,
  StrokeIR,
} from "@toonspectrum/studio-project-model";

export const STUDIO_VRM_SURFACE_PAINT_TOOL_ID = "studio-vrm-surface-round-v12";
export const STUDIO_VRM_SURFACE_PAINT_PROVIDER_ID = "three-vrm-texture-paint";
export const STUDIO_VRM_SURFACE_PAINT_MAX_SAMPLES = 2_048;
export const STUDIO_VRM_SURFACE_PAINT_MAX_OPERATIONS = 50_000;

export const STUDIO_VRM_SURFACE_PAINT_FAILURE_POLICY = Object.freeze({
  automaticAlternateBrushSelectionAllowed: false,
  sourceState: "preserved",
  lastCommit: "preserved",
  nextOperation: "select-provider-or-tool",
} as const);

export const STUDIO_VRM_SURFACE_PAINT_CAPABILITIES = Object.freeze({
  providerId: STUDIO_VRM_SURFACE_PAINT_PROVIDER_ID,
  tip: Object.freeze({
    round: "supported",
    stamp: "unsupported",
    image: "unsupported",
  }),
  mixing: Object.freeze({
    none: "supported",
    smudge: "unsupported",
    wet: "unsupported",
  }),
  failurePolicy: STUDIO_VRM_SURFACE_PAINT_FAILURE_POLICY,
  hotPathGpuReadback: false,
} as const);

export type StudioVrmSurfacePaintToolStatus =
  | "ready"
  | "collecting"
  | "committing"
  | "cancelling"
  | "unavailable"
  | "rejected"
  | "error";

export type StudioVrmSurfacePaintToolErrorCode =
  | "busy"
  | "device-failure"
  | "invalid-input"
  | "memory"
  | "runtime"
  | "runtime-invalid"
  | "runtime-unavailable"
  | "sample-budget"
  | "tool-disposed"
  | "unsupported-face-index"
  | "unsupported-mixing"
  | "unsupported-tip"
  | "upload";

export interface StudioVrmSurfacePaintToolSnapshot {
  readonly status: StudioVrmSurfacePaintToolStatus;
  readonly activePointerId: number | null;
  readonly sampleCount: number;
  readonly message: string;
  readonly errorCode: StudioVrmSurfacePaintToolErrorCode | null;
  readonly lastCommit: Readonly<{
    readonly strokeId: string;
    readonly inputSamples: number;
    readonly runs: number;
    readonly seamBreaks: number;
    readonly operations: number;
    readonly revision: number | null;
  }> | null;
}

export interface StudioVrmSurfacePaintBrushSettings {
  readonly color: string;
  /** Screen-space diameter. The projection provider supplies CSS-pixel to texel density. */
  readonly sizeCssPixels: number;
  readonly opacity: number;
  readonly flow: number;
  readonly hardness: number;
  readonly minSize: number;
}

export interface StudioVrmSurfacePaintPointerSample {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly timeStamp: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly phase: "down" | "move" | "up";
  readonly hit: StudioVrmTexturePaintRayHit;
  /** Analytic camera ray differential at the hit depth; null keeps pair-derived density available. */
  readonly worldUnitsPerCssPixel: number | null;
}

export interface StudioVrmSurfacePaintToolBeginInput {
  /** Null is an explicit unavailable prerequisite, never permission to select another tool. */
  readonly runtime: StudioVrmTexturePaintRuntime | null;
  readonly settings: StudioVrmSurfacePaintBrushSettings;
  readonly sample: StudioVrmSurfacePaintPointerSample;
}

export type StudioVrmSurfacePaintToolBeginFailureReason =
  | "busy"
  | "invalid-input"
  | "runtime-invalid"
  | "runtime-unavailable"
  | "tool-disposed"
  | "unsupported-face-index";

interface StudioVrmSurfacePaintToolBeginFailureReceiptBase {
  readonly ok: false;
  readonly selectedToolId: typeof STUDIO_VRM_SURFACE_PAINT_TOOL_ID;
  readonly selectedProviderId: typeof STUDIO_VRM_SURFACE_PAINT_PROVIDER_ID;
  readonly reason: StudioVrmSurfacePaintToolBeginFailureReason;
  readonly message: string;
  readonly sourceState: "preserved";
  readonly lastCommit: StudioVrmSurfacePaintToolSnapshot["lastCommit"];
  readonly alternateBrushSelected: false;
  /** A caller may choose a provider/tool only before a later operation, never for this pointerdown. */
  readonly nextOperation: "select-provider-or-tool";
}

export type StudioVrmSurfacePaintToolBeginReceipt =
  | Readonly<{
      readonly ok: true;
      readonly status: "accepted";
      readonly route: "surface-brush";
      readonly selectedToolId: typeof STUDIO_VRM_SURFACE_PAINT_TOOL_ID;
      readonly selectedProviderId: typeof STUDIO_VRM_SURFACE_PAINT_PROVIDER_ID;
    }>
  | Readonly<{
      readonly status: "unavailable" | "rejected";
    } & StudioVrmSurfacePaintToolBeginFailureReceiptBase>;

/** Public compatibility name: the result is the complete admission receipt. */
export type StudioVrmSurfacePaintToolBeginResult = StudioVrmSurfacePaintToolBeginReceipt;

export type StudioVrmSurfacePaintToolFinishResult =
  | Readonly<{
      readonly ok: true;
      readonly brushProgram: BrushProgramIR;
      readonly stroke: StrokeIR;
      readonly execution: SurfaceBrushExecutionResult;
    }>
  | Readonly<{
      readonly ok: false;
      readonly cancelled: boolean;
      readonly error: unknown;
    }>;

export type StudioVrmSurfacePaintCancelReason =
  | "disabled"
  | "device-failure"
  | "lost-capture"
  | "pointer-cancel"
  | "pointer-leave"
  | "tool-change"
  | "unmount"
  | "window-blur";

export interface CreateStudioVrmSurfacePaintToolOptions {
  readonly onSnapshot?: (snapshot: StudioVrmSurfacePaintToolSnapshot) => void;
  /** Deterministic test/host seam. Product callers use the existing bridge by default. */
  readonly executeStroke?: typeof executeStudioVrmSurfaceBrushStroke;
  readonly maxSamples?: number;
  readonly maxOperations?: number;
}

interface ActiveSurfacePaintTransaction {
  readonly pointerId: number;
  readonly runtime: StudioVrmTexturePaintRuntime;
  readonly settings: StudioVrmSurfacePaintBrushSettings;
  readonly samples: StudioVrmSurfacePaintPointerSample[];
  readonly abortController: AbortController;
  readonly sequence: number;
  finishing: boolean;
}

const IDENTITY_POINTER_CALIBRATION: DeviceCalibrationIR = {
  deviceId: "studio-vrm-r3f-pointer",
  label: "Studio VRM R3F pointer",
  pressureCurve: [0, 1],
  pressureDeadZone: 0,
  tiltXOffsetDeg: 0,
  tiltYOffsetDeg: 0,
  predictionMs: 0,
};

const INITIAL_SNAPSHOT: StudioVrmSurfacePaintToolSnapshot = Object.freeze({
  status: "ready",
  activePointerId: null,
  sampleCount: 0,
  message: "V12 UV 브러시가 준비됐습니다.",
  errorCode: null,
  lastCommit: null,
});

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu;

function finiteInRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function normalizePointerType(value: string): RawInputSampleIR["pointerType"] {
  if (value === "pen" || value === "touch") return value;
  return "mouse";
}

function validPointerSample(sample: StudioVrmSurfacePaintPointerSample): boolean {
  return Number.isSafeInteger(sample.pointerId)
    && sample.pointerId >= 0
    && Number.isFinite(sample.clientX)
    && Number.isFinite(sample.clientY)
    && Number.isFinite(sample.timeStamp)
    && finiteInRange(sample.pressure, 0, 1)
    && finiteInRange(sample.tiltX, -90, 90)
    && finiteInRange(sample.tiltY, -90, 90)
    && (
      sample.worldUnitsPerCssPixel === null
      || (Number.isFinite(sample.worldUnitsPerCssPixel) && sample.worldUnitsPerCssPixel > 0)
    );
}

function validSettings(settings: StudioVrmSurfacePaintBrushSettings): boolean {
  return HEX_COLOR.test(settings.color)
    && Number.isFinite(settings.sizeCssPixels)
    && settings.sizeCssPixels > 0
    && finiteInRange(settings.opacity, 0, 1)
    && finiteInRange(settings.flow, 0, 1)
    && finiteInRange(settings.hardness, 0, 1)
    && finiteInRange(settings.minSize, 0, 1);
}

function parseColor(color: string): StrokeIR["color"] {
  const match = HEX_COLOR.exec(color);
  if (!match) throw new Error(`invalid surface brush color ${color}`);
  return {
    r: Number.parseInt(match[1]!, 16) / 255,
    g: Number.parseInt(match[2]!, 16) / 255,
    b: Number.parseInt(match[3]!, 16) / 255,
    a: 1,
  };
}

function deterministicSeed(samples: readonly StudioVrmSurfacePaintPointerSample[]): number {
  let hash = 0x811c9dc5;
  for (const sample of samples) {
    const values = [
      sample.pointerId,
      Math.round(sample.clientX * 64),
      Math.round(sample.clientY * 64),
      Math.round(sample.timeStamp * 8),
      Math.round(sample.pressure * 1_000_000),
      Math.round(sample.tiltX * 1_000),
      Math.round(sample.tiltY * 1_000),
    ];
    for (const value of values) {
      hash ^= value | 0;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

function toRawSamples(
  samples: readonly StudioVrmSurfacePaintPointerSample[],
): RawInputSampleIR[] {
  const startedAt = Math.max(0, samples[0]?.timeStamp ?? 0);
  return samples.map((sample) => ({
    x: sample.clientX,
    y: sample.clientY,
    tMs: Math.max(0, sample.timeStamp - startedAt),
    pressure: sample.pressure,
    tiltXDeg: sample.tiltX,
    tiltYDeg: sample.tiltY,
    twistDeg: 0,
    pointerType: normalizePointerType(sample.pointerType),
    phase: sample.phase,
    source: "raw",
  }));
}

export function inspectStudioVrmSurfaceBrushProgram(
  program: BrushProgramIR,
): Readonly<{
  supported: boolean;
  errorCode: "unsupported-tip" | "unsupported-mixing" | null;
  message: string;
}> {
  if (program.tip.kind !== "round") {
    return Object.freeze({
      supported: false,
      errorCode: "unsupported-tip",
      message: `${program.tip.kind} 촉은 UV stamp/image sampler가 검증되기 전까지 지원하지 않습니다.`,
    });
  }
  if (program.mixing.kind !== "none") {
    return Object.freeze({
      supported: false,
      errorCode: "unsupported-mixing",
      message: `${program.mixing.kind} 혼색은 texture-neighborhood backend가 검증되기 전까지 지원하지 않습니다.`,
    });
  }
  return Object.freeze({
    supported: true,
    errorCode: null,
    message: "round 촉 · 혼색 없음 경로",
  });
}

export function createStudioVrmSurfaceBrushProgram(
  settings: StudioVrmSurfacePaintBrushSettings,
): BrushProgramIR {
  if (!validSettings(settings)) {
    throw new Error("surface brush settings must be finite and use a six-digit HEX color");
  }
  const brushProgram: BrushProgramIR = {
    id: STUDIO_VRM_SURFACE_PAINT_TOOL_ID,
    name: "Studio VRM V12 surface round",
    stabilizer: { kind: "none", strength: 0, predictionMs: 0 },
    sizeDynamics: [{
      input: "pressure",
      curve: [0, 1],
      min: settings.minSize,
      max: 1,
    }],
    flowDynamics: [{
      input: "constant",
      curve: [0, 1],
      min: settings.flow,
      max: settings.flow,
    }],
    geometry: {
      kind: "perfect-freehand",
      // Pressure is mapped exactly once by sizeDynamics above.
      thinning: 0,
      smoothing: 0.5,
      streamline: 0.5,
      capStart: true,
      capEnd: true,
    },
    tip: {
      kind: "round",
      hardness: settings.hardness,
      spacingPct: 24,
      angleJitterDeg: 0,
    },
    mixing: { kind: "none", strength: 0 },
    output: { target: "raster-tiles", bake: "editable-proxy" },
    providerPreference: ["three-vrm-texture-paint"],
  };
  return brushProgram;
}

function buildStroke(
  transaction: ActiveSurfacePaintTransaction,
): Readonly<{ brushProgram: BrushProgramIR; stroke: StrokeIR }> {
  const brushProgram = createStudioVrmSurfaceBrushProgram(transaction.settings);
  const color = parseColor(transaction.settings.color);
  const samples = modelRawInput(
    toRawSamples(transaction.samples),
    IDENTITY_POINTER_CALIBRATION,
    { velocitySmoothing: 0.5 },
  );
  const seed = deterministicSeed(transaction.samples);
  const stroke: StrokeIR = {
    id: `vrm-surface-${transaction.sequence}-${seed.toString(16)}`,
    brushPresetId: brushProgram.id,
    seed,
    color: { ...color, a: transaction.settings.opacity },
    baseSizePx: transaction.settings.sizeCssPixels,
    samples,
  };
  return Object.freeze({ brushProgram, stroke });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error);
}

function classifyExecutionError(error: unknown): Readonly<{
  code: StudioVrmSurfacePaintToolErrorCode;
  message: string;
}> {
  const detail = errorMessage(error);
  const normalized = detail.toLowerCase();
  if (
    normalized.includes("history-budget")
    || normalized.includes("target-rgba-budget")
    || normalized.includes("aggregate-rgba-budget")
    || normalized.includes("out of memory")
  ) {
    return Object.freeze({
      code: "memory",
      message: "이 획을 원자적으로 되돌릴 메모리가 부족해 텍스처를 변경하지 않았습니다.",
    });
  }
  if (
    normalized.includes("canvas-unavailable")
    || normalized.includes("target-invalid")
    || normalized.includes("upload")
  ) {
    return Object.freeze({
      code: "upload",
      message: "아틀라스 업로드가 실패해 획 전체를 되돌리고 마지막 성공 결과를 유지했습니다. 다음 작업 전에 provider 또는 도구를 명시적으로 선택하세요.",
    });
  }
  if (error instanceof StudioVrmSurfaceBrushBridgeError) {
    return Object.freeze({
      code: "runtime",
      message: `V12 UV 브러시를 완료하지 못했습니다: ${detail}`,
    });
  }
  return Object.freeze({
    code: "runtime",
    message: `V12 UV 브러시를 완료하지 못해 획을 취소했습니다: ${detail}`,
  });
}

function normalizedLimit(value: number | undefined, defaultValue: number): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return defaultValue;
  return value as number;
}

interface StudioVrmSurfacePaintAdmissionFailure {
  readonly status: "unavailable" | "rejected";
  readonly reason: StudioVrmSurfacePaintToolBeginFailureReason;
  readonly message: string;
}

function inspectRuntimeAdmission(
  runtime: StudioVrmTexturePaintRuntime,
): StudioVrmSurfacePaintAdmissionFailure | null {
  const snapshot = runtime.getSnapshot();
  if (snapshot.status === "disposed") {
    return Object.freeze({
      status: "unavailable",
      reason: "runtime-unavailable",
      message: "선택한 V12 UV 표면 브러시 runtime이 이미 종료됐습니다.",
    });
  }
  if (
    snapshot.activeOperation !== null
    || snapshot.status === "loading"
    || snapshot.status === "painting"
  ) {
    return Object.freeze({
      status: "unavailable",
      reason: "busy",
      message: "선택한 V12 UV 표면 브러시 runtime이 다른 표면 작업을 처리 중입니다.",
    });
  }
  if (snapshot.status === "invalid") {
    return Object.freeze({
      status: "unavailable",
      reason: "runtime-invalid",
      message: "선택한 V12 UV 표면 브러시 runtime의 현재 텍스처 대상이 유효하지 않습니다.",
    });
  }
  return null;
}

function createBeginFailureReceipt(
  failure: StudioVrmSurfacePaintAdmissionFailure,
  lastCommit: StudioVrmSurfacePaintToolSnapshot["lastCommit"],
): Exclude<StudioVrmSurfacePaintToolBeginReceipt, { readonly ok: true }> {
  return Object.freeze({
    ok: false,
    status: failure.status,
    selectedToolId: STUDIO_VRM_SURFACE_PAINT_TOOL_ID,
    selectedProviderId: STUDIO_VRM_SURFACE_PAINT_PROVIDER_ID,
    reason: failure.reason,
    message: `${failure.message} 원본과 마지막 성공 결과를 유지했습니다. 다음 작업 전에 provider 또는 도구를 명시적으로 선택하세요.`,
    sourceState: "preserved",
    lastCommit,
    alternateBrushSelected: false,
    nextOperation: "select-provider-or-tool",
  });
}

export class StudioVrmSurfacePaintTool {
  private readonly executeStroke: typeof executeStudioVrmSurfaceBrushStroke;
  private readonly maxSamples: number;
  private readonly maxOperations: number;
  private readonly onSnapshot: ((snapshot: StudioVrmSurfacePaintToolSnapshot) => void) | undefined;
  private active: ActiveSurfacePaintTransaction | null = null;
  private snapshot: StudioVrmSurfacePaintToolSnapshot = INITIAL_SNAPSHOT;
  private disposed = false;
  private sequence = 0;

  constructor(options: CreateStudioVrmSurfacePaintToolOptions = {}) {
    this.executeStroke = options.executeStroke ?? executeStudioVrmSurfaceBrushStroke;
    this.maxSamples = normalizedLimit(options.maxSamples, STUDIO_VRM_SURFACE_PAINT_MAX_SAMPLES);
    this.maxOperations = normalizedLimit(
      options.maxOperations,
      STUDIO_VRM_SURFACE_PAINT_MAX_OPERATIONS,
    );
    this.onSnapshot = options.onSnapshot;
  }

  getSnapshot(): StudioVrmSurfacePaintToolSnapshot {
    return this.snapshot;
  }

  begin(input: StudioVrmSurfacePaintToolBeginInput): StudioVrmSurfacePaintToolBeginReceipt {
    if (this.disposed) {
      return createBeginFailureReceipt({
        status: "unavailable",
        reason: "tool-disposed",
        message: "선택한 V12 UV 표면 브러시 도구가 이미 종료됐습니다.",
      }, this.snapshot.lastCommit);
    }
    if (this.active) {
      // Do not replace the active transaction's collecting/committing snapshot with the rejected
      // pointerdown. That snapshot and its last-good receipt still own this operation.
      return createBeginFailureReceipt({
        status: "unavailable",
        reason: "busy",
        message: "이전 V12 UV 표면 획이 아직 끝나지 않았습니다.",
      }, this.snapshot.lastCommit);
    }
    const runtime = input.runtime;
    if (runtime === null) {
      const receipt = createBeginFailureReceipt({
        status: "unavailable",
        reason: "runtime-unavailable",
        message: "선택한 V12 UV 표면 브러시 provider가 연결되지 않았습니다.",
      }, this.snapshot.lastCommit);
      this.publish({
        status: receipt.status,
        activePointerId: null,
        sampleCount: 0,
        message: receipt.message,
        errorCode: receipt.reason,
      });
      return receipt;
    }
    const runtimeFailure = inspectRuntimeAdmission(runtime);
    if (runtimeFailure) {
      const receipt = createBeginFailureReceipt(runtimeFailure, this.snapshot.lastCommit);
      this.publish({
        status: receipt.status,
        activePointerId: null,
        sampleCount: 0,
        message: receipt.message,
        errorCode: receipt.reason,
      });
      return receipt;
    }
    if (!validPointerSample(input.sample) || !validSettings(input.settings)) {
      const receipt = createBeginFailureReceipt({
        status: "rejected",
        reason: "invalid-input",
        message: "포인터 또는 브러시 값이 유효하지 않아 선택한 표면 획을 거부했습니다.",
      }, this.snapshot.lastCommit);
      this.publish({
        status: receipt.status,
        activePointerId: null,
        sampleCount: 0,
        message: receipt.message,
        errorCode: receipt.reason,
      });
      return receipt;
    }
    if (
      !Number.isSafeInteger(input.sample.hit.faceIndex)
      || (input.sample.hit.faceIndex as number) < 0
    ) {
      const receipt = createBeginFailureReceipt({
        status: "rejected",
        reason: "unsupported-face-index",
        message: "UV seam을 증명할 faceIndex가 없어 선택한 표면 획을 거부했습니다.",
      }, this.snapshot.lastCommit);
      this.publish({
        status: receipt.status,
        activePointerId: null,
        sampleCount: 0,
        message: receipt.message,
        errorCode: receipt.reason,
      });
      return receipt;
    }

    this.sequence = Math.min(Number.MAX_SAFE_INTEGER, this.sequence + 1);
    this.active = {
      pointerId: input.sample.pointerId,
      runtime,
      settings: Object.freeze({ ...input.settings }),
      samples: [Object.freeze({ ...input.sample })],
      abortController: new AbortController(),
      sequence: this.sequence,
      finishing: false,
    };
    this.publish({
      status: "collecting",
      activePointerId: input.sample.pointerId,
      sampleCount: 1,
      message: "V12 UV 획을 수집 중입니다. 포인터를 놓으면 한 번에 아틀라스에 저장합니다.",
      errorCode: null,
    });
    return Object.freeze({
      ok: true,
      status: "accepted",
      route: "surface-brush",
      selectedToolId: STUDIO_VRM_SURFACE_PAINT_TOOL_ID,
      selectedProviderId: STUDIO_VRM_SURFACE_PAINT_PROVIDER_ID,
    });
  }

  append(sample: StudioVrmSurfacePaintPointerSample): boolean {
    const active = this.active;
    if (
      !active
      || active.finishing
      || active.pointerId !== sample.pointerId
      || !validPointerSample(sample)
    ) {
      return false;
    }
    if (active.samples.length >= this.maxSamples) {
      active.abortController.abort("surface sample budget exceeded");
      this.active = null;
      this.publish({
        status: "error",
        activePointerId: null,
        sampleCount: 0,
        message: `한 획의 입력 한도 ${this.maxSamples.toLocaleString("ko-KR")}개를 넘어 획 전체를 취소했습니다.`,
        errorCode: "sample-budget",
      });
      return false;
    }
    active.samples.push(Object.freeze({ ...sample }));
    this.publish({
      status: "collecting",
      activePointerId: active.pointerId,
      sampleCount: active.samples.length,
      message: "V12 UV 획을 수집 중입니다. 포인터를 놓으면 한 번에 아틀라스에 저장합니다.",
      errorCode: null,
    });
    return true;
  }

  async finish(pointerId: number): Promise<StudioVrmSurfacePaintToolFinishResult> {
    const active = this.active;
    if (!active || active.pointerId !== pointerId || active.finishing) {
      return Object.freeze({
        ok: false,
        cancelled: false,
        error: new Error("surface pointer transaction is not active"),
      });
    }
    active.finishing = true;
    this.publish({
      status: "committing",
      activePointerId: pointerId,
      sampleCount: active.samples.length,
      message: "UV chart 경계를 나눈 뒤 아틀라스에 한 획으로 저장하는 중입니다.",
      errorCode: null,
    });

    let built: Readonly<{ brushProgram: BrushProgramIR; stroke: StrokeIR }>;
    try {
      built = buildStroke(active);
      const support = inspectStudioVrmSurfaceBrushProgram(built.brushProgram);
      if (!support.supported) {
        this.active = null;
        this.publish({
          status: "rejected",
          activePointerId: null,
          sampleCount: 0,
          message: support.message,
          errorCode: support.errorCode,
        });
        return Object.freeze({ ok: false, cancelled: false, error: new Error(support.message) });
      }
    } catch (error) {
      this.active = null;
      this.publish({
        status: "error",
        activePointerId: null,
        sampleCount: 0,
        message: "V12 획 데이터를 만들 수 없어 표면을 변경하지 않았습니다.",
        errorCode: "invalid-input",
      });
      return Object.freeze({ ok: false, cancelled: false, error });
    }

    try {
      const execution = await this.executeStroke({
        runtime: active.runtime,
        brushProgram: built.brushProgram,
        stroke: built.stroke,
        rayHits: active.samples.map((sample) => sample.hit),
        worldUnitsPerCssPixelBySample: active.samples.map(
          (sample) => sample.worldUnitsPerCssPixel,
        ),
        signal: active.abortController.signal,
        execution: {
          missPolicy: "break",
          maxOperations: this.maxOperations,
        },
      });
      if (this.active === active) this.active = null;
      if (!this.disposed) {
        const revision = execution.receipt.commitReceipt
          && "revision" in execution.receipt.commitReceipt
          && typeof execution.receipt.commitReceipt.revision === "number"
            ? execution.receipt.commitReceipt.revision
            : null;
        this.publish({
          status: "ready",
          activePointerId: null,
          sampleCount: 0,
          message: `V12 UV 획을 ${execution.receipt.runs}개 chart run으로 저장했습니다.`,
          errorCode: null,
          lastCommit: Object.freeze({
            strokeId: built.stroke.id,
            inputSamples: execution.receipt.inputSamples,
            runs: execution.receipt.runs,
            seamBreaks: execution.receipt.seamBreaks,
            operations: execution.receipt.operations,
            revision,
          }),
        });
      }
      return Object.freeze({
        ok: true,
        brushProgram: built.brushProgram,
        stroke: built.stroke,
        execution,
      });
    } catch (error) {
      const cancelled = active.abortController.signal.aborted;
      if (this.active === active) this.active = null;
      if (!this.disposed) {
        if (cancelled) {
          this.publish({
            status: "ready",
            activePointerId: null,
            sampleCount: 0,
            message: "V12 UV 획을 취소해 아틀라스와 실행 취소 기록을 그대로 유지했습니다.",
            errorCode: null,
          });
        } else {
          const classified = classifyExecutionError(error);
          this.publish({
            status: "error",
            activePointerId: null,
            sampleCount: 0,
            message: classified.message,
            errorCode: classified.code,
          });
        }
      }
      return Object.freeze({ ok: false, cancelled, error });
    }
  }

  cancel(
    reason: StudioVrmSurfacePaintCancelReason,
    matchingPointerId?: number,
  ): boolean {
    const active = this.active;
    if (
      !active
      || (matchingPointerId !== undefined && matchingPointerId !== active.pointerId)
    ) {
      return false;
    }
    active.abortController.abort(reason);
    if (active.finishing) {
      if (!this.disposed) {
        this.publish({
          status: "cancelling",
          activePointerId: active.pointerId,
          sampleCount: active.samples.length,
          message: "진행 중인 V12 UV 획을 원자적으로 취소하는 중입니다.",
          errorCode: null,
        });
      }
      return true;
    }
    this.active = null;
    if (!this.disposed) {
      const deviceFailure = reason === "device-failure";
      this.publish({
        status: deviceFailure ? "error" : "ready",
        activePointerId: null,
        sampleCount: 0,
        message: deviceFailure
          ? "그래픽 장치 연결이 끊겨 진행 중인 표면 획을 취소하고 마지막 성공 결과를 유지했습니다. 다음 작업 전에 복구된 provider 또는 다른 도구를 명시적으로 선택하세요."
          : "V12 UV 획을 취소해 아틀라스와 실행 취소 기록을 그대로 유지했습니다.",
        errorCode: deviceFailure ? "device-failure" : null,
      });
    }
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const active = this.active;
    this.active = null;
    active?.abortController.abort("unmount");
  }

  private publish(
    update: Omit<StudioVrmSurfacePaintToolSnapshot, "lastCommit"> & {
      readonly lastCommit?: StudioVrmSurfacePaintToolSnapshot["lastCommit"];
    },
  ): void {
    this.snapshot = Object.freeze({
      ...update,
      lastCommit: update.lastCommit === undefined
        ? this.snapshot.lastCommit
        : update.lastCommit,
    });
    this.onSnapshot?.(this.snapshot);
  }
}

export function createStudioVrmSurfacePaintTool(
  options: CreateStudioVrmSurfacePaintToolOptions = {},
): StudioVrmSurfacePaintTool {
  return new StudioVrmSurfacePaintTool(options);
}
