// 스포이드(색상 추출) — 합성 캔버스나 단일 레이어의 픽셀에서 색상을 뽑는 순수 함수.
// DOM/Konva와 분리해 전체 표시색·현재 레이어·최상위 레이어 샘플러가 같은 평균색 규칙을 쓴다.

export const STUDIO_EYEDROPPER_REFERENCE_MODES = [
  "merged",
  "active-layer",
  "top-layer",
] as const;

export type StudioEyedropperReferenceMode =
  (typeof STUDIO_EYEDROPPER_REFERENCE_MODES)[number];

export const STUDIO_EYEDROPPER_TARGETS = ["primary", "secondary"] as const;
export type StudioEyedropperTarget = (typeof STUDIO_EYEDROPPER_TARGETS)[number];

export interface StudioEyedropperSettings {
  /** merged=화면 표시색, active-layer=현재 레이어, top-layer=해당 위치의 최상위 레이어. */
  reference: StudioEyedropperReferenceMode;
  /** 중심 픽셀 주변의 원형 평균 반경. 0은 정확한 단일 픽셀이다. */
  averageRadius: number;
  /** 주색/보조색 중 어느 슬롯을 갱신할지. */
  target: StudioEyedropperTarget;
  /** 포인터 옆 확대 샘플 미리보기를 표시할지. */
  showLoupe: boolean;
  /** 전용 스포이드로 한 번 고른 뒤 이전 도구로 돌아갈지. Alt 임시 스포이드는 항상 복귀한다. */
  autoReturn: boolean;
  /** 현재/최상위 레이어 참조 시 잠긴 레이어를 건너뛸지. */
  excludeLocked: boolean;
  /** 현재/최상위 레이어 참조 시 텍스트·말풍선을 건너뛸지. */
  excludeText: boolean;
  /** 현재/최상위 레이어 참조 시 용지·배경 역할의 레이어를 건너뛸지. */
  excludeBackground: boolean;
  /** 현재/최상위 레이어 참조 시 밑그림 역할의 레이어를 건너뛸지. */
  excludeDraft: boolean;
  /** 현재/최상위 레이어 참조 시 참조 전용 레이어를 건너뛸지. */
  excludeReference: boolean;
}

export const DEFAULT_STUDIO_EYEDROPPER_SETTINGS: Readonly<StudioEyedropperSettings> = {
  reference: "merged",
  averageRadius: 0,
  target: "primary",
  showLoupe: true,
  autoReturn: true,
  excludeLocked: false,
  excludeText: false,
  excludeBackground: false,
  excludeDraft: false,
  excludeReference: false,
};

export const STUDIO_EYEDROPPER_MAX_AVERAGE_RADIUS = 32;

export interface StudioEyedropperSample {
  hex: string;
  rgba: readonly [red: number, green: number, blue: number, alpha: number];
  /** 투명 픽셀을 제외하고 실제 평균에 참여한 픽셀 수. */
  sampleCount: number;
  /** 가장자리 클램프 후 조사한 원형 커널 픽셀 수. */
  candidateCount: number;
  averageRadius: number;
}

function toHex(n: number): string {
  return Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, "0");
}

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}

function includesValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

/** 저장본·외부 입력을 작고 예측 가능한 스포이드 설정으로 정규화한다. */
export function normalizeStudioEyedropperSettings(
  value?: Partial<StudioEyedropperSettings> | null,
): StudioEyedropperSettings {
  const source = value && typeof value === "object" ? value : {};
  return {
    reference: includesValue(STUDIO_EYEDROPPER_REFERENCE_MODES, source.reference)
      ? source.reference
      : DEFAULT_STUDIO_EYEDROPPER_SETTINGS.reference,
    averageRadius: Math.min(
      STUDIO_EYEDROPPER_MAX_AVERAGE_RADIUS,
      Math.max(0, finiteInteger(source.averageRadius, DEFAULT_STUDIO_EYEDROPPER_SETTINGS.averageRadius)),
    ),
    target: includesValue(STUDIO_EYEDROPPER_TARGETS, source.target)
      ? source.target
      : DEFAULT_STUDIO_EYEDROPPER_SETTINGS.target,
    showLoupe: typeof source.showLoupe === "boolean"
      ? source.showLoupe
      : DEFAULT_STUDIO_EYEDROPPER_SETTINGS.showLoupe,
    autoReturn: typeof source.autoReturn === "boolean"
      ? source.autoReturn
      : DEFAULT_STUDIO_EYEDROPPER_SETTINGS.autoReturn,
    excludeLocked: typeof source.excludeLocked === "boolean"
      ? source.excludeLocked
      : DEFAULT_STUDIO_EYEDROPPER_SETTINGS.excludeLocked,
    excludeText: typeof source.excludeText === "boolean"
      ? source.excludeText
      : DEFAULT_STUDIO_EYEDROPPER_SETTINGS.excludeText,
    excludeBackground: typeof source.excludeBackground === "boolean"
      ? source.excludeBackground
      : DEFAULT_STUDIO_EYEDROPPER_SETTINGS.excludeBackground,
    excludeDraft: typeof source.excludeDraft === "boolean"
      ? source.excludeDraft
      : DEFAULT_STUDIO_EYEDROPPER_SETTINGS.excludeDraft,
    excludeReference: typeof source.excludeReference === "boolean"
      ? source.excludeReference
      : DEFAULT_STUDIO_EYEDROPPER_SETTINGS.excludeReference,
  };
}

