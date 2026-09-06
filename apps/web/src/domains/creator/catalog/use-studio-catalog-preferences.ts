import { useEffect, useRef, useState } from "react";

import {
  acquireStudioCatalogPreferencesRepository,
  applyStudioCatalogPreference,
  normalizeStudioCatalogPreferences,
} from "./studio-catalog-preferences";

import type { StudioCatalogPreferenceAction, StudioCatalogPreferences, StudioCatalogPreferencesRepository, StudioCatalogSurface } from "./studio-catalog-preferences";

/** No browser-KV fallback. Failed writes stay visibly pending and may be retried. */
export function useStudioCatalogPreferences(
  surface: StudioCatalogSurface,
  acquire: () => Promise<StudioCatalogPreferencesRepository> = acquireStudioCatalogPreferencesRepository,
) {
  const [state, setState] = useState<StudioCatalogPreferences>(() => normalizeStudioCatalogPreferences(null));
  const [authority, setAuthority] = useState<"loading" | "sqlite-opfs" | "memory-only">("loading");
  const stateRef = useRef(state);
  const epoch = useRef(0);
  const revision = useRef(0);
  const pending = useRef<{ sequence: number; action: StudioCatalogPreferenceAction }[]>([]);
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const currentEpoch = ++epoch.current;
    const initialRevision = revision.current;
    void acquire().then((repository) => repository.load(surface)).then((loaded) => {
      if (epoch.current !== currentEpoch) return;
      if (revision.current === initialRevision && pending.current.length === 0) {
        stateRef.current = loaded;
        setState(loaded);
      }
      setAuthority(pending.current.length === 0 ? "sqlite-opfs" : "memory-only");
    }).catch(() => { if (epoch.current === currentEpoch) setAuthority("memory-only"); });
    return () => { epoch.current += 1; };
  }, [acquire, surface]);

  function flush() {
    const currentEpoch = epoch.current;
    const run = writeQueue.current.catch(() => undefined).then(async () => {
      if (epoch.current !== currentEpoch) return;
      const repository = await acquire();
      let stored: StudioCatalogPreferences | null = pending.current.length === 0
        ? await repository.load(surface) : null;
      while (pending.current.length > 0 && epoch.current === currentEpoch) {
        const operation = pending.current[0];
        stored = await repository.update(surface, operation.action);
        if (epoch.current !== currentEpoch) return;
        pending.current = pending.current.filter(({ sequence }) => sequence !== operation.sequence);
      }
      if (epoch.current !== currentEpoch) return;
      if (stored && pending.current.length === 0) { stateRef.current = stored; setState(stored); }
      setAuthority("sqlite-opfs");
    }).catch(() => { if (epoch.current === currentEpoch) setAuthority("memory-only"); });
    writeQueue.current = run;
  }

  function dispatch(action: StudioCatalogPreferenceAction) {
    const next = applyStudioCatalogPreference(stateRef.current, action);
    stateRef.current = next;
    setState(next);
    pending.current.push({ sequence: ++revision.current, action });
    flush();
  }

  return { state, authority, dispatch, retry: flush };
}
