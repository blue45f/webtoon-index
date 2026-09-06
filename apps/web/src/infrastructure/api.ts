// 공유 HTTP 클라이언트 — ky 인스턴스 1개로 통일한다(이전엔 각 모듈이 fetch를 직접 호출).
// 인증 진실원천은 same-origin HttpOnly 쿠키다. 브라우저 저장소의 bearer를 읽거나
// x-user-id로 자동 전송하지 않는다.
import ky, { HTTPError, type KyResponse, type Options } from "ky";

import {
  TOONSPECTRUM_CSRF_HEADER,
  TOONSPECTRUM_CSRF_HEADER_VALUE,
  isCsrfProtectedMethod,
} from "@/shared/lib/csrf";
import { resolveApiError, safeParseJson } from "@/shared/lib/http-safe";
import { handleUnauthorizedSession } from "@/src/compat/auth-session-state";
import { getRuntimeApiBase } from "@/src/infrastructure/runtime-api-base";

function apiBase() {
  const env = import.meta.env.VITE_API_BASE?.trim().replace(/\/+$/, "");
  return env || getRuntimeApiBase();
}

// `/foo` → `/api/foo`, 이미 `/api/...` 이면 그대로. VITE_API_BASE 가 있으면 앞에 붙인다.
export function apiPath(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const rooted = clean.startsWith("/api/") || clean === "/api" ? clean : `/api${clean}`;
  return `${apiBase()}${rooted}`;
}

// ky 는 요청 전 input 으로 Request 를 만든다 — 상대경로(/api/...)는 base 가 있어야 절대 URL 로 풀린다.
// 브라우저는 location.origin 으로, (테스트 등) 비브라우저 환경은 localhost 폴백으로 해석한다.
// apiPath() 가 이미 절대 URL(VITE_API_BASE 가 절대값일 때)을 만들면 그 값이 baseUrl 보다 우선한다.
function resolveBaseUrl(): string {
  if (typeof window !== "undefined" && globalThis.location?.origin) return globalThis.location.origin;
  return "http://localhost";
}

function isCredentialAttemptPath(pathname: string): boolean {
  return (
    pathname.endsWith("/api/auth/login")
    || pathname.endsWith("/api/auth/oauth/google/id-token")
    || pathname.endsWith("/api/auth/oauth/exchange")
    || /\/api\/auth\/oauth\/[^/]+\/demo$/u.test(pathname)
  );
}

// 공유 ky 클라이언트. URL 은 호출부에서 apiPath() 로 만들고, 인증 헤더만 beforeRequest 훅에서 일괄 주입한다.
const client = ky.create({
  baseUrl: resolveBaseUrl(),
  // 기존 fetch 호출은 모두 cache:"no-store" 였다 — 동작 보존을 위해 기본값으로 둔다(호출부에서 덮어쓰기 가능).
  cache: "no-store",
  // HttpOnly auth cookie is the browser session credential. The API base is
  // fixed by deployment configuration, and credentialed cross-origin access
  // is still constrained by the server's exact CORS/CSRF Origin allowlist.
  credentials: "include",
  // 타임아웃은 끈다 — 기존 fetch 는 무제한이었고, 수동 크롤(/catalog/ingest/run)은 수 분 걸릴 수 있어 동작을 보존한다.
  timeout: false,
  // 자동 재시도는 끈다 — 기존 fetch 호출은 재시도가 없었고, 크롤/수집 같은 멱등성 비보장 요청이 있어 동작을 보존한다.
  retry: 0,
  hooks: {
    beforeRequest: [
      ({ request }) => {
        if (isCsrfProtectedMethod(request.method)) {
          request.headers.set(
            TOONSPECTRUM_CSRF_HEADER,
            TOONSPECTRUM_CSRF_HEADER_VALUE,
          );
        }
      },
    ],
    afterResponse: [
      ({ request, response }) => {
        if (
          response.status === 401
          && !isCredentialAttemptPath(new URL(request.url).pathname)
        ) {
          handleUnauthorizedSession();
        }
      },
    ],
  },
});

