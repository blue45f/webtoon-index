/**
 * Studio 3D 삽입(LT 캡처)의 프레임 기하 — DOM·엔진 의존이 전혀 없는 순수 계산.
 *
 * 예전에는 캡처 비율이 "살아 있는 뷰포트 캔버스 크기"에서 파생됐다. 그래서 3D 패널을 넓히거나
 * 다른 화면에서 열면 같은 장면이 다른 구도로 삽입됐다(사용자 신고: "원본과 달리 변형되어 삽입").
 * 이 모듈은 그 비율을 문서가 소유한 명시적 값으로 바꾸고, 뷰어에 그릴 세이프 프레임과 렌더러가
 * 실제로 캡처하는 사각형이 같은 식에서 나오도록 단일 소스를 제공한다.
 *
 * ── 화각(FOV) 보존 규칙 ──────────────────────────────────────────────
 * 캡처 프레임은 "라이브 뷰포트 안에 들어가는, 요청 비율의 가장 큰 중앙 정렬 사각형"이다(contain).
 * 절대로 뷰포트 밖으로 확장하지 않는다. 따라서
 *   - 캡처가 뷰포트보다 좁으면(pillarbox) 세로 화각이 그대로 유지되고 가로만 잘린다.
 *   - 캡처가 뷰포트보다 넓으면(letterbox) 가로 화각이 그대로 유지되고 세로만 잘린다.
 * 이 규칙만이 오버레이가 정직할 수 있는 유일한 규칙이다. 반대로 "요청 비율에 맞춰 화각을 넓히는"
 * 규칙을 쓰면 화면에 보이지 않던 지오메트리가 삽입 결과에 새로 등장하고, 뷰포트에 그 영역을 그릴
 * 방법이 없어 WYSIWYG이 깨진다.
 *
 * 렌더러 쪽 적용은 Three의 `setViewOffset`(카메라 view 창)으로 하며, 이미 렌즈 시프트가 같은
 * 창을 1000 단위로 쓰고 있으므로(studio-bg3d-camera-application) 두 값을 선형 합성한다.
 */

/** 문서에 저장할 수 있는 캡처 비율 범위(세로 4:1 ~ 가로 4:1). */
export const STUDIO_BG3D_CAPTURE_ASPECT_MIN = 0.25;
export const STUDIO_BG3D_CAPTURE_ASPECT_MAX = 4;
/** 렌즈 시프트가 쓰는 `setViewOffset` 단위 정사각형. 크롭은 여기에 합성된다. */
export const STUDIO_BG3D_CAPTURE_VIEW_OFFSET_UNIT = 1_000;
/** 비율 비교 허용 오차(프리셋 매칭 전용). */
export const STUDIO_BG3D_CAPTURE_ASPECT_EPSILON = 1e-6;

const MAX_VIEWPORT_EDGE = 65_536;

export type StudioBg3dCaptureFrameFit = "exact" | "letterbox" | "pillarbox";

export interface StudioBg3dCaptureFrameInput {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /** null/undefined = 고정 비율이 없는 상태(레거시 문서). 뷰포트 비율을 그대로 따른다. */
  readonly aspectRatio?: number | null;
}

export interface StudioBg3dCaptureFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 프레임이 실제로 갖는 비율. followsViewport일 때는 뷰포트 비율과 같다. */
  readonly aspectRatio: number;
  readonly fit: StudioBg3dCaptureFrameFit;
  readonly followsViewport: boolean;
  /** 뷰포트 → 프레임 NDC 확대율. 항상 1 이상이며 크롭 없는 프레임은 정확히 1이다. */
  readonly scaleX: number;
  readonly scaleY: number;
}

