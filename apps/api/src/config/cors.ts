import { TOONSPECTRUM_CSRF_HEADER } from "../../../web/src/shared/lib/csrf";

import type { INestApplication } from "@nestjs/common";
import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";

const LOCAL_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5181",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5181",
  "http://localhost:4001",
  "http://127.0.0.1:4001",
] as const;

/**
 * ToonSpectrum의 공개 웹 앱 Origin.
 *
 * `www`가 정본이고 apex는 Vercel에서 `www`로 리다이렉트하지만, 리다이렉트 전에
 * preflight/Socket.IO upgrade를 시작한 기존 클라이언트도 안전하게 전환할 수 있도록 두
 * Origin을 모두 정확히 허용한다. 와일드카드나 임의 Vercel preview Origin은 포함하지 않는다.
 */
export const PRODUCTION_CORS_ORIGINS = [
  "https://www.toonstudio.cloud",
  "https://toonstudio.cloud",
] as const;

export const API_CORS_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
export const API_CORS_HEADERS = [
  "Content-Type",
  "x-user-id",
  "Idempotency-Key",
  TOONSPECTRUM_CSRF_HEADER,
] as const;

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * 명시적으로 구성한 운영 Origin과 개발용 로컬 Origin을 합친다.
 * 로컬 Origin은 개발에서만 허용해 운영 allowlist가 불필요하게 넓어지지 않게 한다.
 */
export function allowedCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.API_CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map(normalizeOrigin)
    .filter((origin): origin is string =>
      origin !== null
      && (env.NODE_ENV !== "production" || origin.startsWith("https://")),
    );
  const local = env.NODE_ENV === "production" ? [] : LOCAL_CORS_ORIGINS;
  return [...new Set([...PRODUCTION_CORS_ORIGINS, ...local, ...configured])];
}

export function createCorsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  const allowed = new Set(allowedCorsOrigins(env));
  return {
    // Origin 없는 서버 간 요청은 그대로 허용하고, 브라우저 요청만 allowlist로 제한한다.
    origin(origin, callback) {
      callback(null, origin === undefined || allowed.has(origin));
    },
    methods: [...API_CORS_METHODS],
    allowedHeaders: [...API_CORS_HEADERS],
    // Cookie-authenticated API calls are allowed only from the exact Origin
    // allowlist above. Never combine this with a wildcard Origin.
    credentials: true,
    maxAge: 86_400,
    optionsSuccessStatus: 204,
  };
}

/** 로컬 장기 실행 서버와 Vercel serverless가 반드시 같은 CORS 정책을 쓰게 하는 단일 진입점. */
export function configureCors(app: INestApplication, env: NodeJS.ProcessEnv = process.env): void {
  app.enableCors(createCorsOptions(env));
}
