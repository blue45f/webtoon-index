import type {
  StudioArchiveImportApplyOptions,
  StudioArchiveImportPageDraft,
} from "./studio-archive-import-apply";
import type {
  StudioCbzImportResult,
  StudioCbzLimits,
} from "./studio-cbz-interchange";
import type { El } from "./studio-element-model";
import type { StudioInterchangeLossPreviewInput } from "./studio-interchange-loss-preview";
import type {
  StudioOpenRasterImportResult,
  StudioOpenRasterLimits,
} from "./studio-openraster-interchange";
import type { PageState } from "./studio-page-state";
import type { PsdImportResult } from "./studio-psd-import";

export type StudioInterchangeImportChoice = "new-page" | "current-page";

export type PendingStudioInterchangeImport =
  | {
      readonly kind: "psd";
      readonly fileName: string;
      readonly result: PsdImportResult;
      readonly preview: StudioInterchangeLossPreviewInput;
    }
  | {
      readonly kind: "ora";
      readonly fileName: string;
      readonly result: StudioOpenRasterImportResult;
      readonly preview: StudioInterchangeLossPreviewInput;
    }
  | {
      readonly kind: "cbz";
      readonly fileName: string;
      readonly result: StudioCbzImportResult;
      readonly preview: StudioInterchangeLossPreviewInput;
    };

export interface StudioDocumentInterchangeInspectionOptions {
  readonly extension: ".cbz" | ".ora";
  readonly signal: AbortSignal;
  readonly canvasWidth: number;
  readonly maxEmbeddedBytes: number;
  readonly currentPageCount: number;
  readonly canAddPage: boolean;
  readonly openRasterLimits: Partial<StudioOpenRasterLimits>;
  readonly cbzLimits: Partial<StudioCbzLimits>;
}

export interface StudioDocumentInterchangeInspection {
  readonly pending: PendingStudioInterchangeImport;
  readonly choice: StudioInterchangeImportChoice;
  readonly status: Readonly<{
    tone: "good" | "warn";
    text: string;
  }>;
}

/** Loads exactly one archive codec after file selection; neither codec joins Studio startup. */
export async function inspectStudioDocumentInterchangeArchive(
  file: File,
  options: StudioDocumentInterchangeInspectionOptions,
): Promise<StudioDocumentInterchangeInspection> {
  if (options.extension === ".ora") {
    const [{ importStudioOpenRaster }, { createStudioOpenRasterImportLossPreview }] =
      await Promise.all([
        import("./studio-openraster-interchange"),
        import("./studio-document-interchange-preview"),
      ]);
    const result = await importStudioOpenRaster(file, {
      signal: options.signal,
      limits: options.openRasterLimits,
    });
    const preview = createStudioOpenRasterImportLossPreview(file.name, result, {
      canvasWidth: options.canvasWidth,
      maxEmbeddedBytes: options.maxEmbeddedBytes,
      currentPageCount: options.currentPageCount,
    });
    return {
      pending: { kind: "ora", fileName: file.name, result, preview },
      choice: options.canAddPage ? "new-page" : "current-page",
      status: {
        tone: result.warnings.length > 0 ? "warn" : "good",
        text: `OpenRaster 레이어 ${result.layers.length}개를 검증했어요. 적용 전 손실과 배치 방식을 확인해 주세요.`,
      },
    };
  }

  const [{ importStudioCbz }, { createStudioCbzImportLossPreview }] = await Promise.all([
    import("./studio-cbz-interchange"),
    import("./studio-document-interchange-preview"),
  ]);
  const result = await importStudioCbz(file, {
    signal: options.signal,
    limits: options.cbzLimits,
  });
  const preview = createStudioCbzImportLossPreview(file.name, result, {
    canvasWidth: options.canvasWidth,
    maxEmbeddedBytes: options.maxEmbeddedBytes,
    currentPageCount: options.currentPageCount,
  });
  return {
    pending: { kind: "cbz", fileName: file.name, result, preview },
    choice: "new-page",
    status: {
      tone: result.warnings.length > 0 ? "warn" : "good",
      text: `CBZ 페이지 ${result.pages.length}개를 검증했어요. 새 페이지 적용 전 편집성 손실을 확인해 주세요.`,
    },
  };
}

interface ArchiveApplyRuntime {
  prepareStudioOpenRasterImportPage(
    source: StudioOpenRasterImportResult,
    options: StudioArchiveImportApplyOptions,
  ): Promise<StudioArchiveImportPageDraft>;
  prepareStudioCbzImportPages(
    source: StudioCbzImportResult,
    options: StudioArchiveImportApplyOptions,
  ): Promise<readonly StudioArchiveImportPageDraft[]>;
}

export interface StudioDocumentInterchangeCommitOptions {
  readonly pages: readonly PageState[];
  readonly anchorPageId: string;
  readonly choice: StudioInterchangeImportChoice;
  readonly canvasWidth: number;
  readonly createId: () => string;
  readonly createBlankPage: (createId: () => string, canvasHeight: number) => PageState;
  readonly maxEmbeddedBytes: number;
  readonly signal?: AbortSignal;
  readonly loadArchiveApplyRuntime?: () => Promise<ArchiveApplyRuntime>;
}

