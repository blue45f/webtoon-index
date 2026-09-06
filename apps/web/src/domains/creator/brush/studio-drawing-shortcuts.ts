import {
  matchStudioShortcut,
  normalizeStudioShortcutChordKey,
  type StudioShortcutActionId,
} from "../studio-app-settings";

import {
  BRUSH_OPACITY_RANGE,
  BRUSH_STROKE_WIDTH_RANGE,
} from "./studio-brush-library";

export type StudioDrawingShortcut =
  | { type: "select-pen" }
  | { type: "select-eraser" }
  | { type: "adjust-width"; delta: number }
  | { type: "adjust-opacity"; delta: number }
  /** Recent brush slot recall (0–5). */
  | { type: "recall-brush-slot"; index: number }
  /** Toggle canvas-first chrome (Backquote; Tab stays native browser navigation). */
  | { type: "toggle-chrome" }
  /** CSP / Photoshop: swap primary ↔ secondary color (X). */
  | { type: "swap-colors" }
  /** CSP / Photoshop: reset to ink black / paper white (D). */
  | { type: "default-colors" }
  /** SAI / CSP: cycle stabilizer strength. */
  | { type: "cycle-stabilizer" }
  /** Procreate / CSP: flip canvas horizontally. */
  | { type: "toggle-canvas-flip-h" }
  /** Procreate: toggle size lock when switching brushes. */
  | { type: "toggle-size-lock" }
  /** Procreate: toggle opacity lock when switching brushes. */
  | { type: "toggle-opacity-lock" }
  | { type: "toggle-transparent-color" };

export interface StudioDrawingShortcutEvent {
  code?: string;
  key?: string;
  keyCode?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

export interface StudioShortcutFocusContext {
  tagName?: string;
  role?: string | null;
  tabIndex?: number;
  isContentEditable?: boolean;
  canvasViewportFocused?: boolean;
}

export type StudioDrawingShortcutOptions = {
  /**
   * Customizable shortcut registry (from app settings). When provided, registry
   * chords for pen/eraser/swap/chrome/flip/brush-size take precedence and
   * suppress hard-coded defaults for those actions (including unbound).
   */
  shortcuts?: Partial<Record<StudioShortcutActionId, string>> | Record<string, string>;
};

/** Drawing actions wired through the customizable registry. */
const REGISTRY_DRAWING_DEFAULTS: ReadonlyArray<{
  id: StudioShortcutActionId;
  defaultChord: string;
}> = [
  { id: "tool-pen", defaultChord: "B" },
  { id: "tool-eraser", defaultChord: "E" },
  { id: "swap-colors", defaultChord: "X" },
  { id: "toggle-chrome", defaultChord: "`" },
  { id: "flip-canvas", defaultChord: "H" },
  { id: "brush-smaller", defaultChord: "[" },
  { id: "brush-larger", defaultChord: "]" },
  { id: "toggle-transparent-color", defaultChord: "C" },
];

/**
 * Keep browser focus navigation intact. The chrome shortcut is allowed only
 * while the explicit canvas viewport owns focus; Tab itself never resolves to
 * this action, so both forward and reverse traversal can always leave canvas.
 */
export function shouldPreserveStudioTabNavigation(
  context: StudioShortcutFocusContext
): boolean {
  return !context.canvasViewportFocused;
}

function physicalCode(event: StudioDrawingShortcutEvent): string {
  if (event.code) {
    if (event.code === "b" || event.code === "B") return "KeyB";
    if (event.code === "e" || event.code === "E") return "KeyE";
    if (event.code === "x" || event.code === "X") return "KeyX";
    if (event.code === "c" || event.code === "C") return "KeyC";
    if (event.code === "d" || event.code === "D") return "KeyD";
    if (event.code === "s" || event.code === "S") return "KeyS";
    if (event.code === "f" || event.code === "F") return "KeyF";
    if (event.code === "h" || event.code === "H") return "KeyH";
    if (event.code === "[" || event.code === "{") return "BracketLeft";
    if (event.code === "]" || event.code === "}") return "BracketRight";
    return event.code;
  }
  const key = event.key?.toLowerCase();
  if (key === "b") return "KeyB";
  if (key === "e") return "KeyE";
  if (key === "x") return "KeyX";
  if (key === "c") return "KeyC";
  if (key === "d") return "KeyD";
  if (key === "s") return "KeyS";
  if (key === "f") return "KeyF";
  if (key === "h") return "KeyH";
  if (key === "[") return "BracketLeft";
  if (key === "]") return "BracketRight";
  if (key === "`" || key === "~") return "Backquote";
  return "";
}

function registryChord(
  shortcuts: NonNullable<StudioDrawingShortcutOptions["shortcuts"]>,
  id: StudioShortcutActionId
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(shortcuts, id)) return undefined;
  const raw = shortcuts[id];
  return typeof raw === "string" ? raw : undefined;
}

