import {
  clientTokenExpiresAt,
  normalizeClientSession,
  persistClientSession,
  readClientSession,
  type Session,
} from "./auth-session-storage";

export { SESSION_KEY } from "./auth-session-storage";
export type { Session } from "./auth-session-storage";

let currentSession: Session = readClientSession();
let sessionRevision = 0;
export const listeners = new Set<(session: Session) => void>();
export type SessionSyncReason = "startup" | "focus" | "unauthorized" | "manual";
const sessionSyncListeners = new Set<(reason: SessionSyncReason) => void>();
let sessionExpiryTimer: ReturnType<typeof setTimeout> | undefined;
const SESSION_LOGOUT_CHANNEL_NAME = "toonspectrum-auth-session-v1";
const SESSION_LOGOUT_SIGNAL_KEY = "toonspectrum-auth-session-logout-v1";
let sessionLogoutChannel: BroadcastChannel | null = null;

function clearSessionExpiryTimer(): void {
  if (sessionExpiryTimer !== undefined) {
    globalThis.clearTimeout(sessionExpiryTimer);
    sessionExpiryTimer = undefined;
  }
}

function expireSessionIfNeeded(now: number = Date.now()): boolean {
  const expiresAt = clientTokenExpiresAt(currentSession?.token);
  if (expiresAt === null || expiresAt > now) return false;
  transitionSession(null, true, true);
  return true;
}

function scheduleSessionExpiry(): void {
  clearSessionExpiryTimer();
  if (typeof window === "undefined") return;
  const expiresAt = clientTokenExpiresAt(currentSession?.token);
  if (expiresAt === null) return;
  const delay = expiresAt - Date.now();
  if (delay <= 0) {
    expireSessionIfNeeded();
    return;
  }
  // Browsers clamp long timers. Recheck after each bounded interval so a
  // 30-day server JWT cannot silently outlive its local expiry timer.
  sessionExpiryTimer = globalThis.setTimeout(
    () => {
      if (!expireSessionIfNeeded()) scheduleSessionExpiry();
    },
    Math.min(delay, 2_147_000_000),
  );
}

function publishSessionLogout(): void {
  let published = false;
  try {
    sessionLogoutChannel?.postMessage({ type: "logout", version: 1 });
    published = sessionLogoutChannel !== null;
  } catch {
    // Fall through to the non-secret localStorage event marker.
  }
  if (published || typeof window === "undefined") return;
  try {
    const nonce = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
    globalThis.localStorage.setItem(SESSION_LOGOUT_SIGNAL_KEY, nonce);
    globalThis.localStorage.removeItem(SESSION_LOGOUT_SIGNAL_KEY);
  } catch {
    // Browser privacy settings may block storage. The initiating tab has
    // already cleared its in-memory state, so logout still succeeds locally.
  }
}

function transitionSession(
  session: Session,
  persist: boolean,
  coordinateLogout: boolean,
): Session {
  const previousSession = currentSession;
  const normalized = persist ? persistClientSession(session) : normalizeClientSession(session);
  currentSession = normalized;
  sessionRevision += 1;
  scheduleSessionExpiry();
  listeners.forEach((listener) => listener(currentSession)); // NOSONAR S4158
  if (coordinateLogout && previousSession !== null && currentSession === null) {
    publishSessionLogout();
  }
  return currentSession;
}

function applyRemoteLogout(): void {
  if (currentSession === null) return;
  transitionSession(null, true, false);
}

export function handleSessionCoordinationMessage(message: unknown): void {
  if (
    typeof message === "object"
    && message !== null
    && (message as { type?: unknown }).type === "logout"
    && (message as { version?: unknown }).version === 1
  ) {
    applyRemoteLogout();
  }
}

function initializeSessionCoordination(): void {
  if (typeof window === "undefined") return;
  if (typeof globalThis.BroadcastChannel === "function") {
    try {
      sessionLogoutChannel = new globalThis.BroadcastChannel(
        SESSION_LOGOUT_CHANNEL_NAME,
      );
      sessionLogoutChannel.addEventListener("message", (event: MessageEvent<unknown>) => {
        handleSessionCoordinationMessage(event.data);
      });
    } catch {
      sessionLogoutChannel = null;
    }
  }

  if (!sessionLogoutChannel) {
    globalThis.addEventListener("storage", (event: StorageEvent) => {
      if (
        event.key === SESSION_LOGOUT_SIGNAL_KEY
        && event.newValue !== null
      ) {
        applyRemoteLogout();
      }
    });
  }
}

if (typeof window !== "undefined") {
  const reconcileSessionExpiry = () => {
    if (!expireSessionIfNeeded()) scheduleSessionExpiry();
  };
  globalThis.addEventListener("focus", reconcileSessionExpiry, { passive: true });
  globalThis.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reconcileSessionExpiry();
  });
  initializeSessionCoordination();
  scheduleSessionExpiry();
}

export function getAuthSession() {
  expireSessionIfNeeded();
  return currentSession;
}

/**
 * Monotonic generation for the in-memory authentication identity. Async
 * cookie-session reconciliation captures this value before issuing a request
 * and must not overwrite a newer login, logout, account switch, or cross-tab
 * transition when the older response eventually arrives.
 */
export function getAuthSessionRevision(): number {
  return sessionRevision;
}

export function getAuthUserId() {
  expireSessionIfNeeded();
  return currentSession?.user.id ?? null;
}

/** @deprecated Browser authentication is cookie-only; retained as a null-returning compatibility shim. */
export function getAuthToken() {
  return null;
}

export function readStoredSession(): Session {
  return readClientSession();
}

export function persistSession(session: Session): void {
  transitionSession(session, true, true);
}

export function mergeCurrentSessionProfile(
  profile: Partial<NonNullable<Session>["user"]> & { id: string },
): Session {
  const current = getAuthSession();
  if (!current || profile.id !== current.user.id) return current;

  const user = { ...current.user };
  for (const key of ["name", "email", "image", "role"] as const) {
    const value = profile[key];
    if (typeof value === "string" || value === null) user[key] = value;
  }
  persistSession({ user, token: null });
  return getAuthSession();
}

export function emitSession(session: Session) {
  transitionSession(session, false, false);
  // listeners are registered by src/compat/auth-session.tsx subscribe logic.
}

export function subscribeSessionSyncRequests(
  listener: (reason: SessionSyncReason) => void,
): () => void {
  sessionSyncListeners.add(listener);
  return () => sessionSyncListeners.delete(listener);
}

export function requestSessionSync(reason: SessionSyncReason): void {
  sessionSyncListeners.forEach((listener) => listener(reason)); // NOSONAR S4158
}

/**
 * A protected API 401 is authoritative enough to drop stale UI immediately,
 * then asks the provider to confirm the current cookie state with /auth/session.
 */
export function handleUnauthorizedSession(): void {
  transitionSession(null, true, true);
  requestSessionSync("unauthorized");
}
