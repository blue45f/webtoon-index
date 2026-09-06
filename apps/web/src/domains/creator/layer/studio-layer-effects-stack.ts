/**
 * Studio Non-Destructive Layer Effects Stack
 *
 * CLIP STUDIO PAINT Ver.5.1.0 Parity:
 * - Layer Effects Stack (레이어 효과 스택):
 *   1. Glow (외곽 발광 / 내부 발광)
 *   2. Drop Shadow (그림자 드리우기: 각도, 거리, 번짐, 불투명도, 색상)
 *   3. Relief (부조 / 양각·음각 입체 조명 효과: 고도각, 방위각, 깊이)
 *   4. Border (경계 효과: 반투명 픽셀 고려 테두리 지원)
 * - Non-destructive: effects are stacked, toggleable, reorderable, adjustable.
 * - Pure pixel rendering algorithm with bounding box padding calculation.
 *
 * Pure, deterministic, zero-dependency.
 */

export interface StudioGlowEffect {
  readonly id: string;
  readonly kind: "glow";
  readonly type: "outer" | "inner";
  readonly color: string; // #rrggbb or rgba
  readonly blur: number; // 0..100
  readonly intensity: number; // 0..2
  readonly enabled: boolean;
}

export interface StudioDropShadowEffect {
  readonly id: string;
  readonly kind: "drop-shadow";
  readonly color: string;
  readonly blur: number; // 0..100
  readonly offsetX: number;
  readonly offsetY: number;
  readonly opacity: number; // 0..1
  readonly angleDeg: number;
  readonly distance: number;
  readonly enabled: boolean;
}

export interface StudioReliefEffect {
  readonly id: string;
  readonly kind: "relief";
  readonly elevationDeg: number; // 0..90
  readonly azimuthDeg: number; // 0..360
  readonly depth: number; // 1..20
  readonly smoothness: number; // 0..10
  readonly lightIntensity: number; // 0..2
  readonly ambient: number; // 0..1
  readonly invert: boolean;
  readonly enabled: boolean;
}

export interface StudioBorderEffectItem {
  readonly id: string;
  readonly kind: "border";
  readonly thickness: number; // 1..32
  readonly color: string;
  readonly type: "outer" | "inner" | "center";
  /** CSP v5.1: Respect semi-transparent pixels for soft/watercolor edges */
  readonly respectTransparency: boolean;
  readonly antiAliased: boolean;
  readonly enabled: boolean;
}

export type StudioLayerEffect =
  | StudioGlowEffect
  | StudioDropShadowEffect
  | StudioReliefEffect
  | StudioBorderEffectItem;

export interface StudioLayerEffectsStack {
  readonly effects: readonly StudioLayerEffect[];
}

export const EMPTY_LAYER_EFFECTS_STACK: StudioLayerEffectsStack = Object.freeze({
  effects: Object.freeze([]),
});

/**
 * Creates default layer effect items with standard settings.
 */
export function createDefaultLayerEffect(kind: StudioLayerEffect["kind"], id?: string): StudioLayerEffect {
  const effectId = id || `fx-${kind}-${Math.random().toString(36).slice(2, 8)}`;
  switch (kind) {
    case "glow":
      return Object.freeze({
        id: effectId,
        kind: "glow",
        type: "outer",
        color: "#ffffff",
        blur: 16,
        intensity: 1.0,
        enabled: true,
      });
    case "drop-shadow":
      return Object.freeze({
        id: effectId,
        kind: "drop-shadow",
        color: "#000000",
        blur: 10,
        offsetX: 4,
        offsetY: 6,
        opacity: 0.5,
        angleDeg: 120,
        distance: 7,
        enabled: true,
      });
    case "relief":
      return Object.freeze({
        id: effectId,
        kind: "relief",
        elevationDeg: 45,
        azimuthDeg: 315,
        depth: 4,
        smoothness: 1,
        lightIntensity: 1.2,
        ambient: 0.3,
        invert: false,
        enabled: true,
      });
    case "border":
      return Object.freeze({
        id: effectId,
        kind: "border",
        thickness: 4,
        color: "#ffffff",
        type: "outer",
        respectTransparency: true,
        antiAliased: true,
        enabled: true,
      });
  }
}

/**
 * Appends an effect to the stack.
 */
export function addLayerEffect(
  stack: StudioLayerEffectsStack,
  effect: StudioLayerEffect,
): StudioLayerEffectsStack {
  return Object.freeze({
    effects: Object.freeze([...stack.effects, effect]),
  });
}

/**
 * Removes an effect by ID.
 */
export function removeLayerEffect(
  stack: StudioLayerEffectsStack,
  effectId: string,
): StudioLayerEffectsStack {
  return Object.freeze({
    effects: Object.freeze(stack.effects.filter((e) => e.id !== effectId)),
  });
}

/**
 * Toggles an effect's enabled status.
 */
export function toggleLayerEffect(
  stack: StudioLayerEffectsStack,
  effectId: string,
  forceEnabled?: boolean,
): StudioLayerEffectsStack {
  return Object.freeze({
    effects: Object.freeze(
      stack.effects.map((e) => {
        if (e.id !== effectId) return e;
        const nextEnabled = typeof forceEnabled === "boolean" ? forceEnabled : !e.enabled;
        return Object.freeze({ ...e, enabled: nextEnabled }) as StudioLayerEffect;
      }),
    ),
  });
}

/**
 * Updates an effect by ID with a partial patch.
 */
