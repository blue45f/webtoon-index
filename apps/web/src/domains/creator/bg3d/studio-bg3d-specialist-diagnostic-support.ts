import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  normalizeStudioBg3dSceneDocument,
  type StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

import type { StudioBg3dBabylonDiagnosticBackend } from "./StudioBg3dViewPanel";

export function createStudioBg3dBabylonDiagnosticDocument(): StudioBg3dSceneDocument {
  return normalizeStudioBg3dSceneDocument({
    ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    background: {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.background,
      mode: "color",
      color: "#f8fafc",
    },
    nodes: [{
      id: "babylon-diagnostic-box",
      name: "Babylon diagnostic box",
      kind: "primitive",
      primitiveKind: "box",
      color: "#4f46e5",
      transform: {
        position: [0, 0, 0],
        rotation: [0.2, 0.35, 0],
        scale: [1.6, 1.6, 1.6],
      },
      parentId: null,
      visible: true,
      locked: false,
      castsShadow: true,
      receivesShadow: true,
    }],
  });
}

export function hasStudioBg3dBabylonDiagnosticBeautyVariation(
  rgba: Uint8Array,
): boolean {
  let referencePixel = -1;
  for (let pixel = 0; pixel < rgba.length / 4; pixel += 1) {
    if (rgba[pixel * 4 + 3]! > 0) {
      referencePixel = pixel;
      break;
    }
  }
  if (referencePixel < 0) return false;
  const referenceOffset = referencePixel * 4;
  for (let pixel = referencePixel + 1; pixel < rgba.length / 4; pixel += 1) {
    const offset = pixel * 4;
    if (rgba[offset + 3]! <= 0) continue;
    const difference =
      Math.abs(rgba[offset]! - rgba[referenceOffset]!) +
      Math.abs(rgba[offset + 1]! - rgba[referenceOffset + 1]!) +
      Math.abs(rgba[offset + 2]! - rgba[referenceOffset + 2]!);
    if (difference >= 12) return true;
  }
  return false;
}

export function hasStudioBg3dBabylonDiagnosticDepthVariation(
  depth: Float32Array,
): boolean {
  let minimum = 1;
  let maximum = 0;
  for (const value of depth) {
    if (!Number.isFinite(value) || value < 0 || value > 1) return false;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return minimum < 0.999 && maximum >= 0.999 && maximum - minimum >= 0.01;
}

export function hasStudioBg3dBabylonDiagnosticNormalVariation(
  normal: Uint8Array,
  depth: Float32Array,
): boolean {
  if (normal.length !== depth.length * 2) return false;
  let minimumRed = 255;
  let maximumRed = 0;
  let minimumGreen = 255;
  let maximumGreen = 0;
  let geometryPixels = 0;
  for (let pixel = 0; pixel < depth.length; pixel += 1) {
    if (depth[pixel]! >= 0.999) continue;
    geometryPixels += 1;
    const offset = pixel * 2;
    minimumRed = Math.min(minimumRed, normal[offset]!);
    maximumRed = Math.max(maximumRed, normal[offset]!);
    minimumGreen = Math.min(minimumGreen, normal[offset + 1]!);
    maximumGreen = Math.max(maximumGreen, normal[offset + 1]!);
  }
  return (
    geometryPixels > 0 &&
    Math.max(maximumRed - minimumRed, maximumGreen - minimumGreen) >= 8
  );
}

export function hasStudioBg3dBabylonDiagnosticStableIds(
  data: Uint32Array,
  legend: readonly {
    readonly id: number;
    readonly label: string;
    readonly stableId: string;
  }[],
  expectedStableId: string,
  expectedLabel: string,
): boolean {
  if (
    legend.length !== 1 ||
    legend[0]?.id !== 1 ||
    legend[0].stableId !== expectedStableId ||
    legend[0].label !== expectedLabel
  ) {
    return false;
  }
  let hasBackground = false;
  let hasGeometry = false;
  for (const id of data) {
    if (id === 0) {
      hasBackground = true;
    } else if (id === 1) {
      hasGeometry = true;
    } else {
      return false;
    }
  }
  return hasBackground && hasGeometry;
}

export function studioBg3dBabylonDiagnosticErrorMessage(
  backend: StudioBg3dBabylonDiagnosticBackend,
  error: unknown,
): string {
  const label = backend === "webgpu" ? "WebGPU" : "WebGL2";
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : null;
  if (code === "context-lost") {
    return `Babylon ${label} 컨텍스트가 진단 중 종료되었습니다. 다른 GPU 작업을 닫은 뒤 다시 시도해 주세요. 다른 백엔드는 자동 실행하지 않았습니다.`;
  }
  if (backend === "webgpu" && typeof navigator !== "undefined" && !("gpu" in navigator)) {
    return "이 브라우저에서 WebGPU를 사용할 수 없어 Babylon WebGPU 진단을 완료하지 못했습니다. WebGL2 진단은 자동 실행하지 않았습니다.";
  }
  const supportCode = code ? ` · 지원 코드 ${code}` : "";
  return `Babylon ${label} 엔진 또는 beauty/depth/normal/object ID/material ID 패스를 분리 캔버스에서 검증하지 못했습니다${supportCode}. 현재 3D 편집기에는 영향을 주지 않았고, 다른 백엔드는 자동 실행하지 않았습니다.`;
}
