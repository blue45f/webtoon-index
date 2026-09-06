/**
 * Canonical compressed-geometry capability shared by import, verification, and renderer admission.
 *
 * Keep the decoder behind a dynamic import so opening Studio without entering the 3D workspace does
 * not pay for its embedded WASM payload. The decoder's own worker pool is bounded: more workers can
 * increase peak decoded-buffer duplication and usually gives diminishing returns for editor loads.
 */

export const STUDIO_BG3D_MESHOPT_EXTENSION = "EXT_meshopt_compression" as const;
export const STUDIO_BG3D_KTX2_EXTENSION = "KHR_texture_basisu" as const;

export const STUDIO_BG3D_CANONICAL_REQUIRED_GLTF_EXTENSIONS = Object.freeze([
  STUDIO_BG3D_MESHOPT_EXTENSION,
  STUDIO_BG3D_KTX2_EXTENSION,
] as const);

export interface StudioBg3dMeshoptWorkerSignals {
  readonly hardwareConcurrency?: number;
  readonly workerAvailable: boolean;
  readonly blobWorkerAvailable: boolean;
}

export function resolveStudioBg3dMeshoptWorkerCount(
  signals: StudioBg3dMeshoptWorkerSignals,
): 0 | 1 | 2 {
  if (!signals.workerAvailable || !signals.blobWorkerAvailable) return 0;
  const concurrency = Number.isFinite(signals.hardwareConcurrency)
    ? Math.max(1, Math.floor(signals.hardwareConcurrency ?? 1))
    : 1;
  if (concurrency >= 8) return 2;
  if (concurrency >= 4) return 1;
  return 0;
}

type MeshoptDecoderModule = typeof import("three/examples/jsm/libs/meshopt_decoder.module.js");
export type StudioBg3dMeshoptDecoder = MeshoptDecoderModule["MeshoptDecoder"];

let workerConfigurationAttempted = false;

function configureDecoderWorkers(decoder: StudioBg3dMeshoptDecoder): void {
  if (workerConfigurationAttempted) return;
  workerConfigurationAttempted = true;
  const workerAvailable = typeof Worker === "function";
  const blobWorkerAvailable = typeof Blob === "function"
    && typeof URL === "function"
    && typeof URL.createObjectURL === "function"
    && typeof URL.revokeObjectURL === "function";
  const workerCount = resolveStudioBg3dMeshoptWorkerCount({
    hardwareConcurrency: typeof navigator === "object" ? navigator.hardwareConcurrency : undefined,
    workerAvailable,
    blobWorkerAvailable,
  });
  if (workerCount === 0) return;
  try {
    decoder.useWorkers(workerCount);
  } catch {
    // CSPs may reject blob-backed workers. MeshoptDecoder keeps its safe asynchronous WASM path.
  }
}

export async function loadStudioBg3dMeshoptDecoder(): Promise<StudioBg3dMeshoptDecoder> {
  const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
  configureDecoderWorkers(MeshoptDecoder);
  return MeshoptDecoder;
}
