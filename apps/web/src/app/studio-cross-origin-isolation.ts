/**
 * Studio-only cross-origin isolation contract.
 *
 * The public site deliberately stays outside COOP/COEP so OAuth and third-party
 * popups keep their normal opener relationship. Direct `/studio` documents opt
 * into isolation, while an SPA navigation from a non-isolated document performs
 * one guarded reload before any Studio route is mounted.
 */

import { allowStudioProgrammaticReload } from "../domains/creator/studio-unsaved-work-guard";

export const STUDIO_CROSS_ORIGIN_ISOLATION_HEADERS = Object.freeze({
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Permissions-Policy":
    "camera=(self), microphone=(), geolocation=(), cross-origin-isolated=(self)",
} as const);

/**
 * A dedicated Worker is its own embedder-policy context. The top-level Worker
 * response must opt into the same COEP contract as the Studio document or
 * Chromium blocks the module before its first statement executes.
 */
export const STUDIO_CROSS_ORIGIN_ISOLATION_WORKER_HEADERS = Object.freeze({
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const);

export const STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_HISTORY_KEY =
  "__toonspectrumStudioIsolationReloadV1";
export const STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY =
  "toonspectrum:studio-isolation-reload:v1";

export type StudioCrossOriginIsolationStatus =
  | "not-studio"
  | "enabled"
  | "reload-required"
  | "reload-requested"
  | "unavailable-after-reload"
  | "public-reload-required"
  | "public-reload-requested"
  | "public-reload-attempted"
  | "public-still-isolated"
  | "reload-guard-unavailable"
  | "reload-failed";

export interface StudioCrossOriginIsolationDiagnostic {
  readonly status: StudioCrossOriginIsolationStatus;
  readonly highPerformanceMode: boolean;
  readonly crossOriginIsolated: boolean;
  readonly reloadAttempted: boolean;
}

interface StudioDocumentRequest {
  readonly url?: string | null;
  readonly method?: string | null;
  readonly accept?: string | null;
  readonly secFetchDest?: string | null;
}

interface StudioHistoryLike {
  readonly state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

interface StudioLocationLike {
  readonly href: string;
  reload(): void;
}

interface StudioSessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StudioCrossOriginIsolationGlobals {
  readonly crossOriginIsolated?: boolean;
  readonly history?: StudioHistoryLike;
  readonly location?: StudioLocationLike;
  readonly sessionStorage?: StudioSessionStorageLike;
}

export interface StudioCrossOriginIsolationReloadResult {
  readonly diagnostic: StudioCrossOriginIsolationDiagnostic;
  readonly reloadRequested: boolean;
}

export interface StudioCrossOriginIsolationDocumentContext {
  /**
   * Whether this browser document was originally delivered for a Studio path.
   * This is intentionally independent of the current SPA pathname and
   * `crossOriginIsolated`: a COOP-only document reports false isolation but
   * still needs a full reload before public OAuth/popup routes are mounted.
   */
  readonly documentWasStudio: boolean;
}

interface StudioDiagnosticElement {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

function safely<Value>(read: () => Value, fallback: Value): Value {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function isStudioCrossOriginIsolationPath(pathname: string): boolean {
  return pathname === "/studio" || pathname.startsWith("/studio/");
}

function pathnameFromRequestUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, "http://vite.local").pathname;
  } catch {
    return null;
  }
}

function isViteStudioWorkerAssetUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, "http://vite.local");
    if (
      /(?:^|\/)assets\/studio-[^/]+\.worker-[A-Za-z0-9_-]+\.js$/.test(
        parsed.pathname,
      )
    ) {
      return true;
    }
    // Dev-server module workers and service-worker re-fetches of the same file
    // both use the `studio-*.worker.ts` stem. Vite may add `?worker_file`; a
    // controlling SW often drops that query and sends `Sec-Fetch-Dest: empty`.
    return /(?:^|\/)studio-[^/]+\.worker\.[cm]?[jt]sx?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Vite middleware admission. Only navigation-like GET/HEAD requests under the
 * Studio path receive document isolation headers; JS, images, API calls and the
 * `/studio-live` WebSocket endpoint are left untouched.
 */
export function isStudioCrossOriginIsolationDocumentRequest(
  request: StudioDocumentRequest,
): boolean {
  const method = request.method?.toUpperCase() ?? "GET";
  if (method !== "GET" && method !== "HEAD") return false;

  const pathname = pathnameFromRequestUrl(request.url);
  if (pathname === null || !isStudioCrossOriginIsolationPath(pathname)) return false;

  const destination = request.secFetchDest?.trim().toLowerCase();
  const accept = request.accept?.toLowerCase();
  const explicitlyAcceptsHtml = Boolean(
    accept?.includes("text/html") || accept?.includes("application/xhtml+xml"),
  );
  // A controlling service worker's network-first `fetch(navigationRequest)` can
  // reach Vite/Vercel with `Sec-Fetch-Dest: empty` even though its Accept header
  // still identifies an HTML navigation. Keep that route isolatable, but never
  // let a script/image request with a generic `*/*` Accept inherit document headers.
  if (destination && destination !== "document" && destination !== "iframe") {
    return explicitlyAcceptsHtml;
  }
  return (
    !accept
    || explicitlyAcceptsHtml
    || accept.includes("*/*")
  );
}