/** True when the registry map owns this action (bound or explicitly unbound). */
function registryOwnsAction(
  shortcuts: NonNullable<StudioDrawingShortcutOptions["shortcuts"]>,
  id: StudioShortcutActionId
): boolean {
  return Object.prototype.hasOwnProperty.call(shortcuts, id);
}

function matchRegistryAction(
  shortcuts: NonNullable<StudioDrawingShortcutOptions["shortcuts"]>,
  id: StudioShortcutActionId,
  event: StudioDrawingShortcutEvent
): boolean {
  const chord = registryChord(shortcuts, id);
  if (chord === undefined || !chord.trim()) return false;
  return matchStudioShortcut(chord, event);
}

function resolveFromRegistry(
  event: StudioDrawingShortcutEvent,
  shortcuts: NonNullable<StudioDrawingShortcutOptions["shortcuts"]>
): StudioDrawingShortcut | null {
  // Discrete tool/view actions (no auto-repeat). matchStudioShortcut enforces modifiers.
  if (!event.repeat) {
    if (matchRegistryAction(shortcuts, "tool-pen", event)) {
      return { type: "select-pen" };
    }
    if (matchRegistryAction(shortcuts, "tool-eraser", event)) {
      return { type: "select-eraser" };
    }
    if (matchRegistryAction(shortcuts, "swap-colors", event)) {
      return { type: "swap-colors" };
    }
    if (matchRegistryAction(shortcuts, "toggle-chrome", event)) {
      return { type: "toggle-chrome" };
    }
    if (matchRegistryAction(shortcuts, "flip-canvas", event)) {
      return { type: "toggle-canvas-flip-h" };
    }
    if (matchRegistryAction(shortcuts, "toggle-transparent-color", event)) {
      return { type: "toggle-transparent-color" };
    }
  }

  // Brush size: exact registry match (Shift±5 stays on hard-code path when default).
  if (matchRegistryAction(shortcuts, "brush-smaller", event)) {
    return { type: "adjust-width", delta: -1 };
  }
  if (matchRegistryAction(shortcuts, "brush-larger", event)) {
    return { type: "adjust-width", delta: 1 };
  }

  return null;
}

/**
 * When the registry owns an action, hard-coded defaults for that action must not fire
 * (remapped or unbound). Missing keys in a partial map still allow hard-codes.
 */
function hardcodeAllowed(
  shortcuts: NonNullable<StudioDrawingShortcutOptions["shortcuts"]> | undefined,
  id: StudioShortcutActionId
): boolean {
  if (!shortcuts) return true;
  return !registryOwnsAction(shortcuts, id);
}

/**
 * Bracket hard-codes include Shift±5 variants. Keep them only while the registry
 * still binds the default "[" / "]" chord (or does not own the action yet).
 */
function defaultBrushHardcodeAllowed(
  shortcuts: NonNullable<StudioDrawingShortcutOptions["shortcuts"]> | undefined,
  id: "brush-smaller" | "brush-larger",
  defaultChord: "[" | "]"
): boolean {
  if (!shortcuts) return true;
  if (!registryOwnsAction(shortcuts, id)) return true;
  const chord = registryChord(shortcuts, id);
  if (chord === undefined || !chord.trim()) return false;
  return normalizeStudioShortcutChordKey(chord) === normalizeStudioShortcutChordKey(defaultChord);
}

/**
 * 물리 키 기준 드로잉 단축키 해석. Cmd/Ctrl 조합은 기존 레이어·줌 명령이 우선하도록 전부 넘긴다.
 * Shift/Option에서 event.key가 `{`, 특수 따옴표 등으로 바뀌어도 event.code로 브래킷을 인식한다.
 *
 * `options.shortcuts`가 있으면 커스터마이즈 레지스트리(matchStudioShortcut)를 우선하고,
 * 해당 액션이 리맵/언바인드된 경우 하드코드 기본키는 발동하지 않는다.
 */
