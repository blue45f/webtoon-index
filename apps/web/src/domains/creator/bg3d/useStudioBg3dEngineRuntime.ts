/**
 * Owns the background editor's interactive engine decision for one session.
 *
 * The hook is the only place that combines the persisted artist preference, the WebGPU adapter
 * probe, the embedding host, and this selection's runtime state, and it is the only place that
 * hands R3F an asynchronous renderer factory. Everything it
 * decides with is pure and separately tested; the hook itself owns effects, persistence, and the
 * canvas remount key.
 *
 * Switching backend remounts the R3F `Canvas`. A runtime failure instead marks the selected engine
 * failed and unmounts the canvas; only another explicit choice (or re-selecting WebGPU to retry)
 * can make a renderer eligible again. A renderer swap invalidates
 * every GPU resource in the tree, and the scene is rebuilt from the canonical SceneDocument, so a
 * remount is both cheaper and safer than trying to migrate live engine objects.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  EMPTY_STUDIO_BG3D_ENGINE_WEBGL_ONLY_FEATURES,
  latchStudioBg3dWebglOnlyFeatures,
  normalizeStudioBg3dEnginePreference,
  resolveStudioBg3dEngineRuntime,
  type StudioBg3dEnginePreference,
  type StudioBg3dEngineSelectionPlan,
  type StudioBg3dEngineWebglOnlyFeatures,
} from "./studio-bg3d-engine-selection";
import { classifyStudioBg3dInAppBrowser } from "./studio-bg3d-inapp-browser";
import { probeStudioBg3dWebGpuCapability } from "./studio-bg3d-webgpu-capability";

import type { StudioBg3dDeviceProfile } from "./studio-bg3d-device-quality";
import type { StudioBg3dInAppBrowserProfile } from "./studio-bg3d-inapp-browser";
import type { createStudioBg3dThreeWebGpuRenderer } from "./studio-bg3d-three-webgpu-renderer";
import type { StudioBg3dWebGpuProbeResult } from "./studio-bg3d-webgpu-capability";
// Type-only: erased at runtime, so the WebGPU renderer graph stays behind its dynamic import.

/** Renderer factory shape R3F accepts for its `gl` prop. */
export type StudioBg3dRendererFactory = (
  props: { readonly canvas: HTMLCanvasElement },
) => Promise<{ render: (scene: never, camera: never) => unknown }>;

export type StudioBg3dEngineRuntimePhase = "probing" | "ready";

/**
 * How long the viewport keeps announcing the detailed device-loss cause. The failed plan remains
 * visible after this notification expires.
 */
export const STUDIO_BG3D_DEVICE_LOSS_NOTICE_MS = 10_000;

export interface StudioBg3dEngineRuntimeState {
  readonly phase: StudioBg3dEngineRuntimePhase;
  readonly plan: StudioBg3dEngineSelectionPlan;
  readonly preference: StudioBg3dEnginePreference;
  readonly inApp: StudioBg3dInAppBrowserProfile;
  readonly probe: StudioBg3dWebGpuProbeResult;
  /**
   * Put this in the R3F `Canvas` key. It changes when the backend changes and when the artist
   * explicitly retries a failed WebGPU selection.
   */
  readonly canvasKey: string;
  /** Present only while the selected WebGPU backend is available and the editor is open. */
  readonly glFactory: StudioBg3dRendererFactory | null;
  readonly deviceLostMessage: string | null;
  setPreference(next: StudioBg3dEnginePreference): void;
}

export interface UseStudioBg3dEngineRuntimeOptions {
  /** False while the editor is closed; probing is skipped so a closed editor never touches the GPU. */
  readonly enabled: boolean;
  readonly deviceProfile: StudioBg3dDeviceProfile;
  readonly antialias: boolean;
  readonly saveData?: boolean;
  readonly deviceMemoryGb?: number;
  /**
   * Features observed in this session that only the WebGL2 renderer can serve. Observations latch,
   * so a scene that adds and removes a VRM character does not rebuild the viewport twice.
   */
  readonly observedWebglOnlyFeatures?: Partial<StudioBg3dEngineWebglOnlyFeatures>;
  /** Test seam; production reads the browser. */
  readonly probe?: typeof probeStudioBg3dWebGpuCapability;
  readonly loadPreference?: () => Promise<StudioBg3dEnginePreference>;
  readonly savePreference?: (preference: StudioBg3dEnginePreference) => Promise<void>;
  readonly createWebGpuRenderer?: typeof createStudioBg3dThreeWebGpuRenderer;
}

const PENDING_PROBE: StudioBg3dWebGpuProbeResult = Object.freeze({
  supported: false,
  reason: "api-unavailable",
  computeSupported: false,
  timestampQuerySupported: false,
  limits: Object.freeze({}),
});

async function loadPersistedPreference(): Promise<StudioBg3dEnginePreference> {
  const { acquireProductStudioUiPreferencesRepository } = await import(
    "../studio-ui-preferences-sqlite"
  );
  const repository = await acquireProductStudioUiPreferencesRepository();
  return repository.loadBg3dEnginePreference();
}

