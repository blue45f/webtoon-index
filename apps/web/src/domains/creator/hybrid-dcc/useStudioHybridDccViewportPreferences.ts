import { useCallback, useEffect, useReducer, useState, type SetStateAction } from "react";

import {
  normalizeStudioHybridDccViewportPreferences,
  STUDIO_HYBRID_DCC_VIEWPORT_DEFAULTS,
  type StudioHybridDccViewportPreferences,
} from "./studio-hybrid-dcc-viewport-interaction";
import { loadHybridDccViewportPreferences, saveHybridDccViewportPreferences } from "./viewport-preferences-store";

type Preferences = StudioHybridDccViewportPreferences;
type State = {
  preferences: Preferences;
  pending: Partial<Preferences>;
  loaded: boolean;
  revision: number;
};
type Action =
  | { type: "load"; preferences: Preferences }
  | { type: "patch"; patch: Partial<Preferences> }
  | { type: "replace"; value: SetStateAction<Preferences> };

function reducePreferences(state: State, action: Action): State {
  if (action.type === "load") {
    return {
      ...state,
      preferences: normalizeStudioHybridDccViewportPreferences({ ...action.preferences, ...state.pending, version: 1 }),
      pending: {},
      loaded: true,
    };
  }
  const patch = action.type === "patch" ? action.patch
    : typeof action.value === "function" ? action.value(state.preferences) : action.value;
  return {
    ...state,
    preferences: normalizeStudioHybridDccViewportPreferences({ ...state.preferences, ...patch, version: 1 }),
    pending: state.loaded ? {} : { ...state.pending, ...patch },
    revision: state.revision + 1,
  };
}

/** Session controls stay usable; only restored, authored preferences enter shared SQLite. */
export function useStudioHybridDccViewportPreferences() {
  const [state, dispatch] = useReducer(reducePreferences, {
    preferences: { ...STUDIO_HYBRID_DCC_VIEWPORT_DEFAULTS }, pending: {}, loaded: false, revision: 0,
  });
  const [persistenceState, setPersistenceState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  useEffect(() => {
    let active = true;
    void loadHybridDccViewportPreferences().then((preferences) => {
      if (!active) return;
      dispatch({ type: "load", preferences });
      setPersistenceState("ready");
    }).catch(() => {
      if (active) setPersistenceState("error");
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!state.loaded || state.revision === 0) return;
    let active = true;
    setPersistenceState("saving");
    void saveHybridDccViewportPreferences(state.preferences).then(() => {
      if (active) setPersistenceState("ready");
    }).catch(() => {
      if (active) setPersistenceState("error");
    });
    return () => { active = false; };
  }, [state.loaded, state.preferences, state.revision]);
  const patchPreferences = useCallback((patch: Partial<Preferences>) => dispatch({ type: "patch", patch }), []);
  const setPreferences = useCallback((value: SetStateAction<Preferences>) => dispatch({ type: "replace", value }), []);
  return { preferences: state.preferences, patchPreferences, setPreferences, persistenceState };
}
