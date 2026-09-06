import { flushSync } from "react-dom";

import {
  cloneBgCustomModelInstances,
  type BgCustomModelInstance,
} from "../studio-background-3d-model";
import {
  clonePrimitives,
  type BgPrimitive,
} from "../studio-background-3d-primitives";

import {
  applyStudioBg3dViewportAfterTransition,
  type BgViewportApi,
} from "./studio-bg3d-camera-application";
import {
  createStudioBg3dCaptureBackgroundSnapshot,
  studioBg3dCaptureBackgroundRequestFromSnapshot,
  type StudioBg3dCaptureBackgroundSnapshot,
} from "./studio-bg3d-capture-background";
import {
  resolveStudioBg3dDeviceQuality,
  type StudioBg3dDeviceSignals,
} from "./studio-bg3d-device-quality";
import {
  acquireStudioBg3dCaptureAdapterAfterViewTransition,
  captureStudioBg3dRaster,
  getStudioBg3dCaptureSourceSize,
  SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE,
  waitForStudioBg3dPaintFrame,
} from "./studio-bg3d-editor-derivations";
import { resolveStudioBg3dLtCaptureSize } from "./studio-bg3d-lt-capture-size";
import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "./studio-bg3d-lt-render";
import {
  applyStudioBg3dShot,
  serializeStudioBg3dSceneDocument,
  type StudioBg3dCameraSettings,
  type StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import { STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION } from "./studio-bg3d-shot-batch-limits";
import { loadStudioBg3dShotBatchRuntime } from "./studio-bg3d-shot-batch-runtime-loader";
import {
  freezeStudioBg3dShotAnimationsForBatch,
  projectStudioBg3dShotVisibilityToRuntime,
} from "./studio-bg3d-shot-runtime";

import type { StudioBg3dCaptureAdapter } from "./studio-bg3d-capture-adapter";
import type {
  StudioBg3dSharedCharacterCaptureAuthorityLease,
  StudioBg3dSharedCharacterCaptureAuthorityLeaseResult,
  StudioBg3dSharedCharacterCaptureAuthorityVerificationResult,
} from "./studio-bg3d-shared-character-capture-authority";
import type {
  StudioBg3dShotBatchBuildOptions,
  StudioBg3dShotBatchContactSheet,
  StudioBg3dShotBatchContactSheetFallback,
} from "./studio-bg3d-shot-batch";
import type { StudioBg3dShotBatchPass } from "./studio-bg3d-shot-batch-pass-catalog";
import type {
  StudioBg3dShotBatchCaptureSpecInput,
  StudioBg3dShotBatchPlan,
  StudioBg3dShotBatchRecoveryScope,
} from "./studio-bg3d-shot-batch-plan";
import type { StudioBg3dShotBatchFailureCode } from "./studio-bg3d-shot-batch-queue";
import type {
  StudioBg3dShotBatchRecoverySession,
  StudioBg3dShotBatchRecoveryStore,
  StudioBg3dShotBatchRunToken,
} from "./studio-bg3d-shot-batch-recovery-store";
import type { StudioBg3dShotBatchRuntime } from "./studio-bg3d-shot-batch-runtime-loader";
import type { StudioBg3dShotContactSheetImage } from "./studio-bg3d-shot-contact-sheet-contract";
import type { RefObject } from "react";

/** Live progress the editor renders while a shot batch renders, packages, and downloads. */
export interface StudioBg3dShotBatchProgress {
  readonly stage: "render" | "contact" | "archive";
  readonly completed: number;
  readonly total: number;
  readonly label: string;
}

/** Resumable-batch summary the editor renders once artifacts survive in a recovery store. */
export interface StudioBg3dShotBatchRecoverySummary {
  readonly completedShots: number;
  readonly totalShots: number;
  readonly mode: "durable" | "memory";
  readonly downloadRequested?: boolean;
  readonly degradedReason?: string | null;
}

/**
 * Every editor local the batch export orchestration reads, under the exact names the original
 * `StudioBackground3D` body used. Refs stay refs so reads and mutations keep their identity.
 */
export interface StudioBg3dShotBatchExportRunContext {
  readonly captureInFlightRef: RefObject<boolean>;
  readonly captureRef: { readonly current: { readonly adapter: StudioBg3dCaptureAdapter | null } };
  readonly componentActiveRef: RefObject<boolean>;
  readonly pendingInitialCameraRef: RefObject<StudioBg3dCameraSettings | null>;
  readonly shotBatchAbortRef: RefObject<AbortController | null>;
  readonly shotBatchAuthorizationEpochRef: RefObject<number>;
  readonly shotBatchRecoveryRef: RefObject<StudioBg3dShotBatchRecoverySession | null>;
  readonly shotBatchRecoveryScopeRef: RefObject<{
    readonly controller: AbortController;
    readonly scope: StudioBg3dShotBatchRecoveryScope;
  } | null>;
  readonly shotBatchRecoveryStoreRef: RefObject<StudioBg3dShotBatchRecoveryStore | null>;
  readonly viewportApiRef: RefObject<BgViewportApi | null>;

  readonly customModels: BgCustomModelInstance[];
  readonly deviceSignals: StudioBg3dDeviceSignals;
  readonly lineArtPreview: boolean;
  readonly primitives: BgPrimitive[];
  readonly recoveryScope: StudioBg3dShotBatchRecoveryScope | null;
  readonly sceneBaseDocument: StudioBg3dSceneDocument;
  readonly selectedShotBatchPasses: readonly StudioBg3dShotBatchPass[];
  readonly shotBatchBlockedReason: string | null;
  readonly shotBatchExportHeight: "per-shot" | number;
  readonly shotBatchIncludeContactSheet: boolean;
  readonly shotBatchIncludeLayeredPsd: boolean;
  readonly shotBatchSelectedIds: readonly string[];

  readonly setCaptureBackgroundSnapshot: (value: StudioBg3dCaptureBackgroundSnapshot | null) => void;
  readonly setCustomModels: (value: BgCustomModelInstance[]) => void;
  readonly setError: (value: string | null) => void;
  readonly setIsCapturing: (value: boolean) => void;
  readonly setLineArtPreview: (value: boolean) => void;
  readonly setPrimitives: (value: BgPrimitive[]) => void;
  readonly setSceneBaseDocument: (value: StudioBg3dSceneDocument) => void;
  readonly setShotBatchProgress: (value: StudioBg3dShotBatchProgress | null) => void;
  readonly setShotBatchRecoverySummary: (
    value: StudioBg3dShotBatchRecoverySummary | null,
  ) => void;

  readonly acquireSharedCharacterCaptureAuthority: () =>
    StudioBg3dSharedCharacterCaptureAuthorityLeaseResult | null;
  readonly readCurrentCanonicalSceneForShot: () => StudioBg3dSceneDocument | null;
  readonly validateRecoveryAccess: (
    scope: StudioBg3dShotBatchRecoveryScope,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly verifySharedCharacterCaptureAuthority: (
    lease: StudioBg3dSharedCharacterCaptureAuthorityLease,
    checkpoint: "raster" | "receipt",
  ) => StudioBg3dSharedCharacterCaptureAuthorityVerificationResult | null;
}

const STUDIO_BG3D_SHOT_CONTACT_SHEET_PASS_PRIORITY: readonly StudioBg3dShotBatchPass[] = [
  "lt-composite",
  "beauty",
  "color",
  "tone",
  "main-line",
  "texture-line",
  "depth",
];

/**
 * Builds the editor's shot batch render → recovery → archive orchestration over one explicit
 * context. Nothing runs until the returned runner is invoked, so the editor keeps the exact
 * "read the live render scope at click time" semantics the inline handler had.
 */
export function createStudioBg3dShotBatchExportRunner(
  ctx: StudioBg3dShotBatchExportRunContext,
): () => Promise<void> {
  const {
    acquireSharedCharacterCaptureAuthority,
    captureInFlightRef,
    captureRef,
    componentActiveRef,
    customModels,
    deviceSignals,
    lineArtPreview,
    pendingInitialCameraRef,
    primitives,
    readCurrentCanonicalSceneForShot,
    recoveryScope,
    sceneBaseDocument,
    selectedShotBatchPasses,
    setCaptureBackgroundSnapshot,
    setCustomModels,
    setError,
    setIsCapturing,
    setLineArtPreview,
    setPrimitives,
    setSceneBaseDocument,
    setShotBatchProgress,
    setShotBatchRecoverySummary,
    shotBatchAbortRef,
    shotBatchAuthorizationEpochRef,
    shotBatchBlockedReason,
    shotBatchExportHeight,
    shotBatchIncludeContactSheet,
    shotBatchIncludeLayeredPsd,
    shotBatchRecoveryRef,
    shotBatchRecoveryScopeRef,
    shotBatchRecoveryStoreRef,
    shotBatchSelectedIds,
    validateRecoveryAccess,
    verifySharedCharacterCaptureAuthority,
    viewportApiRef,
  } = ctx;

  async function exportSavedShotsAsZip() {
    if (captureInFlightRef.current) {
      setError("다른 3D 캡처가 진행 중입니다. 완료하거나 취소한 뒤 컷 배치 출력을 다시 실행해 주세요.");
      return;
    }
    if (shotBatchBlockedReason) {
      setError(shotBatchBlockedReason);
      return;
    }
    // Export is read-only. Keep the persisted scene document distinct from the live Orbit view
    // that `readCurrentCanonicalSceneForShot` temporarily samples for validation.
    const originalSceneBaseDocument = sceneBaseDocument;
    const originalViewportApi = viewportApiRef.current;
    const originalLiveView = originalViewportApi?.readView() ?? sceneBaseDocument.camera;
    const currentDocument = readCurrentCanonicalSceneForShot();
    const shots = currentDocument?.shots ?? [];
    if (!currentDocument) return;
    if (shots.length === 0) {
      setError("일괄 렌더할 컷을 먼저 기록해 주세요.");
      return;
    }
    const batchSourceRevision = serializeStudioBg3dSceneDocument(currentDocument);
    if (!batchSourceRevision) {
      setError("컷 배치 장면 revision을 안전하게 고정하지 못했습니다.");
      return;
    }
    if (!recoveryScope) {
      setError("컷 배치 복구 범위를 준비하는 중입니다. 잠시 후 다시 실행해 주세요.");
      return;
    }
    if (!captureRef.current.adapter || !originalViewportApi) {
      setError("컷을 렌더할 3D 뷰포트가 아직 준비되지 않았습니다.");
      return;
    }
    const sharedCharacterAuthorityResult = acquireSharedCharacterCaptureAuthority();
    if (!sharedCharacterAuthorityResult?.ok) {
      setError(SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE);
      return;
    }
    const sharedCharacterAuthorityLease = sharedCharacterAuthorityResult.lease;
    shotBatchAbortRef.current?.abort();
    const controller = new AbortController();
    shotBatchAuthorizationEpochRef.current += 1;
    const authorizationEpoch = shotBatchAuthorizationEpochRef.current;
    shotBatchAbortRef.current = controller;
    shotBatchRecoveryScopeRef.current = { controller, scope: recoveryScope };
    captureInFlightRef.current = true;
    flushSync(() => {
      setShotBatchProgress({
        stage: "render",
        completed: 0,
        total: shotBatchSelectedIds.length,
        label: "컷 출력 런타임 불러오는 중",
      });
      setIsCapturing(true);
      setError(null);
    });
    const finishShotBatchBeforeSession = (message: string) => {
      captureInFlightRef.current = false;
      if (shotBatchAbortRef.current === controller) shotBatchAbortRef.current = null;
      if (shotBatchRecoveryScopeRef.current?.controller === controller) {
        shotBatchRecoveryScopeRef.current = null;
      }
      if (!componentActiveRef.current) return;
      pendingInitialCameraRef.current = null;
      flushSync(() => {
        setIsCapturing(false);
        setShotBatchProgress(null);
        setError(message);
      });
    };
    let shotBatchRuntime: StudioBg3dShotBatchRuntime;
    try {
      shotBatchRuntime = await loadStudioBg3dShotBatchRuntime(controller.signal);
    } catch (cause) {
      finishShotBatchBeforeSession(
        cause instanceof Error && cause.name === "AbortError"
          ? "컷 일괄 렌더를 중단했습니다."
          : "컷 일괄 출력 런타임을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
      );
      return;
    }
    if (!componentActiveRef.current || controller.signal.aborted) {
      finishShotBatchBeforeSession("컷 일괄 렌더를 중단했습니다.");
      return;
    }
    const {
      STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
      STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
      STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES,
      STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
      STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
      STUDIO_BG3D_SHOT_BATCH_RECOVERY_AUTHORIZATION_RECEIPT_MAX_TTL_MS,
      StudioBg3dShotBatchRecoveryError,
      buildStudioBg3dShotArtifacts,
      buildStudioBg3dShotBatchArchiveInWorker,
      buildStudioBg3dShotContactSheetsInWorker,
      commitStudioBg3dShotBatchDownload,
      createStudioBg3dShotBatchPlan,
      createStudioBg3dShotBatchRecoveryStore,
      projectStudioBg3dShotBatchPlanForPublicArchive,
      studioBg3dShotBatchQueueCompletedCount,
      waitForStudioBg3dBatchDocumentVisible,
    } = shotBatchRuntime;
    const originalLineArtPreview = lineArtPreview;
    let shotBatchRecoveryStore: StudioBg3dShotBatchRecoveryStore;
    let originalPrimitives: BgPrimitive[];
    let originalCustomModels: BgCustomModelInstance[];
    try {
      shotBatchRecoveryStore = shotBatchRecoveryStoreRef.current ??
        createStudioBg3dShotBatchRecoveryStore();
      shotBatchRecoveryStoreRef.current = shotBatchRecoveryStore;
      originalPrimitives = clonePrimitives(primitives);
      originalCustomModels = cloneBgCustomModelInstances(customModels);
    } catch (cause) {
      finishShotBatchBeforeSession(
        cause instanceof Error && cause.message.trim().length > 0
          ? `컷 일괄 출력 런타임을 초기화하지 못했습니다. ${cause.message}`
          : "컷 일괄 출력 런타임을 초기화하지 못했습니다.",
      );
      return;
    }
    let recoveryAccessRevoked = false;
    const assertRecoveryAccess = async () => {
      if (controller.signal.aborted) {
        throw Object.assign(new Error("취소됨"), { name: "AbortError" });
      }
      let allowed = false;
      try {
        allowed = await validateRecoveryAccess(recoveryScope, controller.signal);
      } catch {
        if (controller.signal.aborted) {
          throw Object.assign(new Error("취소됨"), { name: "AbortError" });
        }
      }
      if (allowed) return;
      if (!controller.signal.aborted) recoveryAccessRevoked = true;
      controller.abort();
      throw Object.assign(new Error("컷 배치 복구 접근 권한이 변경되었습니다."), {
        name: "AbortError",
      });
    };
    flushSync(() => {
      setShotBatchProgress({
        stage: "render",
        completed: 0,
        total: shotBatchSelectedIds.length,
        label: "결정적 컷 계획 준비",
      });
      setLineArtPreview(false);
    });

    let batchPlan: StudioBg3dShotBatchPlan;
    let recoverySession: StudioBg3dShotBatchRecoverySession;
    let provisionalRecoverySession: StudioBg3dShotBatchRecoverySession | null = null;
    let planningViewportApi: BgViewportApi;
    try {
      await assertRecoveryAccess();
      const transitionedViewport = await applyStudioBg3dViewportAfterTransition({
        view: originalLiveView,
        previousApi: originalViewportApi,
        requireReplacement: false,
        readApi: () => viewportApiRef.current,
        isActive: () => componentActiveRef.current && !controller.signal.aborted,
        waitForPaintFrame: waitForStudioBg3dPaintFrame,
        signal: controller.signal,
        timeoutMs: 15_000,
      });
      if (!transitionedViewport) throw new Error("컷 계획용 단일 viewport를 준비하지 못했습니다.");
      planningViewportApi = transitionedViewport;
      const planningAdapter = await acquireStudioBg3dCaptureAdapterAfterViewTransition({
        isActive: () => componentActiveRef.current && !controller.signal.aborted,
        readAdapter: () => captureRef.current.adapter,
        waitForPaintFrame: waitForStudioBg3dPaintFrame,
        signal: controller.signal,
        timeoutMs: 15_000,
      });
      if (!planningAdapter) throw new Error("컷 계획용 3D 캡처 adapter를 준비하지 못했습니다.");
      const sourceSize = await getStudioBg3dCaptureSourceSize(planningAdapter);
      const captureQuality = resolveStudioBg3dDeviceQuality({
        document: currentDocument,
        mode: "capture",
        signals: deviceSignals,
      });
      const maxPixels = Math.min(
        captureQuality.maxRenderPixels,
        STUDIO_BG3D_LT_RENDER_MAX_PIXELS,
      );
      const captureSpecs: StudioBg3dShotBatchCaptureSpecInput[] = shots.map((sourceShot) => {
        const appliedShot = applyStudioBg3dShot(currentDocument, sourceShot.id);
        const applied = appliedShot ? freezeStudioBg3dShotAnimationsForBatch(appliedShot) : null;
        if (!applied) throw new Error("컷의 고정 캡처 계획을 만들 수 없습니다.");
        const requestedHeight = shotBatchExportHeight === "per-shot"
          ? applied.output.exportHeight
          : shotBatchExportHeight;
        const size = resolveStudioBg3dLtCaptureSize({
          sourceWidth: sourceSize.width,
          sourceHeight: sourceSize.height,
          requestedHeight,
          maxPixels,
          maxEdge: STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION,
        });
        if (!size) throw new Error("컷 출력 해상도를 안전한 예산 안에서 동결하지 못했습니다.");
        const background = createStudioBg3dCaptureBackgroundSnapshot({
          background: applied.background,
          transparent: applied.output.transparentBackground,
        });
        const shotQuality = resolveStudioBg3dDeviceQuality({
          document: applied,
          mode: "capture",
          signals: deviceSignals,
        });
        if (shotQuality.profile !== captureQuality.profile ||
          shotQuality.maxRenderPixels !== captureQuality.maxRenderPixels ||
          shotQuality.textureScale !== captureQuality.textureScale ||
          shotQuality.lodBias !== captureQuality.lodBias) {
          throw new Error("컷별 캡처 품질이 공통 기기 프로필과 일치하지 않습니다.");
        }
        return {
          shotId: sourceShot.id,
          width: size.width,
          height: size.height,
          requestedHeight,
          wasReduced: size.wasReduced,
          includeDepth: applied.output.line.depthEnabled || selectedShotBatchPasses.includes("depth"),
          shadows: shotQuality.shadows,
          shadowMapSize: shotQuality.shadowMapSize,
          background: studioBg3dCaptureBackgroundRequestFromSnapshot(background),
        };
      });
      const batchPlanResult = await createStudioBg3dShotBatchPlan(shots, {
        selectedShotIds: shotBatchSelectedIds,
        passes: selectedShotBatchPasses,
        sourceRevision: batchSourceRevision,
        scope: recoveryScope,
        capture: {
          owner: {
            backend: planningAdapter.backend,
            engineId: planningAdapter.engineId,
            engineRevision: planningAdapter.engineVersion,
            implementationRevision: planningAdapter.implementationRevision,
            graphicsApi: planningAdapter.graphicsApi,
            profileId: planningAdapter.profileId,
            sourceWidth: sourceSize.width,
            sourceHeight: sourceSize.height,
            maxPixels,
            maxEdge: STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION,
            deviceProfile: captureQuality.profile,
            textureScale: captureQuality.textureScale,
            lodBias: captureQuality.lodBias,
            ltPipelineId: STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
            pngEncodingId: STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
            psdEncodingId: STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
          },
          shots: captureSpecs,
        },
        layeredPsd: shotBatchIncludeLayeredPsd,
        contactSheet: shotBatchIncludeContactSheet,
        exportHeight: shotBatchExportHeight,
      });
      if (!batchPlanResult.ok) throw new Error(batchPlanResult.message);
      batchPlan = batchPlanResult.plan;
      await assertRecoveryAccess();
      recoverySession = await shotBatchRecoveryStore.acquire(batchPlan, batchSourceRevision, {
        signal: controller.signal,
      });
      provisionalRecoverySession = recoverySession;
      await assertRecoveryAccess();
      shotBatchRecoveryRef.current = recoverySession;
    } catch (cause) {
      if (provisionalRecoverySession) {
        await shotBatchRecoveryStore.release(provisionalRecoverySession);
        if (shotBatchRecoveryRef.current === provisionalRecoverySession) {
          shotBatchRecoveryRef.current = null;
        }
      }
      pendingInitialCameraRef.current = originalLiveView;
      captureInFlightRef.current = false;
      if (shotBatchAbortRef.current === controller) shotBatchAbortRef.current = null;
      if (shotBatchRecoveryScopeRef.current?.controller === controller) {
        shotBatchRecoveryScopeRef.current = null;
      }
      if (componentActiveRef.current) {
        flushSync(() => {
          setLineArtPreview(originalLineArtPreview);
          setIsCapturing(false);
          setShotBatchProgress(null);
          setError(cause instanceof StudioBg3dShotBatchRecoveryError
            ? cause.message
            : cause instanceof Error && cause.name === "AbortError"
            ? recoveryAccessRevoked
              ? "작품 열람 권한 또는 저장 대상이 변경되어 컷 일괄 렌더를 안전하게 중단했습니다."
              : "컷 일괄 렌더를 중단했습니다."
              : cause instanceof Error
                ? cause.message
                : "결정적 컷 계획을 만들지 못했습니다.");
          });
      }
      return;
    }
    const initiallyCompletedShots = studioBg3dShotBatchQueueCompletedCount(recoverySession.queue);
    setShotBatchRecoverySummary(initiallyCompletedShots > 0
      ? {
          completedShots: initiallyCompletedShots,
          totalShots: batchPlan.shots.length,
          mode: recoverySession.mode,
        }
      : null);
    setShotBatchProgress({
      stage: "render",
      completed: initiallyCompletedShots,
      total: batchPlan.shots.length,
      label: initiallyCompletedShots > 0 ? "검증된 artifact 복구" : "컷 렌더 준비",
    });

    const images = [...recoverySession.images];
    const skippedArtifacts = [...recoverySession.skippedArtifacts];
    const layeredPsds = [...recoverySession.layeredPsds];
    const psdFallbacks = [...recoverySession.psdFallbacks];
    let accumulatedArtifactBytes =
      images.reduce((total, image) => total + image.png.size, 0) +
      layeredPsds.reduce((total, artifact) => total + artifact.psd.size, 0);
    let activeRunToken: StudioBg3dShotBatchRunToken | null = null;
    let renderedProjection = originalLiveView.projection;
    let renderedViewportApi = planningViewportApi;
    try {
      for (let index = 0; index < batchPlan.shots.length; index += 1) {
        if (controller.signal.aborted) throw Object.assign(new Error("취소됨"), { name: "AbortError" });
        const shot = batchPlan.shots[index];
        if (!shot) throw new Error("컷 순서를 읽지 못했습니다.");
        const queueItem = recoverySession.queue.items[index];
        if (queueItem?.status === "succeeded") continue;
        if (document.visibilityState === "hidden") {
          setShotBatchProgress({
            stage: "render",
            completed: studioBg3dShotBatchQueueCompletedCount(recoverySession.queue),
            total: batchPlan.shots.length,
            label: "탭이 다시 표시되기를 기다리는 중",
          });
        }
        await waitForStudioBg3dBatchDocumentVisible(document, controller.signal);
        await assertRecoveryAccess();
        activeRunToken = await shotBatchRecoveryStore.startShot(recoverySession, shot.shotId);
        const appliedShot = applyStudioBg3dShot(currentDocument, shot.shotId);
        const applied = appliedShot
          ? freezeStudioBg3dShotAnimationsForBatch(appliedShot)
          : null;
        const projected = applied
          ? projectStudioBg3dShotVisibilityToRuntime(
              originalPrimitives,
              originalCustomModels,
              applied,
            )
          : null;
        if (!applied || !projected) throw new Error("컷 장면을 렌더 상태로 복원하지 못했습니다.");
        const backgroundSnapshot = createStudioBg3dCaptureBackgroundSnapshot({
          background: applied.background,
          transparent: applied.output.transparentBackground,
        });
        const plannedBackground = studioBg3dCaptureBackgroundRequestFromSnapshot(backgroundSnapshot);
        if (
          plannedBackground.color.toLowerCase() !== shot.capture.background.color.toLowerCase() ||
          plannedBackground.alpha !== shot.capture.background.alpha
        ) {
          throw new Error("컷 배경이 동결된 캡처 계획과 달라졌습니다.");
        }
        const appliedCaptureQuality = resolveStudioBg3dDeviceQuality({
          document: applied,
          mode: "capture",
          signals: deviceSignals,
        });
        if (appliedCaptureQuality.profile !== batchPlan.captureOwner.deviceProfile ||
          Math.min(appliedCaptureQuality.maxRenderPixels, STUDIO_BG3D_LT_RENDER_MAX_PIXELS) !==
            batchPlan.captureOwner.maxPixels ||
          appliedCaptureQuality.textureScale !== batchPlan.captureOwner.textureScale ||
          appliedCaptureQuality.lodBias !== batchPlan.captureOwner.lodBias ||
          appliedCaptureQuality.shadows !== shot.capture.shadows ||
          appliedCaptureQuality.shadowMapSize !== shot.capture.shadowMapSize) {
          throw new Error("컷별 렌더 품질이 동결된 캡처 계획과 달라졌습니다.");
        }

        const previousViewportApi = renderedViewportApi;
        const projectionChanged = renderedProjection !== applied.camera.projection;
        flushSync(() => {
          setPrimitives(projected.primitives);
          setCustomModels(projected.customModels);
          setSceneBaseDocument(applied);
          setCaptureBackgroundSnapshot(backgroundSnapshot);
          setShotBatchProgress({
            stage: "render",
            completed: index,
            total: batchPlan.shots.length,
            label: shot.shotName,
          });
        });
        const appliedViewportApi = await applyStudioBg3dViewportAfterTransition({
          view: applied.camera,
          previousApi: previousViewportApi,
          requireReplacement: projectionChanged,
          readApi: () => viewportApiRef.current,
          isActive: () => componentActiveRef.current && !controller.signal.aborted,
          waitForPaintFrame: waitForStudioBg3dPaintFrame,
          signal: controller.signal,
          timeoutMs: 15_000,
        });
        if (!appliedViewportApi) {
          throw new Error("컷 카메라를 새 viewport에 안전하게 복원하지 못했습니다.");
        }
        pendingInitialCameraRef.current = null;
        renderedViewportApi = appliedViewportApi;
        renderedProjection = applied.camera.projection;

        let captured: Awaited<ReturnType<typeof captureStudioBg3dRaster>> | null = null;
        while (!captured) {
          if (document.visibilityState === "hidden") {
            setShotBatchProgress({
              stage: "render",
              completed: studioBg3dShotBatchQueueCompletedCount(recoverySession.queue),
              total: batchPlan.shots.length,
              label: `${shot.shotName} · 표시 상태 대기`,
            });
          }
          await waitForStudioBg3dBatchDocumentVisible(document, controller.signal);
          try {
            const captureAdapter = await acquireStudioBg3dCaptureAdapterAfterViewTransition({
              isActive: () => componentActiveRef.current && !controller.signal.aborted,
              readAdapter: () => captureRef.current.adapter,
              waitForPaintFrame: waitForStudioBg3dPaintFrame,
              signal: controller.signal,
              timeoutMs: 15_000,
            });
            if (!captureAdapter || controller.signal.aborted) {
              throw Object.assign(new Error("취소됨"), { name: "AbortError" });
            }
            const sourceSize = await getStudioBg3dCaptureSourceSize(captureAdapter);
            const captureOwnerMismatches = [
              captureAdapter.backend === batchPlan.captureOwner.backend
                ? null
                : `backend ${captureAdapter.backend}`,
              captureAdapter.engineId === batchPlan.captureOwner.engineId
                ? null
                : `engine ${captureAdapter.engineId}`,
              captureAdapter.engineVersion === batchPlan.captureOwner.engineRevision
                ? null
                : `engine revision ${captureAdapter.engineVersion}`,
              captureAdapter.implementationRevision ===
                  batchPlan.captureOwner.implementationRevision
                ? null
                : `adapter revision ${captureAdapter.implementationRevision}`,
              captureAdapter.graphicsApi === batchPlan.captureOwner.graphicsApi
                ? null
                : `graphics API ${captureAdapter.graphicsApi}`,
              captureAdapter.profileId === batchPlan.captureOwner.profileId
                ? null
                : `profile ${captureAdapter.profileId}`,
              sourceSize.width === batchPlan.captureOwner.sourceWidth &&
                  sourceSize.height === batchPlan.captureOwner.sourceHeight
                ? null
                : `viewport ${sourceSize.width}×${sourceSize.height} ` +
                  `(plan ${batchPlan.captureOwner.sourceWidth}×${batchPlan.captureOwner.sourceHeight})`,
            ].filter((value): value is string => value !== null);
            if (captureOwnerMismatches.length > 0) {
              throw new Error(
                `3D 캡처 소유자가 동결된 컷 계획과 달라졌습니다: ${captureOwnerMismatches.join(", ")}.`,
              );
            }
            const rasterAuthority = verifySharedCharacterCaptureAuthority(
              sharedCharacterAuthorityLease,
              "raster",
            );
            if (!rasterAuthority?.ok) {
              throw new Error(SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE);
            }
            captured = await captureStudioBg3dRaster(
              captureAdapter,
              {
                width: shot.capture.width,
                height: shot.capture.height,
                background: shot.capture.background,
                includeDepth: shot.capture.includeDepth,
              },
              { signal: controller.signal, timeoutMs: 30_000 },
            );
          } catch (cause) {
            if (
              cause instanceof Error &&
              cause.name === "TimeoutError" &&
              document.visibilityState === "hidden"
            ) {
              continue;
            }
            throw cause;
          }
        }
        if (controller.signal.aborted) throw Object.assign(new Error("취소됨"), { name: "AbortError" });
        const receiptAuthority = verifySharedCharacterCaptureAuthority(
          sharedCharacterAuthorityLease,
          "receipt",
        );
        if (!receiptAuthority?.ok) {
          throw new Error(SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE);
        }
        const shotArtifacts = await buildStudioBg3dShotArtifacts({
          shot,
          captured,
          settings: {
            line: applied.output.line,
            tone: applied.output.tone,
          },
          passes: batchPlan.passes,
          includeLayeredPsd: shotBatchIncludeLayeredPsd,
          committedArtifactBytes: accumulatedArtifactBytes,
          signal: controller.signal,
        });
        if (!activeRunToken) throw new Error("컷 배치 실행 토큰을 읽지 못했습니다.");
        await assertRecoveryAccess();
        await shotBatchRecoveryStore.completeShot(recoverySession, activeRunToken, {
          images: shotArtifacts.images,
          skippedArtifacts: shotArtifacts.skippedArtifacts,
          layeredPsds: shotArtifacts.layeredPsds,
          psdFallbacks: shotArtifacts.psdFallbacks,
        }, {
          signal: controller.signal,
          authorizeBeforeCommit: async () => {
            await assertRecoveryAccess();
            const authorizedAt = Date.now();
            return {
              authorizedAt,
              expiresAt: authorizedAt +
                STUDIO_BG3D_SHOT_BATCH_RECOVERY_AUTHORIZATION_RECEIPT_MAX_TTL_MS,
              isLocallyCurrent: () => componentActiveRef.current && !controller.signal.aborted &&
                shotBatchAbortRef.current === controller &&
                shotBatchAuthorizationEpochRef.current === authorizationEpoch,
            };
          },
        });
        images.push(...shotArtifacts.images);
        skippedArtifacts.push(...shotArtifacts.skippedArtifacts);
        layeredPsds.push(...shotArtifacts.layeredPsds);
        psdFallbacks.push(...shotArtifacts.psdFallbacks);
        accumulatedArtifactBytes += shotArtifacts.artifactBytes;
        activeRunToken = null;
        const completedShots = studioBg3dShotBatchQueueCompletedCount(recoverySession.queue);
        setShotBatchRecoverySummary({
          completedShots,
          totalShots: batchPlan.shots.length,
          mode: recoverySession.mode,
        });
        setShotBatchProgress({
          stage: "render",
          completed: completedShots,
          total: batchPlan.shots.length,
          label: shot.shotName,
        });
      }

      await assertRecoveryAccess();
      if (images.length === 0) {
        throw new Error("선택한 패스가 모든 컷에서 꺼져 있어 출력 artifact가 없습니다.");
      }

      let contactSheets: StudioBg3dShotBatchContactSheet[] = [];
      let contactSheetFallback: StudioBg3dShotBatchContactSheetFallback | undefined;
      if (batchPlan.includeContactSheet) {
        const imageByKey = new Map(images.map((image) => [
          `${image.shotId}:${image.pass ?? image.output ?? "beauty"}`,
          image,
        ] as const));
        const contactSources = batchPlan.shots.map((shot): StudioBg3dShotContactSheetImage | null => {
          for (const pass of STUDIO_BG3D_SHOT_CONTACT_SHEET_PASS_PRIORITY) {
            const image = imageByKey.get(`${shot.shotId}:${pass}`);
            if (image) {
              return {
                shotId: image.shotId,
                shotName: image.shotName,
                width: image.width,
                height: image.height,
                png: image.png,
              };
            }
          }
          return null;
        });
        if (contactSources.some((source) => source === null)) {
          contactSheetFallback = "source-unavailable";
        } else if (typeof Worker !== "function") {
          contactSheetFallback = "unavailable";
        } else {
          setShotBatchProgress({
            stage: "contact",
            completed: 0,
            total: contactSources.length,
            label: "콘택트 시트 준비",
          });
          try {
            const result = await buildStudioBg3dShotContactSheetsInWorker(
              contactSources as StudioBg3dShotContactSheetImage[],
              {
                signal: controller.signal,
                timeoutMs: 120_000,
                onProgress: (progress) => setShotBatchProgress({
                  stage: "contact",
                  completed: progress.completedShots,
                  total: progress.totalShots,
                  label: `콘택트 시트 ${progress.completedSheets}/${progress.totalSheets}장`,
                }),
              },
            );
            const contactBytes = result.sheets.reduce((total, sheet) => total + sheet.png.size, 0);
            if (accumulatedArtifactBytes + contactBytes > STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES) {
              contactSheetFallback = "budget";
            } else {
              contactSheets = [...result.sheets];
              accumulatedArtifactBytes += contactBytes;
            }
          } catch (cause) {
            if (cause instanceof Error && cause.name === "AbortError") throw cause;
            contactSheetFallback = cause instanceof Error && cause.name === "NotSupportedError"
              ? "unavailable"
              : "worker-failed";
          }
        }
      }

      await assertRecoveryAccess();
      setShotBatchProgress({
        stage: "archive",
        completed: 0,
        total: images.length + layeredPsds.length + contactSheets.length + 1,
        label: "ZIP 패키지 생성",
      });
      const archiveOptions: StudioBg3dShotBatchBuildOptions = {
        signal: controller.signal,
        manifest: {
          publicRenderPlan: await projectStudioBg3dShotBatchPlanForPublicArchive(batchPlan, {
            appProfileId: STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
            sourceRevision: batchSourceRevision,
          }),
          skippedArtifacts,
          psdFallbacks,
          ...(contactSheetFallback ? { contactSheetFallback } : {}),
        },
        layeredPsds,
        contactSheets,
        onProgress: (progress) => setShotBatchProgress({
          stage: "archive",
          completed: progress.completedFiles,
          total: progress.totalFiles,
          label: "ZIP 패키지 생성",
        }),
      };
      const archive = await buildStudioBg3dShotBatchArchiveInWorker(images, archiveOptions);
      if (controller.signal.aborted) throw Object.assign(new Error("취소됨"), { name: "AbortError" });
      const downloadUrl = URL.createObjectURL(archive);
      try {
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = "toonspectrum-3d-shot-passes.zip";
        anchor.rel = "noopener";
        document.body.append(anchor);
        try {
          await commitStudioBg3dShotBatchDownload({
            signal: controller.signal,
            isActive: () => componentActiveRef.current,
            assertAccess: assertRecoveryAccess,
            markDownloadRequested: () =>
              shotBatchRecoveryStore.markDownloadRequested(recoverySession),
            download: () => anchor.click(),
          });
        } finally {
          anchor.remove();
        }
        if (componentActiveRef.current) {
          setShotBatchRecoverySummary({
            completedShots: studioBg3dShotBatchQueueCompletedCount(recoverySession.queue),
            totalShots: batchPlan.shots.length,
            mode: recoverySession.mode,
            downloadRequested: true,
            degradedReason: recoverySession.degradedReason,
          });
        }
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
      }
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === "AbortError";
      const budgetExceeded = cause instanceof RangeError ||
        cause instanceof StudioBg3dShotBatchRecoveryError && cause.code === "budget-exceeded";
      let recoveryTransitionFailed = false;
      // Once the server or active document revokes access, do not persist even a queue reset. The
      // next authorized acquire already normalizes an interrupted `running` item to `pending`.
      if (activeRunToken && !recoveryAccessRevoked) {
        try {
          if (aborted) {
            await shotBatchRecoveryStore.resetInterrupted(recoverySession);
          } else {
            let failureCode: StudioBg3dShotBatchFailureCode = "unknown";
            if (document.visibilityState === "hidden") failureCode = "visibility-interrupted";
            else if (cause instanceof Error && cause.name === "TimeoutError") failureCode = "view-timeout";
            else if (budgetExceeded) failureCode = "artifact-budget-exceeded";
            else if (cause instanceof Error && cause.message.includes("복원")) {
              failureCode = "scene-restore-failed";
            } else if (cause instanceof Error && cause.message.includes("PNG")) {
              failureCode = "encode-failed";
            }
            await shotBatchRecoveryStore.failShot(recoverySession, activeRunToken, failureCode);
          }
        } catch {
          recoveryTransitionFailed = true;
        }
      }
      const completedShots = studioBg3dShotBatchQueueCompletedCount(recoverySession.queue);
      if (componentActiveRef.current) {
        setShotBatchRecoverySummary(completedShots > 0
          ? {
              completedShots,
              totalShots: batchPlan.shots.length,
              mode: recoverySession.mode,
              degradedReason: recoverySession.degradedReason,
            }
          : null);
      }
      const recoveryLocation = recoverySession.mode === "durable"
        ? "브라우저 복구 저장소"
        : "현재 탭 메모리";
      const recoveryWarning = recoveryTransitionFailed
        ? " 복구 상태 전이를 기록하지 못해 다음 실행에서 현재 컷을 다시 검증합니다."
        : recoverySession.degradedReason
          ? ` ${recoverySession.degradedReason}`
          : "";
      const failureDetail = cause instanceof Error && cause.message.trim().length > 0
        ? ` 원인: ${cause.message.trim()}`
        : "";
      if (componentActiveRef.current) {
        if (aborted) {
          setError(
            recoveryAccessRevoked
              ? "작품 열람 권한 또는 저장 대상이 변경되어 컷 일괄 렌더를 중단하고 복구 lease를 해제했습니다."
              : completedShots > 0
              ? `${completedShots}개 컷 artifact를 ${recoveryLocation}에 보존했습니다. 같은 계획으로 다시 실행하면 이어서 렌더합니다.${recoveryWarning}`
              : `컷 일괄 렌더를 중단했습니다. 같은 계획으로 다시 실행할 수 있습니다.${recoveryWarning}`,
          );
        } else {
          setError(
            budgetExceeded
              ? `컷 artifact 합계가 배치 예산을 넘었습니다. 이전 완료 컷은 ${recoveryLocation}에 보존했습니다. 컷이나 패스를 줄여 주세요.${recoveryWarning}`
              : `컷 일괄 렌더를 완료하지 못했습니다. 완료 artifact를 ${recoveryLocation}에 보존했으므로 같은 계획으로 다시 시도해 주세요.${failureDetail}${recoveryWarning}`,
          );
        }
      }
    } finally {
      let restoreFailed = false;
      if (componentActiveRef.current) {
        const previousViewportApi = renderedViewportApi;
        const projectionChanged = renderedProjection !== originalLiveView.projection;
        flushSync(() => {
          setPrimitives(originalPrimitives);
          setCustomModels(originalCustomModels);
          setSceneBaseDocument(originalSceneBaseDocument);
          setCaptureBackgroundSnapshot(null);
          setLineArtPreview(originalLineArtPreview);
        });
        try {
          const restoredViewportApi = await applyStudioBg3dViewportAfterTransition({
            view: originalLiveView,
            previousApi: previousViewportApi,
            requireReplacement: projectionChanged,
            readApi: () => viewportApiRef.current,
            isActive: () => componentActiveRef.current,
            waitForPaintFrame: waitForStudioBg3dPaintFrame,
            timeoutMs: 5_000,
          });
          if (!restoredViewportApi) restoreFailed = true;
        } catch {
          restoreFailed = true;
        }
        // The main View remains mounted while capture starts and ends. Only a failed camera
        // restoration needs a deferred retry; returning to quad no longer replaces its authority.
        pendingInitialCameraRef.current = restoreFailed ? originalLiveView : null;
      }
      const recoveryRelease = shotBatchRecoveryStore.release(recoverySession);
      let releaseTimeoutId: number | null = null;
      await Promise.race([
        recoveryRelease,
        new Promise<void>((resolve) => {
          releaseTimeoutId = window.setTimeout(resolve, 2_000);
        }),
      ]);
      if (releaseTimeoutId !== null) window.clearTimeout(releaseTimeoutId);
      if (shotBatchRecoveryRef.current === recoverySession) shotBatchRecoveryRef.current = null;
      if (shotBatchAbortRef.current === controller) shotBatchAbortRef.current = null;
      if (shotBatchRecoveryScopeRef.current?.controller === controller) {
        shotBatchRecoveryScopeRef.current = null;
      }
      captureInFlightRef.current = false;
      if (componentActiveRef.current) {
        flushSync(() => {
          setIsCapturing(false);
          setShotBatchProgress(null);
          if (restoreFailed) {
            setError("컷 배치 후 원래 카메라 구도를 즉시 복원하지 못했습니다. viewport가 준비되면 자동으로 다시 적용합니다.");
          }
        });
      }
    }
  }

  return exportSavedShotsAsZip;
}
