import type {
  AdvancedFillImageDataLike,
  AdvancedFillRequest,
  AdvancedFillResult,
} from "./studio-advanced-fill";

export const STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION = 1 as const;

/**
 * Worker requests intentionally omit `abort`: a running module worker is cancelled by terminating
 * it, which can interrupt CPU work even while the browser main thread remains responsive.
 */
export type StudioAdvancedFillWorkerRunRequest = Omit<AdvancedFillRequest, "abort"> & {
  /** Runs the O(width×height) inside-edge blend in the same worker before returning pixels. */
  readonly softenEdges?: boolean;
  /** Forces the final alpha silhouette to alphaLockSource (or target when omitted). */
  readonly enforceAlphaLock?: boolean;
  readonly alphaLockSource?: AdvancedFillImageDataLike;
};

export interface StudioAdvancedFillWorkerRunMessage {
  type: "studio-advanced-fill/run";
  version: typeof STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION;
  request: StudioAdvancedFillWorkerRunRequest;
}

export interface StudioAdvancedFillWorkerSuccessMessage {
  type: "studio-advanced-fill/success";
  version: typeof STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION;
  /** The input target is returned because its transferred buffer is detached on the caller side. */
  originalTarget: AdvancedFillImageDataLike;
  result: AdvancedFillResult;
}

export interface StudioAdvancedFillWorkerReadyMessage {
  type: "studio-advanced-fill/ready";
  version: typeof STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION;
}

export interface StudioAdvancedFillWorkerFailureMessage {
  type: "studio-advanced-fill/failure";
  version: typeof STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION;
  error: {
    name: string;
    message: string;
  };
}

export type StudioAdvancedFillWorkerResponseMessage =
  | StudioAdvancedFillWorkerReadyMessage
  | StudioAdvancedFillWorkerSuccessMessage
  | StudioAdvancedFillWorkerFailureMessage;

type TransferView = { readonly buffer: ArrayBufferLike };

function uniqueArrayBufferTransfers(views: readonly TransferView[]): Transferable[] {
  const seen = new Set<ArrayBuffer>();
  const transfers: Transferable[] = [];
  for (const view of views) {
    const buffer = view.buffer;
    // SharedArrayBuffer is cloneable but cannot be placed in a transfer list. Browser canvas and
    // ImageData buffers are ordinary ArrayBuffers, so the production path transfers ownership.
    if (!(buffer instanceof ArrayBuffer) || seen.has(buffer)) continue;
    seen.add(buffer);
    transfers.push(buffer);
  }
  return transfers;
}

export function studioAdvancedFillRequestTransfers(
  message: StudioAdvancedFillWorkerRunMessage,
): Transferable[] {
  const views: TransferView[] = [message.request.target.data];
  if (message.request.referenceImage) views.push(message.request.referenceImage.data);
  if (message.request.referenceMask) views.push(message.request.referenceMask.data);
  if (message.request.alphaLockSource) views.push(message.request.alphaLockSource.data);
  return uniqueArrayBufferTransfers(views);
}

export function studioAdvancedFillSuccessTransfers(
  message: StudioAdvancedFillWorkerSuccessMessage,
): Transferable[] {
  return uniqueArrayBufferTransfers([
    message.originalTarget.data,
    message.result.imageData.data,
    message.result.matchedMask,
    message.result.mask,
  ]);
}
