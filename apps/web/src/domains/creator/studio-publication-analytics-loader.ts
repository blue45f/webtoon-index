import type { StudioPublicationAnalyticsDocument } from "./studio-publication-analytics";

export interface StudioPublicationAnalyticsRuntime {
  normalizeStudioPublicationAnalyticsDocument: (
    value: unknown,
  ) => StudioPublicationAnalyticsDocument;
}

let runtimePromise: Promise<StudioPublicationAnalyticsRuntime> | null = null;

/**
 * Keeps the CSV parser, validation ledger, and aggregation engine out of Studio's initial route
 * graph. Existing documents load the canonical normalizer only when analytics data must be
 * hydrated; a new document does not pay for the engine until the publication workspace opens.
 */
export function loadStudioPublicationAnalyticsRuntime(): Promise<StudioPublicationAnalyticsRuntime> {
  if (runtimePromise) return runtimePromise;

  const request = import("./studio-publication-analytics")
    .then(({ normalizeStudioPublicationAnalyticsDocument }) => ({
      normalizeStudioPublicationAnalyticsDocument,
    }))
    .catch((error: unknown) => {
      runtimePromise = null;
      throw error;
    });
  runtimePromise = request;
  return request;
}

export function preloadStudioPublicationAnalyticsRuntime(): void {
  void loadStudioPublicationAnalyticsRuntime();
}

/** A fresh, schema-valid blank value without loading the optional analytics engine. */
export function createEmptyStudioPublicationAnalyticsSnapshot(): StudioPublicationAnalyticsDocument {
  return { version: 1, records: [] };
}

export function isEmptyStudioPublicationAnalyticsSnapshot(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate);
    return keys.length === 2
      && keys.includes("version")
      && keys.includes("records")
      && candidate.version === 1
      && Array.isArray(candidate.records)
      && candidate.records.length === 0;
  } catch {
    return false;
  }
}

/**
 * Normalizes persisted analytics only when there is data to normalize. Optional/legacy documents
 * without this domain stay restorable offline even when the analytics chunk is unavailable.
 */
export async function normalizeStudioPublicationAnalyticsDeferred(
  value: unknown,
): Promise<StudioPublicationAnalyticsDocument> {
  if (value == null || isEmptyStudioPublicationAnalyticsSnapshot(value)) {
    return createEmptyStudioPublicationAnalyticsSnapshot();
  }
  const { normalizeStudioPublicationAnalyticsDocument } =
    await loadStudioPublicationAnalyticsRuntime();
  return normalizeStudioPublicationAnalyticsDocument(value);
}
