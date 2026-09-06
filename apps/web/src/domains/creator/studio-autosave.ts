import {
  hydrateStudioAiImageReferenceDocument,
  type StudioAiImageReferenceDocument,
} from "./ai/studio-ai-image-reference-roles";
import {
  normalizeStudioAiProvenanceDocument,
  type StudioAiProvenanceDocument,
} from "./ai/studio-ai-provenance";
import { studioDrawingAssistHasContent } from "./brush/studio-drawing-assist-document";
import { STUDIO_CANVAS_WIDTH } from "./canvas/studio-canvas-constants";
import { normalizeStudioPublishPackageSettings } from "./studio-publish-package";
import { normalizeStudioPublishPackSettings } from "./studio-publish-preflight";
import {
  normalizeStudioReferenceBoardDocument,
  studioReferenceBoardHasContent,
  type StudioReferenceBoardDocument,
} from "./studio-reference-board";
import { migrateStudioShared3dStageCollectionDocument } from "./studio-shared-3d-stage-collection";

export const LEGACY_STUDIO_AUTOSAVE_KEY = "toonspectrum-studio-autosave";
const STUDIO_AUTOSAVE_PREFIX = "toonspectrum-studio-autosave:v12";

export interface StudioAutosaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Why an autosave bypassed the normal debounced loop and entered durable storage immediately.
 * The marker is private recovery metadata; it is never projected into a creator document.
 */
export type StudioPendingStrokeDurabilityReason =
  | "pointerup"
  | "route-change"
  | "pagehide"
  | "visibility-hidden"
  | "unmount";

export type StudioPendingStrokeDurabilityMarker = {
  kind: "pending-strokes";
  reason: StudioPendingStrokeDurabilityReason;
  pageId: string;
  strokeIds: string[];
  savedAt: string;
};

/**
 * Receipt for a synchronous lifecycle snapshot. Unlike the pending-stroke receipt above, this
 * marker also covers already-committed React state that has not reached the 1.5s autosave yet.
 */
export type StudioLifecycleDurabilityMarker = {
  kind: "lifecycle-snapshot";
  reason: StudioPendingStrokeDurabilityReason;
  savedAt: string;
  pendingStrokePageId?: string;
  pendingStrokeIds?: string[];
};

export type StudioAutosavePayload = {
  version: 2;
  savedAt: string;
  pagesList: Array<{
    id?: unknown;
    elements?: unknown[];
    canvasH?: unknown;
    drawingAssist?: unknown;
    shared3dStage?: unknown;
  }>;
  master?: { elements?: unknown[] } | unknown;
  characterBible?: unknown;
  /** Private story planning/review state. Never projected into public creator documents. */
  writerRoom?: unknown;
  comments?: unknown;
  releaseSchedule?: unknown;
  publicationAnalytics?: unknown;
  /** Project-owned reference composition. Image bytes are content-addressed outside this JSON. */
  referenceBoard?: StudioReferenceBoardDocument;
  /** Private, document-scoped AI operation history. Prompt text is redacted during hydration. */
  aiProvenance?: StudioAiProvenanceDocument;
  /** Metadata-only project references; image bytes remain in the asset CAS. */
  aiImageReferences?: StudioAiImageReferenceDocument;
  title?: string;
  description?: string;
  tagsText?: string;
  /** New-work relationship intent. `null` explicitly means this project is not linked. */
  linkedTitleId?: string | null;
  linkedSeriesId?: string | null;
  linkedChallengeId?: string | null;
  webtoonTheme?: unknown;
  panelGutter?: unknown;
  currentPageId?: string;
  publishPack?: unknown;
  /** Shared-work optimistic-concurrency source. Both fields are required for safe shared restore. */
  sourceWorkId?: string;
  sourceRevision?: number;
  /** Immediate recovery receipt for strokes that had not reached React state before navigation. */
  pendingStrokeDurability?: StudioPendingStrokeDurabilityMarker;
  /** Immediate route/page lifecycle receipt, including stable edits inside the debounce window. */
  lifecycleDurability?: StudioLifecycleDurabilityMarker;
};

const STUDIO_PENDING_STROKE_DURABILITY_REASONS = new Set<StudioPendingStrokeDurabilityReason>([
  "pointerup",
  "route-change",
  "pagehide",
  "visibility-hidden",
  "unmount",
]);

