import { io } from "socket.io-client";

import {
  resolveStudioCloudflareRealtimeOrigin,
} from "../studio-realtime-provider-cloudflare-adapter";

import {
  parseStudioLiveGesturePreviewPayload,
  type StudioLiveGesturePreviewPayload,
} from "./studio-live-gesture-preview";
import {
  createStudioCloudflarePurposeRoutedLiveTransportFactory,
} from "./studio-live-purpose-routed-transport";
import { resolveStudioLiveSocketEndpoint } from "./studio-live-socket-endpoint";
import { isRecord, safeIdentifier } from "./studio-live-socket-wire";

import type { StudioLiveTransportFactory } from "./studio-live-collaboration-transport";

const SOCKET_PATH = "/socket.io";
export const CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_STUDIO_REALTIME_PROVIDER_ID = "cloudflare-realtime-v1";
const STUDIO_REALTIME_PROVIDER_ID =
  /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,159}$/u;

/**
 * Bounded retries still cover a free container's cold start. Production never constructs this
 * socket without an explicit long-running origin, so the larger window cannot revive the old
 * Vercel-serverless reconnect loop.
 */
export const STUDIO_LIVE_SOCKET_RETRY_POLICY = Object.freeze({
  reconnection: true,
  reconnectionAttempts: 8,
  reconnectionDelay: 1_000,
  reconnectionDelayMax: 8_000,
  randomizationFactor: 0.25,
  timeout: CONNECT_TIMEOUT_MS,
});

export interface StudioLiveSocketLike {
  connected: boolean;
  auth: Record<string, unknown>;
  connect(): StudioLiveSocketLike;
  disconnect(): StudioLiveSocketLike;
  emit(event: string, ...args: unknown[]): StudioLiveSocketLike;
  on(event: string, listener: (...args: unknown[]) => void): StudioLiveSocketLike;
  off(event: string, listener: (...args: unknown[]) => void): StudioLiveSocketLike;
}

export interface StudioLiveSocketRuntimeEnvironment {
  readonly explicitOrigin?: string | null;
  readonly locationOrigin?: string | null;
  readonly development?: boolean;
  /**
   * Vite's same-origin Socket.IO proxy is intentionally opt-in. A development build alone is not
   * proof that the proxy exists (production-preview harnesses also execute Vite output locally).
   */
  readonly devProxyEnabled?: boolean;
}

export interface StudioLiveGesturePreviewSocketRelay {
  readonly connectionId: string;
  readonly preview: StudioLiveGesturePreviewPayload;
}

export function parseStudioLiveGesturePreviewSocketRelay(
  value: unknown,
): StudioLiveGesturePreviewSocketRelay | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "connectionId") ||
    !Object.hasOwn(value, "preview") ||
    !safeIdentifier(value.connectionId, 128)
  ) {
    return null;
  }
  const preview = parseStudioLiveGesturePreviewPayload(value.preview);
  return preview ? { connectionId: value.connectionId, preview } : null;
}

