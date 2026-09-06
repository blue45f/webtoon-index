const STUDIO_LIVE_SOCKET_NAMESPACE = "/studio-live";
const VERCEL_SERVERLESS_WEB_HOSTS = new Set([
  "www.toonstudio.cloud",
  "toonstudio.cloud",
]);

export interface StudioLiveSocketEndpointInput {
  explicitOrigin?: string | null;
  viteApiBase?: string | null;
  runtimeApiBase?: string | null;
  locationOrigin?: string | null;
  allowInsecureLoopback?: boolean;
  /** Vite dev without an explicit realtime origin stays on local collaboration. */
  localDevelopment?: boolean;
}

function firstNonBlank(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

function isLoopbackOrigin(value: string | null): boolean {
  if (!value) return false;
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isVercelServerlessOrigin(value: string | null): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "vercel.app"
      || hostname.endsWith(".vercel.app")
      || VERCEL_SERVERLESS_WEB_HOSTS.has(hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Socket.IO's first argument combines the server origin and namespace. A dedicated long-running
 * realtime origin wins over HTTP API bases. Remote origins require HTTPS; development may opt into
 * HTTP only on loopback. Local dev/preview can retain its same-origin Vite proxy or a loopback API,
 * but never inherits a remote HTTP API origin as an implicit WebSocket target. Credentials, paths,
 * query strings, and fragments never enter the endpoint.
 */
export function resolveStudioLiveSocketEndpoint({
  explicitOrigin,
  viteApiBase,
  runtimeApiBase,
  locationOrigin,
  allowInsecureLoopback = false,
  localDevelopment = false,
}: StudioLiveSocketEndpointInput): string | null {
  const explicitBase = firstNonBlank(explicitOrigin);
  const safeLocationOrigin = firstNonBlank(locationOrigin);
  const localShell = isLoopbackOrigin(safeLocationOrigin);
  const implicitBase = firstNonBlank(viteApiBase, runtimeApiBase);
  if (!explicitBase && (localDevelopment || localShell) && implicitBase) {
    try {
      const implicitUrl = safeLocationOrigin
        ? new URL(implicitBase, safeLocationOrigin)
        : new URL(implicitBase);
      const staysOnLocalShell =
        safeLocationOrigin !== null
        && implicitUrl.origin === new URL(safeLocationOrigin).origin;
      if (!staysOnLocalShell && !isLoopbackHostname(implicitUrl.hostname)) {
        return null;
      }
    } catch {
      return null;
    }
  }
  // Vercel's serverless request lifecycle cannot own the long-running Nest Socket.IO gateway.
  // This includes the project's custom production domains. A dedicated
  // VITE_STUDIO_LIVE_ORIGIN is required there.
  if (!explicitBase && isVercelServerlessOrigin(safeLocationOrigin)) return null;

  const configuredBase =
    explicitBase ?? implicitBase;
  if (!configuredBase) return STUDIO_LIVE_SOCKET_NAMESPACE;
  let url: URL;
  try {
    url = safeLocationOrigin
      ? new URL(configuredBase, safeLocationOrigin)
      : new URL(configuredBase);
  } catch {
    return null;
  }
  const secureOrigin = url.protocol === "https:";
  const localDevelopmentOrigin =
    (allowInsecureLoopback || localShell)
    && url.protocol === "http:"
    && isLoopbackHostname(url.hostname);
  if (
    (!secureOrigin && !localDevelopmentOrigin) ||
    url.username ||
    url.password ||
    url.origin === "null"
  ) {
    return null;
  }
  return `${url.origin}${STUDIO_LIVE_SOCKET_NAMESPACE}`;
}