function normalizeStudioPendingStrokeDurabilityMarker(
  value: unknown
): StudioPendingStrokeDurabilityMarker | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.kind !== "pending-strokes") return undefined;
  if (
    typeof record.reason !== "string"
    || !STUDIO_PENDING_STROKE_DURABILITY_REASONS.has(
      record.reason as StudioPendingStrokeDurabilityReason
    )
  ) {
    return undefined;
  }
  if (typeof record.pageId !== "string" || record.pageId.trim().length === 0) return undefined;
  if (typeof record.savedAt !== "string" || record.savedAt.trim().length === 0) return undefined;
  if (!Array.isArray(record.strokeIds)) return undefined;
  const strokeIds = [
    ...new Set(
      record.strokeIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0
      )
    ),
  ];
  if (strokeIds.length === 0) return undefined;
  return {
    kind: "pending-strokes",
    reason: record.reason as StudioPendingStrokeDurabilityReason,
    pageId: record.pageId,
    strokeIds,
    savedAt: record.savedAt,
  };
}

function normalizeStudioLifecycleDurabilityMarker(
  value: unknown
): StudioLifecycleDurabilityMarker | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.kind !== "lifecycle-snapshot") return undefined;
  if (
    typeof record.reason !== "string"
    || !STUDIO_PENDING_STROKE_DURABILITY_REASONS.has(
      record.reason as StudioPendingStrokeDurabilityReason
    )
  ) {
    return undefined;
  }
  if (typeof record.savedAt !== "string" || record.savedAt.trim().length === 0) return undefined;

  const hasPendingPage = Object.hasOwn(record, "pendingStrokePageId");
  const hasPendingIds = Object.hasOwn(record, "pendingStrokeIds");
  if (hasPendingPage !== hasPendingIds) return undefined;
  if (!hasPendingPage) {
    return {
      kind: "lifecycle-snapshot",
      reason: record.reason as StudioPendingStrokeDurabilityReason,
      savedAt: record.savedAt,
    };
  }
  if (
    typeof record.pendingStrokePageId !== "string"
    || record.pendingStrokePageId.trim().length === 0
    || !Array.isArray(record.pendingStrokeIds)
  ) {
    return undefined;
  }
  const pendingStrokeIds = [
    ...new Set(
      record.pendingStrokeIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0
      )
    ),
  ];
  if (pendingStrokeIds.length === 0) return undefined;
  return {
    kind: "lifecycle-snapshot",
    reason: record.reason as StudioPendingStrokeDurabilityReason,
    savedAt: record.savedAt,
    pendingStrokePageId: record.pendingStrokePageId,
    pendingStrokeIds,
  };
}

export type StudioSharedAutosaveCompatibility =
  | { compatible: true; reason: "match" }
  | {
      compatible: false;
      reason: "legacy-unversioned" | "work-mismatch" | "revision-mismatch";
    };

export function studioSharedAutosaveCompatibility(
  payload: StudioAutosavePayload,
  current: { workId: string; revision: number }
): StudioSharedAutosaveCompatibility {
  if (payload.sourceWorkId === undefined || payload.sourceRevision === undefined) {
    return { compatible: false, reason: "legacy-unversioned" };
  }
  if (payload.sourceWorkId !== current.workId) {
    return { compatible: false, reason: "work-mismatch" };
  }
  if (payload.sourceRevision !== current.revision) {
    return { compatible: false, reason: "revision-mismatch" };
  }
  return { compatible: true, reason: "match" };
}

export function studioAutosaveKey(input: {
  userId?: string | null;
  workId?: string | null;
  remixId?: string | null;
}): string {
  const owner = encodeURIComponent(input.userId?.trim() || "guest");
  const documentId = input.workId
    ? `work:${encodeURIComponent(input.workId)}`
    : input.remixId
      ? `remix:${encodeURIComponent(input.remixId)}`
      : "new";
  return `${STUDIO_AUTOSAVE_PREFIX}:${owner}:${documentId}`;
}

