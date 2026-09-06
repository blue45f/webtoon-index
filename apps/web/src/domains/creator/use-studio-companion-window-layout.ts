import { useEffect, useRef, useState } from "react";

import {
  captureStudioCompanionWindowLayout,
  resolveStudioCompanionWindowPlacement,
  type StudioCompanionWindowLayoutSurface,
  type StudioCompanionWindowLayoutV1,
  type StudioCompanionWindowMetricsLike,
  type StudioCompanionWindowPlacement,
} from "./studio-companion-window-layout";
import {
  createStudioCompanionWindowPreferencesRuntime,
  type CreateStudioCompanionWindowPreferencesRuntimeOptions,
  type StudioCompanionWindowPreferencesAuthority,
  type StudioCompanionWindowPreferencesRuntime,
} from "./studio-companion-window-preferences-sqlite";

export const STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS = 1_000;
export const STUDIO_COMPANION_WINDOW_LAYOUT_RESIZE_DEBOUNCE_MS = 250;
export const STUDIO_COMPANION_WINDOW_LAYOUT_MAXIMIZED_TOLERANCE_PX = 16;
export const STUDIO_COMPANION_WINDOW_LAYOUT_RESTORE_TOLERANCE_PX = 24;
/** Pre-V12 key identifier retained only for explicit tests/destruction inventories. */
export const STUDIO_COMPANION_WINDOW_LAYOUT_REMEMBER_STORAGE_PREFIX =
  "toonspectrum.studio.companion-window-layout.remember.v1";

export function studioCompanionWindowLayoutRememberStorageKey(
  surface: StudioCompanionWindowLayoutSurface,
): string {
  return `${STUDIO_COMPANION_WINDOW_LAYOUT_REMEMBER_STORAGE_PREFIX}.${surface}`;
}
export type StudioCompanionWindowLayoutRuntimeStatus =
  | "disabled"
  | "waiting-for-binding"
  | "checking-permission"
  | "permission-required"
  | "permission-denied"
  | "unsupported"
  | "ready"
  | "settling"
  | "restored"
  | "restore-failed"
  | "saved"
  | "stale-topology"
  | "session-only";

export interface UseStudioCompanionWindowLayoutInput {
  surface: StudioCompanionWindowLayoutSurface;
  /** Runtime gate. Keep false for an embedded/non-detached surface. */
  enabled: boolean;
  /** A primary binding must own the companion before storage, restore, or capture starts. */
  interactionReady: boolean;
  initialRememberEnabled?: boolean;
  onStatusChange?: (status: StudioCompanionWindowLayoutRuntimeStatus) => void;
  onSaved?: (layout: StudioCompanionWindowLayoutV1, sessionOnly: boolean) => void;
  onRestored?: (placement: StudioCompanionWindowPlacement) => void;
  onTopologyStale?: () => void;
  /** Deterministic test seam; product callers use SQLite/OPFS + BroadcastChannel. */
  preferencesRuntimeFactory?: (
    options: CreateStudioCompanionWindowPreferencesRuntimeOptions,
  ) => StudioCompanionWindowPreferencesRuntime;
}

export interface UseStudioCompanionWindowLayoutResult {
  status: StudioCompanionWindowLayoutRuntimeStatus;
  hasSaved: boolean;
  rememberEnabled: boolean;
  sessionOnly: boolean;
  persistenceAuthority: StudioCompanionWindowPreferencesAuthority;
  synchronizationDegraded: boolean;
  /**
   * Call after an explicit user placement action has issued moveTo()/resizeTo(). The hook then
   * re-checks an already-granted permission and waits for two stable samples before persisting.
   */
  notifyManualPlacement: () => void;
  resetSavedLayout: () => void;
  setRememberEnabled: (enabled: boolean) => void;
  toggleRememberEnabled: () => void;
}

type WindowManagementPermissionStatusLike = {
  state: PermissionState;
  addEventListener?: (type: "change", listener: EventListener) => void;
  removeEventListener?: (type: "change", listener: EventListener) => void;
};

