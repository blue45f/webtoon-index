import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  loadStudioFloatingSurfaceLayout,
  normalizeStudioFloatingSurfaceLayout,
  saveStudioFloatingSurfaceLayout,
  studioFloatingSurfaceLayoutsEqual,
  type StudioFloatingSurfaceLayout,
  type StudioFloatingSurfaceStorage,
} from "./studio-floating-surface";

import type {
  StudioFloatingSurfacePersistenceFailure,
  StudioFloatingSurfacePreferencesRepository,
} from "./studio-floating-surface-preferences-sqlite";

export type StudioFloatingSurfaceLayoutAuthority =
  | "checking"
  | "sqlite-opfs"
  | "session-only";

export interface UseStudioFloatingSurfaceLayoutOptions {
  readonly surfaceId: string;
  readonly defaultLayout: StudioFloatingSurfaceLayout;
  readonly sessionKey?: string;
  readonly enabled?: boolean;
  readonly repositoryFactory?: () =>
    Promise<StudioFloatingSurfacePreferencesRepository>;
}

export interface UseStudioFloatingSurfaceLayoutResult {
  readonly layout: StudioFloatingSurfaceLayout;
  readonly authority: StudioFloatingSurfaceLayoutAuthority;
  readonly failure: StudioFloatingSurfacePersistenceFailure | "storage-unavailable" | null;
  readonly setLayout: (layout: StudioFloatingSurfaceLayout) => void;
  readonly resetLayout: () => void;
}

export function studioFloatingSurfaceSessionKey(surfaceId: string): string {
  return `toonspectrum:studio:floating:${surfaceId}:v1`;
}

function browserSessionStorage(): StudioFloatingSurfaceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function productRepositoryAvailable(): boolean {
  try {
    return typeof navigator !== "undefined"
      && typeof navigator.storage?.getDirectory === "function";
  } catch {
    return false;
  }
}

async function acquireProductStudioFloatingSurfacePreferencesRepositoryDeferred(): Promise<
  StudioFloatingSurfacePreferencesRepository
> {
  const { acquireProductStudioFloatingSurfacePreferencesRepository } = await import(
    "./studio-floating-surface-preferences-sqlite"
  );
  return acquireProductStudioFloatingSurfacePreferencesRepository();
}

/**
 * Synchronous UI continuity plus verified SQLite/OPFS durability for one persistent Studio panel.
 *
 * Session storage is only the same-tab startup cache. The shared V12 database remains the durable
 * authority, and a slow hydrate never overwrites a layout the artist already moved this session.
 */
export function useStudioFloatingSurfaceLayout({
  surfaceId,
  defaultLayout,
  sessionKey = studioFloatingSurfaceSessionKey(surfaceId),
  enabled = true,
  repositoryFactory =
    acquireProductStudioFloatingSurfacePreferencesRepositoryDeferred,
}: UseStudioFloatingSurfaceLayoutOptions): UseStudioFloatingSurfaceLayoutResult {
  const normalizedDefault = useMemo(
    () => normalizeStudioFloatingSurfaceLayout(defaultLayout, defaultLayout),
    [defaultLayout],
  );
  const [layout, setLayoutState] = useState<StudioFloatingSurfaceLayout>(() =>
    loadStudioFloatingSurfaceLayout(
      browserSessionStorage(),
      sessionKey,
      normalizedDefault,
    )
  );
  const [authority, setAuthority] =
    useState<StudioFloatingSurfaceLayoutAuthority>("checking");
  const [failure, setFailure] =
    useState<UseStudioFloatingSurfaceLayoutResult["failure"]>(null);
  const liveLayoutRef = useRef(layout);
  const localGenerationRef = useRef(0);
  const repositoryRef =
    useRef<Promise<StudioFloatingSurfacePreferencesRepository> | null>(null);
  liveLayoutRef.current = layout;

  const sqliteAvailable = repositoryFactory
    !== acquireProductStudioFloatingSurfacePreferencesRepositoryDeferred
    || productRepositoryAvailable();

  const repository = useCallback(() => {
    repositoryRef.current ??= repositoryFactory();
    return repositoryRef.current;
  }, [repositoryFactory]);

  useEffect(() => {
    if (!enabled || !sqliteAvailable) {
      setAuthority("session-only");
      return;
    }
    let disposed = false;
    const generationAtStart = localGenerationRef.current;
    void repository()
      .then((target) => target.load(surfaceId, normalizedDefault))
      .then((result) => {
        if (disposed) return;
        setFailure(result.failure);
        setAuthority(result.failure ? "session-only" : "sqlite-opfs");
        if (
          !result.persisted
          || generationAtStart !== localGenerationRef.current
        ) {
          return;
        }
        liveLayoutRef.current = result.layout;
        setLayoutState(result.layout);
        saveStudioFloatingSurfaceLayout(
          browserSessionStorage(),
          sessionKey,
          result.layout,
        );
      })
      .catch(() => {
        if (disposed) return;
        setAuthority("session-only");
        setFailure("storage-unavailable");
      });
    return () => {
      disposed = true;
    };
  }, [
    enabled,
    normalizedDefault,
    repository,
    sessionKey,
    sqliteAvailable,
    surfaceId,
  ]);

  const setLayout = useCallback((nextLayout: StudioFloatingSurfaceLayout) => {
    const normalized = normalizeStudioFloatingSurfaceLayout(
      nextLayout,
      normalizedDefault,
    );
    if (studioFloatingSurfaceLayoutsEqual(liveLayoutRef.current, normalized)) {
      return;
    }
    localGenerationRef.current += 1;
    liveLayoutRef.current = normalized;
    setLayoutState(normalized);
    saveStudioFloatingSurfaceLayout(
      browserSessionStorage(),
      sessionKey,
      normalized,
    );
    if (!sqliteAvailable) {
      setAuthority("session-only");
      setFailure("storage-unavailable");
      return;
    }
    void repository()
      .then((target) => target.save(surfaceId, normalized))
      .then((result) => {
        setAuthority(result.status === "persisted" ? "sqlite-opfs" : "session-only");
        setFailure(result.failure);
      })
      .catch(() => {
        setAuthority("session-only");
        setFailure("storage-unavailable");
      });
  }, [
    normalizedDefault,
    repository,
    sessionKey,
    sqliteAvailable,
    surfaceId,
  ]);

  const resetLayout = useCallback(() => {
    setLayout(normalizedDefault);
  }, [normalizedDefault, setLayout]);

  return {
    layout,
    authority,
    failure,
    setLayout,
    resetLayout,
  };
}
