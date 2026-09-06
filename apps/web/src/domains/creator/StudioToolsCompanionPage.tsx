/**
 * Detached, same-origin companion for Studio. The primary owns the editable document and undo;
 * this window only receives bounded review projections/WebP previews and sends validated intents.
 */
import {
  Eye,
  EyeOff,
  Images,
  Layers,
  ListChecks,
  LoaderCircle,
  Map,
  MonitorSmartphone,
  MonitorUp,
  Palette,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useLocation } from "react-router-dom";


import {
  StudioCompanionReferenceObjectUrlOwner,
  type StudioCompanionReferencePreviewFrame,
  type StudioCompanionReferenceProjection,
} from "./studio-companion-reference-projection";
import {
  mergeStudioCompanionBrushPatches,
  planStudioCompanionExternalScreenPlacement,
  StudioCompanionNavigatorObjectUrlOwner,
  type StudioCompanionBrushPatch,
  type StudioCompanionNormalizedPoint,
  type StudioCompanionReviewProjection,
} from "./studio-companion-review-projection";
import {
  buildStudioCompanionCommand,
  buildStudioCompanionControl,
  buildStudioCompanionGoodbye,
  buildStudioCompanionHello,
  buildStudioCompanionPing,
  buildStudioCompanionPresentationSafe,
  createStudioCompanionChannel,
  createStudioCompanionCommandId,
  createStudioCompanionInstanceId,
  isStudioCompanionMessageFresh,
  isStudioToolsCompanionWindowReusable,
  openStudioCompanionSurfaceWindow,
  parseStudioCompanionDocumentScope,
  parseStudioCompanionMessage,
  parseStudioCompanionSessionId,
  parseStudioCompanionSurface,
  StudioCompanionPresentationSafeGuard,
  StudioCompanionReferenceMessageGuard,
  STUDIO_COMPANION_TOOL_LABEL_KEYS,
  STUDIO_COMPANION_TOOL_LABELS,
  STUDIO_COMPANION_TOOL_ORDER,
  studioCompanionPrimaryUrl,
  type StudioCompanionCommandName,
  type StudioCompanionControl,
  type StudioCompanionDensity,
  type StudioCompanionMessage,
  type StudioCompanionReferenceColorResult,
  type StudioCompanionSurface,
  type StudioCompanionToolId,
} from "./studio-tools-companion";
import { StudioCompanionAssistantDisplay } from "./StudioCompanionAssistantDisplay";
import { StudioCompanionNavigator } from "./StudioCompanionNavigator";
import { StudioCompanionReviewConsole } from "./StudioCompanionReviewConsole";
import {
  StudioCompanionWindowLayoutControls,
  type StudioCompanionWindowLayoutPersistenceStatus,
} from "./StudioCompanionWindowLayoutControls";
import { StudioCompanionWindowManager } from "./StudioCompanionWindowManager";
import {
  StudioCompanionWorkspacePresets,
  type StudioCompanionWorkspacePresetId,
} from "./StudioCompanionWorkspacePresets";
import { useStudioCompanionWindowLayout } from "./use-studio-companion-window-layout";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import { studioCanOpenAuxiliaryWindow } from "@/src/compat/in-app-browser";
import Link from "@/src/compat/router-link";

const HEARTBEAT_INTERVAL_MS = 4_000;
const PRIMARY_STALE_AFTER_MS = 12_000;
const BRUSH_CONTROL_COALESCE_MS = 64;
const NAVIGATOR_CONTROL_COALESCE_MS = 32;
const SCREEN_DETAILS_TIMEOUT_MS = 2_500;
const REFERENCE_IMAGE_DECODE_TIMEOUT_MS = 5_000;

type CompanionMode = "tools" | "navigator" | "review" | "reference" | "assistant";
type DedicatedCompanionSurface = Extract<
  StudioCompanionSurface,
  "navigator" | "review" | "reference"
>;

const LazyStudioCompanionReferenceDisplay = lazy(() =>
  import("./StudioCompanionReferenceDisplay").then((module) => ({
    default: module.StudioCompanionReferenceDisplay,
  }))
);

type ScreenPlacementStatus = {
  kind: "requesting" | "unsupported" | "denied" | "timeout" | "no-secondary" | "failed" | "requested" | "restored" | "stale";
  text: string;
};

type StudioCompanionT = (key: string, fallback?: string) => string;

function localizeText(t: StudioCompanionT | undefined, fallback: string, key: string): string {
  if (!t) return fallback;
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function interpolateText(
  message: string,
  values?: Record<string, string | number>,
): string {
  if (!values) return message;
  return Object.entries(values).reduce(
    (memo, [key, value]) => memo.replaceAll(`{${key}}`, String(value)),
    message,
  );
}

function tText(
  t: StudioCompanionT | undefined,
  fallback: string,
  key: string,
  values?: Record<string, string | number>,
): string {
  return interpolateText(localizeText(t, fallback, key), values);
}

type WindowWithScreenDetails = Window & {
  getScreenDetails?: () => Promise<{ screens: readonly unknown[]; currentScreen?: unknown }>;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function decodeStudioCompanionBlobImage(
  url: string
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!url.startsWith("blob:")) {
      resolve(null);
      return;
    }
    const image = new Image();
    let settled = false;
    const timer = globalThis.setTimeout(() => finish(null), REFERENCE_IMAGE_DECODE_TIMEOUT_MS);
    const finish = (value: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      finish(
        Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0
          ? { width, height }
          : null
      );
    };
    image.onerror = () => finish(null);
    image.src = url;
  });
}