type WindowManagementPermissionsLike = {
  query: (descriptor: { name: string }) => Promise<WindowManagementPermissionStatusLike>;
};

type StudioCompanionScreenDetailsLike = {
  screens: readonly unknown[];
  currentScreen?: unknown;
  addEventListener?: (type: "screenschange", listener: EventListener) => void;
  removeEventListener?: (type: "screenschange", listener: EventListener) => void;
};

type StudioCompanionLayoutWindow = Window & {
  getScreenDetails?: () => Promise<StudioCompanionScreenDetailsLike>;
};

type StableSample = {
  key: string;
  metrics: StudioCompanionWindowMetricsLike;
};

type SettleKind = "restore" | "manual";

type SurfaceLifetimeState = {
  restoreAttempted: boolean;
  topologyFingerprint: string | null;
  topologyStale: boolean;
};

function readWindowMetrics(source: Window): StudioCompanionWindowMetricsLike | null {
  try {
    const values = [source.screenX, source.screenY, source.outerWidth, source.outerHeight];
    if (values.some((value) => !Number.isFinite(value))) return null;
    if (source.outerWidth < 1 || source.outerHeight < 1) return null;
    return {
      screenX: Math.round(source.screenX),
      screenY: Math.round(source.screenY),
      outerWidth: Math.round(source.outerWidth),
      outerHeight: Math.round(source.outerHeight),
    };
  } catch {
    return null;
  }
}

function metricsKey(metrics: StudioCompanionWindowMetricsLike): string {
  return `${metrics.screenX}:${metrics.screenY}:${metrics.outerWidth}:${metrics.outerHeight}`;
}

