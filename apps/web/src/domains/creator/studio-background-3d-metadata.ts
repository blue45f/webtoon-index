// 3D 배경 캡처의 장면 메타데이터 계약. 이 모듈은 Three.js/DOM/React와 독립적이어야 한다.
// Studio 셸은 실제 3D 편집기를 열기 전에도 이 경량 모듈만으로 이미지 출처를 판별할 수 있다.

import type { StudioBg3dMaterialOverride } from "./bg3d/studio-bg3d-scene-document";

export type BgPrimitiveKind =
  | "box"
  | "cylinder"
  | "plane"
  | "sphere"
  | "hemisphere"
  | "cone"
  | "pyramid"
  | "triangularPrism"
  | "hexPrism"
  | "torus"
  | "tube"
  | "ring"
  | "capsule";

export interface BgPrimitive {
  id: string;
  kind: BgPrimitiveKind;
  position: [number, number, number];
  rotation: [number, number, number]; // Euler XYZ, radians
  scale: [number, number, number];
  color: string; // Shaded preview only; line-art export ignores this value.
  materialOverride?: StudioBg3dMaterialOverride;
  /** Optional user-defined name for the object list. */
  name?: string;
  /** When false, mesh is hidden in viewport/capture but kept in the scene graph. Default true. */
  visible?: boolean;
  /** When true, transform gizmo and numeric edits are blocked. Default false. */
  locked?: boolean;
  /** Parent entity ID for hierarchy grouping. null/undefined means root. */
  parentId?: string | null;
}

export interface BgSceneState {
  primitives: BgPrimitive[];
  selectedIds: string[];
}

export interface BgPrimitiveDef {
  label: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
}

export type Studio3dTool = "vrm-poser" | "bg3d";

export interface Bg3dSceneMetadata {
  tool: "bg3d";
  primitives: BgPrimitive[];
}

// 종류별 스폰 기본값. plane·ring만 지면에 눕도록 -90° 회전한다. 이 데이터는 지오메트리
// 인스턴스가 아니므로 Three.js 런타임과 함께 묶이지 않는다.
export const PRIMITIVE_DEFS: Record<BgPrimitiveKind, BgPrimitiveDef> = {
  box: { label: "상자", position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#c9a876" },
  cylinder: { label: "원기둥", position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#9fb4c9" },
  plane: { label: "평면", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [6, 6, 1], color: "#93b58c" },
  sphere: { label: "구", position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#c9909f" },
  hemisphere: { label: "반구(돔)", position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#b7a8d6" },
  cone: { label: "원뿔", position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#d6b26a" },
  pyramid: { label: "각뿔", position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#cf9d6a" },
  triangularPrism: {
    label: "삼각기둥(지붕)",
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#a87b5c",
  },
  hexPrism: { label: "육각기둥", position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#8fa88f" },
  torus: { label: "고리", position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#c2a6d6" },
  tube: { label: "파이프", position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#7fa6b8" },
  ring: { label: "평면 고리", position: [0, 0.01, 0], rotation: [-Math.PI / 2, 0, 0], scale: [1, 1, 1], color: "#d6c48a" },
  capsule: { label: "캡슐", position: [0, 0.75, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#8ec2c2" },
};

// VRM 포저의 pose 해시와 같은 계약: 캡처 PNG data URL 뒤의 URL fragment에 재편집 가능한
// 장면 그래프를 보존한다. 반환값은 fragment 본문이며 호출자가 `#` 뒤에 붙인다.
export function encodeBg3dSceneHash(primitives: BgPrimitive[]): string {
  const metadata: Bg3dSceneMetadata = { tool: "bg3d", primitives };
  return encodeURIComponent(JSON.stringify(metadata));
}

export function parseBg3dSceneFromDataUrl(dataUrl: string | undefined): BgPrimitive[] | null {
  if (!dataUrl) return null;
  const hashIndex = dataUrl.indexOf("#");
  if (hashIndex < 0) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(dataUrl.slice(hashIndex + 1))) as Partial<Bg3dSceneMetadata>;
    if (raw.tool !== "bg3d" || !Array.isArray(raw.primitives)) return null;
    return raw.primitives;
  } catch {
    return null;
  }
}

// tool 필드가 도입되기 전 `#` 해시는 VRM 포저만 만들었다. 명시적인 bg3d가 아닌, 파싱 가능한
// 레거시 해시는 기존 계약대로 vrm-poser로 간주한다. 손상된 URI/JSON은 어떤 도구로도 열지 않는다.
export function parseStudio3dTool(src: string | undefined): Studio3dTool | null {
  if (!src) return null;
  const hashIndex = src.indexOf("#");
  if (hashIndex < 0) return null;
  try {
    const meta = JSON.parse(decodeURIComponent(src.slice(hashIndex + 1))) as { tool?: string };
    return meta.tool === "bg3d" ? "bg3d" : "vrm-poser";
  } catch {
    return null;
  }
}
