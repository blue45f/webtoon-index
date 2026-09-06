import { normalizeStudioCharacterBible } from "./studio-character-bible";
import { normalizeStudioCommentsDocument } from "./studio-comments";
import { creatorWorkSnapshotToStudioProject } from "./studio-creator-work-project";
import { parseStudioProjectFile, type StudioProjectFile } from "./studio-project-file";
import { normalizeStudioPublicationAnalyticsDocument } from "./studio-publication-analytics";
import { normalizeStudioPublishPackageSettings } from "./studio-publish-package";
import { normalizeStudioPublishPackSettings } from "./studio-publish-preflight";
import { normalizeStudioReleaseSchedule } from "./studio-release-schedule";
import { diffStudioProjectRevisions, type StudioRevisionDiff } from "./studio-revision-diff";
import {
  canonicalStudioRevisionDocumentExtensions,
  STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD,
} from "./studio-revision-document-extensions";
import { normalizeStudioWriterRoomDocument } from "./studio-writer-room";

export interface StudioServerRevisionComparisonInput {
  targetRevision: number;
  baseRevision: number;
  targetSnapshot: unknown;
  baseSnapshot: unknown;
  localProject: StudioProjectFile;
}

export interface StudioServerRevisionComparison {
  targetRevision: number;
  baseRevision: number;
  /** Changes that will actually be applied when the current local editor is replaced by target. */
  localToTarget: StudioRevisionDiff;
  serverToLocal: StudioRevisionDiff;
  publicationImpact: StudioRevisionPublicationImpact;
  pageLabels: Readonly<Record<string, string>>;
}

export interface StudioRevisionPublicationImpact {
  statusChange: {
    before: "draft" | "published" | null;
    after: "draft" | "published" | null;
  } | null;
  changedRelations: readonly (typeof PUBLICATION_RELATION_FIELDS)[number][];
}

const SERVER_CONTROLLED_PROJECT_FIELDS = [
  "challengeId",
  "episodeNo",
  "format",
  "remixFromId",
  "seriesId",
  "status",
  "titleId",
  "fx",
  STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD,
] as const;

