/**
 * Pure admission for VRM character insert background / subject isolation.
 *
 * VRM inserts default to subject-only transparent PNGs. Optional opaque clear uses a solid
 * background color. Invalid inputs fail closed with Korean UI reasons.
 */

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

export type StudioVrmInsertBackgroundModeErrorCode =
  | "invalid-transparent"
  | "invalid-background-color";

export interface StudioVrmInsertBackgroundPlan {
  /** True when the insert cuts out the character on a transparent clear. */
  readonly transparent: boolean;
  /**
   * When true, capture must hide viewport-only helpers and env geometry so only the character
   * (and attached props) remain in the PNG.
   */
  readonly subjectOnly: boolean;
  readonly captureAlpha: 0 | 1;
  /** Clear color when opaque; still recorded for re-edit when transparent. */
  readonly backgroundColor: string;
}

export type StudioVrmInsertBackgroundModeResult =
  | { readonly ok: true; readonly plan: StudioVrmInsertBackgroundPlan }
  | {
      readonly ok: false;
      readonly code: StudioVrmInsertBackgroundModeErrorCode;
      readonly reason: string;
    };

const FAILURE_REASONS: Readonly<Record<StudioVrmInsertBackgroundModeErrorCode, string>> = Object.freeze({
  "invalid-transparent": "3D 캐릭터 삽입 투명 배경 설정이 올바르지 않습니다.",
  "invalid-background-color": "3D 캐릭터 삽입 배경 색상이 올바르지 않습니다.",
});

function failure(
  code: StudioVrmInsertBackgroundModeErrorCode,
): Extract<StudioVrmInsertBackgroundModeResult, { ok: false }> {
  return Object.freeze({
    ok: false,
    code,
    reason: FAILURE_REASONS[code],
  });
}

/**
 * Resolves VRM insert background mode.
 * `transparent` defaults are not applied here — callers pass an explicit boolean (document or UI).
 */
export function resolveStudioVrmInsertBackgroundMode(input: {
  readonly transparent: unknown;
  readonly backgroundColor?: unknown;
}): StudioVrmInsertBackgroundModeResult {
  if (!input || typeof input !== "object") {
    return failure("invalid-transparent");
  }
  if (typeof input.transparent !== "boolean") {
    return failure("invalid-transparent");
  }

  let backgroundColor = "#ffffff";
  if (input.backgroundColor !== undefined && input.backgroundColor !== null) {
    if (
      typeof input.backgroundColor !== "string" ||
      !HEX_COLOR_PATTERN.test(input.backgroundColor)
    ) {
      return failure("invalid-background-color");
    }
    backgroundColor = input.backgroundColor.toLowerCase();
  }

  const transparent = input.transparent;
  return Object.freeze({
    ok: true,
    plan: Object.freeze({
      transparent,
      // Subject isolation always applies on transparent cutouts so floor/wall env never bakes in.
      subjectOnly: transparent,
      captureAlpha: transparent ? (0 as const) : (1 as const),
      backgroundColor,
    }),
  });
}
