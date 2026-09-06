/**
 * Browser-side persistence for the signed API session.
 *
 * The HttpOnly cookie is the authentication truth source. Legacy deployments
 * persisted a signed bearer in Web Storage, so the parser still understands
 * that shape only to migrate its public profile. No bearer is returned from a
 * storage read or written back to either sessionStorage or localStorage.
 */

export type Session = {
  user: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string | null;
  };
  token?: string | null;
} | null;

export const SESSION_KEY = "toonspectrum-auth-session";
export const CLIENT_SESSION_MAX_SERIALIZED_BYTES = 24_576;
export const CLIENT_SESSION_TOKEN_MAX_LENGTH = 16_384;

const CLIENT_USER_ID_MAX_LENGTH = 512;
const CLIENT_PROFILE_TEXT_MAX_LENGTH = 4_096;

type BrowserStorage = "session" | "local";

function browserStorage(kind: BrowserStorage): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "session" ? globalThis.sessionStorage : globalThis.localStorage;
  } catch {
    return null;
  }
}

function readStorage(kind: BrowserStorage, key: string): string | null | undefined {
  const storage = browserStorage(kind);
  if (!storage) return undefined;
  try {
    return storage.getItem(key);
  } catch {
    return undefined;
  }
}

function writeStorage(kind: BrowserStorage, key: string, value: string): boolean {
  const storage = browserStorage(kind);
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorage(kind: BrowserStorage, key: string): void {
  const storage = browserStorage(kind);
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be disabled by browser privacy policy.  The caller retains
    // its short-lived in-memory state rather than failing a completed login.
  }
}

function normalizedOptionalText(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length <= CLIENT_PROFILE_TEXT_MAX_LENGTH ? text : undefined;
}

function serializedByteLength(value: string): number {
  try {
    return new TextEncoder().encode(value).byteLength;
  } catch {
    // TextEncoder is available in supported browsers. Keep the pre-encoding
    // bound as a conservative fallback for unusual embedded webviews.
    return value.length;
  }
}

function parseJsonBase64Url(segment: string): unknown | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(segment)) return null;
  try {
    const padding = "=".repeat((4 - (segment.length % 4)) % 4);
    const binary = globalThis.atob(segment.replace(/-/g, "+").replace(/_/g, "/") + padding);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

/**
 * Returns a locally observable expiry. This is never a signature check—the API
 * remains the authority—but lets the browser avoid keeping an already-expired
 * credential in memory or storage.
 */
export function clientTokenExpiresAt(token: string | null | undefined): number | null {
  if (!token) return null;

  const jwtParts = token.split(".");
  if (jwtParts.length === 3) {
    const payload = parseJsonBase64Url(jwtParts[1] ?? "");
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return 0;
    const exp = Number((payload as { exp?: unknown }).exp);
    return Number.isSafeInteger(exp) && exp > 0 ? exp * 1_000 : 0;
  }

  // Existing v2 sessions are accepted server-side while they age out. Treat a
  // malformed v2-shaped value as expired instead of repeatedly sending it.
  const legacyParts = token.split(".");
  if (legacyParts.length === 5 && legacyParts[0] === "v2") {
    const expiresAt = Number(legacyParts[3]);
    return Number.isSafeInteger(expiresAt) && expiresAt > 0 ? expiresAt : 0;
  }

  // Other values are left to server verification. This keeps the existing
  // transport contract intact while still removing credentials with a known
  // expiry format.
  return null;
}

export function normalizeClientSession(value: unknown, now: number = Date.now()): Session {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as { user?: unknown; token?: unknown };
  if (typeof candidate.user !== "object" || candidate.user === null || Array.isArray(candidate.user)) {
    return null;
  }

  const rawUser = candidate.user as Record<string, unknown>;
  const rawId = rawUser.id;
  if (typeof rawId !== "string") return null;
  const id = rawId.trim();
  if (!id || id.length > CLIENT_USER_ID_MAX_LENGTH) return null;

  let token: string | null = null;
  if (candidate.token !== undefined && candidate.token !== null) {
    if (typeof candidate.token !== "string") return null;
    token = candidate.token.trim();
    if (!token || token.length > CLIENT_SESSION_TOKEN_MAX_LENGTH) return null;
    const expiresAt = clientTokenExpiresAt(token);
    if (expiresAt !== null && expiresAt <= now) return null;
  }

  const user: NonNullable<Session>["user"] = { id };
  for (const key of ["name", "email", "image", "role"] as const) {
    const text = normalizedOptionalText(rawUser[key]);
    if (text !== undefined) user[key] = text;
  }
  return { user, token };
}

function parseStoredSession(raw: string | null, now: number): Session {
  if (!raw || serializedByteLength(raw) > CLIENT_SESSION_MAX_SERIALIZED_BYTES) return null;
  try {
    return normalizeClientSession(JSON.parse(raw) as unknown, now);
  } catch {
    return null;
  }
}

function withoutClientBearer(session: Session): Session {
  return session ? { user: { ...session.user }, token: null } : null;
}

/**
 * Reads the tab-scoped session first. One legacy localStorage value is moved
 * into sessionStorage and deleted; this is intentionally a one-way migration.
 */
export function readClientSession(now: number = Date.now()): Session {
  const tabRaw = readStorage("session", SESSION_KEY);
  if (tabRaw !== undefined) {
    const tabSession = parseStoredSession(tabRaw, now);
    if (tabSession) {
      const profile = withoutClientBearer(tabSession);
      writeStorage("session", SESSION_KEY, JSON.stringify(profile));
      return profile;
    }
    if (tabRaw !== null) removeStorage("session", SESSION_KEY);
  }

  const legacyRaw = readStorage("local", SESSION_KEY);
  if (legacyRaw === undefined || legacyRaw === null) return null;

  const legacySession = withoutClientBearer(parseStoredSession(legacyRaw, now));
  // Never leave a bearer-like token behind in persistent localStorage.
  removeStorage("local", SESSION_KEY);
  if (!legacySession) return null;
  writeStorage("session", SESSION_KEY, JSON.stringify(legacySession));
  return legacySession;
}

/** Writes only a public profile to sessionStorage; bearer input is discarded. */
export function persistClientSession(value: unknown, now: number = Date.now()): Session {
  const session = withoutClientBearer(normalizeClientSession(value, now));
  const serialized = session ? JSON.stringify(session) : null;
  const boundedSession =
    serialized
    && serializedByteLength(serialized) <= CLIENT_SESSION_MAX_SERIALIZED_BYTES
      ? session
      : null;
  if (boundedSession && serialized) writeStorage("session", SESSION_KEY, serialized);
  else removeStorage("session", SESSION_KEY);
  // Clear the old persistent location on every auth state transition. This
  // also cleans up sessions written by an older deployed client.
  removeStorage("local", SESSION_KEY);
  return boundedSession;
}

export function clearClientSessionStorage(): void {
  removeStorage("session", SESSION_KEY);
  removeStorage("local", SESSION_KEY);
}
