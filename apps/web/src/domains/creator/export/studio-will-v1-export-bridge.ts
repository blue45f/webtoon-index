/**
 * UI-facing bridge from retained Studio freehand elements to the bounded,
 * clean-room WILL v1 Annex B document Worker.
 *
 * The small path-preparation bridge stays in Studio's stable graph. The OPC/ZIP protocol and its
 * Worker client load only after an explicit export request; none of that optional interchange
 * graph is needed to open or draw in Studio. This is a ToonSpectrum-owned public-specification
 * profile, not Wacom SDK output, vendor certification, or trademark authorization.
 */

import {
  resolveStudioInkPressureSamples,
  studioInkPressureDiameter,
} from "../brush/studio-ink-pressure-model";
import { parseStudioGpuColor } from "../render/studio-webgpu-color";

import type { DrawEl } from "../studio-element-model";
import type {
  StudioWillV1LossReport,
  StudioWillV1PathInput,
} from "../studio-will-v1-interchange";
import type { StudioWillV1OpcBuildResult } from "../studio-will-v1-opc-interchange";
import type { StudioWillV1OpcWorkerOptions } from "../studio-will-v1-opc-worker-client";

export const STUDIO_WILL_V1_EXPORT_PROFILE_LABEL =
  "ToonSpectrum bounded WILL v1 Annex B public-spec profile" as const;
export const STUDIO_WILL_V1_EXPORT_DISCLAIMER =
  "ToonSpectrum의 공개 명세 기반 bounded profile이며 Wacom 공식 SDK·인증 파일이 아닙니다." as const;
/** UI export deadline. The generic codec keeps its larger host-configurable ceiling. */
export const STUDIO_WILL_V1_EXPORT_DEFAULT_TIMEOUT_MS = 30_000;

export type StudioWillV1ExportSkipReason =
  | "color-not-representable"
  | "eraser-semantic-not-representable"
  | "hidden-element"
  | "invalid-freehand-geometry"
  | "non-freehand-shape";

export interface StudioWillV1ExportSkip {
  readonly elementId: string;
  readonly reason: StudioWillV1ExportSkipReason;
}

export interface StudioWillV1ExportAdaptation {
  readonly elementId: string;
  readonly reason: "zero-width-clamped-to-profile-minimum";
  readonly count: number;
}

export interface StudioWillV1PageExportInput {
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly elements: readonly Readonly<DrawEl>[];
  readonly signal?: AbortSignal;
  readonly workerOptions?: Omit<StudioWillV1OpcWorkerOptions, "signal">;
}

export interface StudioWillV1PageExportResult {
  readonly bytes: Uint8Array;
  readonly extension: ".will";
  readonly mediaType: "application/vnd.toonspectrum.will-v1-bounded+zip";
  readonly profileLabel: typeof STUDIO_WILL_V1_EXPORT_PROFILE_LABEL;
  readonly disclaimer: typeof STUDIO_WILL_V1_EXPORT_DISCLAIMER;
  readonly exportedStrokeIds: readonly string[];
  readonly skipped: readonly StudioWillV1ExportSkip[];
  readonly adaptations: readonly StudioWillV1ExportAdaptation[];
  readonly loss: StudioWillV1LossReport;
  readonly assurance: StudioWillV1OpcBuildResult["assurance"];
}

interface PreparedPath {
  readonly elementId: string;
  readonly path: StudioWillV1PathInput;
  readonly zeroWidthClampCount: number;
}

const WILL_DECIMAL_PRECISION = 2;
const WILL_MINIMUM_WIDTH = 1 / 10 ** WILL_DECIMAL_PRECISION;

function willV1ExportTimeoutError(timeoutMs: number): Error {
  const error = new Error(
    `WILL v1 파일을 ${timeoutMs}ms 안에 만들지 못했습니다. 다시 시도해 주세요.`,
  );
  error.name = "TimeoutError";
  return error;
}

function willV1ExportAbortError(): Error {
  const error = new Error("WILL v1 내보내기를 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function exportDeadlineMs(
  value: number | undefined,
): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? value!
    : STUDIO_WILL_V1_EXPORT_DEFAULT_TIMEOUT_MS;
}

