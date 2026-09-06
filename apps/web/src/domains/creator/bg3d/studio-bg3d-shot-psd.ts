import { writePsdUint8Array, type Layer, type Psd } from "ag-psd";

import {
  STUDIO_BG3D_SHOT_PSD_MAX_OUTPUT_BYTES,
  STUDIO_BG3D_SHOT_PSD_MIME,
  admitStudioBg3dShotPsdLayers,
} from "./studio-bg3d-shot-psd-contract";

import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";

const LAYER_NAMES: Readonly<Record<StudioBg3dLtRasterLayer["role"], string>> = Object.freeze({
  color: "3D LT · 컬러 렌더",
  tone: "3D LT · 톤",
  "texture-line": "3D LT · 질감선",
  "main-line": "3D LT · 주선",
});

export function buildStudioBg3dShotLayeredPsd(
  layers: readonly StudioBg3dLtRasterLayer[],
): Blob {
  const admission = admitStudioBg3dShotPsdLayers(layers);
  if (!admission.ok) {
    throw new RangeError(`3D 컷 PSD 입력이 안전 예산을 벗어났습니다: ${admission.reason}`);
  }
  const seenRoles = new Set<StudioBg3dLtRasterLayer["role"]>();
  for (const layer of layers) {
    if (seenRoles.has(layer.role)) throw new TypeError("3D 컷 PSD 레이어 role이 중복되었습니다.");
    seenRoles.add(layer.role);
  }
  // LT uses back-to-front paint order; PSD children use panel top-to-bottom order.
  const children: Layer[] = [...layers].reverse().map((layer) => ({
    name: LAYER_NAMES[layer.role],
    top: 0,
    left: 0,
    bottom: admission.height,
    right: admission.width,
    imageData: {
      width: admission.width,
      height: admission.height,
      data: layer.data,
    },
  }));
  const psd: Psd = { width: admission.width, height: admission.height, children };
  const bytes = writePsdUint8Array(psd, {
    noBackground: true,
    generateThumbnail: false,
    trimImageData: false,
    compress: false,
  });
  if (
    bytes.byteLength < 6 ||
    bytes.byteLength > STUDIO_BG3D_SHOT_PSD_MAX_OUTPUT_BYTES ||
    bytes[0] !== 0x38 || bytes[1] !== 0x42 || bytes[2] !== 0x50 || bytes[3] !== 0x53 ||
    bytes[4] !== 0 || bytes[5] !== 1
  ) {
    throw new RangeError("3D 컷 PSD 결과가 signature, version 또는 출력 예산을 벗어났습니다.");
  }
  const blobBuffer = bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : Uint8Array.from(bytes).buffer;
  return new Blob([blobBuffer], { type: STUDIO_BG3D_SHOT_PSD_MIME });
}
