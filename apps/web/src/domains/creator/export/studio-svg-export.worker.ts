import { serializeStudioBrushR8TextureGrainSourceCanonical } from "../brush/studio-brush-r8-grain-asset-contract";
import {
  hydrateStudioBrushR8GrainAsset,
  resetStudioBrushR8GrainRegistry,
} from "../brush/studio-brush-r8-grain-runtime";
import { loadStudioPerfectFreehandStroker } from "../studio-perfect-freehand";

import { exportPageToSvg } from "./studio-svg-export";
import {
  collectStudioSvgExportReferencedR8GrainSources,
  STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
  STUDIO_SVG_EXPORT_WORKER_R8_TRANSFER_LIMITS,
  type StudioSvgExportWorkerFailureMessage,
  type StudioSvgExportWorkerR8GrainEntry,
  type StudioSvgExportWorkerResponseMessage,
  type StudioSvgExportWorkerRunMessage,
  type StudioSvgExportWorkerSuccessMessage,
} from "./studio-svg-export-worker-protocol";

interface StudioSvgExportWorkerScope {
  onmessage: ((event: MessageEvent<StudioSvgExportWorkerRunMessage>) => void) | null;
  postMessage(message: StudioSvgExportWorkerResponseMessage): void;
}

const workerScope = globalThis as unknown as StudioSvgExportWorkerScope;

workerScope.postMessage({
  type: "studio-svg-export/ready",
  version: STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
});

function serializeWorkerError(error: unknown): StudioSvgExportWorkerFailureMessage["error"] {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message || "SVG 내보내기 Worker 실행에 실패했습니다." };
  }
  return { name: "Error", message: "SVG 내보내기 Worker 실행에 실패했습니다." };
}

function isPrivateExactUint8Array(value: unknown): value is Uint8Array<ArrayBuffer> {
  return (
    value instanceof Uint8Array
    && Object.getPrototypeOf(value) === Uint8Array.prototype
    && value.buffer instanceof ArrayBuffer
    && value.byteOffset === 0
    && value.byteLength === value.buffer.byteLength
  );
}

function zeroizeTransferredR8Assets(entries: unknown): void {
  if (!Array.isArray(entries)) return;
  for (const candidate of entries) {
    if (typeof candidate !== "object" || candidate === null) continue;
    try {
      const bytes = (candidate as Partial<StudioSvgExportWorkerR8GrainEntry>).decodedBytes;
      if (isPrivateExactUint8Array(bytes)) bytes.fill(0);
    } catch {
      // Untrusted/malformed protocol data must never make cleanup fail.
    }
  }
}

/**
 * Validates the complete envelope before hydrating anything. Missing, malformed, duplicate,
 * unreferenced or over-budget entries stay unavailable; the renderer then emits its existing
 * fail-closed caveat instead of silently substituting a procedural texture.
 */
export function hydrateStudioSvgExportWorkerR8Assets(
  input: StudioSvgExportWorkerRunMessage["input"],
  entries: unknown,
): void {
  resetStudioBrushR8GrainRegistry();
  if (
    !Array.isArray(entries)
    || entries.length > STUDIO_SVG_EXPORT_WORKER_R8_TRANSFER_LIMITS.maxEntries
  ) {
    return;
  }

  let totalDecodedBytes = 0;
  for (const candidate of entries) {
    if (typeof candidate !== "object" || candidate === null) return;
    const bytes = (candidate as Partial<StudioSvgExportWorkerR8GrainEntry>).decodedBytes;
    if (!isPrivateExactUint8Array(bytes)) return;
    totalDecodedBytes += bytes.byteLength;
    if (
      !Number.isSafeInteger(totalDecodedBytes)
      || totalDecodedBytes > STUDIO_SVG_EXPORT_WORKER_R8_TRANSFER_LIMITS.maxDecodedBytes
    ) {
      return;
    }
  }

  const referenced = new Map(
    collectStudioSvgExportReferencedR8GrainSources(input)
      .map((entry) => [entry.sourceKey, entry.source] as const),
  );
  const validated = new Map<string, Readonly<StudioSvgExportWorkerR8GrainEntry>>();
  const invalidKeys = new Set<string>();

  for (const candidate of entries as StudioSvgExportWorkerR8GrainEntry[]) {
    const expectedSource = referenced.get(candidate.sourceKey);
    if (!expectedSource) continue;
    if (
      serializeStudioBrushR8TextureGrainSourceCanonical(candidate.source)
        !== candidate.sourceKey
      || candidate.source.asset.width * candidate.source.asset.height
        !== candidate.decodedBytes.byteLength
      || invalidKeys.has(candidate.sourceKey)
      || validated.has(candidate.sourceKey)
    ) {
      invalidKeys.add(candidate.sourceKey);
      validated.delete(candidate.sourceKey);
      continue;
    }
    validated.set(candidate.sourceKey, candidate);
  }

  for (const [sourceKey, candidate] of validated) {
    if (invalidKeys.has(sourceKey)) continue;
    hydrateStudioBrushR8GrainAsset(candidate.source, candidate.decodedBytes);
  }
}

workerScope.onmessage = async (event) => {
  const candidate = event.data as unknown;
  if (
    typeof candidate !== "object"
    || candidate === null
    || (candidate as Partial<StudioSvgExportWorkerRunMessage>).type
      !== "studio-svg-export/run"
    || (candidate as Partial<StudioSvgExportWorkerRunMessage>).version
      !== STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION
  ) {
    // The client transfers private R8 buffers before the worker can validate the version. A stale
    // or malformed envelope must not strand those bytes merely because it is rejected early.
    zeroizeTransferredR8Assets(
      typeof candidate === "object" && candidate !== null
        ? (candidate as Partial<StudioSvgExportWorkerRunMessage>).r8GrainAssets
        : undefined,
    );
    resetStudioBrushR8GrainRegistry();
    return;
  }
  const message = candidate as StudioSvgExportWorkerRunMessage;

  try {
    hydrateStudioSvgExportWorkerR8Assets(message.input, message.r8GrainAssets);
    // This worker is intentionally short-lived, so its dynamic-module cache starts empty for every
    // export. Wait for the outline stroker before the first serialization; otherwise G-pen and
    // perfect-* strokes would silently fall back to a uniform-width SVG only in exported files.
    await loadStudioPerfectFreehandStroker();
    const result = exportPageToSvg(message.input);
    const response: StudioSvgExportWorkerSuccessMessage = {
      type: "studio-svg-export/success",
      version: STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
      result,
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: StudioSvgExportWorkerFailureMessage = {
      type: "studio-svg-export/failure",
      version: STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
      error: serializeWorkerError(error),
    };
    workerScope.postMessage(response);
  } finally {
    resetStudioBrushR8GrainRegistry();
    zeroizeTransferredR8Assets(message.r8GrainAssets);
  }
};