export function resolveStudioDrawingShortcut(
  event: StudioDrawingShortcutEvent,
  options?: StudioDrawingShortcutOptions
): StudioDrawingShortcut | null {
  if (event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey) return null;
  const shortcuts = options?.shortcuts;
  if (shortcuts) {
    const fromRegistry = resolveFromRegistry(event, shortcuts);
    if (fromRegistry) return fromRegistry;
  }

  const code = physicalCode(event);
  const allowPen = hardcodeAllowed(shortcuts, "tool-pen");
  const allowEraser = hardcodeAllowed(shortcuts, "tool-eraser");
  const allowSwap = hardcodeAllowed(shortcuts, "swap-colors");
  const allowChrome = hardcodeAllowed(shortcuts, "toggle-chrome");
  const allowFlip = hardcodeAllowed(shortcuts, "flip-canvas");
  const allowBrushSmaller = defaultBrushHardcodeAllowed(shortcuts, "brush-smaller", "[");
  const allowBrushLarger = defaultBrushHardcodeAllowed(shortcuts, "brush-larger", "]");
  const allowTransparent = hardcodeAllowed(shortcuts, "toggle-transparent-color");

  if (allowPen && code === "KeyB" && !event.altKey && !event.repeat) {
    return { type: "select-pen" };
  }
  if (allowEraser && code === "KeyE" && !event.altKey && !event.repeat) {
    return { type: "select-eraser" };
  }
  if (allowTransparent && code === "KeyC" && !event.altKey && !event.shiftKey && !event.repeat) {
    return { type: "toggle-transparent-color" };
  }

  // Digit1–6 → recent brush slots (no modifiers). Shift+Digit assigns is handled by caller.
  if (!event.altKey && !event.shiftKey && !event.repeat) {
    const digitMatch = /^Digit([1-6])$/.exec(code);
    if (digitMatch) {
      return { type: "recall-brush-slot", index: Number(digitMatch[1]) - 1 };
    }
  }

  // Backquote toggles canvas chrome. Tab must remain native focus navigation.
  if (allowChrome && code === "Backquote" && !event.altKey && !event.shiftKey && !event.repeat) {
    return { type: "toggle-chrome" };
  }

  // CSP / Photoshop color keys (no modifiers — Cmd+D remains the Edit deselect command).
  if (allowSwap && code === "KeyX" && !event.altKey && !event.shiftKey && !event.repeat) {
    return { type: "swap-colors" };
  }
  if (code === "KeyD" && !event.altKey && !event.shiftKey && !event.repeat) {
    return { type: "default-colors" };
  }
  // SAI / CSP stabilizer cycle; Alt+S = opacity lock, Shift+Alt+S = size lock (Procreate-adjacent).
  // ⇧S는 보기 리졸버가 `현재 보기 저장`으로 먼저 소비하므로(StudioPage 마스터 핸들러 순서),
  // 여기서 ⇧S를 다시 주장하면 크기 잠금이 영원히 도달하지 못하는 dead branch가 된다.
  // 잠금 두 개를 Alt 계열로 모아 두면 두 명령 모두 실제로 실행된다.
  if (code === "KeyS" && !event.repeat) {
    if (event.shiftKey && event.altKey) return { type: "toggle-size-lock" };
    if (event.altKey && !event.shiftKey) return { type: "toggle-opacity-lock" };
    if (!event.altKey && !event.shiftKey) return { type: "cycle-stabilizer" };
  }
  // Legacy hard-code KeyF; registry default is H (used when options.shortcuts is provided).
  if (allowFlip && code === "KeyF" && !event.altKey && !event.shiftKey && !event.repeat) {
    return { type: "toggle-canvas-flip-h" };
  }

  if (code === "BracketLeft" || code === "BracketRight") {
    const direction = code === "BracketLeft" ? -1 : 1;
    // Opacity is not in the customizable registry — always keep Alt+bracket.
    if (event.altKey) return { type: "adjust-opacity", delta: direction * 0.05 };
    const allowSide = direction < 0 ? allowBrushSmaller : allowBrushLarger;
    if (!allowSide) return null;
    return { type: "adjust-width", delta: direction * (event.shiftKey ? 5 : 1) };
  }
  return null;
}

export function adjustStudioBrushWidth(current: number, delta: number): number {
  const safeCurrent = Number.isFinite(current) ? current : BRUSH_STROKE_WIDTH_RANGE[0];
  const safeDelta = Number.isFinite(delta) ? delta : 0;
  return Math.min(
    BRUSH_STROKE_WIDTH_RANGE[1],
    Math.max(BRUSH_STROKE_WIDTH_RANGE[0], Math.round(safeCurrent + safeDelta))
  );
}

export function adjustStudioBrushOpacity(current: number, delta: number): number {
  const safeCurrent = Number.isFinite(current) ? current : BRUSH_OPACITY_RANGE[1];
  const safeDelta = Number.isFinite(delta) ? delta : 0;
  const rounded = Math.round((safeCurrent + safeDelta) * 100) / 100;
  return Math.min(BRUSH_OPACITY_RANGE[1], Math.max(BRUSH_OPACITY_RANGE[0], rounded));
}

/** @internal exported for tests / docs — registry drawing action defaults. */
export const STUDIO_DRAWING_REGISTRY_DEFAULTS = REGISTRY_DRAWING_DEFAULTS;
