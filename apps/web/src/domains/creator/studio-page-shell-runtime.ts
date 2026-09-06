import { resolveStudioPointerPredictionPreference, studioPointerPredictionEnvironment, supportsStudioPointerPrediction } from "./canvas/studio-pointer-prediction-capability";
import { computeBubbleAnchorTail, resolveAnchorTargetPoint, type AnchorTargetBounds } from "./lettering/studio-bubble-anchor";
import { hasCustomBubbleShape } from "./lettering/studio-bubble-custom-shape";
import { resolveStudioLiveInkRollout, studioLiveInkRolloutInputFromGlobals } from "./live/studio-live-ink-rollout";
import { CANVAS_W } from "./studio-assets";
import { studioAutosaveDocumentBusy } from "./studio-autosave-opfs-session";
import { elBounds } from "./studio-element-geometry";
import { uid } from "./studio-id";
import { createStudioPagesHistoryCommandJournalClient } from "./studio-pages-history-command-journal-client";
import { normalizeStudioPublishPackageSettings } from "./studio-publish-package";


import type { StudioLayerLiftWorkflowSession } from "./layer/studio-layer-lift-workflow";
import type {
  StudioLayerLiftDialogPhase,
  StudioLayerLiftReviewOptions,
  StudioLayerLiftReviewPreview,
} from "./layer/StudioLayerLiftDialog";
import type { StudioAsset } from "./studio-asset-library";
import type { FrameEl, El } from "./studio-element-model";
import type { StudioPublishPackageSettings } from "./studio-publish-package";


// 포인터 이벤트 기반 툴링의 모듈 레벨 상태 계산값을 컴포넌트 본문에서 분리한다.
export const STUDIO_VISIBLE_LIVE_INK_ROLLOUT = resolveStudioLiveInkRollout(
  studioLiveInkRolloutInputFromGlobals(
    import.meta.env.VITE_STUDIO_LIVE_INK_BACKEND,
    import.meta.env.VITE_STUDIO_LIVE_INK_ROLLOUT_PERCENT,
    import.meta.env.VITE_STUDIO_LIVE_INK_KILL_SWITCH,
  ),
);

export const STUDIO_VISIBLE_LIVE_INK_PREFERENCE = STUDIO_VISIBLE_LIVE_INK_ROLLOUT.preference;
export const STUDIO_VISIBLE_LIVE_INK_SELECTION_ENABLED =
  STUDIO_VISIBLE_LIVE_INK_ROLLOUT.status === "selected";

export const STUDIO_POINTER_PREDICTION_ENABLED = supportsStudioPointerPrediction(
  resolveStudioPointerPredictionPreference(import.meta.env.VITE_STUDIO_POINTER_PREDICTION),
  studioPointerPredictionEnvironment()
);
export const STUDIO_RAW_PEN_INK_PREVIEW_ENABLED = typeof globalThis.PointerEvent === "function"
  && typeof globalThis.requestAnimationFrame === "function";
export const STUDIO_TRANSIENT_PEN_INK_SURFACE_ENABLED =
  STUDIO_POINTER_PREDICTION_ENABLED || STUDIO_RAW_PEN_INK_PREVIEW_ENABLED;

export interface StudioLayerLiftUiState {
  readonly open: boolean;
  readonly activeKey: string;
  readonly sourceId: string | null;
  readonly sourceName: string;
  readonly sourceSrc: string;
  readonly phase: StudioLayerLiftDialogPhase;
  readonly progressLabel: string | null;
  readonly error: string | null;
  readonly session: StudioLayerLiftWorkflowSession | null;
  readonly preview: StudioLayerLiftReviewPreview | null;
}

export const STUDIO_LAYER_LIFT_DEFAULT_REVIEW_OPTIONS: StudioLayerLiftReviewOptions = Object.freeze({
  threshold: 0.5,
  feather: 0.08,
});

// 커밋 루틴에서 말풍선 tail 앵커를 마지막으로 정합해서 반영한다.
export function applyBubbleAnchors(nextElements: El[]): El[] {
  const boundsById = new Map<string, AnchorTargetBounds>();
  for (const e of nextElements) boundsById.set(e.id, elBounds(e));

  let changed = false;
  const out = nextElements.map((e) => {
    if (
      e.type !== "bubble"
      || (!e.tailAnchorId && !e.tailAnchorPoint)
      || hasCustomBubbleShape(e.customShapePoints)
    ) return e;

    const point = resolveAnchorTargetPoint(e, (id) => (id === e.id ? null : (boundsById.get(id) ?? null)));
    if (!point) {
      // tailAnchorId 가 가리키는 대상이 사라짐(또는 자기 자신을 가리키는 방어 케이스) — 해제.
      if (!e.tailAnchorId) return e; // tailAnchorPoint 만 있으면 point 는 항상 성공하므로 여기 안 옴.
      changed = true;
      return { ...e, tailAnchorId: undefined } as El;
    }
    const patch = computeBubbleAnchorTail(e, point);
    if (!patch) return e; // 말풍선 bounds 일시 비정상 — 건드리지 않고 다음 커밋 재시도.
    changed = true;
    return { ...e, ...patch } as El;
  });
  return changed ? out : nextElements;
}

export function createStudioPageHistoryCommandJournalClient() {
  return createStudioPagesHistoryCommandJournalClient({
    onError: (cause) => {
      // Another tab owning the OPFS journal is expected on a jam follower. The structured
      // memory-only status still updates; do not dump that as a crash.
      if (studioAutosaveDocumentBusy(cause)) return;
      // This callback exists in production too. The client publishes the same failure through its
      // structured status observer, while the console receipt preserves the original cause.
      console.error("Studio command journal durability degraded.", cause);
    },
  });
}

