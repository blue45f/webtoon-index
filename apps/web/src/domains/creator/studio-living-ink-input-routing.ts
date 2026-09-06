/**
 * Living Ink dual-wield input routing (InkWash §09).
 *
 * - Pen → ink (pressure-speed pen)
 * - Finger after a pencil has been seen → waterbrush (no mode toggle)
 * - Barrel / eraser button → momentary ink↔water swap
 * - Force Touch / hardware pressure / speed-simulated pressure sources
 * - One active stroke at a time; secondary contacts are palm unless dual-pointer water is free
 *
 * Pure policy: no DOM. StudioPage applies the resolved mode to admitStroke.
 */

import { DEFAULT_STUDIO_LIVING_INK_INPUT_POLICY } from "./studio-living-ink-gpu-protocol";

import type {
  StudioLivingInkInputPolicy,
  StudioLivingInkMaterialControls,
} from "./studio-living-ink-gpu-protocol";
import type { StudioLivingInkStrokeMode } from "./studio-living-ink-studio-coordinator";

export const STUDIO_LIVING_INK_INPUT_ROUTING_VERSION = 1 as const;

/** Barrel (2) or eraser (32) bits — matches InkWash `e.buttons & 34`. */
export const STUDIO_LIVING_INK_BARREL_BUTTON_MASK = 34 as const;

export type StudioLivingInkPointerKind = "pen" | "finger" | "mouse" | "unknown";

export interface StudioLivingInkPointerContact {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly buttons: number;
  readonly pressure: number;
  /** Safari Force Touch: `webkitForce` mapped to 0..1 when present. */
  readonly forceTouch?: number | null;
  readonly isPrimary?: boolean;
}

export interface StudioLivingInkInputRoutingState {
  /** True after any pen pointer has been observed this session/page. */
  readonly pencilSeen: boolean;
  /** Active stroke owner pointer id, or null when idle. */
  readonly activePointerId: number | null;
  readonly uiMode: StudioLivingInkStrokeMode;
  readonly dualPointerWaterbrush: boolean;
  readonly inputPolicy: StudioLivingInkInputPolicy;
}

export interface StudioLivingInkResolvedStrokeRoute {
  readonly mode: StudioLivingInkStrokeMode;
  readonly toolMode: StudioLivingInkInputPolicy["toolMode"];
  readonly pointerSource: StudioLivingInkInputPolicy["pointerSource"];
  readonly pressureSource: StudioLivingInkInputPolicy["pressureSource"];
  readonly pressure: number;
  readonly barrelSwapActive: boolean;
  readonly accept: boolean;
  readonly rejectReason:
    | null
    | "secondary-pointer"
    | "palm-while-pen"
    | "unknown-pointer"
    | "policy-disabled";
}

function normalizePointerKind(pointerType: string): StudioLivingInkPointerKind {
  if (pointerType === "pen") return "pen";
  if (pointerType === "touch") return "finger";
  if (pointerType === "mouse") return "mouse";
  return "unknown";
}

export function livingInkBarrelActive(buttons: number): boolean {
  return (Math.max(0, buttons | 0) & STUDIO_LIVING_INK_BARREL_BUTTON_MASK) !== 0;
}

/**
 * Map raw pointer pressure + optional Force Touch into a 0..1 stroke pressure.
 * Speed simulation is left to the mark engine when hardware pressure is absent.
 */
export function resolveLivingInkPressure(
  contact: StudioLivingInkPointerContact,
  pointerSource: StudioLivingInkInputPolicy["pointerSource"],
): Readonly<{
  pressure: number;
  pressureSource: StudioLivingInkInputPolicy["pressureSource"];
}> {
  const force = typeof contact.forceTouch === "number" && Number.isFinite(contact.forceTouch)
    ? Math.min(1, Math.max(0, contact.forceTouch))
    : null;
  if (force !== null && force > 0.02) {
    return Object.freeze({ pressure: force, pressureSource: "force-touch" as const });
  }
  const hardware = typeof contact.pressure === "number" && Number.isFinite(contact.pressure)
    ? contact.pressure
    : 0;
  // Pen with a real pressure stream (not the browser's 0.5 placeholder-only path).
  if (
    pointerSource === "pen"
    && hardware > 0
    && Math.abs(hardware - 0.5) > 0.001
  ) {
    return Object.freeze({
      pressure: Math.min(1, Math.max(0.02, hardware)),
      pressureSource: "hardware" as const,
    });
  }
  if (pointerSource === "pen" && hardware > 0) {
    return Object.freeze({
      pressure: Math.min(1, Math.max(0.02, hardware)),
      pressureSource: "hardware" as const,
    });
  }
  // Mouse / finger: engine fakes pressure from speed (InkWash simP path).
  return Object.freeze({
    pressure: Math.min(1, Math.max(0.12, hardware > 0 ? hardware : 0.35)),
    pressureSource: "speed-simulated" as const,
  });
}

