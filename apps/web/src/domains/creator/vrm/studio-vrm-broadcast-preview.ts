export const STUDIO_VRM_BROADCAST_BACKGROUNDS = Object.freeze([
  Object.freeze({ id: "green", label: "크로마 그린", hex: "#00b140" }),
  Object.freeze({ id: "blue", label: "크로마 블루", hex: "#0047bb" }),
  Object.freeze({ id: "black", label: "블랙", hex: "#000000" }),
] as const);

export const STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_BYTES = 64 * 1024 * 1024;
export const STUDIO_VRM_BROADCAST_FRAMEBUFFER_ESTIMATED_BYTES_PER_PIXEL = 48;
export const STUDIO_VRM_BROADCAST_FRAMEBUFFER_MIN_DPR = 0.125;
export const STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_DPR = 2;

const STUDIO_VRM_BROADCAST_FRAMEBUFFER_MIN_CSS_EDGE = 1;
const STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_CSS_EDGE = 16_384;
const STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_PIXEL_EDGE = 8_192;
const STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_INPUT_DPR = 8;
const STUDIO_VRM_BROADCAST_FRAMEBUFFER_DPR_STEPS_PER_UNIT = 64;

export type StudioVrmBroadcastFramebufferReceipt = Readonly<{
  kind: "toonspectrum.studio-vrm-broadcast-framebuffer";
  version: 1;
  cssWidth: number;
  cssHeight: number;
  requestedDpr: number;
  dpr: number;
  pixelWidth: number;
  pixelHeight: number;
  estimatedBytes: number;
  maxBytes: typeof STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_BYTES;
  estimatedBytesPerPixel: typeof STUDIO_VRM_BROADCAST_FRAMEBUFFER_ESTIMATED_BYTES_PER_PIXEL;
  antialiasEstimate: Readonly<{
    msaaSamples: 4;
    includesColorDepthResolveAndHeadroom: true;
  }>;
  authority: "runtime-only";
}>;

export type StudioVrmBroadcastFramebufferPlan =
  | Readonly<{
      ok: true;
      receipt: StudioVrmBroadcastFramebufferReceipt;
    }>
  | Readonly<{
      ok: false;
      blocker:
        | "invalid-css-edge"
        | "invalid-dpr"
        | "framebuffer-edge-limit"
        | "framebuffer-byte-overflow"
        | "framebuffer-byte-budget";
      reason: string;
    }>;

export type StudioVrmBroadcastBackgroundId =
  (typeof STUDIO_VRM_BROADCAST_BACKGROUNDS)[number]["id"];

export type StudioVrmBroadcastBlocker =
  | "model-unavailable"
  | "model-loading"
  | "asset-mutation"
  | "capture"
  | "creative-persistence"
  | "texture-paint"
  | "pose-transaction"
  | "camera-motion"
  | "tracking-transition";

export type StudioVrmBroadcastPreviewReceipt = Readonly<{
  kind: "toonspectrum.studio-vrm-broadcast-preview";
  version: 1;
  background: Readonly<{
    id: StudioVrmBroadcastBackgroundId;
    label: string;
    hex: `#${string}`;
  }>;
  authority: "runtime-only";
}>;

export type StudioVrmBroadcastPreviewPlan =
  | Readonly<{
      ok: true;
      receipt: StudioVrmBroadcastPreviewReceipt;
    }>
  | Readonly<{
      ok: false;
      blocker: StudioVrmBroadcastBlocker | "invalid-background";
      reason: string;
    }>;

const BLOCKER_MESSAGES: Readonly<Record<StudioVrmBroadcastBlocker, string>> = Object.freeze({
  "model-unavailable": "방송 화면에 표시할 VRM 모델을 먼저 불러오세요.",
  "model-loading": "VRM 모델과 장면 준비가 끝난 뒤 방송 화면을 열 수 있습니다.",
  "asset-mutation": "모델 업로드·삭제·라이브러리 갱신이 끝난 뒤 방송 화면을 열 수 있습니다.",
  capture: "캡처·공유 처리가 끝난 뒤 방송 화면을 열 수 있습니다.",
  "creative-persistence": "포즈·상태 저장이 끝난 뒤 방송 화면을 열 수 있습니다.",
  "texture-paint": "표면 페인트 저장 또는 취소가 끝난 뒤 방송 화면을 열 수 있습니다.",
  "pose-transaction": "포즈·체형·관절 계산이 끝난 뒤 방송 화면을 열 수 있습니다.",
  "camera-motion": "턴테이블 회전을 멈춘 뒤 현재 카메라 그대로 방송 화면을 열 수 있습니다.",
  "tracking-transition": "카메라 추적 준비·보정이 끝난 뒤 방송 화면을 열 수 있습니다.",
});