async function runBoundedWillV1Export<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<T> {
  if (callerSignal?.aborted) throw willV1ExportAbortError();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let removeCallerAbort = () => {};
  const guard = new Promise<never>((_, reject) => {
    const onCallerAbort = () => {
      // Resolve the public failure before aborting the nested Worker promise so callers receive
      // this stable bridge-level reason even if an AbortSignal listener runs synchronously.
      reject(willV1ExportAbortError());
      controller.abort();
    };
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    removeCallerAbort = () => callerSignal?.removeEventListener(
      "abort",
      onCallerAbort,
    );
    timer = globalThis.setTimeout(() => {
      reject(willV1ExportTimeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), guard]);
  } finally {
    if (timer !== null) globalThis.clearTimeout(timer);
    removeCallerAbort();
  }
}

function boundedTitle(value: string): string {
  const title = Array.from(value.trim()).slice(0, 1_024).join("");
  return title || "Untitled";
}

function byteChannel(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function preparePath(element: Readonly<DrawEl>): PreparedPath | null {
  if (
    !Array.isArray(element.points)
    || element.points.length < 2
    || element.points.length % 2 !== 0
    || !element.points.every(Number.isFinite)
    || !Number.isFinite(element.strokeWidth)
    || element.strokeWidth <= 0
  ) {
    return null;
  }
  const color = parseStudioGpuColor(element.stroke);
  if (!color) return null;
  const sourcePoints = Array.from(
    { length: element.points.length / 2 },
    (_, index) => Object.freeze({
      x: element.points[index * 2]!,
      y: element.points[index * 2 + 1]!,
    })
  );
  const resolvedPressures = resolveStudioInkPressureSamples(
    element.pressures,
    sourcePoints.length,
    element.pressureModel
  );
  let zeroWidthClampCount = 0;
  const sourceWidths = resolvedPressures.map((pressure) => {
    const diameter = studioInkPressureDiameter(
      element.strokeWidth,
      pressure,
      element.pressureModel
    );
    if (diameter >= WILL_MINIMUM_WIDTH) return diameter;
    zeroWidthClampCount += 1;
    return WILL_MINIMUM_WIDTH;
  });
  const points = sourcePoints.length === 1
    ? [sourcePoints[0]!, sourcePoints[0]!, sourcePoints[0]!, sourcePoints[0]!]
    : [sourcePoints[0]!, ...sourcePoints, sourcePoints.at(-1)!];
  const strokeWidths = sourceWidths.length === 1
    ? [
        sourceWidths[0]!,
        sourceWidths[0]!,
        sourceWidths[0]!,
        sourceWidths[0]!,
      ]
    : [sourceWidths[0]!, ...sourceWidths, sourceWidths.at(-1)!];
  const opacity = typeof element.opacity === "number" && Number.isFinite(element.opacity)
    ? Math.min(1, Math.max(0, element.opacity))
    : 1;
  return Object.freeze({
    elementId: element.id,
    zeroWidthClampCount,
    path: Object.freeze({
      points: Object.freeze(points),
      strokeWidths: Object.freeze(strokeWidths),
      strokeColor: Object.freeze({
        r: byteChannel(color[0]),
        g: byteChannel(color[1]),
        b: byteChannel(color[2]),
        a: byteChannel(color[3] * opacity),
      }),
      decimalPrecision: WILL_DECIMAL_PRECISION,
    }),
  });
}

/**
 * Converts visible retained freehand strokes and invokes the one-shot module
 * Worker. Unsupported semantics are explicitly reported rather than silently
 * rasterized into the document.
 */
export async function exportStudioPageToWillV1(
  input: StudioWillV1PageExportInput
): Promise<StudioWillV1PageExportResult> {
  const paths: StudioWillV1PathInput[] = [];
  const exportedStrokeIds: string[] = [];
  const skipped: StudioWillV1ExportSkip[] = [];
  const adaptations: StudioWillV1ExportAdaptation[] = [];

  for (const element of input.elements) {
    if (element.hidden) {
      skipped.push({ elementId: element.id, reason: "hidden-element" });
      continue;
    }
    if (element.kind !== undefined && element.kind !== "freehand") {
      skipped.push({ elementId: element.id, reason: "non-freehand-shape" });
      continue;
    }
    if (element.mode === "eraser") {
      skipped.push({
        elementId: element.id,
        reason: "eraser-semantic-not-representable",
      });
      continue;
    }
    const prepared = preparePath(element);
    if (!prepared) {
      skipped.push({
        elementId: element.id,
        reason: parseStudioGpuColor(element.stroke)
          ? "invalid-freehand-geometry"
          : "color-not-representable",
      });
      continue;
    }
    paths.push(prepared.path);
    exportedStrokeIds.push(prepared.elementId);
    if (prepared.zeroWidthClampCount > 0) {
      adaptations.push({
        elementId: prepared.elementId,
        reason: "zero-width-clamped-to-profile-minimum",
        count: prepared.zeroWidthClampCount,
      });
    }
  }

  if (paths.length === 0) {
    throw new Error("WILL v1으로 내보낼 수 있는 보이는 펜 자유곡선이 없어요.");
  }
  const timeoutMs = exportDeadlineMs(input.workerOptions?.timeoutMs);
  const result = await runBoundedWillV1Export(
    async (signal) => {
      const [workerRuntime, interchange] = await Promise.all([
        import("../studio-will-v1-opc-worker-client"),
        import("../studio-will-v1-opc-interchange"),
      ]);
      const { buildStudioWillV1OpcBytesInWorker } = workerRuntime;
      const {
        STUDIO_WILL_V1_OPC_EXTENSION,
        STUDIO_WILL_V1_OPC_MEDIA_TYPE,
      } = interchange;
      const built = await buildStudioWillV1OpcBytesInWorker(
        {
          width: input.width,
          height: input.height,
          title: boundedTitle(input.title),
          application: "ToonSpectrum",
          applicationVersion: "1.0",
          paths,
        },
        {
          ...input.workerOptions,
          timeoutMs: input.workerOptions?.timeoutMs
            ?? STUDIO_WILL_V1_EXPORT_DEFAULT_TIMEOUT_MS,
          signal,
        },
      );
      return Object.freeze({
        built,
        extension: STUDIO_WILL_V1_OPC_EXTENSION,
        mediaType: STUDIO_WILL_V1_OPC_MEDIA_TYPE,
      });
    },
    timeoutMs,
    input.signal,
  );

  return Object.freeze({
    bytes: Uint8Array.from(result.built.bytes),
    extension: result.extension,
    mediaType: result.mediaType,
    profileLabel: STUDIO_WILL_V1_EXPORT_PROFILE_LABEL,
    disclaimer: STUDIO_WILL_V1_EXPORT_DISCLAIMER,
    exportedStrokeIds: Object.freeze(exportedStrokeIds),
    skipped: Object.freeze(skipped.map((item) => Object.freeze(item))),
    adaptations: Object.freeze(
      adaptations.map((item) => Object.freeze(item))
    ),
    loss: result.built.loss,
    assurance: result.built.assurance,
  });
}
