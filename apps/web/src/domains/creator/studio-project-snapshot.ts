import {
  createEmptyStudioAiImageReferenceDocument,
  hydrateStudioAiImageReferenceDocument,
  type StudioAiImageReferenceDocument,
} from "./ai/studio-ai-image-reference-roles";
import { studioDrawingAssistHasContent } from "./brush/studio-drawing-assist-document";
import {
  serializeDocumentMaster,
  type DocumentMaster,
} from "./studio-master-page";
import {
  projectStudioPendingStrokes,
  type StudioPendingStrokeBatch,
  type StudioPendingStrokeElementLike,
  type StudioPendingStrokePageLike,
  type StudioPendingStrokeProjection,
} from "./studio-pending-stroke-durability";
import {
  studioReferenceBoardHasContent,
  type StudioReferenceBoardDocument,
} from "./studio-reference-board";
import {
  studioWriterRoomHasContent,
  type StudioWriterRoomDocument,
} from "./studio-writer-room";

import type { StudioAiProvenanceDocument } from "./ai/studio-ai-provenance";
import type { StudioCharacterBible } from "./studio-character-bible";
import type { StudioCommentsDocument } from "./studio-comments";
import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";
import type { StudioProjectFile } from "./studio-project-file";
import type { StudioPublicationAnalyticsDocument } from "./studio-publication-analytics";
import type { StudioPublishComplianceChecklist } from "./studio-publish-compliance";
import type { StudioPublishPackageSettings } from "./studio-publish-package";
import type {
  StudioPublishAiUsage,
  StudioPublishProfile,
} from "./studio-publish-preflight";
import type { StudioReleaseSchedule } from "./studio-release-schedule";

export interface StudioDurableProjectPagesInput<
  Page extends StudioPendingStrokePageLike,
  Stroke extends StudioPendingStrokeElementLike,
> {
  /** Latest synchronous undo history. It wins over a render-derived page array. */
  pagesHistory: readonly (readonly Page[])[];
  historyIndex: number;
  /** Render-derived fallback used only before history exists or when its index has no snapshot. */
  fallbackPages: readonly Page[];
  /** Released ink that is still intentionally outside React history. */
  pendingStrokeCommits?: StudioPendingStrokeBatch<Stroke> | null;
}

/**
 * Resolves the document pages that are safe to persist at this exact instant.
 *
 * Pointer completion can advance the ref-backed undo history before React renders, while a
 * deferred stroke batch can remain outside that history for a short handoff window. Persistence
 * must therefore read the authoritative history snapshot first and idempotently overlay the
 * deferred batch second. The returned projection retains diagnostics for missing/ambiguous pages
 * instead of silently inventing a destination.
 */
export function resolveStudioDurableProjectPages<
  Page extends StudioPendingStrokePageLike,
  Stroke extends StudioPendingStrokeElementLike,
>(
  input: StudioDurableProjectPagesInput<Page, Stroke>
): StudioPendingStrokeProjection<Page> {
  const boundedHistoryIndex = Math.max(
    0,
    Math.min(input.historyIndex, Math.max(0, input.pagesHistory.length - 1))
  );
  const authoritativePages =
    input.pagesHistory[boundedHistoryIndex] ?? input.fallbackPages;
  return projectStudioPendingStrokes(
    authoritativePages,
    input.pendingStrokeCommits
  );
}

export interface StudioProjectPublishPackSnapshot {
  profile: StudioPublishProfile;
  aiUsage: StudioPublishAiUsage;
  disclosure: string;
  compliance: StudioPublishComplianceChecklist;
  packageSettings: StudioPublishPackageSettings;
  packageCredits: string;
}

/** Canonical, fully typed v2 snapshot used by export, archive, checkpoints, and recovery. */
export type StudioProjectSnapshot = {
  version: 2;
  savedAt: string;
  title: string;
  description: string;
  tagsText: string;
  linkedTitleId: string | null | undefined;
  linkedSeriesId: string | null | undefined;
  linkedChallengeId: string | null | undefined;
  pagesList: PageState[];
  master: { elements: El[] } | undefined;
  characterBible: StudioCharacterBible;
  writerRoom: StudioWriterRoomDocument;
  aiProvenance: StudioAiProvenanceDocument;
  comments: StudioCommentsDocument;
  releaseSchedule: StudioReleaseSchedule;
  publicationAnalytics: StudioPublicationAnalyticsDocument;
  referenceBoard: StudioReferenceBoardDocument;
  aiImageReferences: StudioAiImageReferenceDocument;
  currentPageId: string;
  webtoonTheme: StudioProjectFile["webtoonTheme"];
  panelGutter: number;
  publishPack: StudioProjectPublishPackSnapshot;
};

