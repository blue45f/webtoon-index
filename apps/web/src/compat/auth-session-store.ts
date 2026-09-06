import { createContext, useContext } from "react";

import {
  getAuthSession,
  getAuthSessionRevision,
  persistSession,
  type Session,
  type SessionSyncReason,
} from "./auth-session-state";
import { normalizeClientSession } from "./auth-session-storage";

import { api, apiPath } from "@/src/infrastructure/api";

export {
  SESSION_KEY,
  emitSession,
  getAuthSession,
  getAuthToken,
  getAuthUserId,
  listeners,
  mergeCurrentSessionProfile,
  persistSession,
  readStoredSession,
} from "./auth-session-state";
export type { Session } from "./auth-session-state";

export type SessionContextValue =
  | {
      data: NonNullable<Session>;
      ready: boolean;
      status: "authenticated";
      update: () => Promise<Session>;
    }
  | {
      data: null;
      ready: boolean;
      status: "unauthenticated";
      update: () => Promise<Session>;
    };

export const SessionContext = createContext<SessionContextValue>({
  data: null,
  ready: false,
  status: "unauthenticated",
  update: async () => null,
});

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

type ServerSessionPayload =
  | {
      authenticated: true;
      user: NonNullable<Session>["user"];
    }
  | {
      authenticated: false;
      user: null;
    };

export type ServerSessionSynchronization =
  | {
      status: "authenticated";
      session: NonNullable<Session>;
    }
  | {
      status: "unauthenticated";
      session: null;
    }
  | {
      status: "indeterminate";
      session: Session;
    };

let serverSessionRequest: Promise<ServerSessionSynchronization> | null = null;
let signOutRequest: Promise<SignOutResult> | null = null;
const SERVER_SESSION_ROLES = new Set(["admin", "creator", "operator", "user"]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseServerSessionPayload(value: unknown): ServerSessionPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const payload = value as { authenticated?: unknown; user?: unknown };
  if (payload.authenticated === false && payload.user === null) {
    return { authenticated: false, user: null };
  }
  if (payload.authenticated !== true) return null;
  if (typeof payload.user !== "object" || payload.user === null || Array.isArray(payload.user)) {
    return null;
  }
  const user = payload.user as Record<string, unknown>;
  if (
    !isNullableString(user.name)
    || !isNullableString(user.email)
    || !isNullableString(user.image)
    || typeof user.role !== "string"
    || !SERVER_SESSION_ROLES.has(user.role)
  ) {
    return null;
  }
  const session = normalizeClientSession({ user: payload.user, token: null });
  return session
    ? { authenticated: true, user: session.user }
    : null;
}

/**
 * Reconciles the browser cache with the HttpOnly-cookie session while keeping
 * server verification distinct from the last public profile cached in this
 * tab. Transport, 5xx, and malformed-response failures are indeterminate and
 * retain the cache; only a valid 200 response or an authoritative 401 verifies
 * the current authentication state.
 */
export function synchronizeServerSessionState(
  _reason: SessionSyncReason = "manual",
): Promise<ServerSessionSynchronization> {
  if (serverSessionRequest) return serverSessionRequest;
  const requestRevision = getAuthSessionRevision();
  const requestIsCurrent = () => getAuthSessionRevision() === requestRevision;
  const request = (async (): Promise<ServerSessionSynchronization> => {
    let response: Response;
    try {
      response = await api.raw(apiPath("/auth/session"), {
        method: "GET",
        cache: "no-store",
        throwHttpErrors: false,
      });
    } catch {
      return { status: "indeterminate", session: getAuthSession() };
    }

    if (!requestIsCurrent()) {
      return { status: "indeterminate", session: getAuthSession() };
    }
    if (!response.ok) {
      if (response.status === 401) {
        persistSession(null);
        return { status: "unauthenticated", session: null };
      }
      return { status: "indeterminate", session: getAuthSession() };
    }

    const payload = parseServerSessionPayload(
      await response.json().catch(() => null),
    );
    if (!requestIsCurrent()) {
      return { status: "indeterminate", session: getAuthSession() };
    }
    if (!payload) {
      return { status: "indeterminate", session: getAuthSession() };
    }
    if (!payload.authenticated) {
      persistSession(null);
      return { status: "unauthenticated", session: null };
    }

    const next = { user: payload.user, token: null };
    persistSession(next);
    const synchronizedSession = getAuthSession();
    if (!synchronizedSession) {
      return { status: "indeterminate", session: null };
    }
    return { status: "authenticated", session: synchronizedSession };
  })().finally(() => {
    serverSessionRequest = null;
  });
  serverSessionRequest = request;
  return request;
}

