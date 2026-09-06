/** Renderer-free viewport policy. View preferences never become geometry/document authority. */
export type StudioHybridDccStandardView =
  | "isometric" | "front" | "back" | "right" | "left" | "top" | "bottom";
export type StudioHybridDccCameraProjection = "perspective" | "orthographic";
export type StudioHybridDccViewVec3 = readonly [number, number, number];

export interface StudioHybridDccViewportPreferences {
  readonly version: 1;
  readonly snapping: boolean;
  readonly translationStep: number;
  readonly rotationStepDegrees: number;
  readonly scaleStep: number;
  readonly showGrid: boolean;
  readonly showAxes: boolean;
  readonly showGround: boolean;
}
export const STUDIO_HYBRID_DCC_VIEWPORT_PREFERENCES_KEY = "studio.hybrid-dcc.viewport.v1";
export const STUDIO_HYBRID_DCC_VIEWPORT_DEFAULTS: StudioHybridDccViewportPreferences = Object.freeze({
  version: 1, snapping: true, translationStep: 0.1, rotationStepDegrees: 15,
  scaleStep: 0.1, showGrid: true, showAxes: true, showGround: true,
});
export const STUDIO_HYBRID_DCC_SNAP_LIMITS = Object.freeze({
  translationStep: { min: 0.000001, max: 1_000_000 },
  rotationStepDegrees: { min: 0.001, max: 180 },
  scaleStep: { min: 0.000001, max: 100 },
});
export function normalizeStudioHybridDccViewportPreferences(
  value: unknown,
): StudioHybridDccViewportPreferences {
  const defaults = STUDIO_HYBRID_DCC_VIEWPORT_DEFAULTS;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaults };
  const candidate = value as Partial<StudioHybridDccViewportPreferences>;
  if (candidate.version !== 1) return { ...defaults };
  const number = (key: keyof typeof STUDIO_HYBRID_DCC_SNAP_LIMITS): number => {
    const next = candidate[key];
    const { min, max } = STUDIO_HYBRID_DCC_SNAP_LIMITS[key];
    return typeof next === "number" && Number.isFinite(next) && next >= min && next <= max
      ? next : defaults[key];
  };
  const boolean = (key: "snapping" | "showGrid" | "showAxes" | "showGround"): boolean =>
    typeof candidate[key] === "boolean" ? candidate[key] : defaults[key];
  return {
    version: 1, snapping: boolean("snapping"),
    translationStep: number("translationStep"), rotationStepDegrees: number("rotationStepDegrees"),
    scaleStep: number("scaleStep"), showGrid: boolean("showGrid"),
    showAxes: boolean("showAxes"), showGround: boolean("showGround"),
  };
}
export function parseStudioHybridDccViewportPreferences(text: string | null): StudioHybridDccViewportPreferences {
  if (!text || text.length > 4096) return { ...STUDIO_HYBRID_DCC_VIEWPORT_DEFAULTS };
  try { return normalizeStudioHybridDccViewportPreferences(JSON.parse(text) as unknown); }
  catch { return { ...STUDIO_HYBRID_DCC_VIEWPORT_DEFAULTS }; }
}
export function resolveStudioHybridDccGizmoSnaps(preferences: StudioHybridDccViewportPreferences): {
  readonly translationSnap: number | null;
  readonly rotationSnap: number | null;
  readonly scaleSnap: number | null;
} {
  const safe = normalizeStudioHybridDccViewportPreferences(preferences);
  return {
    translationSnap: safe.snapping ? safe.translationStep : null,
    rotationSnap: safe.snapping ? safe.rotationStepDegrees * Math.PI / 180 : null,
    scaleSnap: safe.snapping ? safe.scaleStep : null,
  };
}