export interface BuildStudioProjectFileSnapshotInput {
  /** The caller owns clock selection so tests and lifecycle receipts remain deterministic. */
  savedAt: string;
  title: string;
  description: string;
  tagsText: string;
  linkedTitleId: string | null | undefined;
  linkedSeriesId: string | null | undefined;
  linkedChallengeId: string | null | undefined;
  pagesList: PageState[];
  master: DocumentMaster<El> | null | undefined;
  characterBible: StudioCharacterBible;
  writerRoom: StudioWriterRoomDocument;
  aiProvenance: StudioAiProvenanceDocument;
  comments: StudioCommentsDocument;
  releaseSchedule: StudioReleaseSchedule;
  publicationAnalytics: StudioPublicationAnalyticsDocument;
  referenceBoard: StudioReferenceBoardDocument;
  aiImageReferences?: StudioAiImageReferenceDocument;
  currentPageId: string;
  webtoonTheme: StudioProjectFile["webtoonTheme"];
  panelGutter: number;
  publishPack: StudioProjectPublishPackSnapshot;
}

/**
 * Builds one lossless StudioProjectFile projection from the editor's canonical document state.
 * Binary asset bytes deliberately remain outside this JSON boundary; their project-owned
 * manifests are preserved inside page elements/referenceBoard and archived by the callers.
 */
export function buildStudioProjectFileSnapshot(
  input: BuildStudioProjectFileSnapshotInput
): StudioProjectSnapshot {
  return {
    version: 2,
    savedAt: input.savedAt,
    title: input.title,
    description: input.description,
    tagsText: input.tagsText,
    linkedTitleId: input.linkedTitleId,
    linkedSeriesId: input.linkedSeriesId,
    linkedChallengeId: input.linkedChallengeId,
    pagesList: input.pagesList,
    // Empty masters intentionally stay `undefined`, preserving legacy JSON omission semantics.
    master: serializeDocumentMaster(input.master),
    characterBible: input.characterBible,
    writerRoom: input.writerRoom,
    aiProvenance: input.aiProvenance,
    comments: input.comments,
    releaseSchedule: input.releaseSchedule,
    publicationAnalytics: input.publicationAnalytics,
    referenceBoard: input.referenceBoard,
    aiImageReferences: input.aiImageReferences === undefined
      ? createEmptyStudioAiImageReferenceDocument()
      : hydrateStudioAiImageReferenceDocument(input.aiImageReferences),
    currentPageId: input.currentPageId,
    webtoonTheme: input.webtoonTheme,
    panelGutter: input.panelGutter,
    publishPack: input.publishPack,
  };
}

/**
 * Returns whether a snapshot contains creator-owned work worth replacing an existing recovery
 * with. View-only defaults (current page, theme, gutter, compliance checkboxes) do not count.
 */
export function studioProjectSnapshotHasMeaningfulContent(
  snapshot: StudioProjectSnapshot,
  options: { canvasWidth: number }
): boolean {
  const settings = snapshot.publishPack.packageSettings;
  return (
    snapshot.pagesList.some((page) => page.elements.length > 0) ||
    snapshot.pagesList.some((page) =>
      studioDrawingAssistHasContent(page.drawingAssist, {
        canvasWidth: options.canvasWidth,
        canvasHeight: page.canvasH,
      })
    ) ||
    (snapshot.master?.elements.length ?? 0) > 0 ||
    snapshot.characterBible.characters.length > 0 ||
    studioWriterRoomHasContent(snapshot.writerRoom) ||
    snapshot.aiProvenance.operations.length > 0 ||
    snapshot.comments.threads.length > 0 ||
    snapshot.releaseSchedule.items.length > 0 ||
    snapshot.publicationAnalytics.records.length > 0 ||
    studioReferenceBoardHasContent(snapshot.referenceBoard) ||
    snapshot.aiImageReferences.references.length > 0 ||
    snapshot.publishPack.profile !== "generic" ||
    snapshot.publishPack.aiUsage !== "none" ||
    snapshot.publishPack.disclosure.trim() !== "" ||
    snapshot.publishPack.packageCredits.trim() !== "" ||
    settings.includeReviewPdf ||
    !settings.includeCredits ||
    settings.requestedThumbnailSlots.join(",") !== "episode" ||
    snapshot.title.trim() !== "" ||
    snapshot.description.trim() !== "" ||
    snapshot.tagsText.trim() !== ""
  );
}
