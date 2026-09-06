import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  defaultStudioAppSettings,
  type StudioAppSettings,
  type StudioAppSettingsTab,
  type StudioRailToolId,
} from "../../studio-app-settings";
import {
  normalizeStudioEffectFavoriteState,
  rememberStudioEffectRecent,
  toggleStudioEffectFavorite,
  type StudioEffectFavoriteState,
  type StudioEffectId,
} from "../../studio-effect-favorites";
import { acquireProductStudioUiPreferencesRepository } from "../../studio-legacy-editor-runtime-helpers";

import type { StudioUiDensityMode } from "../../studio-ui-density";
import type { StudioUiBooleanPreferenceKey } from "../../studio-ui-preferences-sqlite";

interface UseStudioPreferencesRuntimeOptions {
  readonly applyMirroredSettings: (settings: StudioAppSettings) => void;
  readonly closeRightPanelForFocusMode: () => void;
}

/**
 * Owns user-level Studio preferences and the SQLite-backed persistence policy.
 * Document state must never be introduced here: this runtime may survive or hydrate independently
 * from the current canvas document and only exposes explicit UI-setting commands.
 */
export function useStudioPreferencesRuntime({
  applyMirroredSettings,
  closeRightPanelForFocusMode,
}: UseStudioPreferencesRuntimeOptions) {
  const [uiDensityMode, setUiDensityMode] = useState<StudioUiDensityMode>(
    () => defaultStudioAppSettings().general.densityMode,
  );
  const [appSettings, setAppSettings] = useState<StudioAppSettings>(defaultStudioAppSettings);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [appSettingsInitialTab, setAppSettingsInitialTab] =
    useState<StudioAppSettingsTab>("general");
  const [appSettingsPersistenceState, setAppSettingsPersistenceState] = useState<
    "loading" | "saved" | "session-only"
  >("loading");
  const [railMoreOpen, setRailMoreOpen] = useState(false);
  const appSettingsRef = useRef(appSettings);
  const appSettingsUserRevisionRef = useRef(0);
  const applyMirroredSettingsRef = useRef(applyMirroredSettings);
  const closeRightPanelForFocusModeRef = useRef(closeRightPanelForFocusMode);
  const uiBooleanPreferenceRevisionsRef = useRef<
    Record<StudioUiBooleanPreferenceKey, number>
  >({
    "ai-notice-acknowledged": 0,
    "quick-start-dismissed": 0,
    "mobile-hint-dismissed": 0,
    "comment-pins-hidden": 0,
  });
  appSettingsRef.current = appSettings;
  applyMirroredSettingsRef.current = applyMirroredSettings;
  closeRightPanelForFocusModeRef.current = closeRightPanelForFocusMode;

  const [effectFavoriteState, setEffectFavoriteState] = useState<StudioEffectFavoriteState>(() =>
    normalizeStudioEffectFavoriteState(undefined),
  );
  const effectFavoriteStateRef = useRef(effectFavoriteState);
  const effectFavoriteUserRevisionRef = useRef(0);
  effectFavoriteStateRef.current = effectFavoriteState;

  useEffect(() => {
    let cancelled = false;
    const settingsRevisionAtStart = appSettingsUserRevisionRef.current;
    const favoritesRevisionAtStart = effectFavoriteUserRevisionRef.current;

    void acquireProductStudioUiPreferencesRepository()
      .then(async (repository) => {
        const [settingsResult, favoritesResult] = await Promise.allSettled([
          repository.loadAppSettings(),
          repository.loadEffectFavorites(),
        ]);
        if (cancelled) return;

        let degraded = false;
        if (settingsResult.status === "fulfilled") {
          if (appSettingsUserRevisionRef.current === settingsRevisionAtStart) {
            const hydrated = settingsResult.value;
            appSettingsRef.current = hydrated;
            setAppSettings(hydrated);
            setUiDensityMode(hydrated.general.densityMode);
            if (hydrated.general.densityMode === "focus") {
              closeRightPanelForFocusModeRef.current();
            }
            applyMirroredSettingsRef.current(hydrated);
          } else {
            try {
              await repository.saveAppSettings(appSettingsRef.current);
            } catch {
              degraded = true;
            }
          }
        } else if (appSettingsUserRevisionRef.current !== settingsRevisionAtStart) {
          try {
            await repository.saveAppSettings(appSettingsRef.current);
          } catch {
            degraded = true;
          }
        } else {
          degraded = true;
        }

        if (favoritesResult.status === "fulfilled") {
          if (effectFavoriteUserRevisionRef.current === favoritesRevisionAtStart) {
            effectFavoriteStateRef.current = favoritesResult.value;
            setEffectFavoriteState(favoritesResult.value);
          } else {
            try {
              await repository.saveEffectFavorites(effectFavoriteStateRef.current);
            } catch {
              degraded = true;
            }
          }
        } else if (effectFavoriteUserRevisionRef.current !== favoritesRevisionAtStart) {
          try {
            await repository.saveEffectFavorites(effectFavoriteStateRef.current);
          } catch {
            degraded = true;
          }
        } else {
          degraded = true;
        }

        if (!cancelled) {
          setAppSettingsPersistenceState(degraded ? "session-only" : "saved");
        }
      })
      .catch(() => {
        if (!cancelled) setAppSettingsPersistenceState("session-only");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const persistAppSettings = useCallback((next: StudioAppSettings): void => {
    const revision = ++appSettingsUserRevisionRef.current;
    setAppSettingsPersistenceState("loading");
    void acquireProductStudioUiPreferencesRepository()
      .then((repository) => repository.saveAppSettings(next))
      .then(() => {
        if (appSettingsUserRevisionRef.current === revision) {
          setAppSettingsPersistenceState("saved");
        }
      })
      .catch(() => {
        if (appSettingsUserRevisionRef.current === revision) {
          setAppSettingsPersistenceState("session-only");
        }
      });
  }, []);

  const persistStudioUiBooleanPreference = useCallback((
    key: StudioUiBooleanPreferenceKey,
    value: boolean,
  ): void => {
    uiBooleanPreferenceRevisionsRef.current[key] += 1;
    void acquireProductStudioUiPreferencesRepository()
      .then((repository) => repository.saveBooleanPreference(key, value))
      .catch(() => setAppSettingsPersistenceState("session-only"));
  }, []);

  const setStudioUiDensity = useCallback((mode: StudioUiDensityMode): void => {
    if (mode === "focus") closeRightPanelForFocusModeRef.current();
    setUiDensityMode(mode);
    const current = appSettingsRef.current;
    const next = current.general.densityMode === mode
      ? current
      : { ...current, general: { ...current.general, densityMode: mode } };
    if (next !== current) setAppSettings(next);
    persistAppSettings(next);
  }, [persistAppSettings]);

  const commitAppSettings = useCallback((next: StudioAppSettings): void => {
    appSettingsRef.current = next;
    setAppSettings(next);
    persistAppSettings(next);
    setUiDensityMode(next.general.densityMode);
    applyMirroredSettingsRef.current(next);
  }, [persistAppSettings]);

  // Effect Events cannot cross a custom-hook boundary. The public command remains stable while the
  // callback refs above keep its host-owned side effects current without restarting hydration.
  const setStudioUiDensityFromCompanion = setStudioUiDensity;
  const isRailToolVisible = useCallback(
    (id: StudioRailToolId): boolean => appSettings.toolbar.visibleIds.includes(id),
    [appSettings.toolbar.visibleIds],
  );

  const persistEffectFavoriteState = useCallback((next: StudioEffectFavoriteState): void => {
    const revision = ++effectFavoriteUserRevisionRef.current;
    effectFavoriteStateRef.current = next;
    setEffectFavoriteState(next);
    void acquireProductStudioUiPreferencesRepository()
      .then((repository) => repository.saveEffectFavorites(next))
      .catch(() => {
        if (effectFavoriteUserRevisionRef.current === revision) {
          setAppSettingsPersistenceState("session-only");
        }
      });
  }, []);

  const toggleEffectFavoriteCommand = useCallback((effectId: StudioEffectId): void => {
    persistEffectFavoriteState(toggleStudioEffectFavorite(effectFavoriteStateRef.current, effectId));
  }, [persistEffectFavoriteState]);

  const rememberEffectRecent = useCallback((effectId: StudioEffectId): void => {
    persistEffectFavoriteState(rememberStudioEffectRecent(effectFavoriteStateRef.current, effectId));
  }, [persistEffectFavoriteState]);

  return {
    appSettings,
    appSettingsInitialTab,
    appSettingsOpen,
    appSettingsPersistenceState,
    appSettingsRef,
    appSettingsUserRevisionRef,
    commitAppSettings,
    effectFavoriteState,
    effectFavoriteStateRef,
    effectFavoriteUserRevisionRef,
    isRailToolVisible,
    persistAppSettings,
    persistStudioUiBooleanPreference,
    railMoreOpen,
    rememberEffectRecent,
    setAppSettings,
    setAppSettingsInitialTab,
    setAppSettingsOpen,
    setAppSettingsPersistenceState,
    setEffectFavoriteState,
    setRailMoreOpen,
    setStudioUiDensity,
    setStudioUiDensityFromCompanion,
    setUiDensityMode,
    toggleEffectFavorite: toggleEffectFavoriteCommand,
    uiBooleanPreferenceRevisionsRef,
    uiDensityMode,
  } as const;
}