export function parseStudioAutosave(raw: string | null): StudioAutosavePayload | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.pagesList) || record.pagesList.length === 0) return null;
    const pagesList = record.pagesList.map((page) => {
      if (!page || typeof page !== "object" || Array.isArray(page)) return page;
      const pageRecord = page as Record<string, unknown>;
      if (!Object.hasOwn(pageRecord, "shared3dStage")) return pageRecord;
      const { shared3dStage: rawSharedStage, ...rest } = pageRecord;
      const shared3dStage = migrateStudioShared3dStageCollectionDocument(rawSharedStage);
      // Autosave is a recovery surface: preserve the artwork even when only the optional link is
      // corrupt. Project import remains fail-closed for the same malformed document.
      return shared3dStage ? { ...rest, shared3dStage } : rest;
    }) as StudioAutosavePayload["pagesList"];
    return {
      version: 2,
      savedAt: typeof record.savedAt === "string" ? record.savedAt : new Date(0).toISOString(),
      pagesList,
      master: record.master,
      characterBible: record.characterBible,
      writerRoom: record.writerRoom,
      comments: record.comments,
      releaseSchedule: record.releaseSchedule,
      publicationAnalytics: record.publicationAnalytics,
      referenceBoard: Object.hasOwn(record, "referenceBoard")
        ? normalizeStudioReferenceBoardDocument(record.referenceBoard)
        : undefined,
      aiProvenance: Object.hasOwn(record, "aiProvenance")
        ? normalizeStudioAiProvenanceDocument(record.aiProvenance)
        : undefined,
      aiImageReferences: Object.hasOwn(record, "aiImageReferences")
        ? hydrateStudioAiImageReferenceDocument(record.aiImageReferences)
        : undefined,
      title: typeof record.title === "string" ? record.title : undefined,
      description: typeof record.description === "string" ? record.description : undefined,
      tagsText: typeof record.tagsText === "string" ? record.tagsText : undefined,
      linkedTitleId:
        record.linkedTitleId === null
          ? null
          : typeof record.linkedTitleId === "string" && record.linkedTitleId.trim().length > 0
            ? record.linkedTitleId
            : undefined,
      linkedSeriesId:
        record.linkedSeriesId === null
          ? null
          : typeof record.linkedSeriesId === "string" && record.linkedSeriesId.trim().length > 0
            ? record.linkedSeriesId
            : undefined,
      linkedChallengeId:
        record.linkedChallengeId === null
          ? null
          : typeof record.linkedChallengeId === "string" && record.linkedChallengeId.trim().length > 0
            ? record.linkedChallengeId
            : undefined,
      webtoonTheme: record.webtoonTheme,
      panelGutter: record.panelGutter,
      currentPageId: typeof record.currentPageId === "string" ? record.currentPageId : undefined,
      publishPack: record.publishPack,
      sourceWorkId:
        typeof record.sourceWorkId === "string" && record.sourceWorkId.trim().length > 0
          ? record.sourceWorkId
          : undefined,
      sourceRevision:
        typeof record.sourceRevision === "number" &&
        Number.isSafeInteger(record.sourceRevision) &&
        record.sourceRevision >= 1
          ? record.sourceRevision
          : undefined,
      pendingStrokeDurability: normalizeStudioPendingStrokeDurabilityMarker(
        record.pendingStrokeDurability
      ),
      lifecycleDurability: normalizeStudioLifecycleDurabilityMarker(
        record.lifecycleDurability
      ),
    };
  } catch {
    return null;
  }
}

/**
 * Serializes a private autosave while enforcing the same privacy boundary as hydration. Even if
 * a caller passes an explicitly raw-retaining provenance document, browser storage receives only
 * its canonical hash-only representation.
 */
export function serializeStudioAutosave(payload: StudioAutosavePayload): string {
  const pagesList = payload.pagesList.map((page) => {
    if (!page || typeof page !== "object" || Array.isArray(page)) return page;
    const pageRecord = page as Record<string, unknown>;
    if (!Object.hasOwn(pageRecord, "shared3dStage")) return page;
    const { shared3dStage: rawSharedStage, ...rest } = pageRecord;
    const shared3dStage = migrateStudioShared3dStageCollectionDocument(rawSharedStage);
    return shared3dStage ? { ...rest, shared3dStage } : rest;
  });
  return JSON.stringify({
    ...payload,
    pagesList,
    ...(payload.referenceBoard === undefined
      ? {}
      : { referenceBoard: normalizeStudioReferenceBoardDocument(payload.referenceBoard) }),
    ...(payload.aiProvenance === undefined
      ? {}
      : { aiProvenance: normalizeStudioAiProvenanceDocument(payload.aiProvenance) }),
    ...(payload.aiImageReferences === undefined
      ? {}
      : { aiImageReferences: hydrateStudioAiImageReferenceDocument(payload.aiImageReferences) }),
  });
}

function studioWriterRoomHasContent(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.suggestions) && record.suggestions.length > 0) return true;
  const completion = record.completion;
  if (
    completion &&
    typeof completion === "object" &&
    !Array.isArray(completion) &&
    Object.values(completion).some((item) => item === true)
  ) return true;
  const stages = record.stages;
  if (!stages || typeof stages !== "object" || Array.isArray(stages)) return false;
  for (const stage of Object.values(stages)) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) continue;
    const stageRecord = stage as Record<string, unknown>;
    if (["text", "title", "summary"].some(
      (key) => typeof stageRecord[key] === "string" && stageRecord[key].trim().length > 0
    )) return true;
    if (["items", "dialogue", "sfx"].some(
      (key) => Array.isArray(stageRecord[key]) && stageRecord[key].length > 0
    )) return true;
  }
  return false;
}