function finiteScreenField(screen: unknown, key: string): number | null {
  if (!screen || (typeof screen !== "object" && typeof screen !== "function")) return null;
  try {
    const value = (screen as Record<string, unknown>)[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function optionalScreenField(screen: unknown, key: string): string {
  if (!screen || (typeof screen !== "object" && typeof screen !== "function")) return "null";
  try {
    const value = (screen as Record<string, unknown>)[key];
    return typeof value === "boolean" ? String(value) : "null";
  } catch {
    return "null";
  }
}

function screenTopologyFingerprint(rawScreens: readonly unknown[]): string | null {
  const screens = Array.from(rawScreens);
  if (screens.length === 0) return null;
  const keys: string[] = [];
  for (const screen of screens) {
    const geometry = ["availLeft", "availTop", "availWidth", "availHeight"]
      .map((key) => finiteScreenField(screen, key));
    if (geometry.some((value) => value === null)) return null;
    const dpr = finiteScreenField(screen, "devicePixelRatio");
    keys.push([
      ...geometry,
      dpr ?? "null",
      optionalScreenField(screen, "isPrimary"),
      optionalScreenField(screen, "isInternal"),
    ].join(":"));
  }
  return keys.sort().join("|");
}

function screenList(details: StudioCompanionScreenDetailsLike): readonly unknown[] {
  try {
    return Array.from(details.screens);
  } catch {
    return [];
  }
}

function placementMatchesMetrics(
  placement: StudioCompanionWindowPlacement,
  metrics: StudioCompanionWindowMetricsLike
): boolean {
  const tolerance = STUDIO_COMPANION_WINDOW_LAYOUT_RESTORE_TOLERANCE_PX;
  return Math.abs(metrics.screenX - placement.left) <= tolerance
    && Math.abs(metrics.screenY - placement.top) <= tolerance
    && Math.abs(metrics.outerWidth - placement.width) <= tolerance
    && Math.abs(metrics.outerHeight - placement.height) <= tolerance;
}

function isFullscreenOrMaximized(
  metrics: StudioCompanionWindowMetricsLike,
  details: StudioCompanionScreenDetailsLike
): boolean {
  try {
    if (document.fullscreenElement) return true;
  } catch {
    return true;
  }
  const tolerance = STUDIO_COMPANION_WINDOW_LAYOUT_MAXIMIZED_TOLERANCE_PX;
  return screenList(details).some((screen) => {
    const left = finiteScreenField(screen, "availLeft");
    const top = finiteScreenField(screen, "availTop");
    const width = finiteScreenField(screen, "availWidth");
    const height = finiteScreenField(screen, "availHeight");
    if (left === null || top === null || width === null || height === null) return false;
    return Math.abs(metrics.screenX - left) <= tolerance
      && Math.abs(metrics.screenY - top) <= tolerance
      && metrics.outerWidth >= width - tolerance
      && metrics.outerHeight >= height - tolerance;
  });
}

/**
 * Device-local placement lifecycle for a detached Studio companion.
 *
 * Permission is only queried here. `getScreenDetails()` is never called while the permission is
 * prompt/denied, so this hook cannot create an automatic permission prompt.
 */
export function useStudioCompanionWindowLayout({
  surface,
  enabled,
  interactionReady,
  initialRememberEnabled = false,
  onStatusChange,
  onSaved,
  onRestored,
  onTopologyStale,
  preferencesRuntimeFactory = createStudioCompanionWindowPreferencesRuntime,
}: UseStudioCompanionWindowLayoutInput): UseStudioCompanionWindowLayoutResult {
  const [status, setStatus] = useState<StudioCompanionWindowLayoutRuntimeStatus>("disabled");
  const [hasSaved, setHasSaved] = useState(false);
  const [rememberEnabled, setRememberEnabledState] = useState(initialRememberEnabled);
  const [sessionOnly, setSessionOnly] = useState(false);
  const [persistenceAuthority, setPersistenceAuthority] =
    useState<StudioCompanionWindowPreferencesAuthority>("loading");
  const [synchronizationDegraded, setSynchronizationDegraded] = useState(false);
  const statusRef = useRef(status);
  const rememberEnabledRef = useRef(rememberEnabled);
  rememberEnabledRef.current = rememberEnabled;
  const activeSurfaceRef = useRef(surface);
  const sessionPreferencesRef = useRef(new Map<
    StudioCompanionWindowLayoutSurface,
    { rememberEnabled: boolean; layout: StudioCompanionWindowLayoutV1 | null }
  >());
  const surfaceLifetimeStateRef = useRef(
    new Map<StudioCompanionWindowLayoutSurface, SurfaceLifetimeState>()
  );
  const callbacksRef = useRef({ onStatusChange, onSaved, onRestored, onTopologyStale });
  const notifyManualPlacementRef = useRef<() => void>(() => undefined);
  const resetSavedLayoutRef = useRef<() => void>(() => undefined);
  const setRememberEnabledRef = useRef<(next: boolean) => void>((next) => {
    setRememberEnabledState(next);
  });
  callbacksRef.current = { onStatusChange, onSaved, onRestored, onTopologyStale };

  useEffect(() => {
    let disposed = false;
    let permissionEpoch = 0;
    let permissionStatus: WindowManagementPermissionStatusLike | null = null;
    let permissionChangeListener: EventListener | null = null;
    let details: StudioCompanionScreenDetailsLike | null = null;
    let screensChangeListener: EventListener | null = null;
    let surfaceLifetimeState = surfaceLifetimeStateRef.current.get(surface);
    if (!surfaceLifetimeState) {
      surfaceLifetimeState = {
        restoreAttempted: false,
        topologyFingerprint: null,
        topologyStale: false,
      };
      surfaceLifetimeStateRef.current.set(surface, surfaceLifetimeState);
    }
    let topologyFingerprint = surfaceLifetimeState.topologyFingerprint;
    let topologyStale = surfaceLifetimeState.topologyStale;
    let restoreAttempted = surfaceLifetimeState.restoreAttempted;
    let manualPlacementRequested = false;
    let settleKind: SettleKind | null = null;
    let pendingRestoredPlacement: StudioCompanionWindowPlacement | null = null;
    let candidate: StableSample | null = null;
    let stableSampleCount = 0;
    let lastStable: StableSample | null = null;
    let lastSavedMetricsKey: string | null = null;
    let pollTimer: ReturnType<typeof globalThis.setInterval> | null = null;
    let resizeTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let persistenceSessionOnly = false;
    let persistenceHydrated = false;
    const surfaceChanged = activeSurfaceRef.current !== surface;
    const sessionPreference = sessionPreferencesRef.current.get(surface);
    let rememberEnabledCurrent = sessionPreference?.rememberEnabled
      ?? (surfaceChanged ? initialRememberEnabled : rememberEnabledRef.current);
    let savedLayout: StudioCompanionWindowLayoutV1 | null = sessionPreference?.layout ?? null;
    let preferencesRuntime: StudioCompanionWindowPreferencesRuntime | null = null;
    let unsubscribePreferences: (() => void) | null = null;

    if (surfaceChanged) {
      activeSurfaceRef.current = surface;
      setHasSaved(false);
      setSessionOnly(false);
      setPersistenceAuthority("loading");
      setSynchronizationDegraded(false);
    }

    const publishStatus = (next: StudioCompanionWindowLayoutRuntimeStatus) => {
      if (disposed || statusRef.current === next) return;
      statusRef.current = next;
      setStatus(next);
      callbacksRef.current.onStatusChange?.(next);
    };

    const publishReadyStatus = (next: "ready" | "saved") => {
      publishStatus(persistenceSessionOnly ? "session-only" : next);
    };

    const clearPermissionListener = () => {
      if (permissionStatus && permissionChangeListener) {
        permissionStatus.removeEventListener?.("change", permissionChangeListener);
      }
      permissionStatus = null;
      permissionChangeListener = null;
    };

    const clearDetailsListener = () => {
      if (details && screensChangeListener) {
        details.removeEventListener?.("screenschange", screensChangeListener);
      }
      details = null;
      screensChangeListener = null;
    };

    const stopPolling = () => {
      if (pollTimer !== null) {
        globalThis.clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const cancelPlacementAttempt = () => {
      manualPlacementRequested = false;
      settleKind = null;
      pendingRestoredPlacement = null;
      candidate = null;
      stableSampleCount = 0;
      lastStable = null;
      stopPolling();
      clearDetailsListener();
    };

    const markSessionOnly = () => {
      persistenceSessionOnly = true;
      setSessionOnly(true);
      setPersistenceAuthority("memory-only");
    };

    const persistStableMetrics = (
      stable: StableSample,
      completedSettle: SettleKind | null = null
    ) => {
      if (
        disposed
        || !rememberEnabledCurrent
        || topologyStale
        || !details
        || (stable.key === lastSavedMetricsKey && completedSettle === null)
      ) return;
      const restoredPlacement = completedSettle === "restore"
        ? pendingRestoredPlacement
        : null;
      if (
        completedSettle === "restore"
        && (!restoredPlacement || !placementMatchesMetrics(restoredPlacement, stable.metrics))
      ) {
        pendingRestoredPlacement = null;
        lastSavedMetricsKey = stable.key;
        publishStatus("restore-failed");
        return;
      }
      if (isFullscreenOrMaximized(stable.metrics, details)) {
        lastSavedMetricsKey = stable.key;
        if (restoredPlacement) {
          callbacksRef.current.onRestored?.(restoredPlacement);
          pendingRestoredPlacement = null;
          publishStatus("restored");
        } else {
          publishReadyStatus("ready");
        }
        return;
      }
      const screens = screenList(details);
      const layout = captureStudioCompanionWindowLayout({
        surface,
        windowMetrics: stable.metrics,
        screens,
        currentScreen: details.currentScreen,
        now: Date.now(),
      });
      if (!layout) return;
      const storedLayout = preferencesRuntime?.setLayout(layout).layout ?? layout;
      savedLayout = storedLayout;
      lastSavedMetricsKey = stable.key;
      setHasSaved(true);
      callbacksRef.current.onSaved?.(storedLayout, persistenceSessionOnly);
      if (restoredPlacement) {
        callbacksRef.current.onRestored?.(restoredPlacement);
        pendingRestoredPlacement = null;
        publishStatus("restored");
      } else {
        publishReadyStatus("saved");
      }
    };

    const acceptSample = (metrics: StudioCompanionWindowMetricsLike) => {
      const key = metricsKey(metrics);
      if (candidate?.key === key) {
        stableSampleCount += 1;
      } else {
        candidate = { key, metrics };
        stableSampleCount = 1;
      }
      if (stableSampleCount < 2 || !candidate) return;
      lastStable = candidate;
      const completedSettle = settleKind;
      settleKind = null;
      persistStableMetrics(candidate, completedSettle);
    };

    const sampleGeometry = (allowHidden = false) => {
      if (
        disposed
        || !rememberEnabledCurrent
        || topologyStale
        || !details
        || (!allowHidden && document.visibilityState !== "visible")
      ) return;
      const metrics = readWindowMetrics(window);
      if (metrics) acceptSample(metrics);
    };

    const startPolling = () => {
      stopPolling();
      if (
        disposed
        || !rememberEnabledCurrent
        || topologyStale
        || !details
        || document.visibilityState !== "visible"
      ) return;
      sampleGeometry();
      pollTimer = globalThis.setInterval(
        () => sampleGeometry(),
        STUDIO_COMPANION_WINDOW_LAYOUT_POLL_MS
      );
    };

    const flushStableGeometry = () => {
      if (disposed || !rememberEnabledCurrent || topologyStale || settleKind !== null || !details) return;
      const current = readWindowMetrics(window);
      if (current) acceptSample(current);
      if (stableSampleCount < 2 && lastStable) persistStableMetrics(lastStable);
    };

    const markTopologyStale = () => {
      const wasAlreadyStale = topologyStale;
      topologyStale = true;
      surfaceLifetimeState.topologyStale = true;
      settleKind = null;
      pendingRestoredPlacement = null;
      candidate = null;
      stableSampleCount = 0;
      stopPolling();
      publishStatus("stale-topology");
      if (!wasAlreadyStale) callbacksRef.current.onTopologyStale?.();
    };

    const installDetails = (
      nextDetails: StudioCompanionScreenDetailsLike,
      afterManualPlacement: boolean
    ) => {
      const screens = screenList(nextDetails);
      const nextFingerprint = screenTopologyFingerprint(screens);
      if (!nextFingerprint) {
        cancelPlacementAttempt();
        publishStatus("unsupported");
        return;
      }

      clearDetailsListener();
      details = nextDetails;
      screensChangeListener = () => {
        if (!details) return;
        const changedFingerprint = screenTopologyFingerprint(screenList(details));
        if (!changedFingerprint || changedFingerprint !== topologyFingerprint) {
          markTopologyStale();
        }
      };
      details.addEventListener?.("screenschange", screensChangeListener);

      if (topologyStale && !afterManualPlacement) {
        publishStatus("stale-topology");
        return;
      }

      if (
        topologyFingerprint !== null
        && nextFingerprint !== topologyFingerprint
        && !afterManualPlacement
      ) {
        markTopologyStale();
        return;
      }
      topologyFingerprint = nextFingerprint;
      surfaceLifetimeState.topologyFingerprint = nextFingerprint;
      topologyStale = false;
      surfaceLifetimeState.topologyStale = false;

      if (afterManualPlacement) {
        manualPlacementRequested = false;
        restoreAttempted = true;
        surfaceLifetimeState.restoreAttempted = true;
        settleKind = "manual";
        candidate = null;
        stableSampleCount = 0;
        lastStable = null;
        publishStatus("settling");
        startPolling();
        return;
      }

      if (!restoreAttempted && savedLayout) {
        restoreAttempted = true;
        surfaceLifetimeState.restoreAttempted = true;
        const placement = resolveStudioCompanionWindowPlacement({
          layout: savedLayout,
          surface,
          screens,
          now: Date.now(),
        });
        if (!placement) {
          markTopologyStale();
          return;
        }
        settleKind = "restore";
        pendingRestoredPlacement = placement;
        candidate = null;
        stableSampleCount = 0;
        lastStable = null;
        publishStatus("settling");
        try {
          window.moveTo(placement.left, placement.top);
          window.resizeTo(placement.width, placement.height);
        } catch {
          settleKind = null;
          pendingRestoredPlacement = null;
          markTopologyStale();
          return;
        }
        startPolling();
        return;
      }

      restoreAttempted = true;
      surfaceLifetimeState.restoreAttempted = true;
      publishReadyStatus("ready");
      startPolling();
    };

    const refreshPermission = async () => {
      const epoch = ++permissionEpoch;
      const companionWindow = window as StudioCompanionLayoutWindow;
      const permissions = navigator.permissions as unknown as WindowManagementPermissionsLike | undefined;
      if (typeof permissions?.query !== "function" || typeof companionWindow.getScreenDetails !== "function") {
        cancelPlacementAttempt();
        publishStatus("unsupported");
        return;
      }
      publishStatus("checking-permission");
      let nextPermission: WindowManagementPermissionStatusLike;
      try {
        nextPermission = await permissions.query({ name: "window-management" });
      } catch {
        if (!disposed && permissionEpoch === epoch) {
          cancelPlacementAttempt();
          publishStatus("unsupported");
        }
        return;
      }
      if (disposed || permissionEpoch !== epoch) return;
      clearPermissionListener();
      permissionStatus = nextPermission;
      permissionChangeListener = () => { void refreshPermission(); };
      nextPermission.addEventListener?.("change", permissionChangeListener);
      if (nextPermission.state !== "granted") {
        cancelPlacementAttempt();
        publishStatus(nextPermission.state === "denied" ? "permission-denied" : "permission-required");
        return;
      }

      let nextDetails: StudioCompanionScreenDetailsLike;
      try {
        nextDetails = await companionWindow.getScreenDetails();
      } catch {
        if (!disposed && permissionEpoch === epoch) {
          cancelPlacementAttempt();
          publishStatus("unsupported");
        }
        return;
      }
      if (disposed || permissionEpoch !== epoch) return;
      installDetails(nextDetails, manualPlacementRequested);
    };

    const clearSavedLayout = (persist = true) => {
      if (disposed || !enabled || !interactionReady) return;
      if (persist) preferencesRuntime?.clearLayout();
      savedLayout = null;
      restoreAttempted = true;
      surfaceLifetimeState.restoreAttempted = true;
      settleKind = null;
      pendingRestoredPlacement = null;
      candidate = null;
      stableSampleCount = 0;
      lastStable = null;
      const currentMetrics = readWindowMetrics(window);
      lastSavedMetricsKey = currentMetrics ? metricsKey(currentMetrics) : null;
      setHasSaved(false);
      publishReadyStatus("ready");
    };

    notifyManualPlacementRef.current = () => {
      if (disposed || !enabled || !interactionReady || !rememberEnabledCurrent) return;
      manualPlacementRequested = true;
      topologyStale = false;
      surfaceLifetimeState.topologyStale = false;
      restoreAttempted = true;
      surfaceLifetimeState.restoreAttempted = true;
      settleKind = "manual";
      pendingRestoredPlacement = null;
      candidate = null;
      stableSampleCount = 0;
      lastStable = null;
      stopPolling();
      publishStatus("settling");
      void refreshPermission();
    };
    resetSavedLayoutRef.current = clearSavedLayout;
    setRememberEnabledRef.current = (next) => {
      if (disposed || !enabled || !interactionReady) return;
      if (next === rememberEnabledCurrent) return;
      rememberEnabledCurrent = next;
      const nextSnapshot = preferencesRuntime?.setRememberEnabled(next);
      savedLayout = nextSnapshot?.layout ?? (next ? savedLayout : null);
      if (!next) clearSavedLayout(false);
      setRememberEnabledState(next);
      if (next && persistenceHydrated) void refreshPermission();
    };

    if (!enabled) {
      setHasSaved(false);
      setSessionOnly(false);
      setPersistenceAuthority("loading");
      setSynchronizationDegraded(false);
      publishStatus("disabled");
      return () => {
        disposed = true;
      };
    }
    if (!interactionReady) {
      setPersistenceAuthority("loading");
      publishStatus("waiting-for-binding");
      return () => {
        disposed = true;
      };
    }
    const onResize = () => {
      if (resizeTimer !== null) globalThis.clearTimeout(resizeTimer);
      resizeTimer = globalThis.setTimeout(() => {
        resizeTimer = null;
        sampleGeometry();
      }, STUDIO_COMPANION_WINDOW_LAYOUT_RESIZE_DEBOUNCE_MS);
    };
    const onLifecycleFlush = () => flushStableGeometry();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") startPolling();
      else {
        flushStableGeometry();
        stopPolling();
      }
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onLifecycleFlush);
    window.addEventListener("pagehide", onLifecycleFlush);
    document.addEventListener("visibilitychange", onVisibilityChange);

    preferencesRuntime = preferencesRuntimeFactory({
      surface,
      initialRememberEnabled: rememberEnabledCurrent,
    });
    const applyPreferenceState = (
      state: ReturnType<StudioCompanionWindowPreferencesRuntime["current"]>,
    ) => {
      if (disposed) return;
      const wasRememberEnabled = rememberEnabledCurrent;
      rememberEnabledCurrent = state.snapshot.rememberEnabled;
      savedLayout = state.snapshot.layout;
      sessionPreferencesRef.current.set(surface, {
        rememberEnabled: rememberEnabledCurrent,
        layout: savedLayout,
      });
      persistenceSessionOnly = state.authority === "memory-only";
      setPersistenceAuthority(state.authority);
      setSessionOnly(persistenceSessionOnly);
      setSynchronizationDegraded(state.liveSync === "memory-only");
      setRememberEnabledState(rememberEnabledCurrent);
      setHasSaved(savedLayout !== null);
      if (!rememberEnabledCurrent) {
        cancelPlacementAttempt();
        publishReadyStatus("ready");
      } else if (!wasRememberEnabled && persistenceHydrated) {
        void refreshPermission();
      }
    };
    unsubscribePreferences = preferencesRuntime.subscribe(applyPreferenceState);
    applyPreferenceState(preferencesRuntime.current());
    void preferencesRuntime.hydrate().then((state) => {
      if (disposed) return;
      persistenceHydrated = true;
      applyPreferenceState(state);
      if (state.authority === "memory-only") markSessionOnly();
      if (rememberEnabledCurrent) void refreshPermission();
      else publishReadyStatus("ready");
    });

    return () => {
      disposed = true;
      permissionEpoch += 1;
      stopPolling();
      if (resizeTimer !== null) globalThis.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onLifecycleFlush);
      window.removeEventListener("pagehide", onLifecycleFlush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearPermissionListener();
      clearDetailsListener();
      unsubscribePreferences?.();
      unsubscribePreferences = null;
      preferencesRuntime?.close();
      preferencesRuntime = null;
      notifyManualPlacementRef.current = () => undefined;
      resetSavedLayoutRef.current = () => undefined;
      setRememberEnabledRef.current = (next) => setRememberEnabledState(next);
    };
  }, [enabled, initialRememberEnabled, interactionReady, preferencesRuntimeFactory, surface]);

  function notifyManualPlacement(): void {
    notifyManualPlacementRef.current();
  }

  function resetSavedLayout(): void {
    resetSavedLayoutRef.current();
  }

  function setRememberEnabled(next: boolean): void {
    setRememberEnabledRef.current(next);
  }

  function toggleRememberEnabled(): void {
    setRememberEnabledRef.current(!rememberEnabled);
  }

  return {
    status,
    hasSaved,
    rememberEnabled,
    sessionOnly,
    persistenceAuthority,
    synchronizationDegraded,
    notifyManualPlacement,
    resetSavedLayout,
    setRememberEnabled,
    toggleRememberEnabled,
  };
}
