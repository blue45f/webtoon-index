import { z } from "zod";

import { hydrateStudioAiImageReferenceDocument } from "./ai/studio-ai-image-reference-roles";
import {
  normalizeStudioAiProvenanceDocument,
  type StudioAiProvenanceDocument,
} from "./ai/studio-ai-provenance";
import {
  STUDIO_BG3D_SCENE_DOCUMENT_KIND,
  migrateStudioBg3dSceneDocument,
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
} from "./bg3d/studio-bg3d-scene-document";
import { parseStudioDrawingAssistDocument } from "./brush/studio-drawing-assist-document";
import {
  parseStudioLinked3dRenderDocument,
  validateStudioLinked3dRenderDocumentAgainstPage,
  validateStudioLinked3dReservedPageState,
  type StudioLinked3dRenderElementLike,
} from "./studio-linked-3d-render-document";
import { normalizePageReviewState } from "./studio-page-review";
import { parseStudioReferenceBoardDocument } from "./studio-reference-board";
import { migrateStudioShared3dStageCollectionDocument } from "./studio-shared-3d-stage-collection";
import {
  STUDIO_VRM_SCENE_DOCUMENT_KIND,
  migrateStudioVrmSceneDocument,
  parseStudioVrmSceneDocument,
  serializeStudioVrmSceneDocument,
} from "./vrm/studio-vrm-scene-document";

const STUDIO_PROJECT_MAX_ELEMENTS_PER_PAGE_OR_MASTER = 10_000;

/** Canonical limits shared by Studio mutation paths and the persisted project schema. */
export const STUDIO_PROJECT_MAX_PAGES = 200;
export const STUDIO_PROJECT_MAX_CANVAS_HEIGHT = 100_000;

const OptionalAiProvenanceSchema = z
  .unknown()
  .optional()
  .transform((value): StudioAiProvenanceDocument | undefined =>
    value === undefined ? undefined : normalizeStudioAiProvenanceDocument(value)
  );

const ProjectPageSchema = z
  .object({
    id: z.string().min(1),
    elements: z.array(z.unknown()).max(10_000),
    bg: z.string(),
    bgGrad: z.array(z.string()).nullable(),
    canvasH: z.number().finite().positive().max(STUDIO_PROJECT_MAX_CANVAS_HEIGHT),
    shared3dStage: z.unknown().optional(),
    linked3dRender: z.unknown().optional(),
  })
  .passthrough();

const CommonProjectSchema = z.object({
  title: z.string().max(200).default(""),
  description: z.string().max(10_000).default(""),
  tagsText: z.string().max(2_000).default(""),
  currentPageId: z.string().optional(),
  webtoonTheme: z.enum(["classic", "soft", "vivid"]).default("classic"),
  panelGutter: z.number().finite().min(0).max(500).default(24),
  master: z.unknown().optional(),
  characterBible: z.unknown().optional(),
  writerRoom: z.unknown().optional(),
  comments: z.unknown().optional(),
  releaseSchedule: z.unknown().optional(),
  publicationAnalytics: z.unknown().optional(),
  /** Project-owned pose/reference board. Binary bytes live in the asset archive, never here. */
  referenceBoard: z.unknown().optional(),
  /** Metadata-only AI role references. Binary bytes stay in the content-addressed asset store. */
  aiImageReferences: z
    .unknown()
    .optional()
    .transform((value) =>
      value === undefined ? undefined : hydrateStudioAiImageReferenceDocument(value)
    ),
  /** Private operation history; hydration always strips raw prompt fields by default. */
  aiProvenance: OptionalAiProvenanceSchema,
  // 목적지 정책은 자주 바뀌므로 프로젝트 파서는 느슨하게 보존하고, UI에서 별도 정규화한다.
  publishPack: z.unknown().optional(),
});

const ProjectV2Schema = CommonProjectSchema.extend({
  version: z.literal(2),
  savedAt: z.string().optional(),
  pagesList: z.array(ProjectPageSchema).min(1).max(STUDIO_PROJECT_MAX_PAGES),
}).passthrough();

