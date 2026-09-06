/**
 * Pixel-art mode product admission (Piskel / Pixilart / Lospec class).
 *
 * Bundles: integer pixel pencil, grid snap, restricted palette lock,
 * optional onion-friendly frame animation tip. Pure policy — no React.
 */

import {
  findStudioLospecStylePreset,
  quantizeHexToRestrictedPalette,
  type StudioRestrictedPalette,
} from "./studio-restricted-palette";

export const STUDIO_PIXEL_ART_MODE_ID = "studio-pixel-art-mode-v1" as const;

export type StudioPixelArtCanvasScale = 1 | 2 | 4 | 8 | 16 | 32;

export interface StudioPixelArtModeState {
  readonly enabled: boolean;
  readonly gridSnap: boolean;
  readonly pixelPencil: boolean;
  readonly paletteLockEnabled: boolean;
  readonly palette: StudioRestrictedPalette | null;
  /** Display zoom helper for chunky pixels (UI hint only). */
  readonly displayScale: StudioPixelArtCanvasScale;
  readonly showPixelGrid: boolean;
}

export const DEFAULT_STUDIO_PIXEL_ART_MODE: StudioPixelArtModeState = Object.freeze({
  enabled: false,
  gridSnap: true,
  pixelPencil: true,
  paletteLockEnabled: true,
  palette: findStudioLospecStylePreset("lospec-pico8"),
  displayScale: 8,
  showPixelGrid: true,
});

export function createStudioPixelArtMode(
  partial?: Partial<StudioPixelArtModeState>,
): StudioPixelArtModeState {
  const base = DEFAULT_STUDIO_PIXEL_ART_MODE;
  return Object.freeze({
    enabled: partial?.enabled ?? base.enabled,
    gridSnap: partial?.gridSnap ?? base.gridSnap,
    pixelPencil: partial?.pixelPencil ?? base.pixelPencil,
    paletteLockEnabled: partial?.paletteLockEnabled ?? base.paletteLockEnabled,
    palette: partial?.palette === undefined ? base.palette : partial.palette,
    displayScale: partial?.displayScale ?? base.displayScale,
    showPixelGrid: partial?.showPixelGrid ?? base.showPixelGrid,
  });
}

/** Enable a ready-to-draw pixel-art session (Piskel-like defaults). */
export function enableStudioPixelArtMode(
  paletteId = "lospec-pico8",
): StudioPixelArtModeState {
  return createStudioPixelArtMode({
    enabled: true,
    gridSnap: true,
    pixelPencil: true,
    paletteLockEnabled: true,
    palette: findStudioLospecStylePreset(paletteId) ?? findStudioLospecStylePreset("lospec-1bit-monitor"),
    displayScale: 8,
    showPixelGrid: true,
  });
}

export function admitStudioPixelArtStrokeColor(
  requestedHex: string,
  mode: StudioPixelArtModeState,
): string {
  if (!mode.enabled || !mode.paletteLockEnabled || !mode.palette) {
    return requestedHex;
  }
  return quantizeHexToRestrictedPalette(requestedHex, mode.palette.colors);
}

export function snapStudioPixelArtPoint(
  x: number,
  y: number,
  mode: StudioPixelArtModeState,
): { readonly x: number; readonly y: number } {
  if (!mode.enabled || !mode.gridSnap) {
    return { x, y };
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

export function studioPixelArtModeHudLabel(mode: StudioPixelArtModeState): string {
  if (!mode.enabled) return "픽셀 아트 모드 꺼짐";
  const paletteName = mode.palette?.name ?? "자유 팔레트";
  const lock = mode.paletteLockEnabled ? "팔레트 잠금" : "팔레트 자유";
  return `픽셀 아트 · ${paletteName} · ${lock} · ${mode.displayScale}×`;
}

export function studioPixelArtModeTutorialSteps(): readonly string[] {
  return Object.freeze([
    "픽셀 펜으로 정수 셀에만 칠합니다 (Piskel 스타일).",
    "제한 팔레트를 켜면 모든 색이 가장 가까운 팔레트 색으로 스냅됩니다 (Lospec).",
    "프레임 애니메이션 패널에서 GIF로 내보낼 수 있습니다.",
    "격자 스냅을 유지하면 도트가 어긋나지 않습니다.",
  ]);
}
