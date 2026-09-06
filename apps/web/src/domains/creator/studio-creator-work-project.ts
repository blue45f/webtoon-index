import { readWorkFx } from "./studio-motion-fx";
import { normalizePageReviewState } from "./studio-page-review";
import { parseStudioProjectFile, type StudioProjectFile } from "./studio-project-file";
import {
  collectStudioRevisionDocumentExtensions,
  STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD,
} from "./studio-revision-document-extensions";

export const STUDIO_LEGACY_PAGE_ID = "legacy-page-1";
const STUDIO_REVISION_MAX_FX_CUTS = 200;
const STUDIO_REVISION_MAX_FX_TEXT = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function tagsText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.filter((tag): tag is string => typeof tag === "string").join(", ");
}

function nullableId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function nullableInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function comparableWorkFx(doc: Record<string, unknown>) {
  const source = isRecord(doc.fx) ? doc.fx : {};
  const boundedSource = {
    reveal: source.reveal,
    ambient: source.ambient,
    bgmMood: stringValue(source.bgmMood).slice(0, STUDIO_REVISION_MAX_FX_TEXT),
    bgmUrl: stringValue(source.bgmUrl).slice(0, STUDIO_REVISION_MAX_FX_TEXT),
    bgmVolume: source.bgmVolume,
    cuts: Array.isArray(source.cuts)
      ? source.cuts.slice(0, STUDIO_REVISION_MAX_FX_CUTS)
      : [],
  };
  const fx = readWorkFx({ fx: boundedSource });
  return {
    ...fx,
    cuts: fx.cuts.slice(0, STUDIO_REVISION_MAX_FX_CUTS),
  };
}

/**
 * Converts either a live creator work detail or a private revision snapshot through the exact same
 * bounded Studio project parser. Keeping this boundary pure prevents compare/restore from silently
 * interpreting an older snapshot differently from the editor hydration path.
 */
export function creatorWorkSnapshotToStudioProject(
  value: unknown,
  options: { includeRevisionDocumentExtensions?: boolean } = {}
): StudioProjectFile {
  if (!isRecord(value)) throw new Error("비교할 작품 버전 데이터가 올바르지 않습니다.");
  const hasDoc = Object.hasOwn(value, "doc");
  if (hasDoc && !isRecord(value.doc)) {
    throw new Error("비교할 작품 버전의 편집 문서가 손상되었습니다.");
  }
  const doc = hasDoc ? value.doc as Record<string, unknown> : {};
  let rawPages: unknown[];
  if (Object.hasOwn(doc, "pagesList")) {
    if (!Array.isArray(doc.pagesList) || doc.pagesList.length === 0) {
      throw new Error("비교할 작품 버전의 페이지 목록이 손상되었습니다.");
    }
    rawPages = doc.pagesList.map((page) =>
      isRecord(page) && Object.hasOwn(page, "review")
        ? { ...page, review: normalizePageReviewState(page.review) }
        : page
    );
  } else {
    if (Object.hasOwn(doc, "elements") && !Array.isArray(doc.elements)) {
      throw new Error("비교할 작품 버전의 레거시 요소 목록이 손상되었습니다.");
    }
    rawPages = [
      {
        id: STUDIO_LEGACY_PAGE_ID,
        elements: Array.isArray(doc.elements) ? doc.elements : [],
        bg: stringValue(doc.bg, "#ffffff"),
        bgGrad: Array.isArray(doc.bgGrad) ? doc.bgGrad : null,
        canvasH:
          typeof doc.height === "number" && Number.isFinite(doc.height) && doc.height > 0
            ? doc.height
            : 1080,
      },
    ];
  }
  const currentPageId =
    typeof doc.currentPageId === "string" &&
    rawPages.some(
      (page) => isRecord(page) && typeof page.id === "string" && page.id === doc.currentPageId
    )
      ? doc.currentPageId
      : undefined;
  const theme = doc.webtoonTheme;
  const gutter = doc.panelGutter;
  const titleId = nullableId(value.titleId);
  const seriesId = nullableId(value.seriesId);
  const challengeId = nullableId(value.challengeId);
  const remixFromId = nullableId(value.remixFromId);
  const episodeNo = nullableInteger(value.episodeNo);
  const format = value.format;
  const status = value.status;
  const comparableFx = comparableWorkFx(doc);
  const documentExtensions = options.includeRevisionDocumentExtensions
    ? collectStudioRevisionDocumentExtensions(doc)
    : undefined;

  return parseStudioProjectFile({
    version: 2,
    title: stringValue(value.title),
    description: stringValue(value.description),
    tagsText: tagsText(value.tags),
    pagesList: rawPages,
    ...(currentPageId ? { currentPageId } : {}),
    ...(theme === "classic" || theme === "soft" || theme === "vivid"
      ? { webtoonTheme: theme }
      : {}),
    ...(typeof gutter === "number" && Number.isFinite(gutter) ? { panelGutter: gutter } : {}),
    ...(titleId !== undefined ? { titleId } : {}),
    ...(seriesId !== undefined ? { seriesId } : {}),
    ...(challengeId !== undefined ? { challengeId } : {}),
    ...(remixFromId !== undefined ? { remixFromId } : {}),
    ...(episodeNo !== undefined ? { episodeNo } : {}),
    ...(format === "cuttoon" || format === "upload" ? { format } : {}),
    ...(status === "draft" || status === "published" ? { status } : {}),
    master: doc.master,
    characterBible: doc.characterBible,
    writerRoom: doc.writerRoom,
    aiProvenance: doc.aiProvenance,
    comments: doc.comments,
    releaseSchedule: doc.releaseSchedule,
    publicationAnalytics: doc.publicationAnalytics,
    referenceBoard: doc.referenceBoard,
    publishPack: doc.publishPack,
    // WorkFxPanel persists this registered document extension directly under `doc.fx`.
    fx: comparableFx,
    // Comparison-only future extension index. Normal editor hydration intentionally does not
    // retain arbitrary passthrough values; comparison enables this only after privacy projection.
    ...(documentExtensions
      ? { [STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD]: documentExtensions }
      : {}),
  });
}