/**
 * Mirrors the editor snapshot's recovery-worthiness policy for publish-only work. Older payloads
 * can omit every field, while malformed/future nested settings must never make recovery discovery
 * throw and hide otherwise valid candidates.
 */
function studioAutosavePublishPackHasContent(value: unknown): boolean {
  const publishPack = normalizeStudioPublishPackSettings(value);
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const packageCredits = typeof record.packageCredits === "string"
    ? record.packageCredits.trim()
    : "";

  let packageSettings;
  try {
    packageSettings = normalizeStudioPublishPackageSettings(
      record.packageSettings ?? {
        destination: record.profile,
        aiUsage: record.aiUsage,
        aiDisclosure: record.disclosure,
      }
    );
  } catch {
    // The raw value remains available for backup/export, but unsupported future settings do not
    // become a false-positive recovery candidate in an older client.
    return (
      publishPack.profile !== "generic"
      || publishPack.aiUsage !== "none"
      || publishPack.disclosure.trim() !== ""
      || packageCredits !== ""
    );
  }

  return (
    publishPack.profile !== "generic"
    || publishPack.aiUsage !== "none"
    || publishPack.disclosure.trim() !== ""
    || packageCredits !== ""
    || packageSettings.includeReviewPdf
    || !packageSettings.includeCredits
    || packageSettings.requestedThumbnailSlots.join(",") !== "episode"
  );
}

export function studioAutosaveHasContent(payload: StudioAutosavePayload): boolean {
  return (
    // A lifecycle receipt is an explicit dirty snapshot. It can intentionally represent deleting
    // the final element or changing page/background metadata that older content heuristics omit.
    payload.lifecycleDurability !== undefined ||
    payload.pagesList.some((page) => Array.isArray(page?.elements) && page.elements.length > 0) ||
    payload.pagesList.some((page) => studioDrawingAssistHasContent(page?.drawingAssist, {
      canvasWidth: STUDIO_CANVAS_WIDTH,
      canvasHeight: typeof page?.canvasH === "number" && Number.isFinite(page.canvasH)
        ? page.canvasH
        : 1_080,
    })) ||
    (typeof payload.master === "object" &&
      payload.master !== null &&
      Array.isArray((payload.master as { elements?: unknown[] }).elements) &&
      ((payload.master as { elements: unknown[] }).elements.length > 0)) ||
    (typeof payload.characterBible === "object" &&
      payload.characterBible !== null &&
      Array.isArray((payload.characterBible as { characters?: unknown[] }).characters) &&
      ((payload.characterBible as { characters: unknown[] }).characters.length > 0)) ||
    studioWriterRoomHasContent(payload.writerRoom) ||
    (typeof payload.comments === "object" &&
      payload.comments !== null &&
      Array.isArray((payload.comments as { threads?: unknown[] }).threads) &&
      ((payload.comments as { threads: unknown[] }).threads.length > 0)) ||
    (typeof payload.releaseSchedule === "object" &&
      payload.releaseSchedule !== null &&
      Array.isArray((payload.releaseSchedule as { items?: unknown[] }).items) &&
      ((payload.releaseSchedule as { items: unknown[] }).items.length > 0)) ||
    (typeof payload.publicationAnalytics === "object" &&
      payload.publicationAnalytics !== null &&
      Array.isArray((payload.publicationAnalytics as { records?: unknown[] }).records) &&
      ((payload.publicationAnalytics as { records: unknown[] }).records.length > 0)) ||
    studioReferenceBoardHasContent(payload.referenceBoard) ||
    (payload.aiProvenance?.operations.length ?? 0) > 0 ||
    (payload.aiImageReferences?.references.length ?? 0) > 0 ||
    studioAutosavePublishPackHasContent(payload.publishPack) ||
    (payload.title ?? "").trim().length > 0 ||
    (payload.description ?? "").trim().length > 0 ||
    (payload.tagsText ?? "").trim().length > 0
  );
}

/** A second deterministic slot protects an unresolved primary recovery from lifecycle writes. */
export function studioLifecycleAutosaveSidecarKey(primaryKey: string): string {
  return `${primaryKey}:lifecycle`;
}

