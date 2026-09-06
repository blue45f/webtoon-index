import {
  TOONSPECTRUM_CSRF_HEADER,
  TOONSPECTRUM_CSRF_HEADER_VALUE,
  isCsrfProtectedMethod,
} from "../../web/src/shared/lib/csrf";

import { allowedCorsOrigins } from "./config/cors";
import { getSessionAuthenticationSource } from "./session-middleware";

import type { NextFunction, Request, Response } from "express";

const ALLOWED_MISSING_ORIGIN_FETCH_SITES = new Set(["same-origin"]);
const ALLOWED_MISSING_ORIGIN_FETCH_MODES = new Set(["cors", "same-origin"]);

function normalizedRequestPath(value: string): string | null {
  const withoutQuery = value.split("?", 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  const rooted = decoded.startsWith("/") ? decoded : `/${decoded}`;
  const normalized = rooted.length > 1 ? rooted.replace(/\/+$/u, "") : rooted;
  // Nest/Express routes are case-insensitive by default, so the security
  // classifier must canonicalize case before matching the same route family.
  return normalized.toLowerCase();
}

function queryPath(req: Request): string | null {
  const value =
    req.query && typeof req.query === "object" ? req.query.path : undefined;
  const joined = Array.isArray(value)
    ? value
        .filter((part): part is string => typeof part === "string")
        .join("/")
    : typeof value === "string"
      ? value
      : null;
  if (!joined) return null;
  const normalized = normalizedRequestPath(joined);
  if (!normalized) return null;
  return normalized.startsWith("/api/")
    ? normalized
    : `/api${normalized}`;
}

/**
 * Authentication POSTs can establish or replace an ambient HttpOnly session even
 * before a cookie exists. They therefore need login-CSRF protection as well as
 * the ordinary cookie-authenticated mutation boundary.
 *
 * `queryPath` mirrors the Vercel `/api/index?path=...` adapter shape because this
 * middleware deliberately runs before the adapter rewrites the request URL.
 */
export function isAuthMutationRequest(req: Request): boolean {
  const candidates = [
    normalizedRequestPath(req.path),
    normalizedRequestPath(req.originalUrl),
    queryPath(req),
  ];
  return candidates.some((path) =>
    path === "/auth"
    || path === "/api/auth"
    || path?.startsWith("/auth/") === true
    || path?.startsWith("/api/auth/") === true
  );
}

/**
 * Guest jam tickets are minted without a session cookie. They still need the
 * same Origin + CSRF-header proof as login POSTs so a foreign site cannot
 * drive ticket issuance from the victim's browser.
 */
export function isStudioRealtimeTicketMutationRequest(req: Request): boolean {
  const candidates = [
    normalizedRequestPath(req.path),
    normalizedRequestPath(req.originalUrl),
    queryPath(req),
  ];
  return candidates.some(
    (path) =>
      path === "/studio-realtime/tickets"
      || path === "/api/studio-realtime/tickets",
  );
}

function singleHeaderValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseCanonicalBrowserOrigin(
  origin: string,
  env: NodeJS.ProcessEnv,
): URL | null {
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return null;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (env.NODE_ENV === "production" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isAllowedCsrfOrigin(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!parseCanonicalBrowserOrigin(origin, env)) return false;
  return allowedCorsOrigins(env).includes(origin);
}

export function isSameRequestOrigin(
  origin: string,
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const parsed = parseCanonicalBrowserOrigin(origin, env);
  const host = singleHeaderValue(req.headers.host);
  return Boolean(
    parsed
      && host
      && parsed.host.toLowerCase() === host.toLowerCase(),
  );
}

function hasAllowedMissingOriginFetchMetadata(req: Request): boolean {
  const site = singleHeaderValue(req.headers["sec-fetch-site"]);
  const mode = singleHeaderValue(req.headers["sec-fetch-mode"]);
  return Boolean(
    site
      && mode
      && ALLOWED_MISSING_ORIGIN_FETCH_SITES.has(site)
      && ALLOWED_MISSING_ORIGIN_FETCH_MODES.has(mode),
  );
}

function rejectCsrfRequest(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(403).json({
    statusCode: 403,
    error: "Forbidden",
    message: "요청 출처를 확인할 수 없습니다.",
  });
}

/**
 * Protect ambient-cookie mutations before Nest route matching.
 *
 * Header-authenticated CLI/server calls bypass this browser-only boundary.
 * There are deliberately no unsafe-method path exceptions: OAuth callbacks
 * and downloads are GET/HEAD endpoints and are exempt solely by HTTP method.
 */
export function createCsrfProtectionMiddleware(
  env: NodeJS.ProcessEnv = process.env,
) {
  return function csrfProtection(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!isCsrfProtectedMethod(req.method)) {
      next();
      return;
    }

    const authenticationSource = getSessionAuthenticationSource(req);
    // A verified signed header is an explicit, non-ambient server/CLI credential.
    // Cookie requests and anonymous auth mutations are browser-forgeable and must
    // prove both an allowed Origin and the non-safelisted application header.
    if (authenticationSource === "header") {
      next();
      return;
    }
    const authMutation = isAuthMutationRequest(req);
    const ticketMutation = isStudioRealtimeTicketMutationRequest(req);
    if (authenticationSource !== "cookie" && !authMutation && !ticketMutation) {
      next();
      return;
    }

    const proof = singleHeaderValue(req.headers[TOONSPECTRUM_CSRF_HEADER]);
    if (proof !== TOONSPECTRUM_CSRF_HEADER_VALUE) {
      rejectCsrfRequest(res);
      return;
    }

    const origin = singleHeaderValue(req.headers.origin);
    if (origin) {
      if (
        !isSameRequestOrigin(origin, req, env)
        && !isAllowedCsrfOrigin(origin, env)
      ) {
        rejectCsrfRequest(res);
        return;
      }
    } else if (
      authMutation
      || ticketMutation
      || !hasAllowedMissingOriginFetchMetadata(req)
    ) {
      rejectCsrfRequest(res);
      return;
    }

    next();
  };
}