export function updateLayerEffect<T extends StudioLayerEffect>(
  stack: StudioLayerEffectsStack,
  effectId: string,
  patch: Partial<T>,
): StudioLayerEffectsStack {
  return Object.freeze({
    effects: Object.freeze(
      stack.effects.map((e) => {
        if (e.id !== effectId) return e;
        return Object.freeze({ ...e, ...patch }) as StudioLayerEffect;
      }),
    ),
  });
}

/**
 * Reorders effects in the stack.
 */
export function reorderLayerEffect(
  stack: StudioLayerEffectsStack,
  fromIndex: number,
  toIndex: number,
): StudioLayerEffectsStack {
  if (
    fromIndex < 0 ||
    fromIndex >= stack.effects.length ||
    toIndex < 0 ||
    toIndex >= stack.effects.length
  ) {
    return stack;
  }
  const next = [...stack.effects];
  const [removed] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, removed);
  return Object.freeze({ effects: Object.freeze(next) });
}

/**
 * Calculates canvas padding (px) required so active layer effects aren't clipped.
 */
export function computeEffectsBBoxPadding(stack: StudioLayerEffectsStack): {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly totalMargin: number;
} {
  let padLeft = 0;
  let padTop = 0;
  let padRight = 0;
  let padBottom = 0;

  for (const effect of stack.effects) {
    if (!effect.enabled) continue;

    switch (effect.kind) {
      case "glow": {
        const spread = effect.blur * 1.5;
        padLeft = Math.max(padLeft, spread);
        padTop = Math.max(padTop, spread);
        padRight = Math.max(padRight, spread);
        padBottom = Math.max(padBottom, spread);
        break;
      }
      case "drop-shadow": {
        const spread = effect.blur * 1.5;
        const ox = effect.offsetX;
        const oy = effect.offsetY;
        if (ox < 0) padLeft = Math.max(padLeft, -ox + spread);
        else padRight = Math.max(padRight, ox + spread);
        if (oy < 0) padTop = Math.max(padTop, -oy + spread);
        else padBottom = Math.max(padBottom, oy + spread);
        break;
      }
      case "border": {
        const t = effect.thickness;
        if (effect.type !== "inner") {
          padLeft = Math.max(padLeft, t + 2);
          padTop = Math.max(padTop, t + 2);
          padRight = Math.max(padRight, t + 2);
          padBottom = Math.max(padBottom, t + 2);
        }
        break;
      }
      case "relief": {
        // Relief applies within the silhouette
        break;
      }
    }
  }

  const maxPadding = Math.ceil(Math.max(padLeft, padTop, padRight, padBottom));
  return Object.freeze({
    left: Math.ceil(padLeft),
    top: Math.ceil(padTop),
    right: Math.ceil(padRight),
    bottom: Math.ceil(padBottom),
    totalMargin: maxPadding,
  });
}

/**
 * Parses hex or rgba string into RGBA components (0..255).
 */
export function parseColorToRgba(colorStr: string): { r: number; g: number; b: number; a: number } {
  let r = 0, g = 0, b = 0, a = 255;
  const hex = colorStr.replace(/^#/u, "");
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16) || 0;
    g = parseInt(hex[1] + hex[1], 16) || 0;
    b = parseInt(hex[2] + hex[2], 16) || 0;
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16) || 0;
    g = parseInt(hex.slice(2, 4), 16) || 0;
    b = parseInt(hex.slice(4, 6), 16) || 0;
  } else if (hex.length === 8) {
    r = parseInt(hex.slice(0, 2), 16) || 0;
    g = parseInt(hex.slice(2, 4), 16) || 0;
    b = parseInt(hex.slice(4, 6), 16) || 0;
    a = parseInt(hex.slice(6, 8), 16) || 255;
  }
  return { r, g, b, a };
}

/**
 * Applies a Relief lighting calculation on image data with normal gradient estimation.
 */
export function applyReliefLighting(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  relief: StudioReliefEffect,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels);
  if (!relief.enabled) return out;

  const radAzimuth = (relief.azimuthDeg * Math.PI) / 180;
  const radElevation = (relief.elevationDeg * Math.PI) / 180;
  const lx = Math.cos(radElevation) * Math.cos(radAzimuth);
  const ly = Math.cos(radElevation) * Math.sin(radAzimuth);
  const lz = Math.sin(radElevation);

  const depthFactor = (relief.depth * 0.5) * (relief.invert ? -1 : 1);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const alpha = pixels[idx + 3];
      if (alpha < 5) continue; // transparent pixel

      // Gradient of alpha silhouette
      const leftA = pixels[(y * width + (x - 1)) * 4 + 3];
      const rightA = pixels[(y * width + (x + 1)) * 4 + 3];
      const topA = pixels[((y - 1) * width + x) * 4 + 3];
      const bottomA = pixels[((y + 1) * width + x) * 4 + 3];

      const nx = ((rightA - leftA) / 255) * depthFactor;
      const ny = ((bottomA - topA) / 255) * depthFactor;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;

      // Lambertian dot product with directional light
      const dot = Math.max(0, (nx * lx + ny * ly + nz * lz) / len);
      const intensity = relief.ambient + dot * relief.lightIntensity;

      out[idx] = Math.min(255, Math.round(pixels[idx] * intensity));
      out[idx + 1] = Math.min(255, Math.round(pixels[idx + 1] * intensity));
      out[idx + 2] = Math.min(255, Math.round(pixels[idx + 2] * intensity));
    }
  }

  return out;
}
