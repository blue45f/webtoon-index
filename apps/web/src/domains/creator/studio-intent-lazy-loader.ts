export interface StudioIntentLazyLoader<TModule> {
  /** Reuses one in-flight or fulfilled module request and retries after failure. */
  readonly load: () => Promise<TModule>;
  /** Best-effort warm-up for hover, keyboard focus, and touch pointer intent. */
  readonly preload: () => void;
}

/**
 * Couples intent preloading with the loader used by React.lazy/lazyRetry.
 * A failed warm-up is intentionally consumed, while the cached promise is
 * cleared so the user's actual activation can retry through the error boundary.
 */
export function createStudioIntentLazyLoader<TModule>(
  importer: () => Promise<TModule>
): StudioIntentLazyLoader<TModule> {
  let request: Promise<TModule> | null = null;

  const load = (): Promise<TModule> => {
    request ??= importer().catch((error) => {
      request = null;
      throw error;
    });
    return request;
  };

  const preload = (): void => {
    void load().catch(() => undefined);
  };

  return { load, preload };
}