export function isStudioCrossOriginIsolationWorkerRequest(
  request: StudioDocumentRequest,
): boolean {
  const method = request.method?.toUpperCase() ?? "GET";
  if (method !== "GET" && method !== "HEAD") return false;

  const destination = request.secFetchDest?.trim().toLowerCase();
  if (destination === "worker" || destination === "sharedworker") return true;

  // A controlling service worker can re-fetch a Vite-built module Worker
  // without forwarding the original Worker destination metadata, so the
  // origin sees `Sec-Fetch-Dest: empty` (or no destination) with `Accept: */*`.
  // Recognize Vite's immutable Worker asset naming contract so that response
  // still receives COEP/CORP, while direct document navigations stay plain.
  if (
    destination === "document"
    || destination === "frame"
    || destination === "iframe"
  ) {
    return false;
  }
  if (!isViteStudioWorkerAssetUrl(request.url)) return false;
  const accept = request.accept?.trim().toLowerCase();
  if (
    accept?.includes("text/html")
    || accept?.includes("application/xhtml+xml")
  ) {
    return false;
  }
  return (
    !accept
    || accept.includes("*/*")
    || accept.includes("javascript")
  );
}

type StudioIsolationReloadDirection = "studio-entry" | "public-exit";

function reloadHistoryDirection(state: unknown): StudioIsolationReloadDirection | null {
  if (state === null || typeof state !== "object") return null;
  const value = safely(
    () => (state as Record<string, unknown>)[
      STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_HISTORY_KEY
    ],
    undefined,
  );
  if (value === "studio-entry" || value === "public-exit") return value;
  // Pre-directional V1 markers represented Studio entry attempts only.
  return value === true ? "studio-entry" : null;
}

function reloadSessionDirection(
  storage: StudioSessionStorageLike | undefined,
): StudioIsolationReloadDirection | null {
  if (!storage) return null;
  const value = safely(
    () => storage.getItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY),
    null,
  );
  return value === "studio-entry" || value === "public-exit" ? value : null;
}

function clearReloadSessionMarker(storage: StudioSessionStorageLike | undefined): void {
  if (!storage) return;
  safely(() => storage.removeItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY), undefined);
}

function withReloadHistoryMarker(
  state: unknown,
  direction: StudioIsolationReloadDirection,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  if (state !== null && typeof state === "object" && !Array.isArray(state)) {
    for (const key of safely(() => Object.keys(state), [] as string[])) {
      next[key] = safely(() => (state as Record<string, unknown>)[key], undefined);
    }
  }
  next[STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_HISTORY_KEY] = direction;
  return next;
}

function diagnostic(
  status: StudioCrossOriginIsolationStatus,
  crossOriginIsolated: boolean,
  reloadAttempted: boolean,
): StudioCrossOriginIsolationDiagnostic {
  return Object.freeze({
    status,
    highPerformanceMode: status === "enabled" && crossOriginIsolated,
    crossOriginIsolated,
    reloadAttempted,
  });
}

export function diagnoseStudioCrossOriginIsolation(
  pathname: string,
  crossOriginIsolated: boolean,
  historyState: unknown,
  sessionReloadDirection: StudioIsolationReloadDirection | null = null,
  context: StudioCrossOriginIsolationDocumentContext = {
    documentWasStudio: isStudioCrossOriginIsolationPath(pathname),
  },
): StudioCrossOriginIsolationDiagnostic {
  const historyReloadDirection = reloadHistoryDirection(historyState);
  if (!isStudioCrossOriginIsolationPath(pathname)) {
    if (!crossOriginIsolated && !context.documentWasStudio) {
      return diagnostic("not-studio", false, sessionReloadDirection === "public-exit");
    }
    const publicReloadAttempted =
      sessionReloadDirection === "public-exit"
      || (
        sessionReloadDirection === null
        && historyReloadDirection === "public-exit"
      );
    if (publicReloadAttempted) {
      return diagnostic(
        crossOriginIsolated ? "public-still-isolated" : "public-reload-attempted",
        crossOriginIsolated,
        true,
      );
    }
    return diagnostic("public-reload-required", crossOriginIsolated, false);
  }
  if (crossOriginIsolated) {
    return diagnostic(
      "enabled",
      true,
      historyReloadDirection === "studio-entry"
      || sessionReloadDirection === "studio-entry",
    );
  }
  const studioReloadAttempted =
    sessionReloadDirection === "studio-entry"
    || (
      sessionReloadDirection === null
      && historyReloadDirection === "studio-entry"
    );
  if (context.documentWasStudio && studioReloadAttempted) {
    return diagnostic("unavailable-after-reload", false, true);
  }
  if (
    !context.documentWasStudio
    && sessionReloadDirection === "studio-entry"
    && historyReloadDirection === "studio-entry"
  ) {
    // The reload was requested by this still-public document but has not
    // committed yet (for example during a Strict Mode effect replay).
    return diagnostic("reload-requested", false, true);
  }
  return diagnostic("reload-required", false, false);
}