export function studioHybridDccViewBasis(view: StudioHybridDccStandardView): {
  readonly direction: StudioHybridDccViewVec3;
  readonly up: StudioHybridDccViewVec3;
} {
  switch (view) {
    case "front": return { direction: [0, 0, 1], up: [0, 1, 0] };
    case "back": return { direction: [0, 0, -1], up: [0, 1, 0] };
    case "right": return { direction: [1, 0, 0], up: [0, 1, 0] };
    case "left": return { direction: [-1, 0, 0], up: [0, 1, 0] };
    case "top": return { direction: [0, 1, 0], up: [0, 0, -1] };
    case "bottom": return { direction: [0, -1, 0], up: [0, 0, 1] };
    default: return { direction: [1, 0.72, 1], up: [0, 1, 0] };
  }
}
/** Fit a bounding sphere to the limiting field of view, including portrait viewports. */
export function fitStudioHybridDccCamera(
  radius: number, width: number, height: number, fovDegrees = 42, padding = 1.12,
): { readonly distance: number; readonly orthographicZoom: number } {
  if (![radius, width, height, fovDegrees, padding].every(Number.isFinite)
    || radius <= 0 || width <= 0 || height <= 0 || fovDegrees <= 0 || fovDegrees >= 179
    || padding < 1 || padding > 10) throw new Error("유효한 카메라 경계와 화면 크기가 필요합니다.");
  const verticalHalfFov = fovDegrees * Math.PI / 360;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * (width / height));
  const distance = radius * padding / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov));
  const orthographicZoom = Math.min(width, height) / (2 * radius * padding);
  if (!Number.isFinite(distance) || !Number.isFinite(orthographicZoom)
    || distance <= 0 || orthographicZoom <= 0) throw new Error("카메라 맞춤 결과가 안전 범위를 벗어났습니다.");
  return { distance, orthographicZoom };
}
/** Geometry hashes, positions and viewport dimensions deliberately do not trigger a reframe. */
export interface StudioHybridDccFrameIntent {
  readonly revision: number;
  readonly orientationRevision: number;
  readonly view: StudioHybridDccStandardView;
}
export function shouldReframeStudioHybridDccCamera(
  previous: StudioHybridDccFrameIntent | null, next: StudioHybridDccFrameIntent,
): boolean {
  return !previous || previous.revision !== next.revision || previous.view !== next.view
    || previous.orientationRevision !== next.orientationRevision;
}

export interface StudioHybridDccViewportKey {
  readonly key: string;
  readonly code?: string;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly defaultPrevented?: boolean;
}
export interface StudioHybridDccShortcutContext {
  readonly textEntry: boolean;
  readonly selected: boolean;
  readonly editingDisabled: boolean;
  readonly objectMode: boolean;
  readonly canTransform: boolean;
  readonly canSelectComponents: boolean;
  readonly canDuplicate: boolean;
  readonly canDelete: boolean;
  readonly dragging?: boolean;
}
export type StudioHybridDccViewportAction =
  | { readonly kind: "view"; readonly view: StudioHybridDccStandardView }
  | { readonly kind: "frame"; readonly target: "scene" | "selection" }
  | { readonly kind: "transform"; readonly mode: "translate" | "rotate" | "scale" }
  | { readonly kind: "selection"; readonly mode: "vertex" | "edge" | "face" | "object" }
  | { readonly kind: "duplicate" | "delete" | "toggle-snap" | "toggle-projection" | "toggle-isolation" };

/** Event scoping and editable-target detection are the caller's responsibility. */
export function resolveStudioHybridDccViewportShortcut(
  event: StudioHybridDccViewportKey, context: StudioHybridDccShortcutContext,
): StudioHybridDccViewportAction | null {
  if (context.textEntry || context.dragging || event.defaultPrevented || event.repeat
    || event.isComposing || event.keyCode === 229 || event.altKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  const code = event.code ?? "";
  if (event.ctrlKey) {
    if (event.shiftKey) return null;
    const opposite = code === "Numpad1" ? "back" : code === "Numpad3" ? "left"
      : code === "Numpad7" ? "bottom" : null;
    return opposite ? { kind: "view", view: opposite } : null;
  }
  if (event.shiftKey) {
    if (key === "tab") return { kind: "toggle-snap" };
    return key === "d" && !context.editingDisabled && context.objectMode && context.selected
      && context.canDuplicate ? { kind: "duplicate" } : null;
  }
  if (code === "Numpad5") return { kind: "toggle-projection" };
  if (code === "NumpadDivide" || key === "/") return { kind: "toggle-isolation" };
  if (key === "home") return { kind: "frame", target: "scene" };
  if (key === "." || code === "NumpadDecimal" || key === "f") {
    return context.selected ? { kind: "frame", target: "selection" } : null;
  }
  const view = code === "Numpad1" ? "front" : code === "Numpad3" ? "right"
    : code === "Numpad7" ? "top" : null;
  if (view) return { kind: "view", view };
  if (context.editingDisabled) return null;
  const component = code === "Digit1" ? "vertex" : code === "Digit2" ? "edge"
    : code === "Digit3" ? "face" : code === "Digit4" ? "object" : null;
  if (component && context.canSelectComponents && (component === "object" || context.selected)) {
    return { kind: "selection", mode: component };
  }
  if (!context.objectMode || !context.selected) return null;
  if ((key === "delete" || key === "backspace") && context.canDelete) return { kind: "delete" };
  const mode = key === "g" ? "translate" : key === "r" ? "rotate" : key === "s" ? "scale" : null;
  return mode && context.canTransform ? { kind: "transform", mode } : null;
}
