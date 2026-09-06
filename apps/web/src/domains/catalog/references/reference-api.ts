import { ReferenceError, referenceSearchParams } from "../../../shared/lib/kmas-reference";

import { isReferenceItem } from "./reference-storage";

import type { ReferenceQuery, ReferenceResult, ReferenceErrorCode } from "../../../shared/lib/kmas-reference";

const ERROR_CODES: readonly ReferenceErrorCode[] = ["INVALID_QUERY", "KMAS_NOT_CONFIGURED", "KMAS_RATE_LIMITED", "KMAS_TIMEOUT", "KMAS_UNAVAILABLE"];

export function validateReferenceResult(value: unknown, expected: ReferenceQuery): ReferenceResult {
  const data = value as ReferenceResult | null;
  if (!data || data.source !== "kmas" || !Array.isArray(data.items) || data.items.length > 100
    || !data.items.every(isReferenceItem) || new Set(data.items.map((item) => item.id)).size !== data.items.length
    || typeof data.hasNext !== "boolean" || typeof data.cached !== "boolean"
    || !(data.total === null || (Number.isSafeInteger(data.total) && data.total >= data.items.length))
    || typeof data.fetchedAt !== "string" || !Number.isFinite(Date.parse(data.fetchedAt))
    || !data.query || data.query.field !== expected.field || data.query.q !== expected.q || data.query.page !== expected.page
    || (data.items.length === 0 && data.hasNext)) {
    throw new ReferenceError("KMAS_UNAVAILABLE", 502);
  }
  return data;
}

export async function fetchReferenceResult(
  apiBasePath: string, query: ReferenceQuery, signal: AbortSignal, fetcher: typeof fetch = fetch,
): Promise<ReferenceResult> {
  const response = await fetcher(`${apiBasePath}?${referenceSearchParams(query)}`, {
    signal, headers: { Accept: "application/json" },
  });
  // A proxy can return an HTML error page; that is not an empty search result.
  let body: unknown;
  try { body = await response.json(); } catch { throw new ReferenceError("KMAS_UNAVAILABLE", 502); }
  if (!response.ok) {
    const code: unknown = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
    throw new ReferenceError(typeof code === "string" && ERROR_CODES.includes(code as ReferenceErrorCode)
      ? code as ReferenceErrorCode : "KMAS_UNAVAILABLE", response.status);
  }
  return validateReferenceResult(body, query);
}