async function persistPreference(preference: StudioBg3dEnginePreference): Promise<void> {
  const { acquireProductStudioUiPreferencesRepository } = await import(
    "../studio-ui-preferences-sqlite"
  );
  const repository = await acquireProductStudioUiPreferencesRepository();
  await repository.saveBg3dEnginePreference(preference);
}

function readHostSignals(): { userAgent?: string } {
  if (typeof navigator === "undefined") return {};
  return { userAgent: navigator.userAgent };
}

export function useStudioBg3dEngineRuntime(
  options: UseStudioBg3dEngineRuntimeOptions,
): StudioBg3dEngineRuntimeState {
  const {
    enabled,
    deviceProfile,
    antialias,
    saveData,
    deviceMemoryGb,
    observedWebglOnlyFeatures,
    probe: probeCapability = probeStudioBg3dWebGpuCapability,
    loadPreference = loadPersistedPreference,
    savePreference = persistPreference,
    createWebGpuRenderer,
  } = options;

  const [preference, setPreferenceState] = useState<StudioBg3dEnginePreference>("webgpu");
  const [probe, setProbe] = useState<StudioBg3dWebGpuProbeResult>(PENDING_PROBE);
  const [phase, setPhase] = useState<StudioBg3dEngineRuntimePhase>("probing");
  const [webgpuRuntimeFailed, setWebgpuRuntimeFailed] = useState(false);
  const [deviceLostMessage, setDeviceLostMessage] = useState<string | null>(null);
  const [recoveryGeneration, setRecoveryGeneration] = useState(0);
  const [webglOnlyFeatures, setWebglOnlyFeatures] = useState<StudioBg3dEngineWebglOnlyFeatures>(
    EMPTY_STUDIO_BG3D_ENGINE_WEBGL_ONLY_FEATURES,
  );

  // Bumped by every explicit choice. The bootstrap effect compares against it so a restored value
  // that was already in flight cannot overwrite a choice the artist made while it loaded.
  const preferenceRevisionRef = useRef(0);
  const preferenceRef = useRef<StudioBg3dEnginePreference>(preference);
  // Distinguishes a genuine closed→open transition from an effect re-run caused by unstable deps.
  const wasEnabledRef = useRef(false);

  const inApp = useMemo(() => classifyStudioBg3dInAppBrowser(readHostSignals()), []);

  // Read every field by name rather than forwarding the object. The caller rebuilds that object
  // each render, so passing it straight through would re-run this effect on every render; naming
  // the fields keeps the dependency on the values. The cost is that a field added to
  // `StudioBg3dEngineWebglOnlyFeatures` and not added here is silently never latched — which is
  // exactly what happened to `vrmCharacters`, so `studio-bg3d-engine-latch-wiring.test.ts` now
  // fails when the two lists drift apart.
  const observedWebxr = observedWebglOnlyFeatures?.webxr === true;
  const observedVrmCharacters = observedWebglOnlyFeatures?.vrmCharacters === true;
  useEffect(() => {
    setWebglOnlyFeatures((current) => latchStudioBg3dWebglOnlyFeatures(current, {
      webxr: observedWebxr,
      vrmCharacters: observedVrmCharacters,
    }));
  }, [observedWebxr, observedVrmCharacters]);
  // Apply the live observation immediately as well as persisting it in the latch effect. This
  // prevents one render of an otherwise-ready Canvas before a newly added VRM/WebXR requirement is
  // committed to state.
  const effectiveWebglOnlyFeatures = useMemo(
    () => latchStudioBg3dWebglOnlyFeatures(webglOnlyFeatures, {
      webxr: observedWebxr,
      vrmCharacters: observedVrmCharacters,
    }),
    [observedVrmCharacters, observedWebxr, webglOnlyFeatures],
  );

  useEffect(() => {
    if (!enabled) {
      wasEnabledRef.current = false;
      setPhase("probing");
      return;
    }
    // Reopening a retained editor runs this again. Without resetting the phase the engine controls
    // stay live while the restored preference and a fresh probe are still in flight.
    //
    // Only an actual closed→open transition resets it. Callers may pass fresh callback identities
    // each render, which re-runs this effect; resetting on every run would flip the phase back to
    // probing right after it reached ready, then render, re-run and flip again without end.
    const reopened = !wasEnabledRef.current;
    wasEnabledRef.current = true;
    if (reopened) {
      setPhase("probing");
      setWebgpuRuntimeFailed(false);
      setDeviceLostMessage(null);
    }

    let cancelled = false;
    let preferenceRestored = false;
    let latestProbe: StudioBg3dWebGpuProbeResult | undefined;
    const controller = new AbortController();
    const revisionAtStart = preferenceRevisionRef.current;
    void (async () => {
      const restoredPromise = loadPreference()
        .catch(() => "webgpu" as StudioBg3dEnginePreference);
      const probePromise = probeCapability({
        secureContext: typeof window !== "undefined" && window.isSecureContext === true,
        gpu: (navigator as Navigator & { gpu?: Parameters<typeof probeCapability>[0]["gpu"] }).gpu,
        signal: controller.signal,
        onLateResult: (result) => {
          if (cancelled) return;
          latestProbe = result;
          // A cold GPU request can outlive the UI deadline. Admit its real result without another
          // request, but never race ahead of the saved preference or revive a closed/old session.
          if (preferenceRestored) {
            setProbe(result);
            setPhase("ready");
          }
        },
      }).catch(() => PENDING_PROBE);
      const restored = await restoredPromise;
      if (cancelled) return;
      // A choice made while this was loading is newer than what storage returned. Applying the
      // restored value then would remount onto a backend the artist did not ask for and leave the
      // panel disagreeing with the preference it just saved.
      if (preferenceRevisionRef.current === revisionAtStart) {
        const normalized = normalizeStudioBg3dEnginePreference(restored);
        preferenceRef.current = normalized;
        setPreferenceState(normalized);
      }
      preferenceRestored = true;
      // WebGL2 is an independent explicit engine. It does not wait for a WebGPU adapter probe that
      // is irrelevant to its renderer; the probe may finish later for diagnostics and future choice.
      if (preferenceRef.current === "webgl2") setPhase("ready");

      const probed = await probePromise;
      if (cancelled) return;
      // Slow storage may resolve after the late adapter. Do not overwrite newer capability
      // evidence with the earlier timeout result when this bootstrap continuation resumes.
      setProbe(latestProbe ?? probed);
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, loadPreference, probeCapability]);

  const plan = useMemo(
    () => resolveStudioBg3dEngineRuntime({
      preference,
      probe,
      inApp,
      deviceProfile,
      // The renderer module is a dynamic import that is present in every build that ships this
      // hook; a host without WebGPU is already refused by the probe.
      webgpuRuntimeAvailable: true,
      saveData,
      deviceMemoryGb,
      webgpuRuntimeFailed,
      webglOnlyFeatures: effectiveWebglOnlyFeatures,
    }),
    [
      preference,
      probe,
      inApp,
      deviceProfile,
      saveData,
      deviceMemoryGb,
      webgpuRuntimeFailed,
      effectiveWebglOnlyFeatures,
    ],
  );

  const setPreference = useCallback((next: StudioBg3dEnginePreference) => {
    preferenceRevisionRef.current += 1;
    const normalized = normalizeStudioBg3dEnginePreference(next);
    const retriesFailedWebGpu = normalized === "webgpu" && normalized === preference
      && webgpuRuntimeFailed;
    setPreferenceState(normalized);
    preferenceRef.current = normalized;
    if (enabled && normalized === "webgl2") setPhase("ready");
    setDeviceLostMessage(null);
    setWebgpuRuntimeFailed(false);
    if (retriesFailedWebGpu) {
      setRecoveryGeneration((generation) => generation + 1);
    }
    void savePreference(normalized).catch(() => undefined);
  }, [enabled, preference, savePreference, webgpuRuntimeFailed]);

  const handleWebGpuFailure = useCallback((cause: string) => {
    const detail = cause.trim().replace(/[.\s]+$/u, "");
    setWebgpuRuntimeFailed(true);
    setDeviceLostMessage(
      `${detail || "WebGPU 엔진 오류가 발생했습니다"}. `
      + "WebGPU 실행을 중단했습니다. 다시 선택하거나 WebGL2를 직접 선택해 주세요.",
    );
  }, []);

  useEffect(() => {
    if (deviceLostMessage === null) return;
    const timer = setTimeout(() => setDeviceLostMessage(null), STUDIO_BG3D_DEVICE_LOSS_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [deviceLostMessage]);

  const glFactory = useMemo<StudioBg3dRendererFactory | null>(() => {
    if (!enabled || phase !== "ready" || plan.backend !== "webgpu" || plan.status !== "available") {
      return null;
    }
    return async ({ canvas }) => {
      const create = createWebGpuRenderer ?? (
        await import("./studio-bg3d-three-webgpu-entry")
      ).createStudioBg3dThreeWebGpuRenderer;
      try {
        const runtime = await create(canvas, {
          antialias,
          alpha: true,
          onDeviceLost: (loss) => handleWebGpuFailure(loss.message),
        });
        return runtime.renderer as unknown as { render: (scene: never, camera: never) => unknown };
      } catch (error) {
        handleWebGpuFailure("WebGPU 엔진을 시작하지 못했습니다.");
        throw error;
      }
    };
  }, [enabled, phase, plan.backend, plan.status, antialias, createWebGpuRenderer, handleWebGpuFailure]);

  return {
    phase,
    plan,
    preference,
    inApp,
    probe,
    canvasKey: `${plan.backend}#${recoveryGeneration}`,
    glFactory,
    deviceLostMessage,
    setPreference,
  };
}