export type StudioLifecycleAutosaveWriteResult = {
  key: string;
  disposition: "primary" | "preserved-primary-sidecar";
};

const STUDIO_LIFECYCLE_AUTOSAVE_JOURNAL_KIND = "toonspectrum-lifecycle-recovery-journal";

function parseStudioLifecycleAutosaveJournal(raw: string | null): StudioAutosavePayload[] {
  if (!raw) return [];
  const direct = parseStudioAutosave(raw);
  if (direct && studioAutosaveHasContent(direct)) return [direct];
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    if (
      record.kind !== STUDIO_LIFECYCLE_AUTOSAVE_JOURNAL_KIND
      || record.version !== 1
      || !Array.isArray(record.candidates)
    ) {
      return [];
    }
    return record.candidates.flatMap((candidate) => {
      const parsed = parseStudioAutosave(JSON.stringify(candidate));
      return parsed && studioAutosaveHasContent(parsed) ? [parsed] : [];
    });
  } catch {
    return [];
  }
}

function serializeStudioLifecycleAutosaveJournal(
  candidates: readonly StudioAutosavePayload[]
): string {
  return JSON.stringify({
    kind: STUDIO_LIFECYCLE_AUTOSAVE_JOURNAL_KIND,
    version: 1,
    candidates: candidates.map((candidate) => JSON.parse(serializeStudioAutosave(candidate))),
  });
}

/**
 * Writes a lifecycle recovery without ever replacing an unresolved primary recovery. The sidecar
 * is an append-only journal read by `readStudioAutosave`, so startup can select the newest candidate
 * while every older candidate remains available until the artist explicitly resolves recovery.
 */
export function writeStudioLifecycleAutosave(
  storage: StudioAutosaveStorage,
  primaryKey: string,
  payload: StudioAutosavePayload,
  options: { preservePrimary: boolean }
): StudioLifecycleAutosaveWriteResult {
  const primary = parseStudioAutosave(storage.getItem(primaryKey));
  const preservePrimary =
    options.preservePrimary && primary !== null && studioAutosaveHasContent(primary);
  const key = preservePrimary ? studioLifecycleAutosaveSidecarKey(primaryKey) : primaryKey;
  if (preservePrimary) {
    const journal = parseStudioLifecycleAutosaveJournal(storage.getItem(key));
    // The journal is append-only until explicit restore/clear. Thus a recovery that was itself
    // selected from the sidecar can never be overwritten by edits from a later unresolved visit.
    storage.setItem(key, serializeStudioLifecycleAutosaveJournal([...journal, payload]));
  } else {
    storage.setItem(key, serializeStudioAutosave(payload));
  }
  if (!preservePrimary) storage.removeItem(studioLifecycleAutosaveSidecarKey(primaryKey));
  return {
    key,
    disposition: preservePrimary ? "preserved-primary-sidecar" : "primary",
  };
}

function autosaveTimestamp(payload: StudioAutosavePayload): number {
  const parsed = Date.parse(payload.savedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function readStudioAutosave(
  storage: Pick<StudioAutosaveStorage, "getItem">,
  key: string,
  allowLegacy = false
): { key: string; payload: StudioAutosavePayload } | null {
  const current = parseStudioAutosave(storage.getItem(key));
  const sidecarKey = studioLifecycleAutosaveSidecarKey(key);
  const sidecarCandidates = parseStudioLifecycleAutosaveJournal(storage.getItem(sidecarKey));
  const sidecar = sidecarCandidates.reduce<StudioAutosavePayload | null>(
    (latest, candidate) =>
      latest === null || autosaveTimestamp(candidate) >= autosaveTimestamp(latest)
        ? candidate
        : latest,
    null
  );
  const currentCandidate = current && studioAutosaveHasContent(current)
    ? { key, payload: current }
    : null;
  const sidecarCandidate = sidecar && studioAutosaveHasContent(sidecar)
    ? { key: sidecarKey, payload: sidecar }
    : null;
  if (currentCandidate && sidecarCandidate) {
    return autosaveTimestamp(sidecarCandidate.payload) >= autosaveTimestamp(currentCandidate.payload)
      ? sidecarCandidate
      : currentCandidate;
  }
  if (currentCandidate) return currentCandidate;
  if (sidecarCandidate) return sidecarCandidate;
  if (!allowLegacy) return null;
  const legacy = parseStudioAutosave(storage.getItem(LEGACY_STUDIO_AUTOSAVE_KEY));
  return legacy && studioAutosaveHasContent(legacy)
    ? { key: LEGACY_STUDIO_AUTOSAVE_KEY, payload: legacy }
    : null;
}
