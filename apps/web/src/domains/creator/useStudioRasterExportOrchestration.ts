import { useRef } from "react";

import {
  shouldDrawWatermark,
  watermarkPlacement,
  type WatermarkSettings,
} from "./studio-watermark";

import type {
  StudioRasterExportOrchestration,
  StudioRasterExportOrchestrationInput,
} from "./render/studio-raster-export-orchestration-runtime";

type StudioRasterExportIntentInput = Omit<
  StudioRasterExportOrchestrationInput,
  "drawWatermarkOnCanvas"
>;

type StudioRasterExportRuntimeModule = Pick<
  typeof import("./studio-page-orchestration-runtime"),
  "createStudioRasterExportOrchestration"
>;

export interface StudioRasterExportIntentLock {
  current: boolean;
}

function loadStudioPageOrchestrationRuntime(): Promise<StudioRasterExportRuntimeModule> {
  return import("./studio-page-orchestration-runtime");
}

function drawStudioWatermarkOnCanvas(
  canvas: HTMLCanvasElement,
  settings: WatermarkSettings,
): void {
  if (!shouldDrawWatermark(settings)) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const placement = watermarkPlacement(canvas.width, canvas.height, settings);
  const text = settings.text.trim();
  context.save();
  context.globalAlpha = Math.min(1, Math.max(0, settings.opacity));
  context.font = `700 ${placement.fontPx}px "Pretendard", system-ui, sans-serif`;
  context.textAlign = placement.textAlign;
  context.textBaseline = placement.textBaseline;
  context.lineJoin = "round";
  context.lineWidth = Math.max(1.5, placement.fontPx * 0.09);
  context.strokeStyle = "rgba(0,0,0,0.72)";
  context.strokeText(text, placement.x, placement.y);
  context.fillStyle = "#ffffff";
  context.fillText(text, placement.x, placement.y);
  context.restore();
}

export function createStudioRasterExportIntentController(
  input: StudioRasterExportIntentInput,
  operationInFlightRef: StudioRasterExportIntentLock,
  loadRuntime: () => Promise<StudioRasterExportRuntimeModule> =
    loadStudioPageOrchestrationRuntime,
): StudioRasterExportOrchestration {
  const load = async () => {
    const { createStudioRasterExportOrchestration } = await loadRuntime();
    return createStudioRasterExportOrchestration({
      ...input,
      drawWatermarkOnCanvas: drawStudioWatermarkOnCanvas,
    });
  };
  const runExclusive = async <Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    if (operationInFlightRef.current) {
      throw new Error("다른 내보내기 작업이 끝난 뒤 다시 시도해 주세요.");
    }
    operationInFlightRef.current = true;
    try {
      return await operation();
    } finally {
      operationInFlightRef.current = false;
    }
  };

  return {
    handleDownload: async () => {
      try {
        await runExclusive(async () => (await load()).handleDownload());
      } catch (error) {
        input.setError(
          error instanceof Error ? error.message : "이미지 내보내기 도구를 불러오지 못했어요.",
        );
      }
    },
    exportCurrentPageToRasterInterchange: (format) =>
      runExclusive(async () =>
        (await load()).exportCurrentPageToRasterInterchange(format)
      ),
    handleCopyToClipboard: async () => {
      try {
        await runExclusive(async () => (await load()).handleCopyToClipboard());
      } catch (error) {
        input.setError(
          error instanceof Error ? error.message : "클립보드 내보내기 도구를 불러오지 못했어요.",
        );
      }
    },
    handleDownloadAll: async (spacing) => {
      try {
        await runExclusive(async () => (await load()).handleDownloadAll(spacing));
      } catch (error) {
        input.setError(
          error instanceof Error ? error.message : "일괄 내보내기 도구를 불러오지 못했어요.",
        );
      }
    },
    handleCapturePagesForPreset: (scope) =>
      runExclusive(async () =>
        (await load()).handleCapturePagesForPreset(scope)
      ),
    handleCapturePagesForIndices: (indices) =>
      runExclusive(async () =>
        (await load()).handleCapturePagesForIndices(indices)
      ),
  };
}

/**
 * The editor owns only these intent closures. Capture, composition and encoder orchestration is
 * fetched after the artist asks to export, keeping it off Studio's initial rendering graph.
 */
export function useStudioRasterExportOrchestration(
  input: StudioRasterExportIntentInput,
): StudioRasterExportOrchestration {
  const operationInFlightRef = useRef(false);
  return createStudioRasterExportIntentController(input, operationInFlightRef);
}
