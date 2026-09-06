/**
 * Browser CSRF proof shared by the Nest boundary and ToonSpectrum API clients.
 *
 * The value is intentionally public and constant: the protection comes from a
 * browser form being unable to attach a non-safelisted header, while the server
 * also validates the request Origin (or strict Fetch Metadata fallback).
 */
export const TOONSPECTRUM_CSRF_HEADER = "x-toonspectrum-csrf";
export const TOONSPECTRUM_CSRF_HEADER_VALUE = "1";

const CSRF_PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isCsrfProtectedMethod(method: string | undefined): boolean {
  return CSRF_PROTECTED_METHODS.has((method ?? "GET").toUpperCase());
}

/** Attach ToonSpectrum's fixed browser CSRF proof without dropping caller headers. */
export function withCsrfHeader(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  next.set(TOONSPECTRUM_CSRF_HEADER, TOONSPECTRUM_CSRF_HEADER_VALUE);
  return next;
}

/** Protect a known ToonSpectrum API mutation while preserving the full fetch init. */
export function withCsrfProtection(init: RequestInit): RequestInit {
  if (!isCsrfProtectedMethod(init.method)) return init;
  return { ...init, headers: withCsrfHeader(init.headers) };
}