const LegacyProjectSchema = z
  .object({
    version: z.union([z.literal("1.0"), z.literal(1)]).optional(),
    title: z.string().max(200).default(""),
    pages: z.array(ProjectPageSchema).min(1).max(STUDIO_PROJECT_MAX_PAGES),
    master: z.unknown().optional(),
    writerRoom: z.unknown().optional(),
    aiProvenance: OptionalAiProvenanceSchema,
  })
  .passthrough();

export type StudioProjectFile = z.infer<typeof ProjectV2Schema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `elements` intentionally remains open-ended for the large Studio element union, but canonical
 * BG3D metadata is a persistence/security boundary of its own. Validate that one optional field
 * without cloning or narrowing unrelated element data. Invalid current/future versions fail the
 * project import rather than silently removing a scene the creator expects to re-edit.
 */
function canonicalizeBg3dSceneElement(value: unknown): unknown {
  if (!isRecord(value) || value.type !== "image" || value.bg3dScene === undefined) {
    return value;
  }
  const migrated =
    isRecord(value.bg3dScene) &&
    value.bg3dScene.kind === STUDIO_BG3D_SCENE_DOCUMENT_KIND
      ? migrateStudioBg3dSceneDocument(value.bg3dScene)
      : null;
  const serialized = serializeStudioBg3dSceneDocument(migrated);
  const scene = serialized ? parseStudioBg3dSceneDocument(serialized) : null;
  if (!scene) {
    throw new Error("3D 배경 장면 데이터가 손상되었거나 지원하지 않는 버전입니다.");
  }
  return { ...value, bg3dScene: scene };
}

function canonicalizeVrmSceneElement(value: unknown): unknown {
  if (!isRecord(value) || value.type !== "image" || value.vrmScene === undefined) {
    return value;
  }
  const migrated =
    isRecord(value.vrmScene)
    && value.vrmScene.kind === STUDIO_VRM_SCENE_DOCUMENT_KIND
      ? migrateStudioVrmSceneDocument(value.vrmScene)
      : null;
  const serialized = serializeStudioVrmSceneDocument(migrated);
  const scene = serialized ? parseStudioVrmSceneDocument(serialized) : null;
  if (!scene) {
    throw new Error("3D 데생 인형 장면 데이터가 손상되었거나 지원하지 않는 버전입니다.");
  }
  return { ...value, vrmScene: scene };
}

function canonicalizeStudio3dSceneElement(value: unknown): unknown {
  return canonicalizeVrmSceneElement(canonicalizeBg3dSceneElement(value));
}

function canonicalizeBg3dSceneElements(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (value.length > STUDIO_PROJECT_MAX_ELEMENTS_PER_PAGE_OR_MASTER) {
    throw new Error("마스터 요소 수가 프로젝트 안전 한도를 넘었습니다.");
  }
  return value.map(canonicalizeStudio3dSceneElement);
}