export function diagnoseStudioCrossOriginIsolationFromGlobals(
  pathname: string,
  globals: StudioCrossOriginIsolationGlobals = globalThis as StudioCrossOriginIsolationGlobals,
  context: StudioCrossOriginIsolationDocumentContext = {
    documentWasStudio: isStudioCrossOriginIsolationPath(pathname),
  },
): StudioCrossOriginIsolationDiagnostic {
  const isolated = safely(() => globals.crossOriginIsolated === true, false);
  const historyState = safely(() => globals.history?.state, null);
  const storage = safely(() => globals.sessionStorage, undefined);
  return diagnoseStudioCrossOriginIsolation(
    pathname,
    isolated,
    historyState,
    reloadSessionDirection(storage),
    context,
  );
}

/**
 * Requests at most one reload for a single browser history entry.
 *
 * The marker is written to `history.state` before reloading and preserves React
 * Router's existing `usr`/`key`/`idx` fields. If the marker cannot be written,
 * reloading is skipped entirely: this is the fail-safe that prevents an
 * unsupported or storage-restricted browser from entering an infinite loop.
 */
export function requestStudioCrossOriginIsolationReload(
  pathname: string,
  globals: StudioCrossOriginIsolationGlobals = globalThis as StudioCrossOriginIsolationGlobals,
  context: StudioCrossOriginIsolationDocumentContext = {
    documentWasStudio: isStudioCrossOriginIsolationPath(pathname),
  },
): StudioCrossOriginIsolationReloadResult {
  const initial = diagnoseStudioCrossOriginIsolationFromGlobals(pathname, globals, context);
  if (
    initial.status !== "reload-required"
    && initial.status !== "public-reload-required"
  ) {
    if (initial.status === "enabled" || initial.status === "not-studio") {
      clearReloadSessionMarker(safely(() => globals.sessionStorage, undefined));
    }
    return { diagnostic: initial, reloadRequested: false };
  }

  const history = safely(() => globals.history, undefined);
  const location = safely(() => globals.location, undefined);
  const storage = safely(() => globals.sessionStorage, undefined);
  if (!history || !location || !storage) {
    return {
      diagnostic: diagnostic(
        "reload-guard-unavailable",
        initial.crossOriginIsolated,
        false,
      ),
      reloadRequested: false,
    };
  }

  try {
    const direction: StudioIsolationReloadDirection =
      initial.status === "reload-required" ? "studio-entry" : "public-exit";
    storage.setItem(STUDIO_CROSS_ORIGIN_ISOLATION_RELOAD_SESSION_KEY, direction);
    if (reloadSessionDirection(storage) !== direction) {
      throw new Error("session guard was not retained");
    }
    const currentState = safely(() => history.state, null);
    history.replaceState(
      withReloadHistoryMarker(currentState, direction),
      "",
      location.href,
    );
  } catch {
    clearReloadSessionMarker(storage);
    return {
      diagnostic: diagnostic(
        "reload-guard-unavailable",
        initial.crossOriginIsolated,
        false,
      ),
      reloadRequested: false,
    };
  }

  try {
    allowStudioProgrammaticReload();
    location.reload();
    return {
      diagnostic: diagnostic(
        initial.status === "reload-required"
          ? "reload-requested"
          : "public-reload-requested",
        initial.crossOriginIsolated,
        true,
      ),
      reloadRequested: true,
    };
  } catch {
    return {
      diagnostic: diagnostic("reload-failed", initial.crossOriginIsolated, true),
      reloadRequested: false,
    };
  }
}

/**
 * Small, non-sensitive runtime diagnostic for DevTools and browser QA.
 * Existing Studio capability probing independently reads
 * `globalThis.crossOriginIsolated`, so a false value also lowers shared-memory
 * budgets without blocking the editor.
 */
export function publishStudioCrossOriginIsolationDiagnostic(
  value: StudioCrossOriginIsolationDiagnostic,
  element: StudioDiagnosticElement | null | undefined = safely(
    () => globalThis.document?.documentElement,
    undefined,
  ),
): void {
  if (!element) return;
  if (value.status === "not-studio") {
    element.removeAttribute("data-studio-cross-origin-isolation");
    element.removeAttribute("data-studio-high-performance");
    element.removeAttribute("data-studio-isolation-reload-attempted");
    return;
  }
  element.setAttribute("data-studio-cross-origin-isolation", value.status);
  element.setAttribute("data-studio-high-performance", String(value.highPerformanceMode));
  element.setAttribute("data-studio-isolation-reload-attempted", String(value.reloadAttempted));
}
