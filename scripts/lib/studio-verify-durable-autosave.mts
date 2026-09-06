/**
 * scripts/lib/studio-verify-durable-autosave.mts
 *
 * Shared durable-autosave access for the `scripts/verify-studio-*` browser verifiers.
 *
 * Studio's autosave authority is the browser-owned OPFS recovery journal
 * (`apps/web/src/domains/creator/studio-autosave-opfs-session.ts`). The legacy
 * `toonspectrum-studio-autosave*` localStorage JSON slot is no longer written and is
 * tombstoned on every durable save — `verify:studio-lifecycle` asserts that zero browser
 * compatibility records survive a save — so a verifier that enumerates localStorage reads
 * an empty store forever.
 *
 * These helpers reach the shipped document through the *shipped* session module, located
 * among the bundle chunks the page already loaded (the same discovery
 * `scripts/verify-studio-native-raster-tools.mts` uses). Nothing here re-implements the
 * journal's on-disk format and nothing here needs a product-only test hook.
 *
 * Import with an explicit `.mjs` specifier — `./lib/studio-verify-durable-autosave.mjs`.
 * tsx needs an explicit extension to resolve an `.mts` module at runtime, and tsc/Vite map
 * the `.mjs` specifier back to this `.mts` source without `allowImportingTsExtensions`.
 */
import type { Page } from "playwright";

/** One persisted page record, exactly as the shipped autosave payload stores it. */
export interface StudioDurableAutosavePageRecord {
  id?: unknown;
  elements?: unknown[];
  groups?: unknown[];
}

/** The newest durable autosave document, normalized by the shipped session module. */
export interface StudioDurableAutosaveDocument {
  /** Autosave document key the payload was read under. */
  readonly key: string;
  /** Serialized payload — the durable equivalent of the old localStorage JSON slot. */
  readonly raw: string;
  readonly savedAt: string;
  readonly currentPageId: string | null;
  readonly pagesList: readonly StudioDurableAutosavePageRecord[];
}

const BRIDGE_GLOBAL = "__studioVerifyDurableAutosaveBridge";

interface DurableAutosaveReadResult {
  document: StudioDurableAutosaveDocument | null;
  error: string | null;
  moduleUrl: string | null;
}

/**
 * Install the page-side bridge that locates the shipped autosave session chunk and hands
 * out document-scoped sessions. Idempotent: repeated calls reuse the resolved module and
 * the already opened sessions, so a polling verifier pays the discovery cost once.
 */