export interface StudioDocumentInterchangeCommitDraft {
  readonly pages: PageState[];
  readonly selectedPageId?: string;
  readonly status: Readonly<{
    tone: "good" | "warn";
    text: string;
  }>;
  readonly psdStatus?: Readonly<{
    tone: "good" | "warn";
    text: string;
  }>;
}

function anchorIndex(pages: readonly PageState[], anchorPageId: string): number {
  const index = pages.findIndex((page) => page.id === anchorPageId);
  if (index < 0) throw new Error("가져오기를 적용할 기준 페이지를 찾지 못했어요.");
  return index;
}

function importedPage(
  draft: StudioArchiveImportPageDraft,
  options: StudioDocumentInterchangeCommitOptions,
): PageState {
  return {
    ...options.createBlankPage(options.createId, draft.canvasH),
    name: draft.name,
    elements: [...draft.elements] as El[],
    ...(draft.groups ? { groups: [...draft.groups] } : {}),
  };
}

/**
 * Builds a complete immutable page transition only after the user confirms the loss preview.
 * The heavy archive apply runtime remains outside Studio's startup graph.
 */
export async function prepareStudioDocumentInterchangeCommit(
  pending: PendingStudioInterchangeImport,
  options: StudioDocumentInterchangeCommitOptions,
): Promise<StudioDocumentInterchangeCommitDraft> {
  const index = anchorIndex(options.pages, options.anchorPageId);

  if (pending.kind === "psd") {
    const importedElements = pending.result.elements as El[];
    const importedHeight = Math.max(
      1,
      Math.round(pending.result.sourceHeight * pending.result.scale),
    );
    let pages: PageState[];
    let selectedPageId: string | undefined;
    if (options.choice === "current-page") {
      pages = options.pages.map((page) => page.id === options.anchorPageId
        ? {
            ...page,
            canvasH: Math.max(page.canvasH, importedHeight),
            elements: [...page.elements, ...importedElements],
          }
        : page);
    } else {
      const page: PageState = {
        ...options.createBlankPage(options.createId, importedHeight),
        name: pending.fileName.replace(/\.psd$/iu, "") || "PSD 가져오기",
        elements: importedElements,
      };
      pages = [...options.pages];
      pages.splice(index + 1, 0, page);
      selectedPageId = page.id;
    }
    const skipped = pending.result.skipped.length;
    const text = `${pending.result.elements.length}개 PSD 레이어를 적용했어요.${
      skipped > 0 ? ` 재현하지 못한 항목 ${skipped}건을 확인해 주세요.` : ""
    }`;
    return {
      pages,
      ...(selectedPageId ? { selectedPageId } : {}),
      status: { tone: skipped > 0 ? "warn" : "good", text },
      psdStatus: { tone: skipped > 0 ? "warn" : "good", text },
    };
  }

  const runtime = await (options.loadArchiveApplyRuntime?.()
    ?? import("./studio-archive-import-apply"));
  if (pending.kind === "ora") {
    const draft = await runtime.prepareStudioOpenRasterImportPage(pending.result, {
      canvasWidth: options.canvasWidth,
      createId: options.createId,
      signal: options.signal,
      limits: { maxEmbeddedBytes: options.maxEmbeddedBytes },
    });
    let pages: PageState[];
    let selectedPageId: string | undefined;
    if (options.choice === "current-page") {
      pages = options.pages.map((page) => page.id === options.anchorPageId
        ? {
            ...page,
            canvasH: Math.max(page.canvasH, draft.canvasH),
            elements: [...page.elements, ...draft.elements] as El[],
            groups: [...(page.groups ?? []), ...(draft.groups ?? [])],
          }
        : page);
    } else {
      const page = importedPage(draft, options);
      pages = [...options.pages];
      pages.splice(index + 1, 0, page);
      selectedPageId = page.id;
    }
    const warnings = pending.result.warnings.length;
    return {
      pages,
      ...(selectedPageId ? { selectedPageId } : {}),
      status: {
        tone: warnings > 0 ? "warn" : "good",
        text: `OpenRaster 레이어 ${pending.result.layers.length}개를 적용했어요.${
          warnings > 0 ? ` 호환 알림 ${warnings}건을 확인해 주세요.` : ""
        }`,
      },
    };
  }

  const drafts = await runtime.prepareStudioCbzImportPages(pending.result, {
    canvasWidth: options.canvasWidth,
    createId: options.createId,
    signal: options.signal,
    existingPageCount: options.pages.length,
    limits: { maxEmbeddedBytes: options.maxEmbeddedBytes },
  });
  const addedPages = drafts.map((draft) => importedPage(draft, options));
  const pages = [...options.pages];
  pages.splice(index + 1, 0, ...addedPages);
  const warnings = pending.result.warnings.length;
  return {
    pages,
    ...(addedPages[0] ? { selectedPageId: addedPages[0].id } : {}),
    status: {
      tone: warnings > 0 ? "warn" : "good",
      text: `CBZ ${addedPages.length}페이지를 현재 페이지 뒤에 추가했어요.${
        warnings > 0 ? ` 메타데이터 알림 ${warnings}건을 확인해 주세요.` : ""
      }`,
    },
  };
}
