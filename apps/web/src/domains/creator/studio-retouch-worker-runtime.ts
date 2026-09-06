import { wetMixStroke } from "./brush/studio-wet-mix";
import { dodgeBurnStroke } from "./studio-dodge-burn";
import {
  assertStudioRetouchWorkerRequest,
  type StudioRetouchWorkerRunRequest,
} from "./studio-retouch-worker-protocol";

export interface StudioRetouchWorkerRuntimeResult {
  readonly kind: StudioRetouchWorkerRunRequest["kind"];
  readonly data: Uint8ClampedArray;
  readonly w: number;
  readonly h: number;
}

/** Pure single-operation runtime shared by the module Worker and explicitly selected direct lane. */
export function applyStudioRetouchWorkerRequest(
  request: StudioRetouchWorkerRunRequest,
): StudioRetouchWorkerRuntimeResult {
  assertStudioRetouchWorkerRequest(request);
  const data = request.kind === "dodge-burn"
    ? dodgeBurnStroke(request.data, request.w, request.h, request.points, request.settings)
    : wetMixStroke(request.data, request.w, request.h, request.points, request.settings);
  return { kind: request.kind, data, w: request.w, h: request.h };
}
