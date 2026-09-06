import type { StudioStrokeSurfaceRoute } from "./brush/studio-stroke-surface-route";
import type {
  StudioHokusaiLiveOverlaySurfaceBinding,
  StudioLivingInkOverlaySurfaceBinding,
} from "./canvas/StudioCanvasViewport";
import type {
  StudioLiveStrokeCanonicalCanvasToken,
  StudioLiveStrokeGpuRequestToken,
  StudioLiveStrokeRenderBackendCoordinator,
} from "./live/studio-live-stroke-render-backend";
import type { StudioHokusaiLiveOverlayRenderer } from "./render/studio-hokusai-live-brush-overlay";
import type { StudioHokusaiLiveSampleLike } from "./render/studio-hokusai-live-brush-protocol";
import type { StudioHokusaiLiveRouteResult } from "./render/studio-hokusai-live-brush-router";
import type { StudioHokusaiLiveStrokeSession } from "./render/studio-hokusai-live-brush-runtime";
import type { StudioGpuStroke } from "./render/studio-webgpu-stroke";
import type { StudioCharacterBible } from "./studio-character-bible";
import type { DrawEl } from "./studio-element-model";
import type {
  StudioHistoryJournal,
  StudioHistoryJournalSidecarEntry,
} from "./studio-history-journal";
import type { StudioLivingInkOverlayRenderer } from "./studio-living-ink-overlay";
import type { StudioLivingInkStrokeMode } from "./studio-living-ink-studio-coordinator";
import type { StudioWriterRoomDocument } from "./studio-writer-room";

/** 이 편집기의 통합 실행취소 저널 — 캔버스 스냅샷 단계와 사이드카 편집을 한 시간 순서로 담는다. */
export type StudioPageHistoryJournal = StudioHistoryJournal<StudioCharacterBible, StudioWriterRoomDocument>;
export type StudioPageHistorySidecarEntry = StudioHistoryJournalSidecarEntry<
  StudioCharacterBible,
  StudioWriterRoomDocument
>;

export type StudioHybridDccWorkspacePersistence = ReturnType<
  typeof import("./hybrid-dcc/studio-hybrid-dcc-workspace-persistence")
    .createStudioHybridDccWorkspacePersistenceFromFileSystem
>;

export type StudioHybridDccPersistenceStatus =
  import("./hybrid-dcc/StudioHybridDccPanel").StudioHybridDccPersistenceStatus;

export interface StudioHybridDccPersistenceUiState {
  readonly scope: string;
  readonly status: StudioHybridDccPersistenceStatus;
}

export const STUDIO_HYBRID_DCC_RECOVERY_TIMEOUT_MS = 12_000;

export type StudioQuickAccessIntegrationModule =
  typeof import("./studio-quick-access-integration");

export type StudioLiveStrokeBackendAuditSession = {
  readonly coordinator: StudioLiveStrokeRenderBackendCoordinator;
  readonly epoch: number;
  readonly strokeId: string;
  readonly seenGpuRequestIds: Set<string>;
  gpuRequest: StudioLiveStrokeGpuRequestToken | null;
  canonicalCanvasRequest: StudioLiveStrokeCanonicalCanvasToken | null;
};

export type StudioHokusaiReadyRoute = Extract<
  StudioHokusaiLiveRouteResult,
  { status: "ready" }
>;

export type StudioHokusaiPinnedLiveStroke = {
  readonly abortController: AbortController;
  readonly pageId: string;
  readonly route: StudioHokusaiReadyRoute;
  readonly strokeId: string;
  readonly surfaceKey: string;
  beginPromise: Promise<StudioHokusaiLiveStrokeSession> | null;
  session: StudioHokusaiLiveStrokeSession | null;
  queuedSamples: StudioHokusaiLiveSampleLike[];
  forwardedSampleCount: number;
  lastAppendedSequence: number;
  lastMaterialFrameSequence: number;
  overlayPresented: boolean;
  failed: boolean;
  finishing: boolean;
  finalDrawing: DrawEl | null;
  canonicalImageId: string | null;
  canonicalPngHash: `sha256:${string}` | null;
  transactionCommitted: boolean;
};

export type StudioHokusaiLiveOverlaySurfaceState = {
  readonly binding: StudioHokusaiLiveOverlaySurfaceBinding;
  readonly renderer: StudioHokusaiLiveOverlayRenderer;
};

export type StudioLivingInkRoute = Extract<StudioStrokeSurfaceRoute, { kind: "living-ink" }>;

export type StudioLivingInkPinnedStroke = {
  readonly mode: StudioLivingInkStrokeMode;
  readonly pageId: string;
  readonly strokeId: string;
  readonly route: StudioLivingInkRoute;
  readonly surfaceKey: string;
  forwardedSampleCount: number;
  overlayPresented: boolean;
  failed: boolean;
  finishing: boolean;
  finalDrawing: DrawEl | null;
  canonicalImageId: string | null;
  canonicalPngHash: `sha256:${string}` | null;
  transactionCommitted: boolean;
};

export type StudioLivingInkOverlaySurfaceState = {
  readonly binding: StudioLivingInkOverlaySurfaceBinding;
  readonly renderer: StudioLivingInkOverlayRenderer;
};

export type StudioLivingInkCanonicalHandoff = Readonly<{
  token: string;
  kind: "action" | "stroke";
  pageId: string;
  imageId: string;
  pngHash: `sha256:${string}`;
  strokeId: string | null;
}>;

export const EMPTY_STUDIO_GPU_STROKES: readonly StudioGpuStroke[] = Object.freeze([]);
export const STUDIO_GPU_LIVE_SOURCE_JOURNAL_STYLE_KEY = "round-ink-source-journal-v1";
export const STUDIO_GPU_LIVE_OPERATION_ORDER_PREFIX = "\uffffstudio-live:";
// Live operations must sort after the already-settled prefix even when their random UUID happens
// to compare before it. A fixed-width sequence preserves append-only tile composition.