export function StudioToolsCompanionPage() {
  const location = useLocation();
  const t = useT();
  const sessionId = parseStudioCompanionSessionId(location.search);
  const surface = parseStudioCompanionSurface(location.search);
  const documentScope = parseStudioCompanionDocumentScope(location.search);
  const companionWorkId = documentScope?.workId ?? null;
  const companionDocumentScopeKey = documentScope
    ? documentScope.workId !== null
      ? `work:${documentScope.workId}`
      : documentScope.remixId !== null
        ? `remix:${documentScope.remixId}`
        : "draft"
    : null;
  const effectiveSurface: StudioCompanionSurface = surface ?? "workspace";
  const channelRef = useRef<ReturnType<typeof createStudioCompanionChannel>>(null);
  const companionIdentityRef = useRef<{ scope: string; instanceId: string } | null>(null);
  const companionInstanceIdRef = useRef<string | null>(null);
  const targetPrimaryInstanceIdRef = useRef<string | null>(null);
  const pendingPingNonceRef = useRef<string | null>(null);
  const commandSequenceRef = useRef(0);
  const generationRef = useRef(0);
  const projectionRevisionRef = useRef(-1);
  const projectionDocumentRevisionRef = useRef(-1);
  const navigatorSequenceRef = useRef(0);
  const navigatorRevisionRef = useRef(-1);
  const navigatorUrlOwnerRef = useRef<StudioCompanionNavigatorObjectUrlOwner | null>(null);
  navigatorUrlOwnerRef.current ??= new StudioCompanionNavigatorObjectUrlOwner();
  const referenceGuardRef = useRef<StudioCompanionReferenceMessageGuard | null>(null);
  referenceGuardRef.current ??= new StudioCompanionReferenceMessageGuard();
  const presentationSafeGuardRef = useRef<StudioCompanionPresentationSafeGuard | null>(null);
  const releaseNavigatorDemandRef = useRef<() => void>(() => undefined);
  const releaseReferenceDemandRef = useRef<() => void>(() => undefined);
  const referenceUrlOwnerRef = useRef<StudioCompanionReferenceObjectUrlOwner | null>(null);
  referenceUrlOwnerRef.current ??= new StudioCompanionReferenceObjectUrlOwner();
  const referenceFrameEpochRef = useRef(0);
  const referenceDemandActiveRef = useRef(false);
  const presentationSafeRef = useRef(false);
  const pendingBrushPatchRef = useRef<StudioCompanionBrushPatch | null>(null);
  const pendingBrushTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const pendingNavigatorPointRef = useRef<StudioCompanionNormalizedPoint | null>(null);
  const pendingNavigatorTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const screenPlacementEpochRef = useRef(0);
  const navigatorDemandActiveRef = useRef(false);
  const previousDocumentTitleRef = useRef<string | null>(null);
  const dedicatedWindowRefs = useRef<Record<DedicatedCompanionSurface, Window | null>>({
    navigator: null,
    review: null,
    reference: null,
  });
  const dedicatedWindowOwnerRef = useRef<{
    readonly sessionId: string;
    readonly scopeKey: string;
    readonly workId: string | null;
  } | null>(
    surface === "workspace" && sessionId && companionDocumentScopeKey
      ? { sessionId, scopeKey: companionDocumentScopeKey, workId: companionWorkId }
      : null,
  );

  const [connected, setConnected] = useState(false);
  const [targetPrimaryInstanceId, setTargetPrimaryInstanceId] = useState<string | null>(null);
  const [primaryTitle, setPrimaryTitle] = useState(
    localizeText(t, "스튜디오", "studio.toolsCompanion.title.default")
  );
  const [activeTool, setActiveTool] = useState<StudioCompanionToolId>("select");
  const [density, setDensity] = useState<StudioCompanionDensity>("full");
  const [primaryCanvasOnly, setPrimaryCanvasOnly] = useState(false);
  const [mode, setMode] = useState<CompanionMode>("tools");
  const [projection, setProjection] = useState<StudioCompanionReviewProjection | null>(null);
  const [navigatorImage, setNavigatorImage] = useState<{
    url: string;
    width: number;
    height: number;
    revision: number;
  } | null>(null);
  const [referenceProjection, setReferenceProjection] =
    useState<StudioCompanionReferenceProjection | null>(null);
  const [referencePreview, setReferencePreview] = useState<{
    url: string;
    generation: number;
    revision: number;
    referenceRevision: number;
    sequence: number;
    width: number;
    height: number;
  } | null>(null);
  const [referenceColorResult, setReferenceColorResult] =
    useState<StudioCompanionReferenceColorResult | null>(null);
  const [referenceConnectionEpoch, setReferenceConnectionEpoch] = useState(0);
  const [presentationSafeState, setPresentationSafeState] = useState(() => ({
    sessionId,
    enabled: false,
  }));
  const [presentationSafeTransport, setPresentationSafeTransport] =
    useState<"pending" | "broadcast" | "memory-only">("pending");
  const [screenPlacementStatus, setScreenPlacementStatus] = useState<ScreenPlacementStatus | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const interactionReady = connected && targetPrimaryInstanceId !== null;
  /**
   * 이 창을 벗어날 방법이 환경마다 다르다.
   *
   * 보조 창을 열 수 있는 브라우저에서 이 페이지는 보통 기본 스튜디오가 띄운 팝업이라,
   * 사용자는 창을 닫으면 된다 — 거기에 같은 탭 `/studio` 링크를 놓으면 도구 창이 두 번째
   * 편집기로 바뀌어 버린다. 반대로 인앱 브라우저(카카오톡·인스타그램)에서 공유 링크를 타고
   * 이 주소로 들어오면 창 크롬도 주소창도 뒤로 가기도 없어서, 화면 안 링크가 유일한 문이다.
   * 그래서 탈출구는 팝업을 못 여는 환경에서만 내보내고, 재연결 링크도 같은 신호로 target 을 고른다.
   */
  const canOpenAuxiliaryWindow = studioCanOpenAuxiliaryWindow();
  const reconnectTargetProps = canOpenAuxiliaryWindow
    ? ({ rel: "noopener noreferrer", target: "_blank" } as const)
    : ({} as const);
  const companionWindowLayout = useStudioCompanionWindowLayout({
    surface: effectiveSurface,
    enabled: sessionId !== null,
    interactionReady,
    onRestored: () => {
      setScreenPlacementStatus({
        kind: "restored",
        text: localizeText(
          t,
          "이 역할에 저장된 창 위치와 크기를 복원했습니다.",
          "studio.toolsCompanion.screenPlacement.restored"
        ),
      });
    },
    onTopologyStale: () => {
      setScreenPlacementStatus({
        kind: "stale",
        text: localizeText(
          t,
          "모니터 구성이 바뀌어 자동 복원을 멈췄습니다. 창을 원하는 곳으로 옮긴 뒤 ‘현재 위치 저장’을 눌러 주세요.",
          "studio.toolsCompanion.screenPlacement.stale"
        ),
      });
    },
  });

  const presentationSafe = presentationSafeState.sessionId === sessionId
    ? presentationSafeState.enabled
    : false;
  useLayoutEffect(() => {
    // BroadcastChannel callbacks are external observers. Expose only the value that React
    // committed; a speculative/abandoned render must never momentarily reopen preview capture.
    presentationSafeRef.current = presentationSafe;
  }, [presentationSafe]);

  function post(msg: StudioCompanionMessage): boolean {
    try {
      const channel = channelRef.current;
      if (!channel) return false;
      channel.postMessage(msg);
      return true;
    } catch {
      setPresentationSafeTransport("memory-only");
      setLastError(localizeText(
        t,
        "채널 전송에 실패했습니다. 기본 스튜디오 탭이 같은 출처인지 확인하세요.",
        "studio.toolsCompanion.error.channelSend"
      ));
      return false;
    }
  }

  const clearPendingBrushControl = useCallback(() => {
    if (pendingBrushTimerRef.current !== null) {
      globalThis.clearTimeout(pendingBrushTimerRef.current);
      pendingBrushTimerRef.current = null;
    }
    pendingBrushPatchRef.current = null;
  }, []);

  const clearPendingNavigatorControl = useCallback(() => {
    if (pendingNavigatorTimerRef.current !== null) {
      globalThis.clearTimeout(pendingNavigatorTimerRef.current);
      pendingNavigatorTimerRef.current = null;
    }
    pendingNavigatorPointRef.current = null;
  }, []);

  const clearReviewState = useCallback(() => {
    generationRef.current = 0;
    projectionRevisionRef.current = -1;
    projectionDocumentRevisionRef.current = -1;
    navigatorSequenceRef.current = 0;
    navigatorRevisionRef.current = -1;
    navigatorUrlOwnerRef.current?.clear();
    referenceFrameEpochRef.current += 1;
    referenceDemandActiveRef.current = false;
    referenceGuardRef.current?.reset();
    referenceUrlOwnerRef.current?.clear();
    clearPendingBrushControl();
    clearPendingNavigatorControl();
    setProjection(null);
    setNavigatorImage(null);
    setReferenceProjection(null);
    setReferencePreview(null);
    setReferenceColorResult(null);
  }, [clearPendingBrushControl, clearPendingNavigatorControl]);

  const applyPresentationSafe = useCallback((enabled: boolean) => {
    presentationSafeRef.current = enabled;
    setPresentationSafeState({ sessionId, enabled });
    if (!enabled) return;
    // Revoke every visual preview and cancel primary-side capture before React swaps in the safe
    // placeholders. The epoch also rejects a Reference decode already awaiting Image.onload.
    navigatorUrlOwnerRef.current?.clear();
    setNavigatorImage(null);
    referenceFrameEpochRef.current += 1;
    referenceUrlOwnerRef.current?.clear();
    setReferencePreview(null);
    setReferenceColorResult(null);
    releaseNavigatorDemandRef.current();
    releaseReferenceDemandRef.current();
  }, [sessionId]);

  function sendControl(control: StudioCompanionControl): boolean {
    const companionInstanceId = companionInstanceIdRef.current;
    const targetPrimary = targetPrimaryInstanceIdRef.current;
    const generation = generationRef.current;
    if (!connected || !companionInstanceId || !targetPrimary || generation <= 0) return false;
    commandSequenceRef.current += 1;
    const sent = post(buildStudioCompanionControl({
      control,
      generation,
      companionInstanceId,
      targetPrimaryInstanceId: targetPrimary,
      commandId: createStudioCompanionCommandId(),
      sequence: commandSequenceRef.current,
    }));
    if (control.kind === "reference-preview-demand" && (sent || !control.active)) {
      referenceDemandActiveRef.current = control.active;
      if (!control.active) {
        referenceFrameEpochRef.current += 1;
        referenceUrlOwnerRef.current?.clear();
        setReferencePreview(null);
        setReferenceColorResult(null);
      }
    }
    return sent;
  }

  function flushBrushControl() {
    if (pendingBrushTimerRef.current !== null) {
      globalThis.clearTimeout(pendingBrushTimerRef.current);
      pendingBrushTimerRef.current = null;
    }
    const patch = pendingBrushPatchRef.current;
    pendingBrushPatchRef.current = null;
    if (patch) sendControl({ kind: "brush", patch });
  }

  function queueBrushControl(patch: StudioCompanionBrushPatch) {
    pendingBrushPatchRef.current = mergeStudioCompanionBrushPatches(
      pendingBrushPatchRef.current,
      patch
    );
    if (pendingBrushTimerRef.current !== null) return;
    pendingBrushTimerRef.current = globalThis.setTimeout(
      flushBrushControl,
      BRUSH_CONTROL_COALESCE_MS
    );
  }

  function flushNavigatorControl() {
    if (pendingNavigatorTimerRef.current !== null) {
      globalThis.clearTimeout(pendingNavigatorTimerRef.current);
      pendingNavigatorTimerRef.current = null;
    }
    const point = pendingNavigatorPointRef.current;
    pendingNavigatorPointRef.current = null;
    if (point) sendControl({ kind: "navigate", point });
  }

  function queueNavigatorControl(point: StudioCompanionNormalizedPoint, final = false) {
    pendingNavigatorPointRef.current = point;
    if (final) {
      flushNavigatorControl();
      return;
    }
    if (pendingNavigatorTimerRef.current !== null) return;
    pendingNavigatorTimerRef.current = globalThis.setTimeout(
      flushNavigatorControl,
      NAVIGATOR_CONTROL_COALESCE_MS
    );
  }

  function changePresentationSafe(enabled: boolean) {
    applyPresentationSafe(enabled);
    const companionInstanceId = companionInstanceIdRef.current;
    const guard = presentationSafeGuardRef.current;
    if (!companionInstanceId || !guard) return;
    const state = guard.write(enabled, createStudioCompanionCommandId());
    if (!state) return;
    post(buildStudioCompanionPresentationSafe({
      companionInstanceId,
      targetCompanionInstanceId: null,
      state,
    }));
    if (enabled || interactionReady) return;

    const targetPrimaryInstanceId = targetPrimaryInstanceIdRef.current;
    if (!targetPrimaryInstanceId) {
      post(buildStudioCompanionHello({
        role: "companion",
        surface: effectiveSurface,
        companionInstanceId,
        targetPrimaryInstanceId: null,
      }));
      return;
    }

    const nonce = createStudioCompanionCommandId();
    pendingPingNonceRef.current = nonce;
    post(buildStudioCompanionPing({
      companionInstanceId,
      targetPrimaryInstanceId,
      nonce,
    }));
  }

  useEffect(() => {
    previousDocumentTitleRef.current = document.title;
    return () => {
      if (previousDocumentTitleRef.current !== null) {
        document.title = previousDocumentTitleRef.current;
      }
    };
  }, []);

  useEffect(() => {
    const surfaceTitle = localizeText(
      t,
      effectiveSurface === "workspace"
        ? "도구 창"
        : effectiveSurface === "navigator"
          ? "캔버스 내비게이터"
          : effectiveSurface === "review"
            ? "검수 콘솔"
            : "레퍼런스 화면",
      effectiveSurface === "workspace"
        ? "studio.toolsCompanion.surface.workspace"
        : effectiveSurface === "navigator"
          ? "studio.toolsCompanion.surface.navigator"
          : effectiveSurface === "review"
            ? "studio.toolsCompanion.surface.review"
            : "studio.toolsCompanion.surface.reference"
    );
    document.title = `${surfaceTitle} · ToonSpectrum Studio`;
  }, [effectiveSurface, t]);

  useEffect(() => {
    if (!presentationSafe) return;
    navigatorUrlOwnerRef.current?.clear();
    setNavigatorImage(null);
    referenceFrameEpochRef.current += 1;
    referenceUrlOwnerRef.current?.clear();
    setReferencePreview(null);
    setReferenceColorResult(null);
    releaseNavigatorDemandRef.current();
    releaseReferenceDemandRef.current();
  }, [presentationSafe]);

  useEffect(() => {
    if (surface !== "workspace") return;
    const previousOwner = dedicatedWindowOwnerRef.current;
    const nextOwner = sessionId && companionDocumentScopeKey
      ? { sessionId, scopeKey: companionDocumentScopeKey, workId: companionWorkId }
      : null;
    if (
      previousOwner?.sessionId === nextOwner?.sessionId
      && previousOwner?.scopeKey === nextOwner?.scopeKey
    ) return;
    if (previousOwner) {
      for (const dedicatedSurface of ["navigator", "review", "reference"] as const) {
        const companionWindow = dedicatedWindowRefs.current[dedicatedSurface];
        if (!isStudioToolsCompanionWindowReusable(
          previousOwner.sessionId,
          companionWindow,
          dedicatedSurface,
          previousOwner.workId,
        )) continue;
        try {
          companionWindow.close();
        } catch {
          // A browser may deny close after ownership changes; the old handle is still released.
        } finally {
          dedicatedWindowRefs.current[dedicatedSurface] = null;
        }
      }
    }
    dedicatedWindowOwnerRef.current = nextOwner;
  }, [companionDocumentScopeKey, companionWorkId, sessionId, surface]);

  useEffect(() => () => {
    screenPlacementEpochRef.current += 1;
  }, []);

  useEffect(() => {
    setConnected(false);
    setTargetPrimaryInstanceId(null);
    setPrimaryTitle(localizeText(t, "스튜디오", "studio.toolsCompanion.title.default"));
    setActiveTool("select");
    setDensity("full");
    setLastError(null);
    setScreenPlacementStatus(null);
    setPresentationSafeTransport("pending");
    applyPresentationSafe(false);
    screenPlacementEpochRef.current += 1;
    targetPrimaryInstanceIdRef.current = null;
    pendingPingNonceRef.current = null;
    commandSequenceRef.current = 0;
    channelRef.current = null;
    clearReviewState();

    if (!sessionId) {
      companionInstanceIdRef.current = null;
      setLastError(localizeText(
        t,
        "유효한 분리 세션이 없습니다. 기본 스튜디오에서 도구 창을 다시 열어 주세요.",
        "studio.toolsCompanion.error.invalidSession"
      ));
      return;
    }
    if (!surface) {
      companionInstanceIdRef.current = null;
      setLastError(localizeText(
        t,
        "유효한 컴패니언 보기 모드가 없습니다. 기본 스튜디오에서 창을 다시 열어 주세요.",
        "studio.toolsCompanion.error.invalidSurface"
      ));
      return;
    }
    if (companionDocumentScopeKey === null) {
      companionInstanceIdRef.current = null;
      setLastError(
        "유효한 작품 범위가 없습니다. 기본 스튜디오에서 도구 창을 다시 열어 주세요.",
      );
      return;
    }

    const companionScope = `${sessionId}:${surface}:${companionDocumentScopeKey}`;
    let companionIdentity = companionIdentityRef.current;
    if (!companionIdentity || companionIdentity.scope !== companionScope) {
      companionIdentity = {
        scope: companionScope,
        instanceId: createStudioCompanionInstanceId(),
      };
      companionIdentityRef.current = companionIdentity;
    }
    const companionInstanceId = companionIdentity.instanceId;
    companionInstanceIdRef.current = companionInstanceId;
    const channel = createStudioCompanionChannel(sessionId);
    channelRef.current = channel;
    if (!channel) {
      setPresentationSafeTransport("memory-only");
      setLastError(localizeText(
        t,
        "이 브라우저는 BroadcastChannel을 지원하지 않습니다.",
        "studio.toolsCompanion.error.unsupportedBroadcast"
      ));
      return;
    }
    setPresentationSafeTransport("broadcast");

    const presentationSafeGuard = new StudioCompanionPresentationSafeGuard();
    presentationSafeGuard.bind(companionInstanceId);
    presentationSafeGuardRef.current = presentationSafeGuard;

    let lastPrimaryActivityAt = 0;
    let primaryConfirmed = false;
    let companionGoodbyeSent = false;
    let leaving = false;
    const releaseNavigatorDemand = (notifyPrimary = true) => {
      if (!navigatorDemandActiveRef.current) return;
      const targetPrimary = targetPrimaryInstanceIdRef.current;
      const generation = generationRef.current;
      if (notifyPrimary && targetPrimary && generation > 0) {
        commandSequenceRef.current += 1;
        try {
          channel.postMessage(buildStudioCompanionControl({
            control: { kind: "navigator-demand", active: false },
            generation,
            companionInstanceId,
            targetPrimaryInstanceId: targetPrimary,
            commandId: createStudioCompanionCommandId(),
            sequence: commandSequenceRef.current,
          }));
        } catch {
          // Closing the detached window may race the final demand release.
        }
      }
      navigatorDemandActiveRef.current = false;
    };
    const releaseReferenceDemand = (notifyPrimary = true) => {
      if (!referenceDemandActiveRef.current) return;
      const targetPrimary = targetPrimaryInstanceIdRef.current;
      const generation = generationRef.current;
      if (notifyPrimary && targetPrimary && generation > 0) {
        commandSequenceRef.current += 1;
        try {
          channel.postMessage(buildStudioCompanionControl({
            control: { kind: "reference-preview-demand", active: false },
            generation,
            companionInstanceId,
            targetPrimaryInstanceId: targetPrimary,
            commandId: createStudioCompanionCommandId(),
            sequence: commandSequenceRef.current,
          }));
        } catch {
          // Closing the detached window may race the final demand release.
        }
      }
      referenceDemandActiveRef.current = false;
    };
    const releasePresentationSafeNavigatorDemand = () => releaseNavigatorDemand(true);
    const releasePresentationSafeReferenceDemand = () => releaseReferenceDemand(true);
    releaseNavigatorDemandRef.current = releasePresentationSafeNavigatorDemand;
    releaseReferenceDemandRef.current = releasePresentationSafeReferenceDemand;
    const leaveCompanion = () => {
      if (companionGoodbyeSent) return;
      companionGoodbyeSent = true;
      leaving = true;
      releaseNavigatorDemand();
      releaseReferenceDemand();
      const targetPrimary = targetPrimaryInstanceIdRef.current;
      if (!targetPrimary) return;
      try {
        channel.postMessage(buildStudioCompanionGoodbye({
          companionInstanceId,
          targetPrimaryInstanceId: targetPrimary,
          surface,
        }));
      } catch {
        // The channel may already be unavailable while the detached window is closing.
      }
    };
    const onCompanionPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      leaveCompanion();
    };
    window.addEventListener("pagehide", onCompanionPageHide);
    const markPrimaryActivity = () => {
      lastPrimaryActivityAt = Date.now();
      primaryConfirmed = true;
      setConnected(true);
      setLastError(null);
    };
    const expirePrimary = (notifyPrimary = true) => {
      releaseNavigatorDemand(notifyPrimary);
      releaseReferenceDemand(notifyPrimary);
      lastPrimaryActivityAt = 0;
      setConnected(false);
      setTargetPrimaryInstanceId(null);
      setPrimaryTitle(localizeText(t, "스튜디오", "studio.toolsCompanion.title.default"));
      setActiveTool("select");
      setDensity("full");
      setPrimaryCanvasOnly(false);
      targetPrimaryInstanceIdRef.current = null;
      pendingPingNonceRef.current = null;
      primaryConfirmed = false;
      setReferenceConnectionEpoch((value) => value + 1);
      clearReviewState();
    };

    const stageReferenceFrame = async (frame: StudioCompanionReferencePreviewFrame) => {
      const acceptedEpoch = referenceFrameEpochRef.current;
      const owner = referenceUrlOwnerRef.current;
      if (!owner || presentationSafeRef.current) return;
      const handle = await owner.stageVerified(frame);
      if (!handle) return;
      if (
        presentationSafeRef.current
        || referenceFrameEpochRef.current !== acceptedEpoch
        || owner.pending() !== handle
      ) {
        owner.reject(handle);
        return;
      }
      const decoded = await decodeStudioCompanionBlobImage(handle.url);
      if (
        !decoded
        || presentationSafeRef.current
        || referenceFrameEpochRef.current !== acceptedEpoch
        || owner.pending() !== handle
      ) {
        owner.reject(handle);
        return;
      }
      const url = owner.commit(handle, decoded.width, decoded.height);
      if (!url) return;
      setReferencePreview({ ...handle, url });
    };

    const stageNavigatorFrame = async (
      frame: Extract<StudioCompanionMessage, { type: "navigator-frame" }>
    ) => {
      const owner = navigatorUrlOwnerRef.current;
      if (!owner || presentationSafeRef.current) return;
      const handle = owner.stage(frame.blob);
      if (!handle) return;
      if (
        presentationSafeRef.current
        || frame.primaryInstanceId !== targetPrimaryInstanceIdRef.current
        || frame.generation !== generationRef.current
        || frame.sequence !== navigatorSequenceRef.current
        || frame.revision !== projectionDocumentRevisionRef.current
        || owner.pending() !== handle
      ) {
        owner.reject(handle);
        return;
      }
      const decoded = await decodeStudioCompanionBlobImage(handle.url);
      if (
        !decoded
        || decoded.width !== frame.width
        || decoded.height !== frame.height
        || presentationSafeRef.current
        || frame.primaryInstanceId !== targetPrimaryInstanceIdRef.current
        || frame.generation !== generationRef.current
        || frame.sequence !== navigatorSequenceRef.current
        || frame.revision !== projectionDocumentRevisionRef.current
        || owner.pending() !== handle
      ) {
        owner.reject(handle);
        return;
      }
      const url = owner.commit(handle);
      if (!url) return;
      navigatorRevisionRef.current = frame.revision;
      setNavigatorImage({
        url,
        width: frame.width,
        height: frame.height,
        revision: frame.revision,
      });
      markPrimaryActivity();
    };

    channel.onmessage = (event: MessageEvent) => {
      if (leaving) return;
      const msg = parseStudioCompanionMessage(event.data);
      if (!msg || !isStudioCompanionMessageFresh(msg)) return;
      if (msg.type === "hello" && msg.role === "companion") {
        if (msg.companionInstanceId === companionInstanceId) return;
        const state = presentationSafeGuard.current();
        if (!state) return;
        try {
          channel.postMessage(buildStudioCompanionPresentationSafe({
            companionInstanceId,
            targetCompanionInstanceId: msg.companionInstanceId,
            state,
          }));
        } catch {
          // A peer hello is retried; the latest register remains available for the next replay.
        }
        return;
      }
      if (msg.type === "companion-presentation-safe") {
        if (!presentationSafeGuard.accept(msg, { companionInstanceId })) return;
        const state = presentationSafeGuard.current();
        if (state) applyPresentationSafe(state.enabled);
        return;
      }
      if (msg.type === "primary-goodbye") {
        if (msg.primaryInstanceId !== targetPrimaryInstanceIdRef.current) return;
        if (msg.targetCompanionInstanceId !== companionInstanceId) return;
        if (msg.surface !== surface) return;
        expirePrimary(false);
        return;
      }
      if (msg.type === "hello" && msg.role === "primary") {
        if (
          msg.targetCompanionInstanceId !== null
          && msg.targetCompanionInstanceId !== companionInstanceId
        ) return;
        const currentPrimary = targetPrimaryInstanceIdRef.current;
        if (currentPrimary && currentPrimary !== msg.primaryInstanceId) return;
        const isNewCandidate = currentPrimary === null;
        if (!referenceGuardRef.current?.bind(msg.primaryInstanceId, companionInstanceId)) return;
        targetPrimaryInstanceIdRef.current = msg.primaryInstanceId;
        setTargetPrimaryInstanceId(msg.primaryInstanceId);
        lastPrimaryActivityAt = Date.now();
        if (!primaryConfirmed) setConnected(false);
        if (isNewCandidate) {
          setReferenceConnectionEpoch((value) => value + 1);
          try {
            channel.postMessage(buildStudioCompanionHello({
              role: "companion",
              surface,
              companionInstanceId,
              targetPrimaryInstanceId: msg.primaryInstanceId,
            }));
          } catch {
            // Discovery retries on the next heartbeat.
          }
        }
        return;
      }
      if (msg.type === "primary-state") {
        if (msg.primaryInstanceId !== targetPrimaryInstanceIdRef.current) return;
        if (msg.targetCompanionInstanceId !== companionInstanceId) return;
        markPrimaryActivity();
        setActiveTool(msg.tool);
        setDensity(msg.density);
        setPrimaryCanvasOnly(msg.canvasOnly);
        setPrimaryTitle(
          msg.title || localizeText(t, "스튜디오", "studio.toolsCompanion.title.default")
        );
        return;
      }
      if (msg.type === "primary-reference-state") {
        const guard = referenceGuardRef.current;
        if (!guard?.acceptState(msg)) return;
        generationRef.current = msg.generation;
        referenceFrameEpochRef.current += 1;
        referenceUrlOwnerRef.current?.clearStale(msg.projection);
        const current = referenceUrlOwnerRef.current?.current() ?? null;
        setReferencePreview(current ? { ...current } : null);
        setReferenceColorResult(null);
        setReferenceProjection(msg.projection);
        markPrimaryActivity();
        return;
      }
      if (msg.type === "reference-preview-frame") {
        const guard = referenceGuardRef.current;
        if (!guard?.acceptPreviewFrame(msg) || presentationSafeRef.current) return;
        markPrimaryActivity();
        void stageReferenceFrame({
          generation: msg.generation,
          revision: msg.revision,
          referenceRevision: msg.referenceRevision,
          sequence: msg.sequence,
          width: msg.width,
          height: msg.height,
          blob: msg.blob,
        });
        return;
      }
      if (msg.type === "reference-color-result") {
        const guard = referenceGuardRef.current;
        if (!guard?.acceptColorResult(msg) || presentationSafeRef.current) return;
        setReferenceColorResult({
          generation: msg.generation,
          revision: msg.revision,
          referenceRevision: msg.referenceRevision,
          sequence: msg.sequence,
          color: msg.color,
        });
        markPrimaryActivity();
        return;
      }
      if (msg.type === "primary-review-state") {
        if (msg.primaryInstanceId !== targetPrimaryInstanceIdRef.current) return;
        if (msg.targetCompanionInstanceId !== companionInstanceId) return;
        if (msg.generation < generationRef.current) return;
        if (msg.generation > generationRef.current) {
          navigatorDemandActiveRef.current = false;
          clearPendingBrushControl();
          clearPendingNavigatorControl();
          navigatorUrlOwnerRef.current?.clear();
          setNavigatorImage(null);
          generationRef.current = msg.generation;
          projectionRevisionRef.current = -1;
          projectionDocumentRevisionRef.current = -1;
          navigatorSequenceRef.current = 0;
          navigatorRevisionRef.current = -1;
        }
        if (msg.projection.revision < projectionRevisionRef.current) return;
        if (msg.projection.documentRevision < projectionDocumentRevisionRef.current) return;
        if (
          msg.projection.documentRevision > projectionDocumentRevisionRef.current
          && navigatorRevisionRef.current !== msg.projection.documentRevision
        ) {
          navigatorUrlOwnerRef.current?.clear();
          navigatorRevisionRef.current = -1;
          setNavigatorImage(null);
        }
        projectionRevisionRef.current = msg.projection.revision;
        projectionDocumentRevisionRef.current = msg.projection.documentRevision;
        setProjection(msg.projection);
        markPrimaryActivity();
        return;
      }
      if (msg.type === "navigator-frame") {
        if (msg.primaryInstanceId !== targetPrimaryInstanceIdRef.current) return;
        if (msg.targetCompanionInstanceId !== companionInstanceId) return;
        if (msg.generation !== generationRef.current || msg.generation <= 0) return;
        if (msg.sequence <= navigatorSequenceRef.current) return;
        if (msg.revision !== projectionDocumentRevisionRef.current) return;
        if (presentationSafeRef.current) return;
        navigatorSequenceRef.current = msg.sequence;
        void stageNavigatorFrame(msg);
        return;
      }
      if (msg.type === "pong") {
        if (msg.primaryInstanceId !== targetPrimaryInstanceIdRef.current) return;
        if (msg.targetCompanionInstanceId !== companionInstanceId) return;
        if (msg.nonce !== pendingPingNonceRef.current) return;
        pendingPingNonceRef.current = null;
        markPrimaryActivity();
      }
    };

    try {
      channel.postMessage(buildStudioCompanionHello({
        role: "companion",
        surface,
        companionInstanceId,
        targetPrimaryInstanceId: null,
      }));
    } catch {
      // The status remains disconnected and heartbeat retries discovery.
    }
    const ping = globalThis.setInterval(() => {
      if (leaving) return;
      if (
        lastPrimaryActivityAt > 0
        && Date.now() - lastPrimaryActivityAt >= PRIMARY_STALE_AFTER_MS
      ) expirePrimary();
      const targetPrimary = targetPrimaryInstanceIdRef.current;
      if (!targetPrimary) {
        try {
          channel.postMessage(buildStudioCompanionHello({
            role: "companion",
            surface,
            companionInstanceId,
            targetPrimaryInstanceId: null,
          }));
        } catch {
          // Retry later.
        }
        return;
      }
      const nonce = createStudioCompanionCommandId();
      pendingPingNonceRef.current = nonce;
      try {
        channel.postMessage(buildStudioCompanionPing({
          companionInstanceId,
          targetPrimaryInstanceId: targetPrimary,
          nonce,
        }));
      } catch {
        // Liveness expiry handles a detached peer.
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      screenPlacementEpochRef.current += 1;
      window.removeEventListener("pagehide", onCompanionPageHide);
      globalThis.clearInterval(ping);
      leaveCompanion();
      channel.onmessage = null;
      try {
        channel.close();
      } catch {
        // Ignore a channel already closed by the browser.
      }
      if (channelRef.current === channel) channelRef.current = null;
      if (companionInstanceIdRef.current === companionInstanceId) {
        companionInstanceIdRef.current = null;
      }
      if (presentationSafeGuardRef.current === presentationSafeGuard) {
        presentationSafeGuard.reset();
        presentationSafeGuardRef.current = null;
      }
      if (releaseNavigatorDemandRef.current === releasePresentationSafeNavigatorDemand) {
        releaseNavigatorDemandRef.current = () => undefined;
      }
      if (releaseReferenceDemandRef.current === releasePresentationSafeReferenceDemand) {
        releaseReferenceDemandRef.current = () => undefined;
      }
      targetPrimaryInstanceIdRef.current = null;
      pendingPingNonceRef.current = null;
      commandSequenceRef.current = 0;
      clearReviewState();
    };
  }, [
    applyPresentationSafe,
    clearPendingBrushControl,
    clearPendingNavigatorControl,
    clearReviewState,
    companionDocumentScopeKey,
    sessionId,
    surface,
    t,
  ]);

  function sendCommand(command: StudioCompanionCommandName) {
    const companionInstanceId = companionInstanceIdRef.current;
    const targetPrimary = targetPrimaryInstanceIdRef.current;
    if (!connected || !companionInstanceId || !targetPrimary) return;
    commandSequenceRef.current += 1;
    const sent = post(buildStudioCompanionCommand({
      command,
      companionInstanceId,
      targetPrimaryInstanceId: targetPrimary,
      commandId: createStudioCompanionCommandId(),
      sequence: commandSequenceRef.current,
    }));
    if (
      sent
      && command !== "focus-primary"
      && command !== "toggle-canvas-only"
      && command !== "enter-canvas-only"
      && command !== "exit-canvas-only"
    ) {
      setActiveTool(command);
    }
  }

  async function moveToAnotherScreen() {
    const placementEpoch = screenPlacementEpochRef.current + 1;
    screenPlacementEpochRef.current = placementEpoch;
    setScreenPlacementStatus({
      kind: "requesting",
      text: localizeText(
        t,
        "연결된 화면을 확인하고 있습니다…",
        "studio.toolsCompanion.screenPlacement.requesting"
      ),
    });
    const screenWindow = window as WindowWithScreenDetails;
    if (typeof screenWindow.getScreenDetails !== "function") {
      setScreenPlacementStatus({
        kind: "unsupported",
        text: localizeText(
          t,
          "이 브라우저는 자동 창 배치를 지원하지 않습니다. 창 제목 표시줄을 끌어 직접 옮겨 주세요.",
          "studio.toolsCompanion.screenPlacement.unsupported"
        ),
      });
      return;
    }
    try {
      const details = await withTimeout(
        screenWindow.getScreenDetails(),
        SCREEN_DETAILS_TIMEOUT_MS
      );
      if (screenPlacementEpochRef.current !== placementEpoch) return;
      const placement = planStudioCompanionExternalScreenPlacement({
        screens: details.screens,
        currentScreen: details.currentScreen,
        preferredWidth: effectiveSurface === "workspace"
          ? 520
          : effectiveSurface === "navigator"
            ? 390
            : 420,
        preferredHeight: effectiveSurface === "workspace" ? 820 : 860,
      });
      if (!placement) {
        setScreenPlacementStatus({
          kind: "no-secondary",
          text: localizeText(
            t,
            "사용 가능한 다른 화면을 찾지 못했습니다. 화면 연결 상태를 확인해 주세요.",
            "studio.toolsCompanion.screenPlacement.noSecondary"
          ),
        });
        return;
      }
      window.moveTo(placement.left, placement.top);
      window.resizeTo(placement.width, placement.height);
      companionWindowLayout.notifyManualPlacement();
      try {
        window.focus();
      } catch {
        // A valid detached window remains usable when focus() is denied.
      }
      setScreenPlacementStatus({
        kind: "requested",
        text: localizeText(
          t,
          "다른 화면으로 이동을 요청했습니다.",
          "studio.toolsCompanion.screenPlacement.requested"
        ),
      });
    } catch (error) {
      if (screenPlacementEpochRef.current !== placementEpoch) return;
      const errorName = error instanceof DOMException ? error.name : "";
      const timedOut = error instanceof Error && error.message === "timeout";
      setScreenPlacementStatus(
        errorName === "NotAllowedError"
          ? {
              kind: "denied",
              text: localizeText(
                t,
                "창 관리 권한이 필요합니다. 주소창의 사이트 설정에서 권한을 허용하거나 직접 옮겨 주세요.",
                "studio.toolsCompanion.screenPlacement.denied"
              ),
            }
          : timedOut
            ? {
                kind: "timeout",
                text: localizeText(
                  t,
                  "화면 정보를 받지 못했습니다. 다시 시도하거나 창 제목 표시줄을 끌어 옮겨 주세요.",
                  "studio.toolsCompanion.screenPlacement.timeout"
                ),
              }
            : {
                kind: "failed",
                text: localizeText(
                  t,
                  "화면 이동을 요청하지 못했습니다. 창 제목 표시줄을 끌어 직접 옮겨 주세요.",
                  "studio.toolsCompanion.screenPlacement.failed"
                ),
              }
      );
    }
  }

  function openDedicatedSurface(nextSurface: DedicatedCompanionSurface): boolean {
    if (!sessionId || companionDocumentScopeKey === null || surface !== "workspace") return false;
    // This must remain synchronous so the user activation reaches window.open before it expires.
    const companionWindow = openStudioCompanionSurfaceWindow(
      sessionId,
      nextSurface,
      dedicatedWindowRefs.current[nextSurface],
      undefined,
      companionWorkId,
    );
    if (!companionWindow) return false;
    dedicatedWindowRefs.current[nextSurface] = companionWindow;
    return true;
  }

  const activeWorkspacePreset: StudioCompanionWorkspacePresetId | null = !interactionReady
    ? null
    : mode === "tools" && primaryCanvasOnly
      ? "draw"
      : mode === "navigator" && primaryCanvasOnly
        ? "navigate"
        : mode === "review" && !primaryCanvasOnly
          ? "review"
          : mode === "reference" && primaryCanvasOnly
            ? "reference"
          : null;
  function applyWorkspacePreset(preset: StudioCompanionWorkspacePresetId): void {
    if (!interactionReady || effectiveSurface !== "workspace") return;
    if (preset === "draw") {
      setMode("tools");
      sendCommand("enter-canvas-only");
      return;
    }
    if (preset === "navigate") {
      setMode("navigator");
      sendCommand("enter-canvas-only");
      return;
    }
    if (preset === "reference") {
      setMode("reference");
      sendCommand("enter-canvas-only");
      return;
    }
    setMode("review");
    sendCommand("exit-canvas-only");
  }
  const titleStudio = localizeText(t, "스튜디오", "studio.toolsCompanion.title.studio");
  const visiblePrimaryTitle = presentationSafe ? titleStudio : primaryTitle;
  const navigatorSurfaceActive = effectiveSurface === "navigator"
    || (effectiveSurface === "workspace" && mode === "navigator");
  const syncNavigatorDemand = useEffectEvent((active: boolean) => {
    if (navigatorDemandActiveRef.current === active) return;
    if (!active) clearPendingNavigatorControl();
    const sent = sendControl({ kind: "navigator-demand", active });
    if (sent || !active) navigatorDemandActiveRef.current = active;
  });
  useEffect(() => {
    syncNavigatorDemand(
      interactionReady && projection !== null && navigatorSurfaceActive && !presentationSafe
    );
  }, [interactionReady, navigatorSurfaceActive, presentationSafe, projection]);
  const tabs: ReadonlyArray<{ id: CompanionMode; label: string; icon: typeof Palette }> = [
    {
      id: "tools",
      label: localizeText(t, "도구", "studio.toolsCompanion.mode.tools"),
      icon: Palette,
    },
    {
      id: "navigator",
      label: localizeText(t, "Navigator", "studio.toolsCompanion.mode.navigator"),
      icon: Map,
    },
    {
      id: "review",
      label: localizeText(t, "검수", "studio.toolsCompanion.mode.review"),
      icon: ListChecks,
    },
    {
      id: "reference",
      label: localizeText(t, "레퍼런스", "studio.toolsCompanion.mode.reference"),
      icon: Images,
    },
    {
      id: "assistant",
      label: "보조 툴킷",
      icon: WandSparkles,
    },
  ];
  const shellTitle = effectiveSurface === "workspace"
    ? visiblePrimaryTitle
    : effectiveSurface === "navigator"
      ? localizeText(t, "캔버스 내비게이터", "studio.toolsCompanion.surface.navigator")
      : effectiveSurface === "review"
        ? localizeText(t, "검수 콘솔", "studio.toolsCompanion.surface.review")
        : localizeText(t, "레퍼런스 화면", "studio.toolsCompanion.surface.reference");
  const referenceConnectionStatus = connected
    ? "connected"
    : targetPrimaryInstanceId
      ? "reconnecting"
      : "disconnected";
  const dedicatedLayout = effectiveSurface !== "workspace";
  const screenPlacementBusy = screenPlacementStatus?.kind === "requesting";
  const windowLayoutPersistenceStatus: StudioCompanionWindowLayoutPersistenceStatus =
    companionWindowLayout.status === "unsupported"
      ? "unsupported"
      : companionWindowLayout.sessionOnly
        ? "session-only"
        : "persistent";
  const windowLayoutAutomationNote =
    companionWindowLayout.status === "permission-required"
      ? t("studio.toolsCompanion.layoutSettings.permissionRequired")
      : companionWindowLayout.status === "permission-denied"
        ? t("studio.toolsCompanion.layoutSettings.permissionDenied")
        : companionWindowLayout.status === "stale-topology"
          ? t("studio.toolsCompanion.layoutSettings.staleTopology")
          : companionWindowLayout.status === "restore-failed"
            ? t("studio.toolsCompanion.layoutSettings.restoreFailed")
            : companionWindowLayout.synchronizationDegraded
              ? localizeText(
                t,
                "창 간 배치 동기화를 사용할 수 없어 이 창은 SQLite 저장본만 사용합니다.",
                "studio.toolsCompanion.layoutSettings.liveSyncDegraded",
              )
              : null;
  const windowLayoutSettings = (
    <>
      <StudioCompanionWindowLayoutControls
        surface={effectiveSurface}
        enabled={companionWindowLayout.rememberEnabled}
        disabled={!interactionReady}
        hasSavedLayout={companionWindowLayout.hasSaved}
        persistenceStatus={windowLayoutPersistenceStatus}
        onEnabledChange={companionWindowLayout.setRememberEnabled}
        onCapture={companionWindowLayout.notifyManualPlacement}
        onClear={companionWindowLayout.resetSavedLayout}
      />
      {windowLayoutAutomationNote ? (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-2 text-[0.66rem] leading-relaxed text-warn">
          {windowLayoutAutomationNote}
        </p>
      ) : null}
    </>
  );

  function handleModeTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    setMode(next.id);
    globalThis.requestAnimationFrame?.(() => {
      document.getElementById(`companion-mode-tab-${next.id}`)?.focus();
    });
  }

  return (
    <div
      data-testid="studio-tools-companion-root"
      data-companion-surface={effectiveSurface}
      data-presentation-safe-authority={presentationSafeTransport}
      className="flex h-dvh min-h-0 flex-col overflow-x-hidden overflow-y-auto bg-canvas text-fg [--studio-safe-bottom:env(safe-area-inset-bottom)] [--studio-safe-left:env(safe-area-inset-left)] [--studio-safe-right:env(safe-area-inset-right)] [--studio-safe-top:env(safe-area-inset-top)]"
    >
      <header className="sticky top-0 z-20 border-b border-line bg-panel/95 pb-2 backdrop-blur-xl [padding-left:max(0.75rem,var(--studio-safe-left))] [padding-right:max(0.75rem,var(--studio-safe-right))] [padding-top:max(0.65rem,var(--studio-safe-top))]">
        <div className="flex items-start gap-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent-soft text-accent">
            <MonitorSmartphone className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[0.9rem] font-semibold tracking-tight">{shellTitle}</h1>
          <p role="status" aria-live="polite" className="mt-0.5 truncate text-xs text-fg-2">
            {interactionReady ? (
              <span className="text-good">
                {presentationSafe
                  ? t("studio.toolsCompanion.status.connectedPresentationSafe")
                  : effectiveSurface === "workspace"
                    ? tText(
                      t,
                      "연결됨 · {primaryTitle}",
                      "studio.toolsCompanion.status.connectedWithPrimary",
                      { primaryTitle: visiblePrimaryTitle },
                    )
                    : t("studio.toolsCompanion.status.connectedStudio")
                }
              </span>
            ) : (
              <span className="text-warn">{t("studio.toolsCompanion.status.waiting")}</span>
            )}
            <span className="text-fg-3">
              {tText(
                t,
                "· 밀도 {density}",
                "studio.toolsCompanion.status.density",
                { density },
              )}
            </span>
          </p>
          </div>
          <button
            type="button"
            disabled={!sessionId}
            aria-label={presentationSafe
              ? t("studio.toolsCompanion.presentationSafe.toggleOff")
              : t("studio.toolsCompanion.presentationSafe.toggleOn")
            }
            aria-pressed={presentationSafe}
            title={presentationSafe
              ? t("studio.toolsCompanion.presentationSafe.toggleOff")
              : t("studio.toolsCompanion.presentationSafe.toggleOn")
            }
            onClick={() => changePresentationSafe(!presentationSafe)}
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl border outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:opacity-45",
              presentationSafe
                ? "border-good/45 bg-good/10 text-good"
                : "border-line bg-card text-fg-2 hover:bg-raised"
            )}
          >
            {presentationSafe
              ? <EyeOff className="size-4" aria-hidden />
              : <Eye className="size-4" aria-hidden />}
          </button>
          <button
            type="button"
            disabled={screenPlacementBusy}
            aria-busy={screenPlacementBusy}
            aria-label={screenPlacementBusy
              ? t("studio.toolsCompanion.layoutSettings.moveBusy")
              : t("studio.toolsCompanion.layoutSettings.moveToAnotherScreen")
            }
            title={t("studio.toolsCompanion.layoutSettings.moveToAnotherScreen")}
            onClick={() => void moveToAnotherScreen()}
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-2 outline-none transition-colors motion-reduce:transition-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-wait disabled:opacity-60"
          >
            {screenPlacementBusy
              ? <LoaderCircle className="size-4 motion-safe:animate-spin motion-reduce:animate-none" aria-hidden />
              : <MonitorUp className="size-4" aria-hidden />}
          </button>
        </div>
        {effectiveSurface === "workspace" ? (
          <div
            role="tablist"
            className="mt-2 grid grid-cols-5 gap-1 rounded-xl border border-line bg-card p-1"
            aria-label={t("studio.toolsCompanion.modeTabAria")}
          >
            {tabs.map(({ id, label, icon: Icon }, index) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`companion-mode-tab-${id}`}
                aria-label={label}
                aria-selected={mode === id}
                aria-controls={`companion-mode-panel-${id}`}
                tabIndex={mode === id ? 0 : -1}
                onClick={() => setMode(id)}
                onKeyDown={(event) => handleModeTabKeyDown(event, index)}
                className={cn(
                  "inline-flex min-h-11 min-w-0 items-center justify-center gap-1 overflow-hidden rounded-lg px-1 text-xs font-semibold outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-accent/35 min-[390px]:gap-1.5 min-[390px]:px-2",
                  mode === id ? "bg-raised text-fg shadow-sm" : "text-fg-3 hover:text-fg-2"
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="hidden min-w-0 truncate min-[390px]:inline">{label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <main className={cn(
        "mx-auto w-full max-w-xl pt-4 [padding-bottom:max(1rem,var(--studio-safe-bottom))] [padding-left:max(0.75rem,var(--studio-safe-left))] [padding-right:max(0.75rem,var(--studio-safe-right))]",
        dedicatedLayout ? "flex min-h-0 flex-1 flex-col gap-4" : "space-y-4"
      )}>
        {lastError ? (
          <p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            {lastError}
          </p>
        ) : null}
        {/*
          막다른 상태의 문.

          처음에는 `lastError` 안에만 뒀는데, 그러면 실제로 갇히는 경우를 놓친다. 세션 ID 가
          형식상 유효하면 BroadcastChannel 생성이 성공해서 `lastError` 는 계속 null 이고,
          기본 탭이 하나도 응답하지 않아도 `expirePrimary` 는 `connected` 만 내린다 — 에러가
          영원히 없는 채로 연결만 안 되는 상태다. 그래서 조건은 에러가 아니라 `interactionReady` 다.

          팝업을 열 수 있는 환경에서는 내보내지 않는다. 거기서 이 페이지는 기본 스튜디오가 띄운
          팝업이라 사용자는 창을 닫으면 되고, 같은 탭 이동은 도구 창을 두 번째 편집기로 바꿔
          버린다. 문이 필요한 쪽은 창 크롬도 주소창도 없는 인앱 브라우저다.
        */}
        {!interactionReady && !canOpenAuxiliaryWindow ? (
          <div className="shrink-0 rounded-xl border border-line/70 bg-card/55 px-3 py-2.5">
            <p className="text-xs text-fg-2">
              {localizeText(
                t,
                "기본 스튜디오와 연결되지 않았습니다.",
                "studio.toolsCompanion.exit.disconnected",
              )}
            </p>
            <Link
              href="/studio"
              data-studio-route-exit="editor"
              className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {localizeText(t, "Studio 편집기 열기", "studio.toolsCompanion.exit.editor")}
            </Link>
          </div>
        ) : null}
        {screenPlacementStatus ? (
          <p
            role={screenPlacementStatus.kind === "requesting"
              || screenPlacementStatus.kind === "requested"
              || screenPlacementStatus.kind === "restored"
              ? "status"
              : "alert"}
            aria-live={screenPlacementStatus.kind === "requesting"
              || screenPlacementStatus.kind === "requested"
              || screenPlacementStatus.kind === "restored"
              ? "polite"
              : undefined}
            className={cn(
              "rounded-xl border px-3 py-2 text-xs",
              screenPlacementStatus.kind === "requested" || screenPlacementStatus.kind === "restored"
                ? "border-good/35 bg-good/10 text-good"
                : screenPlacementStatus.kind === "requesting"
                  ? "border-line bg-card text-fg-2"
                  : "border-warn/35 bg-warn/10 text-warn"
            )}
          >
            {screenPlacementStatus.text}
          </p>
        ) : null}
        {!interactionReady && sessionId && dedicatedLayout ? (
          <a
            href={studioCompanionPrimaryUrl(
              sessionId,
              typeof window !== "undefined" ? window.location.origin : "",
              location.search
            )}
            {...reconnectTargetProps}
            className={cn(buttonClass({ size: "sm", variant: "solid" }), "min-h-11 justify-start gap-2 no-underline")}
          >
            <WandSparkles className="size-3.5" aria-hidden />
            {t("studio.toolsCompanion.surfaceTools.reconnect")}
          </a>
        ) : null}

        {dedicatedLayout ? (
          <details className="group shrink-0 rounded-xl border border-line/70 bg-card/55 p-1.5">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-2.5 text-xs font-semibold text-fg-2 outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/35 [&::-webkit-details-marker]:hidden">
              {t("studio.toolsCompanion.layoutSettings.title")}
              <span className="text-[0.64rem] font-medium text-fg-3 group-open:hidden">
                {t("studio.toolsCompanion.layoutSettings.expand")}
              </span>
              <span className="hidden text-[0.64rem] font-medium text-fg-3 group-open:inline">
                {t("studio.toolsCompanion.layoutSettings.collapse")}
              </span>
            </summary>
            <div className="space-y-1.5 pt-1.5">{windowLayoutSettings}</div>
          </details>
        ) : null}

        {effectiveSurface === "workspace" ? (
          <div
            role="tabpanel"
            id="companion-mode-panel-tools"
            aria-labelledby="companion-mode-tab-tools"
            hidden={mode !== "tools"}
            className="space-y-4"
          >
            <section aria-label={t("studio.toolsCompanion.toolsTab")} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-3">
                {t("studio.toolsCompanion.toolsTab")}
              </p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {STUDIO_COMPANION_TOOL_ORDER.map((tool) => {
                  const active = activeTool === tool;
                  return (
                    <button
                      key={tool}
                      type="button"
                      disabled={!interactionReady}
                      aria-pressed={active}
                      onClick={() => sendCommand(tool)}
                      className={cn(
                        "min-h-11 rounded-xl border px-3 py-2.5 text-left text-[0.78rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        active
                          ? "border-accent/50 bg-accent-soft text-fg ring-1 ring-accent/25"
                          : "border-line/60 bg-card text-fg-2 hover:bg-raised"
                      )}
                    >
                      {localizeText(
                        t,
                        STUDIO_COMPANION_TOOL_LABELS[tool],
                        STUDIO_COMPANION_TOOL_LABEL_KEYS[tool],
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-3">
                {t("studio.toolsCompanion.surfaceTab")}
              </p>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  disabled={!interactionReady}
                  onClick={() => sendCommand("focus-primary")}
                className={cn(buttonClass({ size: "sm", variant: "outline" }), "min-h-11 justify-start gap-2")}
              >
                <Sparkles className="size-3.5" aria-hidden />
                {t("studio.toolsCompanion.surfaceTools.focusPrimary")}
              </button>
                <button
                  type="button"
                  disabled={!interactionReady}
                  onClick={() => sendCommand("toggle-canvas-only")}
                className={cn(buttonClass({ size: "sm", variant: "quiet" }), "min-h-11 justify-start gap-2")}
              >
                <Layers className="size-3.5" aria-hidden />
                {t("studio.toolsCompanion.surfaceTools.toggleCanvas")}
              </button>
                {!interactionReady && sessionId ? (
                  <a
                    href={studioCompanionPrimaryUrl(
                      sessionId,
                      typeof window !== "undefined" ? window.location.origin : "",
                      location.search
                    )}
                    {...reconnectTargetProps}
                  className={cn(buttonClass({ size: "sm", variant: "solid" }), "min-h-11 justify-start gap-2 no-underline")}
                >
                  <WandSparkles className="size-3.5" aria-hidden />
                  {t("studio.toolsCompanion.surfaceTools.reconnect")}
                </a>
              ) : null}
            </div>
            </section>
            <StudioCompanionWorkspacePresets
              disabled={!interactionReady}
              activePreset={activeWorkspacePreset}
              onApplyPreset={applyWorkspacePreset}
            />
            {windowLayoutSettings}
            <StudioCompanionWindowManager
              disabled={!sessionId || surface !== "workspace"}
              onOpenSurface={openDedicatedSurface}
            />
          </div>
        ) : null}

        {effectiveSurface === "workspace" || effectiveSurface === "navigator" ? (
          <div
            role={effectiveSurface === "workspace" ? "tabpanel" : undefined}
            id="companion-mode-panel-navigator"
            aria-labelledby={effectiveSurface === "workspace" ? "companion-mode-tab-navigator" : undefined}
              aria-label={effectiveSurface === "navigator" ? t("studio.toolsCompanion.navigatorAria") : undefined}
            hidden={effectiveSurface === "workspace" && mode !== "navigator"}
            className={cn(dedicatedLayout && "flex min-h-0 flex-1 flex-col")}
          >
            {presentationSafe ? (
              <section className="grid min-h-64 flex-1 place-items-center rounded-xl border border-line bg-card px-5 text-center">
                <div className="max-w-64">
                  <EyeOff className="mx-auto size-6 text-fg-3" aria-hidden />
                  <h2 className="mt-3 text-sm font-semibold text-fg">
                    {t("studio.toolsCompanion.presentationSafe.navigatorTitle")}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-fg-3">
                    {t("studio.toolsCompanion.presentationSafe.navigatorDescription")}
                  </p>
                </div>
              </section>
            ) : (
              <StudioCompanionNavigator
                imageUrl={navigatorImage?.url ?? null}
                imageWidth={navigatorImage?.width ?? 0}
                imageHeight={navigatorImage?.height ?? 0}
                viewport={projection?.viewport ?? { x: 0, y: 0, width: 1, height: 1 }}
                connected={interactionReady}
                captureAllowed={projection?.captureAllowed ?? false}
                layout={dedicatedLayout ? "dedicated" : "embedded"}
                onNavigate={queueNavigatorControl}
              />
            )}
          </div>
        ) : null}

        {effectiveSurface === "workspace" || effectiveSurface === "review" ? (
          <div
            role={effectiveSurface === "workspace" ? "tabpanel" : undefined}
            id="companion-mode-panel-review"
            aria-labelledby={effectiveSurface === "workspace" ? "companion-mode-tab-review" : undefined}
            aria-label={effectiveSurface === "review" ? t("studio.toolsCompanion.reviewAria") : undefined}
            hidden={effectiveSurface === "workspace" && mode !== "review"}
            className={cn(dedicatedLayout && "flex min-h-0 flex-1 flex-col")}
          >
            <StudioCompanionReviewConsole
              projection={projection}
              connected={interactionReady}
              presentationSafe={presentationSafe}
              layout={dedicatedLayout ? "dedicated" : "embedded"}
              onSelectLayer={(layerId) => sendControl({ kind: "select-layer", layerId })}
              onHistory={(action) => sendControl({ kind: "history", action })}
              onCommentFocus={(threadId) => sendControl({ kind: "comment-focus", threadId })}
              onBrushPatch={queueBrushControl}
            />
          </div>
        ) : null}

        {effectiveSurface === "reference"
        || (effectiveSurface === "workspace" && mode === "reference") ? (
          <div
            role={effectiveSurface === "workspace" ? "tabpanel" : undefined}
            id="companion-mode-panel-reference"
            aria-labelledby={effectiveSurface === "workspace" ? "companion-mode-tab-reference" : undefined}
            aria-label={effectiveSurface === "reference" ? t("studio.toolsCompanion.referenceAria") : undefined}
            className={dedicatedLayout
              ? "flex min-h-[29rem] flex-1 flex-col"
              : "min-h-0"}
          >
            {presentationSafe ? (
              <section className="grid min-h-64 flex-1 place-items-center rounded-xl border border-line bg-card px-5 text-center">
                <div className="max-w-64">
                  <EyeOff className="mx-auto size-6 text-fg-3" aria-hidden />
                  <h2 className="mt-3 text-sm font-semibold text-fg">
                    {t("studio.toolsCompanion.presentationSafe.referenceTitle")}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-fg-3">
                    {t("studio.toolsCompanion.presentationSafe.referenceDescription")}
                  </p>
                </div>
              </section>
            ) : (
              <Suspense
                fallback={(
                  <div
                    role="status"
                    className="grid min-h-64 flex-1 place-items-center rounded-xl border border-line bg-card text-xs text-fg-3"
                  >
                    {t("studio.toolsCompanion.referenceLoading")}
                  </div>
                )}
              >
                <LazyStudioCompanionReferenceDisplay
                  projection={referenceProjection}
                  preview={referencePreview}
                  connectionStatus={referenceConnectionStatus}
                  latestColorResult={referenceColorResult}
                  connectionEpoch={referenceConnectionEpoch}
                  onControl={sendControl}
                />
              </Suspense>
            )}
          </div>
        ) : null}

        {effectiveSurface === "workspace" && mode === "assistant" ? (
          <div
            role="tabpanel"
            id="companion-mode-panel-assistant"
            aria-labelledby="companion-mode-tab-assistant"
            className={dedicatedLayout ? "flex min-h-[29rem] flex-1 flex-col" : "min-h-0"}
          >
            <StudioCompanionAssistantDisplay
              layout={dedicatedLayout ? "dedicated" : "embedded"}
            />
          </div>
        ) : null}

          <p className={cn("text-xs leading-relaxed text-fg-3", dedicatedLayout && "shrink-0")}>
            {t("studio.toolsCompanion.footer")}
          </p>
      </main>
    </div>
  );
}

export default StudioToolsCompanionPage;
