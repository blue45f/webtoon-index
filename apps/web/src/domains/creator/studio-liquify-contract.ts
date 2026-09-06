/** Lightweight UI/pointer contract kept outside the on-demand pixel engine. */
export const STUDIO_LIQUIFY_MODES = [
  "push",
  "twirl-clockwise",
  "twirl-counterclockwise",
  "pinch",
  "bloat",
] as const;

export type StudioLiquifyMode = (typeof STUDIO_LIQUIFY_MODES)[number];

export const LIQUIFY_RADIUS_RANGE = { min: 20, max: 240, step: 5 } as const;
export const LIQUIFY_RADIUS_DEFAULT = 80;
export const LIQUIFY_STRENGTH_RANGE = { min: 10, max: 100, step: 5 } as const;
export const LIQUIFY_STRENGTH_DEFAULT = 50;
export const LIQUIFY_HARDNESS_RANGE = { min: 0, max: 100, step: 5 } as const;
export const LIQUIFY_HARDNESS_DEFAULT = 50;
export const LIQUIFY_MIN_RADIUS_RANGE = { min: 0, max: 100, step: 5 } as const;
export const LIQUIFY_MIN_RADIUS_DEFAULT = 20;
export const LIQUIFY_STABILIZER_RANGE = { min: 0, max: 100, step: 5 } as const;
export const LIQUIFY_STABILIZER_DEFAULT = 0;
export const LIQUIFY_SPACING_RANGE = { min: 10, max: 75, step: 5 } as const;
export const LIQUIFY_SPACING_DEFAULT = 35;

/** Worker 프로토콜과 순수 엔진이 함께 사용하는 직렬화/할당 안전 상한. */
export const LIQUIFY_MAX_INPUT_POINTS = 20_000;
/** dx+dy Float32Array 합계 128MiB. */
export const LIQUIFY_MAX_FIELD_CELLS = 16_777_216;
/** 한 stroke가 누적할 수 있는 최대 변위는 brush 반경의 이 배수로 제한된다. */
export const LIQUIFY_MAX_DISPLACEMENT_RADIUS_RATIO = 2;

/** Percent-based UI values are normalized to 0..1 once at the pixel-engine boundary. */
export interface StudioLiquifyBrushDynamics {
  readonly hardness?: number;
  readonly minimumRadiusRatio?: number;
  readonly pressureAffectsRadius?: boolean;
  readonly pressureAffectsStrength?: boolean;
  readonly stabilizer?: number;
  readonly spacingRatio?: number;
}

const LIQUIFY_MODE_SET: ReadonlySet<string> = new Set(STUDIO_LIQUIFY_MODES);

export function normalizeStudioLiquifyMode(mode: unknown): StudioLiquifyMode {
  return typeof mode === "string" && LIQUIFY_MODE_SET.has(mode)
    ? (mode as StudioLiquifyMode)
    : "push";
}
