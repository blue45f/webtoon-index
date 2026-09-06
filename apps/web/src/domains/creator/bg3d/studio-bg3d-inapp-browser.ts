/**
 * GPU trust policy for the host the studio is running inside.
 *
 * Detection itself lives in `src/compat/in-app-browser.ts`, which the mobile shell already uses and
 * which a dedicated route sweep verifies. This module only answers the question that detector does
 * not: how far a given host can be trusted with a WebGPU device.
 *
 * The distinction matters because three properties of an embedded WebView bear on a renderer, and
 * none of them are visible to a capability probe:
 *
 * 1. the GPU process belongs to the host application and is reclaimed under memory pressure, so an
 *    adapter that probes successfully can still disappear mid-session;
 * 2. the artist cannot open devtools, switch renderers, or reload without losing the host context;
 * 3. `navigator.gpu` may exist while the embedder never hands out a usable device.
 */

import {
  diagnoseStudioInAppBrowser,
  type StudioInAppBrowserId,
  type StudioInAppBrowserPlatform,
} from "../../../compat/in-app-browser";

/**
 * How far the host may be trusted with a WebGPU device.
 *
 * - `trusted`: a standalone browser; `auto` may promote to WebGPU once the adapter probe passes.
 * - `opt-in`: a WebView that can run WebGPU but cannot recover visibly from device loss, so `auto`
 *   stays on WebGL2 and only an explicit artist choice promotes it.
 * - `blocked`: a host where a WebGPU device is known to be unusable or unrecoverable; even an
 *   explicit choice is refused so the editor never presents a dead viewport.
 */
export type StudioBg3dInAppBrowserGpuTrust = "trusted" | "opt-in" | "blocked";

export interface StudioBg3dInAppBrowserSignals {
  readonly userAgent?: string;
}

export interface StudioBg3dInAppBrowserProfile {
  /** `null` in a standalone browser. */
  readonly id: StudioInAppBrowserId | null;
  readonly platform: StudioInAppBrowserPlatform;
  readonly isInApp: boolean;
  readonly gpuTrust: StudioBg3dInAppBrowserGpuTrust;
  /** Korean, user-facing, for the engine status surface. */
  readonly label: string;
}

/**
 * Hosts whose embedded browser has repeatedly failed to produce a usable WebGPU device. Everything
 * else that is in-app gets `opt-in`: capable of WebGPU, but not trusted to keep it.
 */
const BLOCKED_HOSTS: ReadonlySet<StudioInAppBrowserId> = new Set<StudioInAppBrowserId>([
  "facebook",
  "instagram",
  "threads",
]);

const GENERIC_LABELS: Readonly<Record<"android-webview" | "ios-webview", string>> = Object.freeze({
  "android-webview": "안드로이드 웹뷰",
  "ios-webview": "iOS 웹뷰",
});

const STANDALONE: StudioBg3dInAppBrowserProfile = Object.freeze({
  id: null,
  platform: "unknown",
  isInApp: false,
  gpuTrust: "trusted",
  label: "일반 브라우저",
});

function label(id: StudioInAppBrowserId, name: string | null): string {
  if (id === "android-webview" || id === "ios-webview") return GENERIC_LABELS[id];
  return name === null ? "인앱 브라우저" : `${name} 인앱 브라우저`;
}

/** Classifies the embedding host and the WebGPU trust that follows from it. */
export function classifyStudioBg3dInAppBrowser(
  signals: StudioBg3dInAppBrowserSignals,
): StudioBg3dInAppBrowserProfile {
  const diagnosis = diagnoseStudioInAppBrowser({ userAgent: signals?.userAgent ?? null });
  if (!diagnosis.inApp || diagnosis.id === null) {
    return diagnosis.platform === STANDALONE.platform
      ? STANDALONE
      : Object.freeze({ ...STANDALONE, platform: diagnosis.platform });
  }
  return Object.freeze({
    id: diagnosis.id,
    platform: diagnosis.platform,
    isInApp: true,
    gpuTrust: BLOCKED_HOSTS.has(diagnosis.id) ? "blocked" : "opt-in",
    label: label(diagnosis.id, diagnosis.name),
  });
}
