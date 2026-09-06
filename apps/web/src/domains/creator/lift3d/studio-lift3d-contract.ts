/**
 * Studio Lift 3D — 2D 원화(캐릭터·소품·배경)를 3D 지오메트리로 들어올리는 파이프라인의 공용 계약.
 *
 * 이 트리는 브라우저 API(DOM/Canvas/WebGL)와 React 를 전혀 참조하지 않는 순수 커널이다.
 * 픽셀을 받아 실루엣 마스크 → 깊이장 → 편집 가능 메시 → 텍스처 GLB 로 이어지는 각 단계가
 * 결정론적으로 동작해야 같은 원화가 언제나 같은 모델(같은 해시)을 만든다.
 */

export const STUDIO_LIFT3D_REVISION = 1 as const;

export const STUDIO_LIFT3D_LIMITS = Object.freeze({
  /** 원본 이미지 한 변의 허용 범위. */
  minSourceDimension: 8,
  maxSourceDimension: 8192,
  /** 원본 총 픽셀 수 상한(대략 32MP). 그 이상은 업로드 단계에서 걸러야 한다. */
  maxSourcePixels: 32_000_000,
  /**
   * 작업 격자(한 변) 범위.
   *
   * 상한은 편집 메시의 **코너** 예산(`maxEdges` 500,000)에서 역산한다. 이미지 전체가 피사체인
   * 배경 리프트는 한 변 n 에서 앞뒤 2(n−1)² 개 + 옆벽 4(n−1) 개의 사각형을 만들고, 사각형 하나가
   * 코너 4개를 쓴다. n=248 이면 492,024 코너로 예산 안이고, n=252 부터 넘는다. 슬라이더 스텝(8)에
   * 맞춰 248 로 둔다 — 정점 예산만 보고 256 을 열어두면 최대 해상도가 실패로만 끝난다.
   */
  minResolution: 24,
  maxResolution: 248,
  defaultResolution: 160,
  /** GLB 에 그대로 실어보내는 원본 텍스처 바이트 상한. */
  maxTextureBytes: 16 * 1024 * 1024,
  /** 마스크가 이 비율보다 작으면 피사체를 찾지 못한 것으로 본다(거절). */
  minSubjectCoverage: 0.0015,
  /** 들어올릴 수는 있지만 디테일이 뭉개지기 시작하는 지점(경고). */
  thinSubjectCoverage: 0.012,
});

export const STUDIO_LIFT3D_SUBJECTS = ["character", "prop", "background"] as const;
export type StudioLift3dSubject = (typeof STUDIO_LIFT3D_SUBJECTS)[number];

export const STUDIO_LIFT3D_MASK_MODES = ["auto", "alpha", "key", "full"] as const;
export type StudioLift3dMaskMode = (typeof STUDIO_LIFT3D_MASK_MODES)[number];

/** 실제로 마스크를 만든 방식(`auto` 는 해석 결과로 대체된다). */
export type StudioLift3dResolvedMaskMode = Exclude<StudioLift3dMaskMode, "auto">;

export const STUDIO_LIFT3D_DEPTH_PROFILES = ["round", "soft", "slab", "relief"] as const;
export type StudioLift3dDepthProfile = (typeof STUDIO_LIFT3D_DEPTH_PROFILES)[number];

export const STUDIO_LIFT3D_GEOMETRY_MODES = ["inflate", "relief", "parallax"] as const;
/**
 * `inflate`  — 실루엣을 앞뒤 두 겹으로 부풀린 닫힌 solid(캐릭터·소품).
 * `relief`   — 앞면만 변위시키고 평평한 뒷판과 옆벽으로 막은 부조 슬래브(배경).
 * `parallax` — 깊이를 밴드로 잘라 층마다 평평한 카드를 세운 시차 레이어(배경).
 */
export type StudioLift3dGeometryMode = (typeof STUDIO_LIFT3D_GEOMETRY_MODES)[number];

export const STUDIO_LIFT3D_WARNING_CODES = [
  "alpha-absent",
  "background-key-ambiguous",
  "detached-parts-dropped",
  /** 격자 단계에서 대각 꼬집힘을 **잘라냈다**. */
  "pinch-faces-dropped",
  /** 그러고도 위상 오류가 **남았다** — 위와 뜻이 반대이므로 코드를 나눠 둔다. */
  "non-manifold-residual",
  /** 좌우대칭으로 보기 어려워 대칭 보정을 걸지 않았다. */
  "symmetry-skipped",
  /** 실루엣에 안쪽 정점이 없어 앞쪽 두께 비율이 형태를 바꾸지 못했다. */
  "front-ratio-inert",
  /** 요청한 시차 레이어 수가 지원 범위를 벗어나 조였다. */
  "layer-bands-clamped",
  /** 옆으로 맞닿은 두 시차 카드가 z 에서 두 층 이상 떨어져, 그 사이가 빈 채로 남았다. */
  "layer-depth-gap",
  "resolution-clamped",
  "shallow-subject",
  "texture-omitted",
  "thin-subject",
] as const;
export type StudioLift3dWarningCode = (typeof STUDIO_LIFT3D_WARNING_CODES)[number];

export interface StudioLift3dWarning {
  readonly code: StudioLift3dWarningCode;
  readonly message: string;
}

export type StudioLift3dFailureCode =
  | "budget-exceeded"
  | "degenerate-geometry"
  | "empty-subject"
  | "invalid-option"
  | "invalid-source";

export type StudioLift3dResult<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: readonly StudioLift3dWarning[] }
  | { readonly ok: false; readonly code: StudioLift3dFailureCode; readonly detail: string };