/** 이미 적용돼 있는 view 창(정규화 [0,1] 단위). 렌즈 시프트는 {sx, sy, 1, 1}로 들어온다. */
export interface StudioBg3dCaptureBaseViewWindow {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioBg3dCaptureViewOffsetInput {
  readonly frame: StudioBg3dCaptureFrame;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /** 화면이 이미 보여 주고 있는 창. 크롭은 이 창 "안쪽"을 다시 자른다. */
  readonly baseWindow?: StudioBg3dCaptureBaseViewWindow | null;
}

/** Three `camera.setViewOffset(fullWidth, fullHeight, offsetX, offsetY, width, height)` 인자. */
export interface StudioBg3dCaptureViewOffset {
  readonly fullWidth: number;
  readonly fullHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioBg3dCaptureAspectPreset {
  readonly id: string;
  readonly label: string;
  /** null = 뷰포트 비율을 따르는 자동 상태. */
  readonly ratio: number | null;
}

export interface StudioBg3dCaptureFrameCameraLike {
  readonly zoom?: number;
  readonly lensShift?: readonly [number, number];
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 손상된 문서 값을 방어적으로 정규화한다. 숫자가 아니거나 유한하지 않으면 null(=자동)로 떨어지고,
 * 범위를 벗어난 유한한 값은 계약 범위로 클램프된다. 클램프는 멱등이라 canonical 왕복에 안전하다.
 */
export function normalizeStudioBg3dCaptureAspectRatio(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(STUDIO_BG3D_CAPTURE_ASPECT_MAX, Math.max(STUDIO_BG3D_CAPTURE_ASPECT_MIN, value));
}

/**
 * 뷰포트 안에 들어가는 캡처 프레임을 계산한다. 뷰포트 크기가 비정상이거나, 비율을 명시했는데 그
 * 값이 유한한 양수가 아니면 null(fail-closed)을 돌려준다.
 */
export function resolveStudioBg3dCaptureFrame(
  input: StudioBg3dCaptureFrameInput,
): StudioBg3dCaptureFrame | null {
  if (!input || typeof input !== "object") return null;
  const { viewportWidth, viewportHeight } = input;
  if (
    !finitePositive(viewportWidth) ||
    !finitePositive(viewportHeight) ||
    viewportWidth > MAX_VIEWPORT_EDGE ||
    viewportHeight > MAX_VIEWPORT_EDGE
  ) {
    return null;
  }
  const viewportAspect = viewportWidth / viewportHeight;
  if (!finitePositive(viewportAspect)) return null;

  const requested = input.aspectRatio;
  const followsViewport = requested === undefined || requested === null;
  let aspectRatio = viewportAspect;
  if (!followsViewport) {
    const normalized = normalizeStudioBg3dCaptureAspectRatio(requested);
    if (normalized === null) return null;
    aspectRatio = normalized;
  }

  // 뷰포트와 같은 비율이면 크롭이 없다. 레거시(자동) 경로가 예전과 완전히 같은 값을 쓰도록
  // 배율을 계산이 아닌 정확히 1로 고정한다.
  if (followsViewport || aspectRatio === viewportAspect) {
    return Object.freeze({
      x: 0,
      y: 0,
      width: viewportWidth,
      height: viewportHeight,
      aspectRatio,
      fit: "exact" as const,
      followsViewport,
      scaleX: 1,
      scaleY: 1,
    });
  }

  const letterbox = aspectRatio > viewportAspect;
  const width = letterbox ? viewportWidth : Math.min(viewportWidth, viewportHeight * aspectRatio);
  const height = letterbox ? Math.min(viewportHeight, viewportWidth / aspectRatio) : viewportHeight;
  if (!finitePositive(width) || !finitePositive(height)) return null;

  return Object.freeze({
    x: (viewportWidth - width) / 2,
    y: (viewportHeight - height) / 2,
    width,
    height,
    aspectRatio,
    fit: letterbox ? ("letterbox" as const) : ("pillarbox" as const),
    followsViewport: false,
    scaleX: viewportWidth / width,
    scaleY: viewportHeight / height,
  });
}

/**
 * 프레임을 Three의 view offset 창으로 옮긴다. 이미 적용된 렌즈 시프트가 있으면, 화면에 보이는
 * (시프트된) 창 안쪽을 다시 자르는 의미가 되도록 선형 합성한다.
 */
export function resolveStudioBg3dCaptureViewOffset(
  input: StudioBg3dCaptureViewOffsetInput,
): StudioBg3dCaptureViewOffset | null {
  if (!input || typeof input !== "object") return null;
  const { frame, viewportWidth, viewportHeight } = input;
  if (
    !frame ||
    !finitePositive(viewportWidth) ||
    !finitePositive(viewportHeight) ||
    !finitePositive(frame.width) ||
    !finitePositive(frame.height) ||
    !Number.isFinite(frame.x) ||
    !Number.isFinite(frame.y) ||
    frame.x < 0 ||
    frame.y < 0 ||
    frame.x + frame.width > viewportWidth + 1e-6 ||
    frame.y + frame.height > viewportHeight + 1e-6
  ) {
    return null;
  }
  const base = input.baseWindow;
  const baseOffsetX = base && Number.isFinite(base.offsetX) ? base.offsetX : 0;
  const baseOffsetY = base && Number.isFinite(base.offsetY) ? base.offsetY : 0;
  const baseWidth = base && finitePositive(base.width) ? base.width : 1;
  const baseHeight = base && finitePositive(base.height) ? base.height : 1;
  const unit = STUDIO_BG3D_CAPTURE_VIEW_OFFSET_UNIT;
  const offsetX = (baseOffsetX + (frame.x / viewportWidth) * baseWidth) * unit;
  const offsetY = (baseOffsetY + (frame.y / viewportHeight) * baseHeight) * unit;
  const width = (frame.width / viewportWidth) * baseWidth * unit;
  const height = (frame.height / viewportHeight) * baseHeight * unit;
  if (
    !Number.isFinite(offsetX) ||
    !Number.isFinite(offsetY) ||
    !finitePositive(width) ||
    !finitePositive(height)
  ) {
    return null;
  }
  return Object.freeze({ fullWidth: unit, fullHeight: unit, offsetX, offsetY, width, height });
}

/**
 * 원근 소실점 유도용 카메라 설정을 캡처 프레임 기준으로 환산한다.
 *
 * 중앙 크롭은 NDC를 (scaleX, scaleY)만큼 확대하는 선형 변환이다. 세로 반화각 t와 렌즈 시프트를
 * t' = t / scaleY, shift' = (sx·scaleX, sy·scaleY)로 바꾸면, 잘린 래스터 크기로 소실점을 계산해도
 * 렌더러 결과와 정확히 같은 좌표가 나온다. zoom은 t의 분모이므로 zoom' = zoom · scaleY.
 */
export function resolveStudioBg3dCaptureFrameCameraSettings<
  Camera extends StudioBg3dCaptureFrameCameraLike,
>(camera: Camera, frame: StudioBg3dCaptureFrame): Camera {
  if (
    !camera ||
    !frame ||
    frame.fit === "exact" ||
    !finitePositive(frame.scaleX) ||
    !finitePositive(frame.scaleY)
  ) {
    return camera;
  }
  const shift = camera.lensShift;
  return Object.freeze({
    ...camera,
    ...(typeof camera.zoom === "number" && Number.isFinite(camera.zoom)
      ? { zoom: camera.zoom * frame.scaleY }
      : {}),
    ...(shift && Number.isFinite(shift[0]) && Number.isFinite(shift[1])
      ? { lensShift: [shift[0] * frame.scaleX, shift[1] * frame.scaleY] as readonly [number, number] }
      : {}),
  }) as Camera;
}

export const STUDIO_BG3D_CAPTURE_ASPECT_VIEWPORT_PRESET_ID = "viewport";
export const STUDIO_BG3D_CAPTURE_ASPECT_DOCUMENT_PRESET_ID = "document";
export const STUDIO_BG3D_CAPTURE_ASPECT_CUSTOM_PRESET_ID = "custom";

/** 웹툰 작업 흐름에 맞춘 고정 비율 프리셋. 첫 항목은 언제나 "자동"이다. */
export const STUDIO_BG3D_CAPTURE_ASPECT_PRESETS: readonly StudioBg3dCaptureAspectPreset[] =
  Object.freeze([
    Object.freeze({
      id: STUDIO_BG3D_CAPTURE_ASPECT_VIEWPORT_PRESET_ID,
      label: "뷰포트 비율 (자유)",
      ratio: null,
    }),
    Object.freeze({ id: "16-9", label: "가로 16:9", ratio: 16 / 9 }),
    Object.freeze({ id: "4-3", label: "가로 4:3", ratio: 4 / 3 }),
    Object.freeze({ id: "1-1", label: "정사각 1:1", ratio: 1 }),
    Object.freeze({ id: "3-4", label: "세로 3:4", ratio: 3 / 4 }),
    Object.freeze({ id: "9-16", label: "세로 9:16", ratio: 9 / 16 }),
  ]);

/** 편집 중인 문서 캔버스 비율 프리셋. 캔버스 크기를 모르면 null이라 목록에서 빠진다. */
export function createStudioBg3dDocumentCaptureAspectPreset(
  canvasWidth: unknown,
  canvasHeight: unknown,
): StudioBg3dCaptureAspectPreset | null {
  if (!finitePositive(canvasWidth) || !finitePositive(canvasHeight)) return null;
  const ratio = normalizeStudioBg3dCaptureAspectRatio(canvasWidth / canvasHeight);
  if (ratio === null) return null;
  return Object.freeze({
    id: STUDIO_BG3D_CAPTURE_ASPECT_DOCUMENT_PRESET_ID,
    label: `문서 캔버스 비율 (${Math.round(canvasWidth)}×${Math.round(canvasHeight)})`,
    ratio,
  });
}

/** 현재 비율에 해당하는 프리셋 id. 어디에도 맞지 않으면 "custom". */
export function matchStudioBg3dCaptureAspectPreset(
  ratio: number | null | undefined,
  presets: readonly StudioBg3dCaptureAspectPreset[] = STUDIO_BG3D_CAPTURE_ASPECT_PRESETS,
): string {
  if (ratio === null || ratio === undefined) {
    return STUDIO_BG3D_CAPTURE_ASPECT_VIEWPORT_PRESET_ID;
  }
  if (!finitePositive(ratio)) return STUDIO_BG3D_CAPTURE_ASPECT_CUSTOM_PRESET_ID;
  for (const preset of presets) {
    if (preset.ratio === null) continue;
    if (Math.abs(preset.ratio - ratio) <= STUDIO_BG3D_CAPTURE_ASPECT_EPSILON * preset.ratio) {
      return preset.id;
    }
  }
  return STUDIO_BG3D_CAPTURE_ASPECT_CUSTOM_PRESET_ID;
}

/** 비율을 사람이 읽는 라벨로. 프리셋이면 프리셋 라벨, 아니면 소수 2자리 근사. */
export function formatStudioBg3dCaptureAspectRatio(
  ratio: number | null | undefined,
  presets: readonly StudioBg3dCaptureAspectPreset[] = STUDIO_BG3D_CAPTURE_ASPECT_PRESETS,
): string {
  if (ratio === null || ratio === undefined || !finitePositive(ratio)) return "자동";
  const id = matchStudioBg3dCaptureAspectPreset(ratio, presets);
  const preset = presets.find((candidate) => candidate.id === id);
  return preset?.label ?? `${ratio.toFixed(2)} : 1`;
}