// axios/fetch 시절 호출부 호환 — { params } 를 ky searchParams 로 바꾼다(빈 값은 제외).
// searchParams(ky 원형, 문자열/객체)도 그대로 받는다.
export type ApiOptions = Omit<Options, "method" | "json" | "body"> & {
  params?: Record<string, string | number | boolean | null | undefined>;
};

function toOptions(opts?: ApiOptions): Options {
  if (!opts) return {};
  const { params, ...rest } = opts;
  if (!params) return rest;
  const searchParams = Object.fromEntries(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)])
  );
  return { ...rest, searchParams };
}

// 응답 본문을 타입 T 로 파싱한다. 204/빈 본문은 undefined.
// 비 JSON 본문(예: 미배포 엔드포인트의 HTML 404 페이지)은 JSON.parse 의 원시 SyntaxError
// ("Unexpected token '<'") 가 그대로 UI 로 새지 않도록 깔끔한 한국어 메시지로 감싼다.
async function toJson<T>(response: KyResponse): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("서버 응답을 해석하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
}

/**
 * 공유 ky 래퍼. path 는 `/api` 이후 경로(예: "/creator/works") 또는 전체 `/api/...` 둘 다 받는다.
 * apiPath() 로 정규화하므로 호출부는 fetch 시절 URL 을 그대로 넘기면 된다.
 * 4xx/5xx 는 ky HTTPError 로 throw → getApiErrorMessage() 로 메시지를 뽑는다.
 */
export const api = {
  raw: client,
  get: <T>(path: string, options?: ApiOptions): Promise<T> =>
    client.get(apiPath(path), toOptions(options)).then(toJson<T>),
  post: <T>(path: string, body?: unknown, options?: ApiOptions): Promise<T> =>
    client.post(apiPath(path), { json: body, ...toOptions(options) }).then(toJson<T>),
  patch: <T>(path: string, body?: unknown, options?: ApiOptions): Promise<T> =>
    client.patch(apiPath(path), { json: body, ...toOptions(options) }).then(toJson<T>),
  put: <T>(path: string, body?: unknown, options?: ApiOptions): Promise<T> =>
    client.put(apiPath(path), { json: body, ...toOptions(options) }).then(toJson<T>),
  delete: <T = void>(path: string, options?: ApiOptions): Promise<T> =>
    client.delete(apiPath(path), toOptions(options)).then(toJson<T>),
};

/** 404 등 특정 상태를 흐름 제어로 다루고 싶을 때 — 응답 객체째 돌려준다(throwHttpErrors:false 권장). */
export { HTTPError };

export function isHttpError(err: unknown): err is HTTPError {
  return err instanceof HTTPError;
}

/** HTTPError 의 상태 코드(아니면 null). */
export function httpStatus(err: unknown): number | null {
  return err instanceof HTTPError ? err.response.status : null;
}

/**
 * ky HTTPError(또는 일반 Error)에서 UI 표시용 메시지를 뽑는다.
 * ky 는 응답 본문을 미리 파싱해 error.data 에 담는다({ error } / { message } 형태).
 * 기존 resolveApiError 규칙을 그대로 재사용해 메시지 텍스트가 fetch 시절과 동일하게 나오게 한다.
 */
export async function getApiErrorMessage(err: unknown, fallback: string): Promise<string> {
  if (err instanceof HTTPError) {
    // ky 2.x 는 본문을 error.data 로 미리 파싱한다(응답 body 는 이미 소비됨).
    let parsed: unknown = err.data;
    if (parsed === undefined && !err.response.bodyUsed) {
      // body 미소비 응답만 clone 시도 — 소비된 응답에 clone 하면 TypeError 가 원래 에러를 가린다(502 등 비JSON 본문).
      try {
        parsed = await safeParseJson<unknown>(err.response.clone());
      } catch {
        parsed = undefined;
      }
    }
    return resolveApiError(parsed, `${fallback} (${err.response.status})`);
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/** getApiErrorMessage 메시지를 담되 원본 에러를 cause 로 보존한 Error 를 만든다(rethrow 용). */
export async function toApiError(err: unknown, fallback: string): Promise<Error> {
  return new Error(await getApiErrorMessage(err, fallback), { cause: err });
}
