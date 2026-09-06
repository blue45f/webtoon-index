// Engine-neutral allowlist for Studio's procedural 360° sky. Documents persist only these ids and
// a finite rotation; no URL, upload handle, Blob, or local storage key crosses this boundary.

import type { StudioBg3dSkyPresetId } from "./bg3d/studio-bg3d-scene-document";

export interface BgSkyPreset {
  readonly id: StudioBg3dSkyPresetId;
  readonly label: string;
  readonly description: string;
  readonly clearColor: string;
  readonly kind: "solid" | "procedural-panorama";
}

export const BG_SKY_PRESETS = Object.freeze<readonly BgSkyPreset[]>([
  {
    id: "blank",
    label: "흰 배경",
    description: "환경 그림 없이 재질과 선만 또렷하게 확인합니다.",
    clearColor: "#ffffff",
    kind: "solid",
  },
  {
    id: "clear_day",
    label: "맑은 낮",
    description: "푸른 천정과 옅은 구름이 이어지는 밝은 360° 하늘입니다.",
    clearColor: "#bfe3f5",
    kind: "procedural-panorama",
  },
  {
    id: "sunset",
    label: "노을",
    description: "따뜻한 수평선과 낮은 해가 구도를 감싸는 360° 노을입니다.",
    clearColor: "#f2b183",
    kind: "procedural-panorama",
  },
  {
    id: "night",
    label: "밤",
    description: "달과 별이 있는 저채도 360° 밤하늘입니다.",
    clearColor: "#1c2436",
    kind: "procedural-panorama",
  },
]);

export const DEFAULT_SKY_PRESET_ID: StudioBg3dSkyPresetId = "blank";

export function getSkyPreset(id: unknown): BgSkyPreset {
  return BG_SKY_PRESETS.find((p) => p.id === id) ?? BG_SKY_PRESETS[0];
}

/** Returns an equivalent UI angle in the familiar -180°…180° range. */
export function normalizePanoramaRotationDegrees(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const unsigned = ((value % 360) + 360) % 360;
  const wrapped =
    unsigned === 180 ? (value < 0 ? -180 : 180) : unsigned > 180 ? unsigned - 360 : unsigned;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

/** Clamps a direct numeric-field commit instead of wrapping a mistyped out-of-range value. */
export function clampPanoramaRotationDegrees(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const clamped = Math.min(180, Math.max(-180, value));
  return Object.is(clamped, -0) ? 0 : clamped;
}
