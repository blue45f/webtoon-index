import { normalizeStudioLinked3dSaveProjection } from "./studio-linked-3d-save-projection";
import { parseStudioWorkTagTokens } from "./studio-work-metadata";

import type { StudioProjectSnapshot } from "./studio-project-snapshot";
import type { UpdateStudioSharedDocumentInput } from "./studio-shared-document-client";
import type { StudioTeamRole } from "./studio-team-client";
import type {
  CreateWorkInput,
  UpdateWorkInput,
} from "@/src/infrastructure/creator-client";

export type StudioSaveStatus = "published" | "draft";
export type StudioSavePayload = Omit<CreateWorkInput, "status"> & {
  status: StudioSaveStatus;
};

type StudioSaveProjectDocumentFields = Pick<
  StudioProjectSnapshot,
  | "pagesList"
  | "master"
  | "characterBible"
  | "writerRoom"
  | "aiProvenance"
  | "aiImageReferences"
  | "comments"
  | "releaseSchedule"
  | "publicationAnalytics"
  | "referenceBoard"
  | "currentPageId"
  | "webtoonTheme"
  | "panelGutter"
  | "publishPack"
>;

export interface StudioSaveDocumentInput extends StudioSaveProjectDocumentFields {
  extensionBase?: Record<string, unknown> | null;
  width: number;
}

export interface BuildStudioSavePayloadInput {
  title: string;
  description: string;
  tagsText: string;
  linkedTitleId?: string | null;
  cover: string;
  pageImages: string[];
  document: StudioSaveDocumentInput;
  status: StudioSaveStatus;
  workId?: string | null;
  remixId?: string | null;
  linkedSeriesId?: string | null;
  linkedChallengeId?: string | null;
}

export function normalizeStudioSaveTags(tagsText: string): string[] {
  return parseStudioWorkTagTokens(tagsText).slice(0, 8);
}

/**
 * Projects the captured editor snapshot into the creator API DTO. Validation, capture, I/O,
 * request freshness, and mutation ordering remain owned by the editor-page save coordinator.
 */
export function buildStudioSavePayload(
  input: BuildStudioSavePayloadInput,
): StudioSavePayload {
  const { document } = input;
  const pagesList = normalizeStudioLinked3dSaveProjection({
    pagesList: document.pagesList,
    master: document.master,
  });
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    tags: normalizeStudioSaveTags(input.tagsText),
    format: "cuttoon",
    titleId: input.linkedTitleId ?? undefined,
    cover: input.cover,
    pages: input.pageImages,
    doc: {
      ...(document.extensionBase ?? {}),
      width: document.width,
      pagesList,
      master: document.master,
      characterBible: document.characterBible,
      writerRoom: document.writerRoom,
      aiProvenance: document.aiProvenance,
      aiImageReferences: document.aiImageReferences,
      comments: document.comments,
      releaseSchedule: document.releaseSchedule,
      publicationAnalytics: document.publicationAnalytics,
      referenceBoard: document.referenceBoard,
      currentPageId: document.currentPageId,
      webtoonTheme: document.webtoonTheme,
      panelGutter: document.panelGutter,
      publishPack: document.publishPack,
    },
    status: input.status,
    remixFromId: !input.workId && input.remixId ? input.remixId : undefined,
    seriesId: input.linkedSeriesId ?? undefined,
    challengeId: input.linkedChallengeId ?? undefined,
  };
}

export interface BuildStudioSharedSavePatchInput {
  payload: StudioSavePayload;
  baseRevision: number;
  crdtServerSequence: string;
  role: StudioTeamRole;
}

/** Owner-only publication state is intentionally omitted for every non-owner role. */
export function buildStudioSharedSavePatch({
  payload,
  baseRevision,
  crdtServerSequence,
  role,
}: BuildStudioSharedSavePatchInput): UpdateStudioSharedDocumentInput {
  return {
    baseRevision,
    crdtServerSequence,
    title: payload.title,
    description: payload.description,
    tags: payload.tags,
    cover: payload.cover,
    pages: payload.pages,
    doc: payload.doc,
    ...(role === "owner" ? { status: payload.status } : {}),
  };
}

export type StudioDirectWorkSavePlan =
  | { kind: "create"; payload: CreateWorkInput }
  | { kind: "update"; workId: string; payload: UpdateWorkInput };

export interface BuildStudioDirectWorkSavePlanInput {
  payload: StudioSavePayload;
  workId?: string | null;
  baseRevision?: number | null;
}

export function buildStudioDirectWorkSavePlan({
  payload,
  workId,
  baseRevision,
}: BuildStudioDirectWorkSavePlanInput): StudioDirectWorkSavePlan {
  if (!workId) return { kind: "create", payload };
  return {
    kind: "update",
    workId,
    payload: {
      ...payload,
      ...(baseRevision ? { baseRevision } : {}),
    },
  };
}