export function studioVrmBroadcastBackgroundById(
  id: StudioVrmBroadcastBackgroundId,
) {
  return STUDIO_VRM_BROADCAST_BACKGROUNDS.find((background) => background.id === id) ?? null;
}

function rejectStudioVrmBroadcastFramebuffer(
  blocker: Extract<StudioVrmBroadcastFramebufferPlan, { ok: false }>["blocker"],
  reason: string,
): StudioVrmBroadcastFramebufferPlan {
  return Object.freeze({ ok: false, blocker, reason });
}

/**
 * Selects the highest bounded DPR that fits the existing antialiased Canvas into 64 MiB.
 *
 * The conservative 48-byte estimate covers four RGBA8 + depth/stencil MSAA samples, a resolved
 * color surface, compositor/backing storage, and alignment headroom. This is an admission bound,
 * not a claim that a browser exposes or allocates exactly that layout.
 */
export function planStudioVrmBroadcastFramebuffer(input: Readonly<{
  cssWidth: number;
  cssHeight: number;
  requestedDpr: number;
}>): StudioVrmBroadcastFramebufferPlan {
  if (
    !Number.isFinite(input.cssWidth)
    || !Number.isFinite(input.cssHeight)
    || input.cssWidth < STUDIO_VRM_BROADCAST_FRAMEBUFFER_MIN_CSS_EDGE
    || input.cssHeight < STUDIO_VRM_BROADCAST_FRAMEBUFFER_MIN_CSS_EDGE
    || input.cssWidth > STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_CSS_EDGE
    || input.cssHeight > STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_CSS_EDGE
  ) {
    return rejectStudioVrmBroadcastFramebuffer(
      "invalid-css-edge",
      "방송 뷰포트의 실제 CSS 크기를 안전한 범위에서 확인할 수 없습니다.",
    );
  }
  if (
    !Number.isFinite(input.requestedDpr)
    || input.requestedDpr < STUDIO_VRM_BROADCAST_FRAMEBUFFER_MIN_DPR
    || input.requestedDpr > STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_INPUT_DPR
  ) {
    return rejectStudioVrmBroadcastFramebuffer(
      "invalid-dpr",
      "이 디스플레이의 픽셀 배율을 안전한 범위에서 확인할 수 없습니다.",
    );
  }

  const cssPixels = input.cssWidth * input.cssHeight;
  const requestedDpr = Math.min(
    input.requestedDpr,
    STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_DPR,
  );
  const dprByBytes = Math.sqrt(
    STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_BYTES
      / (cssPixels * STUDIO_VRM_BROADCAST_FRAMEBUFFER_ESTIMATED_BYTES_PER_PIXEL),
  );
  const dprByEdge = STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_PIXEL_EDGE
    / Math.max(input.cssWidth, input.cssHeight);
  const boundedDpr = Math.min(requestedDpr, dprByBytes, dprByEdge);
  if (!Number.isFinite(boundedDpr)) {
    return rejectStudioVrmBroadcastFramebuffer(
      "framebuffer-byte-overflow",
      "방송 프레임버퍼 예상 크기를 안전한 정수 범위에서 계산할 수 없습니다.",
    );
  }

  let dprSteps = Math.floor(
    boundedDpr * STUDIO_VRM_BROADCAST_FRAMEBUFFER_DPR_STEPS_PER_UNIT,
  );
  const minimumDprSteps = Math.ceil(
    STUDIO_VRM_BROADCAST_FRAMEBUFFER_MIN_DPR
      * STUDIO_VRM_BROADCAST_FRAMEBUFFER_DPR_STEPS_PER_UNIT,
  );
  if (dprSteps < minimumDprSteps) {
    return rejectStudioVrmBroadcastFramebuffer(
      "framebuffer-byte-budget",
      "64 MiB 방송 프레임버퍼 예산 안에서 읽을 수 있는 해상도를 확보할 수 없습니다.",
    );
  }

  while (dprSteps >= minimumDprSteps) {
    const dpr = dprSteps / STUDIO_VRM_BROADCAST_FRAMEBUFFER_DPR_STEPS_PER_UNIT;
    const pixelWidth = Math.ceil(input.cssWidth * dpr);
    const pixelHeight = Math.ceil(input.cssHeight * dpr);
    if (
      !Number.isSafeInteger(pixelWidth)
      || !Number.isSafeInteger(pixelHeight)
      || pixelWidth < 1
      || pixelHeight < 1
    ) {
      return rejectStudioVrmBroadcastFramebuffer(
        "framebuffer-byte-overflow",
        "방송 프레임버퍼 픽셀 크기를 안전한 정수 범위에서 계산할 수 없습니다.",
      );
    }
    if (
      pixelWidth > STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_PIXEL_EDGE
      || pixelHeight > STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_PIXEL_EDGE
    ) {
      dprSteps -= 1;
      continue;
    }

    const framebufferPixels = pixelWidth * pixelHeight;
    const estimatedBytes = framebufferPixels
      * STUDIO_VRM_BROADCAST_FRAMEBUFFER_ESTIMATED_BYTES_PER_PIXEL;
    if (!Number.isSafeInteger(framebufferPixels) || !Number.isSafeInteger(estimatedBytes)) {
      return rejectStudioVrmBroadcastFramebuffer(
        "framebuffer-byte-overflow",
        "방송 프레임버퍼 예상 바이트를 안전한 정수 범위에서 계산할 수 없습니다.",
      );
    }
    if (estimatedBytes > STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_BYTES) {
      dprSteps -= 1;
      continue;
    }

    return Object.freeze({
      ok: true,
      receipt: Object.freeze({
        kind: "toonspectrum.studio-vrm-broadcast-framebuffer",
        version: 1,
        cssWidth: input.cssWidth,
        cssHeight: input.cssHeight,
        requestedDpr: input.requestedDpr,
        dpr,
        pixelWidth,
        pixelHeight,
        estimatedBytes,
        maxBytes: STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_BYTES,
        estimatedBytesPerPixel:
          STUDIO_VRM_BROADCAST_FRAMEBUFFER_ESTIMATED_BYTES_PER_PIXEL,
        antialiasEstimate: Object.freeze({
          msaaSamples: 4,
          includesColorDepthResolveAndHeadroom: true,
        }),
        authority: "runtime-only",
      }),
    });
  }

  return rejectStudioVrmBroadcastFramebuffer(
    "framebuffer-edge-limit",
    "방송 프레임버퍼의 한 변을 안전한 GPU 범위 안에 맞출 수 없습니다.",
  );
}

/**
 * Creates a session-only preview receipt. The caller supplies every live transaction blocker;
 * this function never reads or mutates project, OPFS, history, camera, or renderer state.
 */
export function createStudioVrmBroadcastPreviewPlan(input: Readonly<{
  backgroundId: StudioVrmBroadcastBackgroundId;
  blockers?: readonly StudioVrmBroadcastBlocker[];
}>): StudioVrmBroadcastPreviewPlan {
  const background = studioVrmBroadcastBackgroundById(input.backgroundId);
  if (!background) {
    return Object.freeze({
      ok: false,
      blocker: "invalid-background",
      reason: "검증된 방송 배경색을 선택해 주세요.",
    });
  }

  const blocker = input.blockers?.[0] ?? null;
  if (blocker) {
    return Object.freeze({
      ok: false,
      blocker,
      reason: BLOCKER_MESSAGES[blocker],
    });
  }

  return Object.freeze({
    ok: true,
    receipt: Object.freeze({
      kind: "toonspectrum.studio-vrm-broadcast-preview",
      version: 1,
      background: Object.freeze({ ...background }),
      authority: "runtime-only",
    }),
  });
}