async function installBridge(page: Page, moduleUrl: string | null): Promise<void> {
  await page.evaluate(
    ({ globalName, presetModuleUrl }) => {
      interface AutosaveSession {
        readLatest: () => Promise<
          | { state: "snapshot"; savedAt: string; payload: Record<string, unknown> }
          | { state: "cleared"; savedAt: string }
          | null
        >;
        write: (payload: Record<string, unknown>) => Promise<unknown>;
        dispose: () => Promise<void>;
      }
      type AutosaveSessionFactory = (
        key: string,
        scope?: unknown,
        options?: { readOnly?: boolean },
      ) => Promise<AutosaveSession | null>;
      interface AutosaveRuntime {
        createStudioAutosaveOpfsSession?: AutosaveSessionFactory;
      }
      interface AutosaveBridge {
        moduleUrl: string | null;
        lastError: string | null;
        runtime: Promise<AutosaveRuntime> | null;
        factory: Promise<AutosaveSessionFactory> | null;
        sessions: Map<string, Promise<AutosaveSession | null>>;
        resolveModuleUrl: () => Promise<string | null>;
        resolveFactory: () => Promise<AutosaveSessionFactory>;
        open: (key: string, readOnly: boolean) => Promise<AutosaveSession | null>;
      }
      const holder = window as typeof window & Record<string, unknown>;
      const existing = holder[globalName] as AutosaveBridge | undefined;
      if (existing) {
        if (presetModuleUrl && !existing.moduleUrl) existing.moduleUrl = presetModuleUrl;
        return;
      }

      const bridge: AutosaveBridge = {
        moduleUrl: presetModuleUrl,
        lastError: null,
        runtime: null,
        factory: null,
        sessions: new Map(),
        async resolveModuleUrl() {
          if (bridge.moduleUrl) return bridge.moduleUrl;
          const resourceUrls = performance.getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((url) => url.startsWith(window.location.origin));
          let found = resourceUrls.find((url) =>
            /\/assets\/studio-autosave-opfs-session-[A-Za-z0-9_-]+\.js(?:\?.*)?$/u.test(url)
          ) ?? resourceUrls.find((url) =>
            /\/src\/domains\/creator\/studio-autosave-opfs-session\.ts(?:\?.*)?$/u.test(url)
          ) ?? null;
          if (!found && resourceUrls.some((url) => url.includes("/@vite/client"))) {
            found = new URL(
              "/src/domains/creator/studio-autosave-opfs-session.ts",
              window.location.origin,
            ).href;
          }
          if (!found) {
            // The session chunk is loaded lazily with the durable autosave runtime; before
            // that lands, follow the StudioPage chunk's own import specifier.
            const studioPageUrl = resourceUrls.find((url) =>
              /\/assets\/StudioPage-[A-Za-z0-9_-]+\.js(?:\?.*)?$/u.test(url)
            );
            if (studioPageUrl) {
              const source = await fetch(studioPageUrl).then((response) => response.text());
              const match = source.match(
                /\.\/studio-autosave-opfs-session-[A-Za-z0-9_-]+\.js/u,
              );
              if (match) found = new URL(match[0], studioPageUrl).href;
            }
          }
          bridge.moduleUrl = found;
          return found;
        },
        resolveFactory() {
          bridge.factory ??= (async () => {
            const url = await bridge.resolveModuleUrl();
            if (!url) {
              throw new Error(
                "the shipped studio-autosave-opfs-session chunk was not found on this page",
              );
            }
            bridge.runtime ??= import(url) as Promise<AutosaveRuntime>;
            const runtime = await bridge.runtime;
            const named = runtime.createStudioAutosaveOpfsSession;
            if (typeof named === "function") return named;
            // A production chunk renames every top-level export
            // (`export{ee as i,S as n,x as r,L as t}`), so a name lookup only works on a dev
            // server. Studio itself reaches this module through
            // `import(chunk).then(module => module.n)` — one of those mangled exports is a
            // namespace object that still carries the authored property names, which is what
            // keeps the app's own destructuring readable. Take the same door.
            for (const exported of Object.values(runtime)) {
              const factory = await Promise.resolve(exported as AutosaveRuntime)
                .then((namespace) => namespace?.createStudioAutosaveOpfsSession)
                .catch(() => undefined);
              if (typeof factory === "function") return factory;
            }
            throw new Error(
              `no autosave session factory export was found in ${url}`,
            );
          })();
          return bridge.factory;
        },
        async open(key, readOnly) {
          const cacheKey = `${readOnly ? "reader" : "writer"}:${key}`;
          const cached = bridge.sessions.get(cacheKey);
          if (cached) return cached;
          const opened = (async () => {
            const factory = await bridge.resolveFactory();
            return factory(key, undefined, { readOnly });
          })();
          bridge.sessions.set(cacheKey, opened);
          // A rejected open must not be cached: a polling reader has to be able to retry
          // through a transient journal failure.
          opened.catch(() => bridge.sessions.delete(cacheKey));
          return opened;
        },
      };
      holder[globalName] = bridge;
    },
    { globalName: BRIDGE_GLOBAL, presetModuleUrl: moduleUrl },
  );
}

/**
 * Read the newest durable autosave document for `autosaveKey`.
 *
 * Returns `null` when the document has never been written, when the shipped session
 * reports a `cleared` tombstone, and when a concurrent writer is publishing the next
 * immutable head — the last case stores its cause for {@link readDurableStudioAutosaveError}
 * so a polling caller can keep retrying and still report why it never settled.
 */