function nonBlank(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/**
 * Runtime admission policy for Socket.IO. Missing configuration is a deliberate local-only mode,
 * never an instruction to probe the current static/Vercel origin and start a reconnect loop.
 */
export function resolveStudioLiveSocketRuntimeEndpoint(
  environment: StudioLiveSocketRuntimeEnvironment,
): string | null {
  const explicitOrigin = nonBlank(environment.explicitOrigin);
  if (explicitOrigin) {
    try {
      const url = new URL(explicitOrigin);
      if (url.pathname !== "/" || url.search || url.hash) return null;
    } catch {
      // Relative Vite/API paths are not proof of a long-running realtime origin.
      return null;
    }
    return resolveStudioLiveSocketEndpoint({
      explicitOrigin,
      locationOrigin: environment.locationOrigin,
      allowInsecureLoopback: environment.development === true,
      localDevelopment: environment.development === true,
    });
  }

  if (environment.development === true && environment.devProxyEnabled === true) {
    return "/studio-live";
  }
  return null;
}

export function runtimeSocketEndpoint(): string | null {
  // Socket.IO is only for a long-running Nest CRDT/lock host (`VITE_STUDIO_LIVE_ORIGIN`).
  // `VITE_STUDIO_REALTIME_ORIGIN` is the Cloudflare Durable Object data plane for presence,
  // comment invalidation, and screen-share signaling — it speaks a custom WS protocol, not
  // Engine.IO. Falling back to it here produced endless
  // `wss://…workers.dev/socket.io/?EIO=4&transport=websocket` failures in production.
  return resolveStudioLiveSocketRuntimeEndpoint({
    explicitOrigin: import.meta.env.VITE_STUDIO_LIVE_ORIGIN,
    locationOrigin: globalThis.location?.origin,
    development: import.meta.env.DEV,
    devProxyEnabled:
      import.meta.env.VITE_STUDIO_LIVE_DEV_PROXY_ENABLED === "true",
  });
}

export interface StudioRealtimePurposeRoutingEnvironment {
  readonly realtimeOrigin?: string;
  readonly providerId?: string;
}

function resolveStudioRealtimeProviderId(
  value: string | null | undefined,
): string | null {
  const providerId = value?.trim() || DEFAULT_STUDIO_REALTIME_PROVIDER_ID;
  return STUDIO_REALTIME_PROVIDER_ID.test(providerId) ? providerId : null;
}

/**
 * Activates the purpose-specific Cloudflare data plane only for an exact HTTPS origin. Missing or
 * malformed browser configuration leaves the proven primary transport untouched. The ticket
 * endpoint intentionally remains the same trusted API base so its HttpOnly cookie and CSRF
 * boundary cannot be redirected to a runtime-configured third-party origin.
 */
export function applyStudioRealtimePurposeRouting(
  primaryFactory: StudioLiveTransportFactory,
  environment: StudioRealtimePurposeRoutingEnvironment,
): StudioLiveTransportFactory {
  const realtimeOrigin = resolveStudioCloudflareRealtimeOrigin(
    environment.realtimeOrigin,
  );
  const providerId = resolveStudioRealtimeProviderId(environment.providerId);
  if (!realtimeOrigin || !providerId) return primaryFactory;
  return (context) => {
    const primary = primaryFactory(context);
    // A browser-local BroadcastChannel cannot provide remote CRDT/locks/chat authority. Wrapping
    // it with remote presence would advertise collaborators the document path can never reach.
    if (primary.mode !== "server") return primary;
    return createStudioCloudflarePurposeRoutedLiveTransportFactory({
      primaryFactory: () => primary,
      realtimeOrigin,
      providerId,
    })(context);
  };
}

export function createSocketAtEndpoint(
  endpoint: string,
  auth: { sessionToken: string },
): StudioLiveSocketLike {
  return io(
    endpoint,
    {
      path: SOCKET_PATH,
      transports: ["websocket"],
      autoConnect: false,
      ...STUDIO_LIVE_SOCKET_RETRY_POLICY,
      auth,
    }
  ) as unknown as StudioLiveSocketLike;
}

export function defaultCreateSocket(auth: { sessionToken: string }): StudioLiveSocketLike {
  const endpoint = runtimeSocketEndpoint();
  if (!endpoint) {
    throw new Error(
      "실시간 서버가 구성되지 않아 네트워크 연결 대신 로컬 공동작업을 사용해야 합니다.",
    );
  }
  return createSocketAtEndpoint(endpoint, auth);
}

export function defaultSetTimeout(handler: () => void, delay: number): unknown {
  return globalThis.setTimeout(handler, delay);
}

export function defaultClearTimeout(handle: unknown): void {
  globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
}

export function defaultRandomId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("보안 잠금 요청 식별자를 생성할 수 없습니다.");
  }
  return globalThis.crypto.randomUUID();
}
