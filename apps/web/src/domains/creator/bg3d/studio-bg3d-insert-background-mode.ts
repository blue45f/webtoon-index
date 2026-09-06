/**
 * Pure admission for 3D insert / capture background mode (subject-only vs opaque sky).
 *
 * Capture adapters own clear color and alpha; this module only freezes the document intent
 * into a portable plan so insert, shot batch, and library save never re-derive alpha ad hoc.
 * Invalid inputs fail closed with Korean UI reasons — never silently coerce.
 */

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const BACKGROUND_MODE_SET = new Set(["color", "sky-preset", "transparent"]);

export type StudioBg3dInsertBackgroundModeErrorCode =
  | "invalid-transparent"
  | "invalid-background-mode"
  | "invalid-clear-color";

export interface StudioBg3dInsertBackgroundPlan {
  /** True when the insert should cut out everything except scene subjects (alpha 0 clear). */
  readonly transparent: boolean;
  /** Document `background.mode` written for re-edit parity. */
  readonly documentBackgroundMode: "transparent" | "sky-preset";
  /** Capture request alpha: 0 subject-only, 1 opaque clear. */
  readonly captureAlpha: 0 | 1;
  /**
   * When true, the engine capture pass must null `scene.background` so panorama/sky does not
   * paint into transparent pixels.
   */
  readonly suppressSceneBackground: boolean;
  /** Optional validated clear color; null means "use sky preset clear at the call site". */
  readonly clearColor: string | null;
}

export type StudioBg3dInsertBackgroundModeResult =
  | { readonly ok: true; readonly plan: StudioBg3dInsertBackgroundPlan }
  | {
      readonly ok: false;
      readonly code: StudioBg3dInsertBackgroundModeErrorCode;
      readonly reason: string;
    };

const FAILURE_REASONS: Readonly<Record<StudioBg3dInsertBackgroundModeErrorCode, string>> = Object.freeze({
  "invalid-transparent": "3D 삽입 투명 배경 설정이 올바르지 않습니다.",
  "invalid-background-mode": "3D 삽입 배경 모드가 올바르지 않습니다.",
  "invalid-clear-color": "3D 삽입 배경 색상이 올바르지 않습니다.",
});

function failure(
  code: StudioBg3dInsertBackgroundModeErrorCode,
): Extract<StudioBg3dInsertBackgroundModeResult, { ok: false }> {
  return Object.freeze({
    ok: false,
    code,
    reason: FAILURE_REASONS[code],
  });
}

function planFromTransparent(
  transparent: boolean,
  clearColor: string | null,
): StudioBg3dInsertBackgroundModeResult {
  return Object.freeze({
    ok: true,
    plan: Object.freeze({
      transparent,
      documentBackgroundMode: transparent ? ("transparent" as const) : ("sky-preset" as const),
      captureAlpha: transparent ? (0 as const) : (1 as const),
      suppressSceneBackground: transparent,
      clearColor,
    }),
  });
}

function normalizeOptionalClearColor(
  clearColor: unknown,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  if (clearColor === undefined || clearColor === null) {
    return { ok: true, value: null };
  }
  if (typeof clearColor !== "string" || !HEX_COLOR_PATTERN.test(clearColor)) {
    return { ok: false };
  }
  return { ok: true, value: clearColor.toLowerCase() };
}

/**
 * Resolves an explicit subject-only / opaque insert intent.
 * `transparent` must be a boolean — non-booleans fail closed instead of truthy-coercing.
 */
export function resolveStudioBg3dInsertBackgroundMode(input: {
  readonly transparent: unknown;
  readonly clearColor?: unknown;
}): StudioBg3dInsertBackgroundModeResult {
  if (!input || typeof input !== "object") {
    return failure("invalid-transparent");
  }
  if (typeof input.transparent !== "boolean") {
    return failure("invalid-transparent");
  }
  const clear = normalizeOptionalClearColor(input.clearColor);
  if (!clear.ok) return failure("invalid-clear-color");
  return planFromTransparent(input.transparent, clear.value);
}

/**
 * Resolves insert background mode from persisted document fields.
 * Either `output.transparentBackground` or `background.mode === "transparent"` enables cutout.
 * Absent fields default to opaque sky (document defaults); present but invalid values fail closed.
 */
export function resolveStudioBg3dInsertBackgroundFromDocument(input: {
  readonly transparentBackground?: unknown;
  readonly backgroundMode?: unknown;
  readonly clearColor?: unknown;
}): StudioBg3dInsertBackgroundModeResult {
  if (!input || typeof input !== "object") {
    return failure("invalid-transparent");
  }

  if (
    input.transparentBackground !== undefined &&
    typeof input.transparentBackground !== "boolean"
  ) {
    return failure("invalid-transparent");
  }
  if (input.backgroundMode !== undefined) {
    if (typeof input.backgroundMode !== "string" || !BACKGROUND_MODE_SET.has(input.backgroundMode)) {
      return failure("invalid-background-mode");
    }
  }

  const clear = normalizeOptionalClearColor(input.clearColor);
  if (!clear.ok) return failure("invalid-clear-color");

  const transparent =
    input.transparentBackground === true || input.backgroundMode === "transparent";
  return planFromTransparent(transparent, clear.value);
}

/** Portable capture-request fragment derived from an admitted plan + resolved clear color. */
export function toStudioBg3dInsertCaptureBackground(
  plan: StudioBg3dInsertBackgroundPlan,
  clearColor: string,
): { readonly color: string; readonly alpha: 0 | 1 } {
  if (!plan || typeof plan !== "object") {
    throw new TypeError("3D insert background plan is required.");
  }
  if (typeof clearColor !== "string" || !HEX_COLOR_PATTERN.test(clearColor)) {
    throw new TypeError("3D insert clear color must be a six-digit hex color.");
  }
  return Object.freeze({
    color: (plan.clearColor ?? clearColor).toLowerCase(),
    alpha: plan.captureAlpha,
  });
}
