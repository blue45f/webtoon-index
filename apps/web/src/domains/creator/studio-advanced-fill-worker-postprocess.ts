import { softenStudioAdvancedFillEdges, type AdvancedFillResult } from "./studio-advanced-fill";
import { applyAlphaLockToRasterPixels } from "./studio-alpha-lock";

import type { StudioAdvancedFillWorkerRunRequest } from "./studio-advanced-fill-worker-protocol";

/** Applies expensive edge and Alpha Lock passes inside the same worker as the flood scan. */
export function postprocessStudioAdvancedFillWorkerResult(
  request: StudioAdvancedFillWorkerRunRequest,
  result: AdvancedFillResult,
): AdvancedFillResult {
  if (result.diagnostics.status !== "applied") return result;
  if (request.softenEdges) {
    softenStudioAdvancedFillEdges(
      result.imageData.data,
      request.target.data,
      result.mask,
      request.target.width,
      request.target.height,
      request.fill,
    );
  }
  if (!request.enforceAlphaLock) return result;

  const lockSource = request.alphaLockSource ?? request.target;
  if (
    lockSource.width !== request.target.width ||
    lockSource.height !== request.target.height
  ) {
    throw new RangeError("알파 락 원본과 채우기 대상의 픽셀 크기가 다릅니다.");
  }
  const locked = applyAlphaLockToRasterPixels(
    lockSource.data,
    request.target.data,
    result.imageData.data,
  );
  const areaRatio = locked.changedPixelCount / (result.diagnostics.width * result.diagnostics.height);
  return {
    ...result,
    imageData: {
      data: locked.data,
      width: result.imageData.width,
      height: result.imageData.height,
    },
    diagnostics: {
      ...result.diagnostics,
      status: locked.changedPixelCount === 0 ? "noop" : "applied",
      paintedPixelCount: locked.changedPixelCount,
      final: {
        ...result.diagnostics.final,
        pixelCount: locked.changedPixelCount,
        areaRatio,
      },
    },
  };
}
