/**
 * Client half of the Service Worker contract: registration, the update prompt,
 * and the field-recovery kill switch.
 *
 * Loaded through a dynamic `import()` from `main.tsx` after `load`, so none of
 * this joins the app entry chunk or competes with first paint.
 *
 * Update UX, stated plainly, because a creative tool gets exactly one chance to
 * get this right:
 *
 *  1. A new worker installs in the background and *parks in `waiting`*. It
 *     controls nothing, purges nothing, and the running build keeps every lazy
 *     chunk it already had. There is no mid-stroke swap, ever.
 *  2. The artist is told with a dismissible prompt. Nothing is forced.
 *  3. Applying is a normal `location.reload()` from a user gesture, so Studio's
 *     own `beforeunload` guard fires and the browser asks about unsaved work.
 *     No bespoke coupling to editor state, and no path where the reload wins
 *     over the artist.
 */
import {
  STUDIO_SERVICE_WORKER_CACHE_PREFIX,
  STUDIO_SERVICE_WORKER_MESSAGE,
} from "./studio-service-worker-policy";

const SERVICE_WORKER_URL = "/sw.js";
/** Append to any URL to recover from a bad worker. Documented in DEPLOY.md. */
export const STUDIO_SERVICE_WORKER_RESET_QUERY = "__toonspectrumSwReset";
const RESET_SESSION_KEY = "toonspectrum:sw-reset:v1";
const UPDATE_ATTRIBUTE = "data-studio-sw-update";

export type StudioServiceWorkerClientStatus =
  | "unsupported"
  | "registering"
  | "active"
  | "update-waiting"
  | "reset"
  | "failed";

interface StudioServiceWorkerClientApi {
  readonly status: StudioServiceWorkerClientStatus;
  applyUpdate(): Promise<void>;
  reset(): Promise<void>;
  inspect(): Promise<unknown>;
}

let current: StudioServiceWorkerClientStatus = "registering";
let waitingWorker: ServiceWorker | null = null;

function publishStatus(next: StudioServiceWorkerClientStatus): void {
  current = next;
  document.documentElement.setAttribute(UPDATE_ATTRIBUTE, next);
  globalThis.dispatchEvent(
    new CustomEvent("toonspectrum:service-worker", { detail: { status: next } }),
  );
}

/** Purges every cache this app owns. Safe: no artist data lives in the Cache
 * API — documents are in OPFS/SQLite, which this never touches. */
async function purgeOwnedCaches(): Promise<void> {
  if (!("caches" in globalThis)) return;
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter(
        (key) =>
          key.startsWith(STUDIO_SERVICE_WORKER_CACHE_PREFIX)
          || key.startsWith("toonspectrum-pwa-")
          || key.startsWith("toonspectrum-covers-"),
      )
      .map((key) => caches.delete(key)),
  );
}

/**
 * Unregisters every worker on this origin and drops our caches. Reachable
 * without any application code running, which is what makes it a real recovery
 * path rather than a debug affordance.
 */
export async function resetStudioServiceWorker(): Promise<void> {
  const registrations = await navigator.serviceWorker
    .getRegistrations()
    .catch(() => []);
  await Promise.all(registrations.map((entry) => entry.unregister()));
  await purgeOwnedCaches();
  publishStatus("reset");
}

function consumeResetRequest(): boolean {
  const url = new URL(globalThis.location.href);
  if (url.searchParams.get(STUDIO_SERVICE_WORKER_RESET_QUERY) !== "1") {
    return false;
  }
  url.searchParams.delete(STUDIO_SERVICE_WORKER_RESET_QUERY);
  try {
    // One reload per session: a reset that somehow does not stick must not
    // trap the browser in a loop.
    if (sessionStorage.getItem(RESET_SESSION_KEY) === "done") return true;
    sessionStorage.setItem(RESET_SESSION_KEY, "done");
  } catch {
    return true;
  }
  void resetStudioServiceWorker().finally(() => {
    globalThis.location.replace(url.toString());
  });
  return true;
}

async function messageWorker(
  worker: ServiceWorker,
  type: string,
): Promise<unknown> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(undefined), 3_000);
    channel.port1.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}

function renderUpdatePrompt(onApply: () => void): void {
  if (document.getElementById("toonspectrum-sw-update")) return;
  const host = document.createElement("div");
  host.id = "toonspectrum-sw-update";
  // A shadow root keeps this prompt out of reach of the app's cascade — and
  // keeps it from perturbing Studio's own layout.
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .card {
        position: fixed; inset-block-end: 16px; inset-inline-start: 16px;
        z-index: 2147483000; display: flex; gap: 12px; align-items: center;
        padding: 10px 12px; border-radius: 10px;
        font: 500 13px/1.4 system-ui, -apple-system, sans-serif;
        color: #f8fafc; background: #1e293b;
        box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
      }
      button {
        font: inherit; cursor: pointer; border-radius: 6px;
        border: 1px solid transparent; padding: 5px 10px;
      }
      .apply { background: #6366f1; color: #fff; }
      .dismiss { background: transparent; color: #cbd5e1; border-color: #475569; }
    </style>
    <div class="card" role="status">
      <span>새 버전이 준비됐습니다.</span>
      <button class="apply" type="button">새로고침</button>
      <button class="dismiss" type="button">나중에</button>
    </div>`;
  root.querySelector<HTMLButtonElement>(".apply")?.addEventListener(
    "click",
    onApply,
  );
  root.querySelector<HTMLButtonElement>(".dismiss")?.addEventListener(
    "click",
    () => host.remove(),
  );
  document.body.append(host);
}

/**
 * Hands control to the waiting worker and reloads. `location.reload()` is a
 * plain navigation, so any `beforeunload` guard Studio installed still gets to
 * warn about unsaved work — the artist keeps the final say.
 */
export async function applyStudioServiceWorkerUpdate(): Promise<void> {
  const worker = waitingWorker;
  if (!worker) return;
  await messageWorker(worker, STUDIO_SERVICE_WORKER_MESSAGE.applyUpdate);
  globalThis.location.reload();
}

function watchForUpdate(registration: ServiceWorkerRegistration): void {
  const announce = (worker: ServiceWorker | null): void => {
    // `controller` being present is what distinguishes "an update is waiting"
    // from "this is the very first install", which must stay silent.
    if (!worker || !navigator.serviceWorker.controller) return;
    waitingWorker = worker;
    publishStatus("update-waiting");
    renderUpdatePrompt(() => {
      void applyStudioServiceWorkerUpdate();
    });
  };

  announce(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") announce(registration.waiting);
    });
  });
}

export function registerStudioServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    publishStatus("unsupported");
    return;
  }
  if (consumeResetRequest()) return;

  const api: StudioServiceWorkerClientApi = {
    get status() {
      return current;
    },
    applyUpdate: applyStudioServiceWorkerUpdate,
    reset: resetStudioServiceWorker,
    inspect: async () => {
      const worker = navigator.serviceWorker.controller;
      return worker
        ? messageWorker(worker, STUDIO_SERVICE_WORKER_MESSAGE.inspect)
        : undefined;
    },
  };
  Object.defineProperty(globalThis, "__toonspectrumServiceWorker", {
    value: api,
    configurable: true,
  });

  publishStatus("registering");
  navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" }).then(
    (registration) => {
      if (!registration) {
        publishStatus("failed");
        return;
      }
      publishStatus(
        navigator.serviceWorker.controller ? "active" : "registering",
      );
      watchForUpdate(registration);
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        publishStatus("active");
      });
    },
    () => {
      publishStatus("failed");
    },
  );
}