export const QUICK_SAMPLE_CANVAS_H = 1120;
const QUICK_SAMPLE_MARGIN = 24;

export function createQuickSampleFrames(): FrameEl[] {
  const height = Math.round((QUICK_SAMPLE_CANVAS_H - QUICK_SAMPLE_MARGIN * 3) / 2);
  return [0, 1].map((_) => ({
    id: uid(),
    type: "frame" as const,
    x: QUICK_SAMPLE_MARGIN,
    y: QUICK_SAMPLE_MARGIN + _ * (height + QUICK_SAMPLE_MARGIN),
    width: CANVAS_W - QUICK_SAMPLE_MARGIN * 2,
    height,
  }));
}

export function studioTimelineClockMs(): number {
  return globalThis.performance.now();
}

export function clampZoom(z: number) {
  const safe = Number.isFinite(z) ? z : 1;
  return Math.min(5, Math.max(0.2, safe));
}

export function isStudioViewToolsHudEventTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-studio-view-tools-hud]") !== null;
}

export function publishPackageSettingsFromPack(value: unknown): StudioPublishPackageSettings {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return normalizeStudioPublishPackageSettings(record.packageSettings ?? {
    destination: record.profile,
    aiUsage: record.aiUsage,
    aiDisclosure: record.disclosure,
  });
}

export function publishPackageCreditsFromPack(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const credits = (value as Record<string, unknown>).packageCredits;
  return typeof credits === "string" ? credits.slice(0, 20_000) : "";
}

export async function sha256Blob(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("이 브라우저에서는 게시 패키지 무결성 해시를 만들 수 없어요.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function studioBrushQuickSlotsDeviceProfile(): string {
  const browserNavigator = globalThis.navigator;
  const userAgent = browserNavigator?.userAgent ?? "";
  const browserFamily = /(?:Edg|EdgiOS)\//u.test(userAgent)
    ? "edge"
    : /(?:Firefox|FxiOS)\//u.test(userAgent)
      ? "firefox"
      : /(?:Chrome|CriOS|Chromium)\//u.test(userAgent)
        ? "chromium"
        : /Safari\//u.test(userAgent)
          ? "safari"
          : "browser";
  const navigatorWithUserAgentData = browserNavigator as Navigator & { readonly userAgentData?: { readonly platform?: string } };
  const rawPlatform = navigatorWithUserAgentData?.userAgentData?.platform
    ?? browserNavigator?.platform
    ?? "unknown";
  const platform = Array.from(
    rawPlatform.trim().toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, "-"),
  ).slice(0, 80).join("") || "unknown";
  const maxTouchPoints = Number.isSafeInteger(browserNavigator?.maxTouchPoints)
    ? Math.min(64, Math.max(0, browserNavigator.maxTouchPoints))
    : 0;
  const hardwareConcurrency = Number.isSafeInteger(browserNavigator?.hardwareConcurrency)
    ? Math.min(256, Math.max(0, browserNavigator.hardwareConcurrency))
    : 0;
  return `browser-v1:${browserFamily}:${platform}:touch-${maxTouchPoints}:cores-${hardwareConcurrency}`;
}

export const STUDIO_LINKED_3D_CLOUD_SAVE_RECOVERY_STATE_KEY = "studioLinked3dCloudSaveRecovery" as const;
const STUDIO_LINKED_3D_CLOUD_SAVE_RECOVERY_NOTICE =
  "이전 cloud-save가 이미 완료된 작품을 열었습니다. 현재 로컬 초안은 덮어쓰지 않고 보존했습니다.";

export function studioLinked3dCloudSaveRecoveryNotice(state: unknown, workId: string | null): string | null {
  if (!workId || typeof state !== "object" || state === null || Array.isArray(state)) return null;
  const receipt = (state as Record<string, unknown>)[STUDIO_LINKED_3D_CLOUD_SAVE_RECOVERY_STATE_KEY];
  if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt)) return null;
  const record = receipt as Record<string, unknown>;
  return record.version === 1 && record.workId === workId
    ? STUDIO_LINKED_3D_CLOUD_SAVE_RECOVERY_NOTICE
    : null;
}

export function withStudioLinked3dCloudSaveRecoveryState(
  state: unknown,
  workId: string,
): Record<string, unknown> {
  const base = typeof state === "object" && state !== null && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
  return {
    ...base,
    [STUDIO_LINKED_3D_CLOUD_SAVE_RECOVERY_STATE_KEY]: { version: 1, workId },
  };
}

export function closedStudioLayerLiftUiState(): StudioLayerLiftUiState {
  return {
    open: false,
    activeKey: "studio-layer-lift:closed",
    sourceId: null,
    sourceName: "선택 이미지",
    sourceSrc: "",
    phase: "analyzing",
    progressLabel: null,
    error: null,
    session: null,
    preview: null,
  };
}

export function isStudioAiReferenceCompatibleAsset(asset: Pick<StudioAsset, "dataUrl">): boolean {
  return /^data:image\/(?:png|jpeg|webp);base64,/iu.test(asset.dataUrl);
}

export const STUDIO_GPU_PIN_REQUEST_TIMEOUT_MS = 300;
/**
 * Budget for the request that carries a FINISHED stroke's terminal receipt.
 *
 * 300 ms is a live-latency budget and the right answer for a pointer frame. After pointer-up the
 * stroke is complete and nothing animates, so the same 300 ms only measured how busy the main
 * thread happened to be — a deferred commit render routinely overran it and the product then
 * deleted the finished stroke ("현재 획을 취소했습니다"). A lost receipt is still caught, just not
 * confused with a busy frame.
 */
export const STUDIO_GPU_TERMINAL_RECEIPT_TIMEOUT_MS = 2_000;