export async function readDurableStudioAutosaveDocument(
  page: Page,
  autosaveKey: string,
  options: { readonly moduleUrl?: string | null } = {},
): Promise<StudioDurableAutosaveDocument | null> {
  await installBridge(page, options.moduleUrl ?? null);
  const result = await page.evaluate(
    async ({ globalName, key }): Promise<DurableAutosaveReadResult> => {
      interface AutosaveSession {
        readLatest: () => Promise<
          | { state: "snapshot"; savedAt: string; payload: Record<string, unknown> }
          | { state: "cleared"; savedAt: string }
          | null
        >;
      }
      interface AutosaveBridge {
        moduleUrl: string | null;
        lastError: string | null;
        open: (key: string, readOnly: boolean) => Promise<AutosaveSession | null>;
      }
      const bridge = (window as typeof window & Record<string, unknown>)[
        globalName
      ] as AutosaveBridge;
      try {
        const session = await bridge.open(key, true);
        const latest = await session?.readLatest() ?? null;
        bridge.lastError = null;
        if (!latest || latest.state !== "snapshot") {
          return { document: null, error: null, moduleUrl: bridge.moduleUrl };
        }
        const payload = latest.payload;
        const pagesList = Array.isArray(payload.pagesList) ? payload.pagesList : null;
        if (!pagesList) {
          return { document: null, error: null, moduleUrl: bridge.moduleUrl };
        }
        return {
          document: {
            key,
            raw: JSON.stringify(payload),
            savedAt: typeof payload.savedAt === "string" ? payload.savedAt : latest.savedAt,
            currentPageId:
              typeof payload.currentPageId === "string" ? payload.currentPageId : null,
            pagesList,
          },
          error: null,
          moduleUrl: bridge.moduleUrl,
        };
      } catch (error) {
        // A writer may be publishing the next immutable head while this advisory reader
        // polls. Keep the failure for timeout diagnostics instead of masking it.
        bridge.lastError = String(error);
        return { document: null, error: bridge.lastError, moduleUrl: bridge.moduleUrl };
      }
    },
    { globalName: BRIDGE_GLOBAL, key: autosaveKey },
  );
  return result.document;
}

/** Cause of the most recent failed durable read on this page, if there was one. */
export async function readDurableStudioAutosaveError(page: Page): Promise<string | null> {
  return page.evaluate((globalName) => {
    const bridge = (window as typeof window & Record<string, unknown>)[globalName] as
      | { lastError: string | null }
      | undefined;
    return bridge?.lastError ?? null;
  }, BRIDGE_GLOBAL);
}

/**
 * URL of the shipped autosave session chunk this page resolved, so a sibling page on the
 * same origin — one that never mounted Studio and therefore never loaded the chunk — can
 * be handed the same module.
 */
export async function resolveDurableStudioAutosaveModuleUrl(
  page: Page,
): Promise<string | null> {
  await installBridge(page, null);
  return page.evaluate(async (globalName) => {
    const bridge = (window as typeof window & Record<string, unknown>)[globalName] as {
      resolveModuleUrl: () => Promise<string | null>;
    };
    return bridge.resolveModuleUrl();
  }, BRIDGE_GLOBAL);
}

/**
 * Write `raw` (a serialized autosave payload from
 * {@link readDurableStudioAutosaveDocument}) into this page's OPFS autosave journal.
 *
 * OPFS is BrowserContext-scoped and Playwright's `storageState` carries only cookies and
 * localStorage, so transplanting a fixture into a second context needs the document to be
 * re-persisted through the shipped writer. Run this on a page that has NOT mounted Studio:
 * the editor owns the document's writer lease while it is open.
 */
export async function seedDurableStudioAutosaveDocument(
  page: Page,
  autosaveKey: string,
  raw: string,
  moduleUrl: string | null,
): Promise<void> {
  await installBridge(page, moduleUrl);
  const failure = await page.evaluate(
    async ({ globalName, key, serialized }): Promise<string | null> => {
      interface AutosaveSession {
        write: (payload: Record<string, unknown>) => Promise<unknown>;
        dispose: () => Promise<void>;
      }
      interface AutosaveBridge {
        open: (key: string, readOnly: boolean) => Promise<AutosaveSession | null>;
      }
      const bridge = (window as typeof window & Record<string, unknown>)[
        globalName
      ] as AutosaveBridge;
      let session: AutosaveSession | null = null;
      try {
        session = await bridge.open(key, false);
        if (!session) return "the shipped autosave session refused to open for writing";
        await session.write(JSON.parse(serialized) as Record<string, unknown>);
        return null;
      } catch (error) {
        return String(error);
      } finally {
        // Hand the writer lease back before the editor opens the same document.
        await session?.dispose().catch(() => undefined);
      }
    },
    { globalName: BRIDGE_GLOBAL, key: autosaveKey, serialized: raw },
  );
  if (failure) throw new Error(`durable autosave seeding failed: ${failure}`);
}