function canonicalizeProjectBg3dScenes(project: StudioProjectFile): StudioProjectFile {
  const pagesList = project.pagesList.map((page) => {
    const elements = page.elements.map(canonicalizeStudio3dSceneElement);
    const review = "review" in page
      ? normalizePageReviewState(page.review)
      : undefined;
    const drawingAssist = page.drawingAssist === undefined
      ? undefined
      : parseStudioDrawingAssistDocument(page.drawingAssist);
    if (page.drawingAssist !== undefined && !drawingAssist) {
      throw new Error("페이지 드로잉 보조 설정이 손상되었거나 지원하지 않는 버전입니다.");
    }
    const shared3dStage = page.shared3dStage === undefined
      ? undefined
      : migrateStudioShared3dStageCollectionDocument(page.shared3dStage);
    if (page.shared3dStage !== undefined && !shared3dStage) {
      throw new Error("페이지 공유 3D Stage 연결이 손상되었거나 지원하지 않는 버전입니다.");
    }
    const linked3dRender = page.linked3dRender === undefined
      ? undefined
      : parseStudioLinked3dRenderDocument(page.linked3dRender);
    if (page.linked3dRender !== undefined && !linked3dRender) {
      throw new Error("페이지 연결형 3D 렌더 인덱스가 손상되었거나 지원하지 않는 버전입니다.");
    }
    const reservedState = validateStudioLinked3dReservedPageState({
      value: linked3dRender,
      elements: elements as readonly StudioLinked3dRenderElementLike[],
    });
    if (!reservedState.ok) {
      throw new Error(`페이지 연결형 3D reserved 상태가 Canvas 권위와 다릅니다: ${reservedState.message}`);
    }
    if (linked3dRender) {
      const validation = validateStudioLinked3dRenderDocumentAgainstPage({
        value: linked3dRender,
        elements: elements as readonly StudioLinked3dRenderElementLike[],
        shared3dStage: shared3dStage ?? undefined,
      });
      if (!validation.ok) {
        throw new Error(`페이지 연결형 3D 렌더 인덱스가 Canvas 권위와 다릅니다: ${validation.message}`);
      }
    }
    return {
      ...page,
      ...(review === undefined ? {} : { review }),
      elements,
      ...(drawingAssist ? { drawingAssist } : {}),
      ...(shared3dStage ? { shared3dStage } : {}),
      ...(linked3dRender ? { linked3dRender } : {}),
    };
  });
  const master = isRecord(project.master) && Array.isArray(project.master.elements)
    ? (() => {
        const elements = canonicalizeBg3dSceneElements(project.master.elements);
        const reservedState = validateStudioLinked3dReservedPageState({
          value: undefined,
          elements: elements as readonly StudioLinked3dRenderElementLike[],
        });
        if (!reservedState.ok) {
          throw new Error("문서 마스터에 page-owned 연결형 3D locator나 correction이 있습니다.");
        }
        return { ...project.master, elements };
      })()
    : project.master;
  const referenceBoard = project.referenceBoard === undefined
    ? undefined
    : parseStudioReferenceBoardDocument(project.referenceBoard);
  if (project.referenceBoard !== undefined && !referenceBoard) {
    throw new Error("포즈 참고 보드 데이터가 손상되었거나 지원하지 않는 버전입니다.");
  }
  return {
    ...project,
    pagesList,
    master,
    ...(referenceBoard ? { referenceBoard } : {}),
  };
}

export function parseStudioProjectFile(value: unknown): StudioProjectFile {
  const current = ProjectV2Schema.safeParse(value);
  if (current.success) return canonicalizeProjectBg3dScenes(current.data);
  const legacy = LegacyProjectSchema.safeParse(value);
  if (!legacy.success) throw new Error("올바르지 않은 ToonSpectrum 프로젝트 파일입니다.");
  return canonicalizeProjectBg3dScenes({
    version: 2,
    title: legacy.data.title,
    description: "",
    tagsText: "",
    pagesList: legacy.data.pages,
    master: legacy.data.master,
    writerRoom: legacy.data.writerRoom,
    aiProvenance: legacy.data.aiProvenance,
    aiImageReferences: undefined,
    currentPageId: legacy.data.pages[0].id,
    webtoonTheme: "classic",
    panelGutter: 24,
  });
}

/** Serializes an importable project using the same bounded, hash-only provenance policy. */
export function serializeStudioProjectFile(value: unknown, space?: number): string {
  return JSON.stringify(parseStudioProjectFile(value), null, space);
}

/**
 * A remix is a new authorship context. It must not inherit the source creator's private prompt
 * hashes, provider request identifiers, target IDs, or usage log. New remix operations are
 * recorded into this fresh document after the remix opens.
 */
export function resetStudioAiProvenanceForRemix(): StudioAiProvenanceDocument {
  return normalizeStudioAiProvenanceDocument(undefined);
}
