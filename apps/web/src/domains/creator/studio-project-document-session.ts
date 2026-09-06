import type {
  CanonicalStudioDocumentEnvelope,
  StudioDocumentJsonObject,
} from "./studio-document-envelope";
import type { StudioProjectDocumentMetadata } from "./studio-project-document";

export interface StudioProjectDocumentSessionProvenance {
  readonly scopeKey: string;
  readonly baselineGeneration: number;
  /** Parser-validated, detached, recursively frozen canonical authority. */
  readonly envelope: CanonicalStudioDocumentEnvelope<"project">;
  readonly document: Readonly<{
    id: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
  }>;
  readonly extensions: StudioDocumentJsonObject;
}

export interface StudioProjectDocumentSessionExportPlan {
  readonly metadata: StudioProjectDocumentMetadata;
  readonly extensions: StudioDocumentJsonObject;
  /**
   * Existing canonical authority used verbatim for a no-edit export. A null value means the caller
   * must create and validate a new envelope from `project`, metadata, and extensions.
   */
  readonly directEnvelope: CanonicalStudioDocumentEnvelope<"project"> | null;
  /** Current known fields overlaid on preserved future top-level payload fields. */
  readonly project: Readonly<Record<string, unknown>>;
  readonly provenance: "created" | "unchanged" | "advanced";
}

const EMPTY_EXTENSIONS: StudioDocumentJsonObject = Object.freeze({});

function assertGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new RangeError("Studio project generation must be a non-negative safe integer.");
  }
}

function frozenDocument(
  document: StudioProjectDocumentSessionProvenance["document"],
): StudioProjectDocumentSessionProvenance["document"] {
  return Object.freeze({
    id: document.id,
    revision: document.revision,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  });
}

function createSession(
  scopeKey: string,
  baselineGeneration: number,
  envelope: CanonicalStudioDocumentEnvelope<"project">,
): StudioProjectDocumentSessionProvenance {
  assertGeneration(baselineGeneration);
  return Object.freeze({
    scopeKey,
    baselineGeneration,
    envelope,
    document: envelope.document,
    // Canonical envelopes are already detached and recursively frozen at the parser boundary.
    // Retaining this opaque graph avoids a second potentially multi-megabyte clone.
    extensions: envelope.extensions,
  });
}

function exportMetadata(
  document: StudioProjectDocumentSessionProvenance["document"],
): StudioProjectDocumentMetadata {
  return Object.freeze({
    documentId: document.id,
    revision: document.revision,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  });
}

function advancedTimestamp(previous: string, requested: string): string {
  const previousTime = Date.parse(previous);
  const requestedTime = Date.parse(requested);
  if (!Number.isFinite(previousTime) || !Number.isFinite(requestedTime)) {
    throw new RangeError("Studio project timestamps must be valid ISO-8601 values.");
  }
  const nextTime = Math.max(requestedTime, previousTime + 1);
  try {
    const next = new Date(nextTime).toISOString();
    if (!/^\d{4}-\d{2}-\d{2}T/u.test(next) || Date.parse(next) <= previousTime) {
      throw new RangeError("Studio project timestamp range is exhausted.");
    }
    return next;
  } catch {
    throw new RangeError("Studio project timestamp range is exhausted.");
  }
}

function projectRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Studio project export payload must be an object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function copyProjectTopLevel(value: unknown): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.assign(Object.create(null), projectRecord(value)));
}

function mergeProjectTopLevel(
  preserved: unknown,
  current: unknown,
): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.assign(
      Object.create(null),
      projectRecord(preserved),
      projectRecord(current),
    ),
  );
}

export function captureStudioProjectDocumentSession(
  envelope: CanonicalStudioDocumentEnvelope<"project">,
  scopeKey: string,
  baselineGeneration: number,
): StudioProjectDocumentSessionProvenance {
  return createSession(scopeKey, baselineGeneration, envelope);
}

export function planStudioProjectDocumentSessionExport(input: Readonly<{
  session: StudioProjectDocumentSessionProvenance | null;
  scopeKey: string;
  currentGeneration: number;
  exportedAt: string;
  fallbackMetadata: StudioProjectDocumentMetadata;
  readCurrentProject: () => Readonly<Record<string, unknown>>;
}>): StudioProjectDocumentSessionExportPlan {
  assertGeneration(input.currentGeneration);
  const session = input.session;
  if (
    !session
    || session.scopeKey !== input.scopeKey
    || input.currentGeneration < session.baselineGeneration
  ) {
    return Object.freeze({
      metadata: Object.freeze({ ...input.fallbackMetadata }),
      extensions: EMPTY_EXTENSIONS,
      directEnvelope: null,
      project: copyProjectTopLevel(input.readCurrentProject()),
      provenance: "created",
    });
  }

  if (input.currentGeneration === session.baselineGeneration) {
    return Object.freeze({
      metadata: exportMetadata(session.document),
      extensions: session.extensions,
      directEnvelope: session.envelope,
      project: projectRecord(session.envelope.payload.data),
      provenance: "unchanged",
    });
  }

  const generationDelta = input.currentGeneration - session.baselineGeneration;
  const availableRevisions = Number.MAX_SAFE_INTEGER - session.document.revision;
  if (generationDelta > availableRevisions) {
    throw new RangeError(
      "Studio project revision range is exhausted. Save as a new document instead.",
    );
  }
  const revision = session.document.revision + generationDelta;
  const document = frozenDocument({
    ...session.document,
    revision,
    updatedAt: advancedTimestamp(session.document.updatedAt, input.exportedAt),
  });
  return Object.freeze({
    metadata: exportMetadata(document),
    extensions: session.extensions,
    directEnvelope: null,
    project: mergeProjectTopLevel(
      session.envelope.payload.data,
      input.readCurrentProject(),
    ),
    provenance: "advanced",
  });
}