/**
 * Resolve ink vs water for a new Living Ink stroke from pointer identity + UI mode + barrel.
 */
export function resolveLivingInkStrokeRoute(
  state: StudioLivingInkInputRoutingState,
  contact: StudioLivingInkPointerContact,
): StudioLivingInkResolvedStrokeRoute {
  const policy = state.inputPolicy ?? DEFAULT_STUDIO_LIVING_INK_INPUT_POLICY;
  const kind = normalizePointerKind(contact.pointerType);
  if (kind === "unknown") {
    return Object.freeze({
      mode: state.uiMode,
      toolMode: policy.toolMode,
      pointerSource: "mouse",
      pressureSource: "speed-simulated",
      pressure: 0.35,
      barrelSwapActive: false,
      accept: false,
      rejectReason: "unknown-pointer",
    });
  }

  // One stroke at a time — second contact is palm / secondary (InkWash activePointerId rule).
  if (
    state.activePointerId !== null
    && contact.pointerId !== state.activePointerId
  ) {
    const penOwnsStroke = policy.rejectPalm && state.activePointerId !== null;
    if (penOwnsStroke || policy.rejectSecondaryPointer) {
      return Object.freeze({
        mode: state.uiMode,
        toolMode: policy.toolMode,
        pointerSource: kind === "finger" ? "finger" : kind === "pen" ? "pen" : "mouse",
        pressureSource: "speed-simulated" as const,
        pressure: 0.35,
        barrelSwapActive: false,
        accept: false,
        rejectReason: kind === "finger" && state.pencilSeen
          ? "palm-while-pen"
          : "secondary-pointer",
      });
    }
  }

  const pointerSource: StudioLivingInkInputPolicy["pointerSource"] =
    kind === "pen" ? "pen" : kind === "finger" ? "finger" : "mouse";

  // Dual-pointer waterbrush: after a pencil has been seen, finger is water (InkWash iPad mapping).
  let mode: StudioLivingInkStrokeMode = state.uiMode;
  if (state.dualPointerWaterbrush && state.pencilSeen && kind === "finger") {
    mode = "water";
  } else if (kind === "pen") {
    mode = "ink";
  }

  const barrel = livingInkBarrelActive(contact.buttons)
    && policy.barrelMomentarySwap === "ink-water";
  if (barrel) {
    mode = mode === "ink" ? "water" : "ink";
  }

  const pressureResolved = resolveLivingInkPressure(contact, pointerSource);
  const toolMode: StudioLivingInkInputPolicy["toolMode"] =
    mode === "water"
      ? "clean-water-brush"
      : policy.toolMode === "white-gouache"
        ? "white-gouache"
        : "pressure-speed-pen";

  return Object.freeze({
    mode,
    toolMode,
    pointerSource,
    pressureSource: pressureResolved.pressureSource,
    pressure: pressureResolved.pressure,
    barrelSwapActive: barrel,
    accept: true,
    rejectReason: null,
  });
}

export function withPencilSeen(
  state: StudioLivingInkInputRoutingState,
  pointerType: string,
): StudioLivingInkInputRoutingState {
  if (pointerType !== "pen" || state.pencilSeen) return state;
  return Object.freeze({ ...state, pencilSeen: true });
}

export function livingInkModeLabel(
  mode: StudioLivingInkStrokeMode,
  route: StudioLivingInkResolvedStrokeRoute,
): string {
  if (route.barrelSwapActive) {
    return mode === "water" ? "물 (배럴 스왑)" : "잉크 (배럴 스왑)";
  }
  if (route.pointerSource === "finger" && mode === "water") {
    return "물 (손가락 워터브러시)";
  }
  if (route.pointerSource === "pen" && mode === "ink") {
    return "잉크 (펜)";
  }
  return mode === "water" ? "물" : "잉크";
}

/** Product defaults for dual-wield — pencil seen enables finger→water. */
export function createDefaultLivingInkInputRoutingState(
  uiMode: StudioLivingInkStrokeMode = "ink",
): StudioLivingInkInputRoutingState {
  return Object.freeze({
    pencilSeen: false,
    activePointerId: null,
    uiMode,
    dualPointerWaterbrush: true,
    inputPolicy: DEFAULT_STUDIO_LIVING_INK_INPUT_POLICY,
  });
}

export type { StudioLivingInkMaterialControls };
