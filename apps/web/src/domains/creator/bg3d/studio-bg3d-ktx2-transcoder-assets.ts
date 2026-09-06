import basisJavascriptSource from "three/examples/jsm/libs/basis/basis_transcoder.js?raw";
import basisWasmUrl from "three/examples/jsm/libs/basis/basis_transcoder.wasm?url";

import { readBoundedStudioAssetResponse } from "../studio-bounded-asset-response";

import { STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST } from "./studio-bg3d-ktx2-transcoder-contract";

import type { StudioBg3dKtx2TranscoderAssets } from "./studio-bg3d-ktx2-transcoder-contract";

/**
 * Loads the exact Three Basis assets used by both the validation Worker and the viewport runtime.
 *
 * The JavaScript wrapper remains a build-time raw string because Vite's served `?url` JavaScript
 * may include transform metadata. WASM is an emitted same-origin asset and is read through the
 * shared bounded-response guard before either execution realm may attest it.
 */
export async function loadPinnedStudioBg3dKtx2TranscoderAssets(
  signal?: AbortSignal,
): Promise<StudioBg3dKtx2TranscoderAssets> {
  const javascript = new TextEncoder().encode(basisJavascriptSource);
  const response = await fetch(basisWasmUrl, {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw new Error("studio-bg3d-ktx2-wasm-fetch-failed");
  const wasm = await readBoundedStudioAssetResponse(
    response,
    STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.wasm.byteLength,
    STUDIO_BG3D_KTX2_TRANSCODER_ASSET_MANIFEST.wasm.byteLength,
    signal,
  );
  return { javascript, wasm };
}