/**
 * Compatibility facade for callers that only need the latest public profile.
 * SessionProvider uses synchronizeServerSessionState() so an empty cache is
 * never confused with an authoritative unauthenticated response.
 */
export async function synchronizeServerSession(
  reason: SessionSyncReason = "manual",
): Promise<Session> {
  return (await synchronizeServerSessionState(reason)).session;
}

// GIS(Google Identity Services) ID 토큰 로그인 — GIS 버튼 콜백이 받은 credential(ID 토큰)을
// 서버에서 검증해 세션을 확정한다. 리다이렉트 없이 모달에서 바로 로그인 완료.
export type GoogleIdTokenSignInResult =
  | { ok: true; error: null; status: number }
  | { ok: false; error: string; status: number };

const GOOGLE_ID_TOKEN_MAX_LENGTH = 16_384;
const GOOGLE_SIGN_IN_FALLBACK_ERROR = "Google 로그인에 실패했어요. 다시 시도해 주세요.";
const SIGN_OUT_RETRY_DELAYS_MS = [150, 600] as const;
const SIGN_OUT_MAXIMUM_RETRY_DELAY_MS = 2_000;

function readGoogleSignInError(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== "string") return null;
  const message = error.trim();
  return message || null;
}

export type SignOutResult =
  | {
      readonly ok: true;
      readonly status: "signed-out";
      readonly attempts: number;
      readonly httpStatus: number;
      readonly error: null;
    }
  | {
      readonly ok: false;
      readonly status: "pending";
      readonly attempts: number;
      readonly httpStatus: number;
      readonly error: string;
    };

export interface SignOutOptions {
  /** Test/runtime override; values are bounded and at most two retries are accepted. */
  readonly retryDelaysMs?: readonly number[];
  readonly wait?: (delayMs: number) => Promise<void>;
}

function signOutRetryDelays(value: readonly number[] | undefined): readonly number[] {
  return (value ?? SIGN_OUT_RETRY_DELAYS_MS)
    .slice(0, SIGN_OUT_RETRY_DELAYS_MS.length)
    .map((delay) => Math.min(
      SIGN_OUT_MAXIMUM_RETRY_DELAY_MS,
      Math.max(0, Number.isFinite(delay) ? Math.trunc(delay) : 0),
    ));
}

function waitForSignOutRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

export async function signInWithGoogleIdToken(
  idToken: string,
  options?: { signal?: AbortSignal },
): Promise<GoogleIdTokenSignInResult> {
  const token = typeof idToken === "string" ? idToken.trim() : "";
  if (
    !token
    || token.length > GOOGLE_ID_TOKEN_MAX_LENGTH
    || token.split(".").length !== 3
  ) {
    return { ok: false, error: "Google 로그인 응답 형식이 올바르지 않아요.", status: 400 };
  }

  try {
    const response = await api.raw(apiPath("/auth/oauth/google/id-token"), {
      method: "POST",
      throwHttpErrors: false,
      json: { idToken: token },
      signal: options?.signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | { user?: NonNullable<Session>["user"]; error?: unknown }
      | null;
    if (!response.ok || !payload?.user) {
      return {
        ok: false,
        error: readGoogleSignInError(payload) ?? GOOGLE_SIGN_IN_FALLBACK_ERROR,
        status: response.status,
      };
    }
    persistSession({ user: payload.user, token: null });
    return { ok: true, error: null, status: response.status };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "Google 로그인 요청이 취소되었어요.", status: 0 };
    }
    return {
      ok: false,
      error: "로그인 서버에 연결하지 못했어요. 네트워크를 확인해 주세요.",
      status: 0,
    };
  }
}