export interface StudioLift3dVec2 {
  readonly x: number;
  readonly y: number;
}

export interface StudioLift3dVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface StudioLift3dUv {
  /** glTF TEXCOORD_0 규약: 이미지 좌상단이 (0,0), v 는 아래로 증가한다. */
  readonly u: number;
  readonly v: number;
}

/** RGBA8, row-major, 좌상단 원점. `pixels.length === width * height * 4`. */
export interface StudioLift3dSourceImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray | Uint8Array;
}

/** 원본 그대로 GLB 에 심을 텍스처(업로드된 PNG/JPEG/WebP 바이트). */
export interface StudioLift3dTexture {
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly bytes: Uint8Array;
}

/** 0..1 로 조이고 비유한 값은 0 으로 떨어뜨린다. 마스크·깊이 커널이 함께 쓴다. */
export function clampStudioLift3dUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function studioLift3dWarning(
  code: StudioLift3dWarningCode,
  message: string,
): StudioLift3dWarning {
  return Object.freeze({ code, message });
}

export function studioLift3dFailure(
  code: StudioLift3dFailureCode,
  detail: string,
): StudioLift3dResult<never> {
  return Object.freeze({ ok: false as const, code, detail });
}

export function studioLift3dSuccess<T>(
  value: T,
  warnings: readonly StudioLift3dWarning[] = [],
): StudioLift3dResult<T> {
  return Object.freeze({ ok: true as const, value, warnings: Object.freeze([...warnings]) });
}

/**
 * 원본 이미지가 파이프라인 예산 안에 있고 픽셀 버퍼 길이가 선언된 크기와 일치하는지 확인한다.
 * 실패 사유는 UI 가 그대로 보여줄 수 있는 문장으로 돌려준다.
 */
export function validateStudioLift3dSource(
  source: StudioLift3dSourceImage | null | undefined,
): StudioLift3dResult<StudioLift3dSourceImage> {
  if (!source || typeof source !== "object") {
    return studioLift3dFailure("invalid-source", "원본 이미지가 필요합니다");
  }
  const { width, height, pixels } = source;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    return studioLift3dFailure("invalid-source", "이미지 크기는 정수여야 합니다");
  }
  const { minSourceDimension, maxSourceDimension, maxSourcePixels } = STUDIO_LIFT3D_LIMITS;
  if (
    width < minSourceDimension
    || height < minSourceDimension
    || width > maxSourceDimension
    || height > maxSourceDimension
  ) {
    return studioLift3dFailure(
      "invalid-source",
      `이미지 한 변은 ${minSourceDimension}px 이상 ${maxSourceDimension}px 이하여야 합니다`,
    );
  }
  if (width * height > maxSourcePixels) {
    return studioLift3dFailure("budget-exceeded", "이미지가 너무 큽니다(32MP 초과)");
  }
  if (!(pixels instanceof Uint8ClampedArray) && !(pixels instanceof Uint8Array)) {
    return studioLift3dFailure("invalid-source", "픽셀 버퍼는 Uint8(Clamped)Array 여야 합니다");
  }
  if (pixels.length !== width * height * 4) {
    return studioLift3dFailure(
      "invalid-source",
      "픽셀 버퍼 길이가 선언된 이미지 크기와 맞지 않습니다",
    );
  }
  return studioLift3dSuccess(source);
}

/**
 * 작업 격자 해상도를 예산 안으로 조인다. 조정되면 경고를 함께 돌려준다.
 *
 * `ceiling` 은 위상이 따로 깎는 상한이다. 지금 이 값을 넘기는 곳은 시차 레이어뿐이라
 * 조정 문구도 레이어를 지목한다 — 다른 사유가 생기면 문구도 함께 갈라야 한다.
 * 레이어는 밴드 수만큼 껍질을 겹쳐 쌓으므로 `maxResolution` 을 그대로 쓰면 해상도·레이어
 * 슬라이더의 최대값 두 개가 **항상 함께 실패한다**. 상한을 여기서 낮춰 두면 사용자가 고를 수
 * 있는 조합은 언제나 만들어진다.
 */
export function clampStudioLift3dResolution(
  requested: number | undefined,
  ceiling?: number,
): {
  readonly resolution: number;
  readonly warning: StudioLift3dWarning | null;
} {
  const { defaultResolution, maxResolution, minResolution } = STUDIO_LIFT3D_LIMITS;
  const requestedCeiling = ceiling !== undefined && Number.isFinite(ceiling)
    ? Math.floor(ceiling)
    : maxResolution;
  const upper = Math.max(minResolution, Math.min(maxResolution, requestedCeiling));
  const fallback = Math.min(defaultResolution, upper);
  if (requested === undefined) return { resolution: fallback, warning: null };
  if (!Number.isFinite(requested)) {
    return {
      resolution: fallback,
      warning: studioLift3dWarning(
        "resolution-clamped",
        `해상도 값이 유효하지 않아 기본값 ${fallback}으로 대체했습니다`,
      ),
    };
  }
  const rounded = Math.round(requested);
  const clamped = Math.min(upper, Math.max(minResolution, rounded));
  if (clamped === rounded) return { resolution: clamped, warning: null };
  const reason = upper < maxResolution
    ? `레이어를 겹쳐 쌓느라 상한이 ${upper}으로 내려가, 해상도를 ${clamped}으로 조정했습니다`
    : `해상도를 ${minResolution}~${upper} 범위의 ${clamped}으로 조정했습니다`;
  return { resolution: clamped, warning: studioLift3dWarning("resolution-clamped", reason) };
}