const PUBLICATION_RELATION_FIELDS = [
  "titleId",
  "seriesId",
  "challengeId",
  "episodeNo",
  "remixFromId",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalPublishPack(value: unknown): Record<string, unknown> {
  const record = isRecord(value) ? value : {};
  const base = normalizeStudioPublishPackSettings(record);
  return {
    ...base,
    packageSettings: normalizeStudioPublishPackageSettings(record.packageSettings ?? {
      destination: record.profile,
      aiUsage: record.aiUsage,
      aiDisclosure: record.disclosure,
    }),
    packageCredits: typeof record.packageCredits === "string"
      ? record.packageCredits.slice(0, 20_000)
      : "",
  };
}

function canonicalAiProvenanceForRevisionComparison(
  value: StudioProjectFile["aiProvenance"]
): Record<string, unknown> {
  // `parseStudioProjectFile` has already normalized and privacy-redacted this section once.
  const document = value ?? { version: 1 as const, operations: [] };
  const operations = document.operations.map((operation) => ({
    kind: operation.kind,
    task: operation.task,
    status: operation.status,
    promptVersion: operation.promptVersion,
    ...(operation.requestedSize ? { requestedSize: operation.requestedSize } : {}),
  }));
  operations.sort((left, right) => {
    const leftSize = left.requestedSize ? `${left.requestedSize.width}x${left.requestedSize.height}` : "";
    const rightSize = right.requestedSize ? `${right.requestedSize.width}x${right.requestedSize.height}` : "";
    const leftKey = `${left.kind}\u0000${left.task}\u0000${left.status}\u0000${left.promptVersion}\u0000${leftSize}`;
    const rightKey = `${right.kind}\u0000${right.task}\u0000${right.status}\u0000${right.promptVersion}\u0000${rightSize}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return { version: document.version, operations };
}

/** Makes omitted legacy sections and the editor's explicit empty defaults semantically identical. */
export function canonicalStudioProjectForRevisionComparison(
  project: StudioProjectFile
): StudioProjectFile {
  const withoutEditorAliases = { ...project } as StudioProjectFile & Record<string, unknown>;
  // These query-derived editor fields are useful for creating a new linked work but are not the
  // source of truth when an existing server work is being compared.
  delete withoutEditorAliases.linkedTitleId;
  delete withoutEditorAliases.linkedSeriesId;
  delete withoutEditorAliases.linkedChallengeId;
  return {
    ...withoutEditorAliases,
    [STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD]:
      canonicalStudioRevisionDocumentExtensions(
        withoutEditorAliases[STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD]
      ),
    aiProvenance: canonicalAiProvenanceForRevisionComparison(project.aiProvenance),
    characterBible: normalizeStudioCharacterBible(project.characterBible),
    writerRoom: normalizeStudioWriterRoomDocument(project.writerRoom),
    comments: normalizeStudioCommentsDocument(project.comments),
    releaseSchedule: normalizeStudioReleaseSchedule(project.releaseSchedule),
    publicationAnalytics: normalizeStudioPublicationAnalyticsDocument(project.publicationAnalytics),
    publishPack: canonicalPublishPack(project.publishPack),
  } as unknown as StudioProjectFile;
}

function withCurrentServerMetadata(
  localProject: StudioProjectFile,
  baseProject: StudioProjectFile
): StudioProjectFile {
  const comparable = { ...localProject } as Record<string, unknown>;
  const base = baseProject as unknown as Record<string, unknown>;
  for (const field of SERVER_CONTROLLED_PROJECT_FIELDS) {
    if (Object.hasOwn(base, field)) comparable[field] = base[field];
    else delete comparable[field];
  }
  return comparable as StudioProjectFile;
}

function projectField(project: StudioProjectFile, field: string): unknown {
  return (project as unknown as Record<string, unknown>)[field];
}

function publicationStatus(project: StudioProjectFile): "draft" | "published" | null {
  const status = projectField(project, "status");
  return status === "draft" || status === "published" ? status : null;
}

function buildPublicationImpact(
  targetProject: StudioProjectFile,
  baseProject: StudioProjectFile
): StudioRevisionPublicationImpact {
  const before = publicationStatus(baseProject);
  const after = publicationStatus(targetProject);
  return {
    statusChange: before === after ? null : { before, after },
    changedRelations: PUBLICATION_RELATION_FIELDS.filter(
      (field) => !Object.is(projectField(baseProject, field), projectField(targetProject, field))
    ),
  };
}

function revisionPageLabels(
  localProject: StudioProjectFile,
  baseProject: StudioProjectFile,
  targetProject: StudioProjectFile
): Readonly<Record<string, string>> {
  const labels = Object.create(null) as Record<string, string>;
  // The restore destination is authoritative, followed by the current editor. The
  // baseline is only a final fallback for pages that exist in neither direction.
  for (const project of [baseProject, localProject, targetProject]) {
    project.pagesList.forEach((page, index) => {
      const rawName = (page as unknown as Record<string, unknown>).name;
      const name = typeof rawName === "string" ? rawName.trim().slice(0, 80) : "";
      Object.defineProperty(labels, page.id, {
        configurable: true,
        enumerable: true,
        value: name || `${index + 1}페이지`,
        writable: true,
      });
    });
  }
  return labels;
}

/**
 * Builds both comparisons required before a restore:
 * - current local editor → selected server revision (actual restore direction)
 * - current server baseline → current local editor (unsaved-local detection)
 *
 * The return value contains only bounded semantic descriptors and never retains raw snapshots.
 */
export function buildStudioServerRevisionComparison(
  input: StudioServerRevisionComparisonInput
): StudioServerRevisionComparison {
  const rawLocalProject = canonicalStudioProjectForRevisionComparison(
    parseStudioProjectFile(input.localProject)
  );
  const targetProject = canonicalStudioProjectForRevisionComparison(
    creatorWorkSnapshotToStudioProject(input.targetSnapshot, {
      includeRevisionDocumentExtensions: true,
    })
  );
  const baseProject = canonicalStudioProjectForRevisionComparison(
    creatorWorkSnapshotToStudioProject(input.baseSnapshot, {
      includeRevisionDocumentExtensions: true,
    })
  );
  if (projectField(targetProject, "format") === "upload") {
    throw new Error("업로드형 과거 버전은 컷툰 편집기에서 복원할 수 없습니다.");
  }
  if (projectField(baseProject, "format") === "upload") {
    throw new Error("현재 서버 작품 형식이 컷툰 편집기와 호환되지 않습니다.");
  }
  const localProject = withCurrentServerMetadata(rawLocalProject, baseProject);
  const localToTarget = diffStudioProjectRevisions(localProject, targetProject);
  const serverToLocal = diffStudioProjectRevisions(baseProject, localProject);
  return {
    targetRevision: input.targetRevision,
    baseRevision: input.baseRevision,
    localToTarget,
    serverToLocal,
    publicationImpact: buildPublicationImpact(targetProject, baseProject),
    pageLabels: revisionPageLabels(localProject, baseProject, targetProject),
  };
}
