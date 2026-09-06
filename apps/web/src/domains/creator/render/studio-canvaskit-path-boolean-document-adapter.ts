import {
  studioPathBooleanOutputFromPortableContours,
  studioPathBooleanShapeToSvgPathData,
  type StudioPathBooleanCombineResult,
  type StudioPathBooleanOp,
  type StudioPathBooleanShapeSpec,
} from "../studio-path-boolean";

import type {
  StudioQualityWorkerClientResult,
  StudioQualityWorkerRunOptions,
} from "../studio-quality-worker-client";

export const STUDIO_CANVASKIT_PATH_BOOLEAN_DOCUMENT_ADAPTER_VERSION =
  1 as const;

export interface StudioCanvasKitPathBooleanClient {
  pathBoolean(
    a: string,
    b: string,
    op: "union" | "difference" | "intersect" | "xor",
    options?: StudioQualityWorkerRunOptions,
  ): Promise<StudioQualityWorkerClientResult>;
}

export type StudioCanvasKitPathBooleanDocumentResult =
  | Readonly<{
      ok: true;
      output: Extract<StudioPathBooleanCombineResult, { ok: true }>["output"];
      provider: Readonly<{
        id: "canvaskit";
        adapterVersion:
          typeof STUDIO_CANVASKIT_PATH_BOOLEAN_DOCUMENT_ADAPTER_VERSION;
        workerEpoch: number;
        requestId: number;
        requestToken: string;
      }>;
    }>
  | Readonly<{ ok: false; reason: string }>;

function qualityOperation(
  operation: StudioPathBooleanOp,
): "union" | "difference" | "intersect" | "xor" {
  switch (operation) {
    case "union":
      return "union";
    case "subtract":
      return "difference";
    case "intersect":
      return "intersect";
    case "exclude":
      return "xor";
  }
}

/**
 * Settled-only document adapter. It submits exact cubic shape paths to the persistent CanvasKit
 * Worker, admits only its portable contour receipt, and adapts that suggestion to the current
 * points-based DrawEl boundary. Document/history/selection authority stays with StudioPage.
 */
export async function combineStudioShapesWithCanvasKit(
  client: StudioCanvasKitPathBooleanClient,
  base: StudioPathBooleanShapeSpec,
  top: StudioPathBooleanShapeSpec,
  operation: StudioPathBooleanOp,
  options: StudioQualityWorkerRunOptions = {},
): Promise<StudioCanvasKitPathBooleanDocumentResult> {
  const basePath = studioPathBooleanShapeToSvgPathData(base);
  if (!basePath.ok) return { ok: false, reason: `아래 도형: ${basePath.reason}` };
  const topPath = studioPathBooleanShapeToSvgPathData(top);
  if (!topPath.ok) return { ok: false, reason: `위 도형: ${topPath.reason}` };

  const response = await client.pathBoolean(
    basePath.pathData,
    topPath.pathData,
    qualityOperation(operation),
    options,
  );
  if (!response.result.ok) return response.result;
  if (response.operationKind !== "path-boolean") {
    return {
      ok: false,
      reason: "CanvasKit Worker가 다른 종류의 연산 결과를 반환했습니다.",
    };
  }
  const geometry = response.result.geometry;
  if (geometry === undefined) {
    return {
      ok: false,
      reason: "CanvasKit Worker 결과에 안전한 contour 영수증이 없습니다.",
    };
  }
  const combined = studioPathBooleanOutputFromPortableContours(
    geometry.contours,
    operation,
  );
  if (!combined.ok) return combined;
  return Object.freeze({
    ok: true,
    output: combined.output,
    provider: Object.freeze({
      id: "canvaskit",
      adapterVersion:
        STUDIO_CANVASKIT_PATH_BOOLEAN_DOCUMENT_ADAPTER_VERSION,
      workerEpoch: response.workerEpoch,
      requestId: response.requestId,
      requestToken: response.requestToken,
    }),
  });
}
