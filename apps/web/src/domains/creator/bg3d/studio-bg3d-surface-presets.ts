// 표면 프리셋 카탈로그 — 원클릭 재질 프리셋을 기존 StudioBg3dMaterialOverride 필드 위에 얹는 순수 모듈.
// three.js/DOM 의존 없음. 렌더러는 resolve 결과를 R3F 소품으로 옮기고, 문서 저장은
// buildStudioBg3dSurfacePresetOverride가 만든 완전한 오버라이드 객체 하나로 끝난다.

import { DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE } from "./studio-bg3d-scene-document";

import type { StudioBg3dMaterialOverride } from "./studio-bg3d-scene-document";

export interface StudioBg3dSurfacePreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly patch: Readonly<
    Pick<
      StudioBg3dMaterialOverride,
      "roughness" | "metalness" | "emissiveColor" | "emissiveIntensity" | "opacityMultiplier"
    >
  >;
}

const NEUTRAL_PATCH_BASE = Object.freeze({
  emissiveColor: "#000000",
  emissiveIntensity: null,
  opacityMultiplier: 1,
});

export const STUDIO_BG3D_SURFACE_PRESETS: readonly StudioBg3dSurfacePreset[] = Object.freeze([
  {
    id: "matte-plastic",
    label: "매트 플라스틱",
    description: "빛을 거의 반사하지 않는 무광 표면",
    patch: { roughness: 0.85, metalness: 0, ...NEUTRAL_PATCH_BASE },
  },
  {
    id: "gloss-plastic",
    label: "광택 플라스틱",
    description: "하이라이트가 살짝 맺히는 매끈한 표면",
    patch: { roughness: 0.25, metalness: 0, ...NEUTRAL_PATCH_BASE },
  },
  {
    id: "brushed-metal",
    label: "무광 금속",
    description: "결이 남는 은은한 금속 반사",
    patch: { roughness: 0.45, metalness: 0.9, ...NEUTRAL_PATCH_BASE },
  },
  {
    id: "chrome",
    label: "크롬",
    description: "거울처럼 날카로운 금속 반사",
    patch: { roughness: 0.08, metalness: 1, ...NEUTRAL_PATCH_BASE },
  },
  {
    id: "glass",
    label: "유리",
    description: "비치는 반투명 유리 질감",
    patch: { roughness: 0.1, metalness: 0, emissiveColor: "#000000", emissiveIntensity: null, opacityMultiplier: 0.35 },
  },
  {
    id: "neon",
    label: "네온 발광",
    description: "스스로 빛나는 간판·광원 소품용",
    patch: { roughness: 0.5, metalness: 0, emissiveColor: "#fff3d6", emissiveIntensity: 2.2, opacityMultiplier: 1 },
  },
  {
    id: "rubber",
    label: "러버",
    description: "흡광되는 고무·타이어 질감",
    patch: { roughness: 0.95, metalness: 0, ...NEUTRAL_PATCH_BASE },
  },
  {
    id: "ceramic",
    label: "세라믹",
    description: "부드럽게 반사되는 도자기 표면",
    patch: { roughness: 0.3, metalness: 0, ...NEUTRAL_PATCH_BASE },
  },
]);

const SURFACE_PRESET_IDS = new Set(STUDIO_BG3D_SURFACE_PRESETS.map((preset) => preset.id));

export function isStudioBg3dSurfacePresetId(id: string): boolean {
  return SURFACE_PRESET_IDS.has(id);
}

/** 프리셋 id → 기본 오버라이드 위에 패치를 얹은 완전한(canonical) 오버라이드. 모르는 id는 null. */
export function buildStudioBg3dSurfacePresetOverride(id: string): StudioBg3dMaterialOverride | null {
  const preset = STUDIO_BG3D_SURFACE_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return null;
  return Object.freeze({ ...DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE, ...preset.patch });
}

export interface StudioBg3dSurfaceMaterialProps {
  readonly roughness?: number;
  readonly metalness?: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly opacity?: number;
  readonly wireframe?: boolean;
}

/** 문서 오버라이드 → MeshStandardMaterial 대응 소품. 설정되지 않은(null) 필드는 생략한다. */
export function resolveStudioBg3dSurfaceMaterialProps(
  override: StudioBg3dMaterialOverride | undefined,
): StudioBg3dSurfaceMaterialProps {
  if (!override) return {};
  const props: {
    roughness?: number;
    metalness?: number;
    emissive?: string;
    emissiveIntensity?: number;
    opacity?: number;
    wireframe?: boolean;
  } = {};
  if (override.roughness !== null) props.roughness = override.roughness;
  if (override.metalness !== null) props.metalness = override.metalness;
  if (override.emissiveIntensity !== null && override.emissiveIntensity > 0) {
    props.emissive = override.emissiveColor;
    props.emissiveIntensity = override.emissiveIntensity;
  }
  if (override.opacityMultiplier < 1) props.opacity = override.opacityMultiplier;
  if (override.wireframe) props.wireframe = true;
  return props;
}

export type StudioBg3dSurfaceMaterialSpread = Partial<{
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
  wireframe: boolean;
}>;

/** R3F JSX 스프레드용 — 반투명일 때만 transparent를 동반하고, 값이 있는 소품만 채운다. */
export function spreadStudioBg3dSurfaceMaterialProps(
  props: StudioBg3dSurfaceMaterialProps,
): StudioBg3dSurfaceMaterialSpread {
  const spread: StudioBg3dSurfaceMaterialSpread = {};
  if (props.roughness !== undefined) spread.roughness = props.roughness;
  if (props.metalness !== undefined) spread.metalness = props.metalness;
  if (props.emissive !== undefined && props.emissiveIntensity !== undefined) {
    spread.emissive = props.emissive;
    spread.emissiveIntensity = props.emissiveIntensity;
  }
  if (props.opacity !== undefined) {
    spread.opacity = props.opacity;
    spread.transparent = true;
  }
  if (props.wireframe === true) spread.wireframe = true;
  return spread;
}