/**
 * 중심 주변의 원형 커널을 alpha-weighted 평균한다. 반투명 가장자리의 숨은 RGB가 평균색을
 * 오염시키지 않으며, 완전 투명 픽셀만 있는 영역은 null을 반환한다.
 */
export function sampleColorFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  options: { averageRadius?: number } = {},
): StudioEyedropperSample | null {
  const safeWidth = finiteInteger(width, 0);
  const safeHeight = finiteInteger(height, 0);
  if (safeWidth <= 0 || safeHeight <= 0 || data.length < safeWidth * safeHeight * 4) return null;
  const centerX = Math.floor(x);
  const centerY = Math.floor(y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (centerX < 0 || centerY < 0 || centerX >= safeWidth || centerY >= safeHeight) return null;

  const radius = Math.min(
    STUDIO_EYEDROPPER_MAX_AVERAGE_RADIUS,
    Math.max(0, finiteInteger(options.averageRadius, 0)),
  );
  let weightedRed = 0;
  let weightedGreen = 0;
  let weightedBlue = 0;
  let alphaWeight = 0;
  let alphaSum = 0;
  let sampleCount = 0;
  let candidateCount = 0;

  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    const sampleY = centerY + offsetY;
    if (sampleY < 0 || sampleY >= safeHeight) continue;
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (offsetX * offsetX + offsetY * offsetY > radius * radius) continue;
      const sampleX = centerX + offsetX;
      if (sampleX < 0 || sampleX >= safeWidth) continue;
      candidateCount += 1;
      const index = (sampleY * safeWidth + sampleX) * 4;
      const alpha = data[index + 3] ?? 0;
      if (alpha <= 0) continue;
      const weight = alpha / 255;
      weightedRed += (data[index] ?? 0) * weight;
      weightedGreen += (data[index + 1] ?? 0) * weight;
      weightedBlue += (data[index + 2] ?? 0) * weight;
      alphaWeight += weight;
      alphaSum += alpha;
      sampleCount += 1;
    }
  }

  if (sampleCount === 0 || alphaWeight <= 0) return null;
  const red = Math.round(weightedRed / alphaWeight);
  const green = Math.round(weightedGreen / alphaWeight);
  const blue = Math.round(weightedBlue / alphaWeight);
  const alpha = Math.round(alphaSum / sampleCount);
  return {
    hex: `#${toHex(red)}${toHex(green)}${toHex(blue)}`,
    rgba: [red, green, blue, alpha],
    sampleCount,
    candidateCount,
    averageRadius: radius,
  };
}

/**
 * ImageData의 (x, y) 픽셀을 #rrggbb hex로 반환한다. 캔버스 밖 좌표거나 완전 투명(alpha=0)
 * 픽셀이면 null(아무것도 칠해지지 않은 지점에서는 색을 바꾸지 않는 게 자연스럽다).
 * 알파 블렌딩: 배경이 비치는 반투명 픽셀은 이미 합성된(premultiplied 아닌 실제 표시) 색을
 * 그대로 쓴다 — data는 항상 스테이지를 흰 배경 위에 렌더링한 결과이므로 별도 언블렌딩 불필요.
 */
export function pickColorFromImageData(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): string | null {
  return sampleColorFromImageData(data, width, height, x, y)?.hex ?? null;
}