export async function signIn(provider?: string, options?: Record<string, unknown>) {
  // 소셜 로그인(Google·Kakao): OAuth 시작 엔드포인트로 전체 페이지 리다이렉트.
  // 백엔드가 설정 여부에 따라 실제 제공자 또는 데모 폴백(/auth/callback#demo=)으로 분기한다.
  // (Google 실연동은 GIS 버튼 → signInWithGoogleIdToken 경로를 사용; 이 리다이렉트는 데모/code-flow 폴백.)
  if (provider === "google" || provider === "kakao" || provider === "naver") {
    const url = `/api/auth/oauth/${provider}/start`;
    if (typeof window !== "undefined") globalThis.location.assign(url);
    return { ok: true, error: null, status: 0, url };
  }

  if (provider !== "credentials") {
    return {
      ok: false,
      error: "provider-unavailable-in-vite-spa",
      status: 501,
      url: null,
    };
  }

  // 로그인 실패(비-2xx)도 정상 흐름으로 { ok:false, error } 를 돌려주므로 ky 예외를 끄고 Response 를 직접 다룬다.
  const response = await api.raw(apiPath("/auth/login"), {
    method: "POST",
    throwHttpErrors: false,
    json: { email: options?.email, password: options?.password },
  });
  const payload = (await response.json().catch(() => null)) as
    | { user?: NonNullable<Session>["user"]; error?: string }
    | null;

  if (!response.ok || !payload?.user) {
    return {
      ok: false,
      error: payload?.error ?? "auth-failed",
      status: response.status,
      url: null,
    };
  }

  persistSession({ user: payload.user, token: null });
  return {
    ok: true,
    error: null,
    status: response.status,
    url: null,
  };
}

async function performSignOut(
  options: SignOutOptions = {},
): Promise<SignOutResult> {
  const retryDelays = signOutRetryDelays(options.retryDelaysMs);
  const wait = options.wait ?? waitForSignOutRetry;
  let httpStatus = 0;

  for (let attempt = 1; attempt <= retryDelays.length + 1; attempt += 1) {
    try {
      const response = await api.raw(apiPath("/auth/logout"), {
        method: "POST",
        cache: "no-store",
        throwHttpErrors: false,
      });
      httpStatus = response.status;
      if (response.ok || response.status === 401) {
        // This revision change also prevents an older /auth/session response from reviving the
        // just-cleared profile after the authoritative logout response arrives.
        persistSession(null);
        return {
          ok: true,
          status: "signed-out",
          attempts: attempt,
          httpStatus: response.status,
          error: null,
        };
      }
    } catch {
      httpStatus = 0;
    }

    const retryDelay = retryDelays[attempt - 1];
    if (retryDelay !== undefined) await wait(retryDelay);
  }

  // A transport failure cannot prove whether the server received the request. Keep the public
  // profile as pending/indeterminate instead of falsely announcing logout success; callers can
  // surface this bounded result and let the user retry.
  return {
    ok: false,
    status: "pending",
    attempts: retryDelays.length + 1,
    httpStatus,
    error: "로그아웃 확인에 실패했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
  };
}

export function signOut(
  options: SignOutOptions = {},
): Promise<SignOutResult> {
  if (signOutRequest) return signOutRequest;
  const request = performSignOut(options).finally(() => {
    if (signOutRequest === request) signOutRequest = null;
  });
  signOutRequest = request;
  return request;
}

// OAuth 콜백 페이지가 핸드오프/데모로 받은 사용자 객체로 세션을 확정할 때 사용.
export function completeOAuthLogin(
  user: NonNullable<Session>["user"] | null,
) {
  persistSession(user?.id ? { user, token: null } : null);
}
