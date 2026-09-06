import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_REVIEW_PDF_PROFILES,
  createStudioReviewPdfPageCanvas,
  getStudioReviewPdfProfile,
  normalizeStudioReviewPdfProfileId,
  planStudioReviewPdfPageLayout,
  projectStudioReviewPdfDocumentMetadata,
  projectStudioReviewPdfPageMetadata,
  renderStudioReviewPdf,
} from "./studio-review-pdf";

import type { PdfPagesRenderOptions, PdfRenderResult } from "./export/studio-pdf-export";

function fakeCanvas(width: number, height: number, hasContext = true): HTMLCanvasElement {
  const context = hasContext
    ? {
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        font: "",
        textBaseline: "alphabetic",
        textAlign: "start",
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn((text: string) => ({ width: Array.from(text).length * 8 })),
      }
    : null;
  return {
    width,
    height,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
}

function renderResult(pageCount: number): PdfRenderResult {
  return {
    blob: new Blob(["pdf"], { type: "application/pdf" }),
    pageCount,
    bytes: 3,
    fileName: "review.pdf",
  };
}

describe("studio review PDF profiles", () => {
  it("normalizes legacy aliases defensively and defaults to the unchanged image-only profile", () => {
    expect(normalizeStudioReviewPdfProfileId(undefined)).toBe("image-only");
    expect(normalizeStudioReviewPdfProfileId(" legacy ")).toBe("image-only");
    expect(normalizeStudioReviewPdfProfileId("proof")).toBe("editorial");
    expect(normalizeStudioReviewPdfProfileId("review")).toBe("approval");
    expect(normalizeStudioReviewPdfProfileId("FULL")).toBe("production-full");
    expect(normalizeStudioReviewPdfProfileId("unknown")).toBe("image-only");
  });

  it("exposes immutable internal-only profile definitions with explicit field policies", () => {
    expect(Object.isFrozen(STUDIO_REVIEW_PDF_PROFILES)).toBe(true);
    for (const profile of Object.values(STUDIO_REVIEW_PDF_PROFILES)) {
      expect(profile.internalOnly).toBe(true);
      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.fields)).toBe(true);
    }
    expect(getStudioReviewPdfProfile("image-only").fields).toEqual({
      pageNumber: false,
      pageTitle: false,
      pageNotes: false,
      reviewStatus: false,
      reviewAssignee: false,
      reviewNotes: false,
      reviewUpdatedAt: false,
      panelMetadata: false,
      panelCaptions: false,
      dialogue: false,
    });
    expect(getStudioReviewPdfProfile("production-full").fields).toEqual(
      Object.fromEntries(Object.keys(getStudioReviewPdfProfile("production-full").fields).map((key) => [key, true]))
    );
  });
});

describe("studio review PDF metadata projection", () => {
  const page = {
    id: "page-1",
    name: "  옥상 재회\u202e  ",
    note: "  2컷 호흡 확인  ",
    shotType: "cu",
    cameraAngle: "low",
    groups: [{ id: "hidden-group", name: "초안", hidden: true }],
    review: {
      status: "changes-requested",
      locked: true,
      assignee: "  편집자 김  ",
      note: "  마지막 표정 수정\u2066  ",
      updatedAt: "2026-07-11T09:30:00+09:00",
    },
    elements: [
      {
        id: "frame-later",
        type: "frame",
        x: 20,
        y: 500,
        width: 650,
        height: 400,
        storyBeat: { summary: "대답을 망설인다" },
      },
      { id: "bubble-2", type: "bubble", text: "잠깐만.", x: 100, y: 600, width: 150, height: 80 },
      {
        id: "frame-first",
        type: "frame",
        x: 20,
        y: 20,
        width: 650,
        height: 400,
        storyBeat: { summary: "오랜만에 마주친다" },
      },
      { id: "bubble-1", type: "bubble", text: "오랜만이야.", x: 100, y: 120, width: 180, height: 90 },
      { id: "text-out", type: "text", text: "다음 화에 계속", x: 900, y: 1_000, width: 150, height: 60 },
      { id: "hidden-self", type: "bubble", text: "숨긴 대사", hidden: true, x: 100, y: 120, width: 100, height: 50 },
      { id: "hidden-group-item", type: "text", text: "그룹 초안", groupId: "hidden-group", x: 100, y: 120 },
      { id: "empty", type: "bubble", text: "   ", x: 0, y: 0, width: 1, height: 1 },
    ],
  };

  it("image-only projects no metadata, so private review values cannot survive accidentally", () => {
    const projected = projectStudioReviewPdfPageMetadata(page, 0, "image-only");
    expect(projected).toEqual({});
    expect(JSON.stringify(projected)).not.toContain("편집자 김");
    expect(JSON.stringify(projected)).not.toContain("마지막 표정");
  });

  it("editorial includes ordered panels, captions and geometrically assigned dialogue but no review secrets", () => {
    const projected = projectStudioReviewPdfPageMetadata(page, 0, "editorial");
    expect(projected).toMatchObject({
      pageNumber: 1,
      title: "옥상 재회",
      pageNote: "2컷 호흡 확인",
      panels: [
        {
          id: "frame-first",
          order: 1,
          label: "컷 1",
          shotType: "클로즈업",
          cameraAngle: "로우 앵글",
          caption: "오랜만에 마주친다",
          dialogue: ["오랜만이야."],
        },
        {
          id: "frame-later",
          order: 2,
          label: "컷 2",
          caption: "대답을 망설인다",
          dialogue: ["잠깐만."],
        },
        {
          id: "unassigned",
          order: 3,
          label: "프레임 밖 대사",
          dialogue: ["다음 화에 계속"],
        },
      ],
    });
    expect(projected).not.toHaveProperty("review");
    expect(JSON.stringify(projected)).not.toContain("편집자 김");
    expect(JSON.stringify(projected)).not.toContain("숨긴 대사");
    expect(JSON.stringify(projected)).not.toContain("그룹 초안");
  });

  it("approval includes canonical review workflow metadata but intentionally omits captions and dialogue", () => {
    const projected = projectStudioReviewPdfPageMetadata(page, 2, "approval");
    expect(projected).toMatchObject({
      pageNumber: 3,
      title: "옥상 재회",
      pageNote: "2컷 호흡 확인",
      review: {
        status: "수정 요청",
        assignee: "편집자 김",
        note: "마지막 표정 수정",
        updatedAt: "2026-07-11T00:30:00.000Z",
      },
    });
    expect(projected).not.toHaveProperty("panels");
  });

  it("production-full combines approval and production captions without mutating source pages", () => {
    const before = JSON.stringify(page);
    const projected = projectStudioReviewPdfDocumentMetadata([page], "production-full");
    expect(projected[0]?.review?.assignee).toBe("편집자 김");
    expect(projected[0]?.panels?.[0]?.caption).toBe("오랜만에 마주친다");
    expect(projected[0]?.panels?.[0]?.dialogue).toEqual(["오랜만이야."]);
    expect(JSON.stringify(page)).toBe(before);
  });

  it("uses a safe automatic title and page-wide dialogue bucket for malformed or frame-less pages", () => {
    const projected = projectStudioReviewPdfPageMetadata(
      {
        name: 42,
        review: { status: "not-real", assignee: 7, updatedAt: "invalid" },
        shotType: "not-real",
        elements: [null, { type: "text", text: "내레이션", x: "bad" }],
      },
      Number.NaN,
      "production-full"
    );
    expect(projected).toMatchObject({
      pageNumber: 1,
      title: "1페이지",
      review: { status: "작업 중" },
      panels: [{ id: "page", label: "페이지 전체", dialogue: ["내레이션"] }],
    });
    expect(projected.review).not.toHaveProperty("assignee");
    expect(projected.review).not.toHaveProperty("updatedAt");
  });
});

describe("studio review PDF canvas and renderer", () => {
  it("keeps the exact source dimensions for image-only and adds only a side rail for annotated profiles", () => {
    expect(planStudioReviewPdfPageLayout(690, 1_280, "image-only")).toEqual({
      width: 690,
      height: 1_280,
      railWidth: 0,
      imageX: 0,
    });
    expect(planStudioReviewPdfPageLayout(690, 1_280, "approval")).toEqual({
      width: 1_080,
      height: 1_280,
      railWidth: 390,
      imageX: 390,
    });
    expect(() => planStudioReviewPdfPageLayout(0, 10, "approval")).toThrow("크기가 올바르지 않아요");
  });

  it("draws the source into an annotated rail canvas and reports an unavailable 2D context clearly", () => {
    const source = fakeCanvas(690, 1_280);
    const output = fakeCanvas(1_080, 1_280);
    const created = createStudioReviewPdfPageCanvas(
      source,
      { pageNumber: 1, title: "첫 장", review: { status: "승인" } },
      "approval",
      (width, height) => {
        expect({ width, height }).toEqual({ width: 1_080, height: 1_280 });
        return output;
      }
    );
    expect(created).toBe(output);
    const context = output.getContext("2d") as unknown as { drawImage: ReturnType<typeof vi.fn>; fillText: ReturnType<typeof vi.fn> };
    expect(context.drawImage).toHaveBeenCalledWith(source, 390, 0);
    expect(context.fillText.mock.calls.some(([text]) => text === "P.01")).toBe(true);

    const contextless = fakeCanvas(1_080, 1_280, false);
    expect(() =>
      createStudioReviewPdfPageCanvas(source, { pageNumber: 1 }, "approval", () => contextless)
    ).toThrow("주석 캔버스를 만들지 못했어요");
    expect({ width: contextless.width, height: contextless.height }).toEqual({ width: 0, height: 0 });

    const drawFailure = fakeCanvas(1_080, 1_280);
    const failingContext = drawFailure.getContext("2d") as unknown as {
      drawImage: ReturnType<typeof vi.fn>;
    };
    failingContext.drawImage.mockImplementation(() => {
      throw new Error("draw failed");
    });
    expect(() =>
      createStudioReviewPdfPageCanvas(source, { pageNumber: 1 }, "approval", () => drawFailure)
    ).toThrow("draw failed");
    expect({ width: drawFailure.width, height: drawFailure.height }).toEqual({ width: 0, height: 0 });
  });

  it("delegates image-only to the existing PDF renderer with original canvas references and no composition", async () => {
    const pages = [fakeCanvas(690, 1_280), fakeCanvas(690, 900)];
    const createReviewCanvas = vi.fn(() => fakeCanvas(1, 1));
    const renderPdf = vi.fn(async (options: PdfPagesRenderOptions) => renderResult(options.pages.length));
    const result = await renderStudioReviewPdf({
      pages,
      pageMetadata: [{ review: { assignee: "비공개" } }],
      profile: "image-only",
      title: "review",
      createReviewCanvas,
      renderPdf,
    });
    expect(result.pageCount).toBe(2);
    expect(createReviewCanvas).not.toHaveBeenCalled();
    expect(renderPdf.mock.calls[0]?.[0].pages).toBe(pages);
  });

  it("renders annotated canvases, skips invalid pages and releases every temporary canvas after success", async () => {
    const pages = [fakeCanvas(690, 1_280), fakeCanvas(0, 500), fakeCanvas(720, 900)];
    const created: HTMLCanvasElement[] = [];
    const released: HTMLCanvasElement[] = [];
    const renderPdf = vi.fn(async (options: PdfPagesRenderOptions) => {
      const prepared: HTMLCanvasElement[] = [];
      options.pages.forEach((source, sourceIndex) => {
        if (source.width <= 0 || source.height <= 0) return;
        const page = options.preparePage?.(source, sourceIndex) ?? source;
        prepared.push(page);
        options.releasePreparedPage?.(page, sourceIndex);
      });
      expect(prepared).toHaveLength(2);
      expect(prepared[0]).not.toBe(pages[0]);
      expect(prepared[1]).not.toBe(pages[2]);
      return renderResult(prepared.length);
    });
    const result = await renderStudioReviewPdf({
      pages,
      pageMetadata: [{ name: "1" }, { name: "invalid" }, { name: "3" }],
      profile: "production-full",
      title: "review",
      createReviewCanvas: (width, height) => {
        const canvas = fakeCanvas(width, height);
        created.push(canvas);
        return canvas;
      },
      releaseReviewCanvas: (canvas) => released.push(canvas),
      renderPdf,
    });
    expect(result.pageCount).toBe(2);
    expect(created).toHaveLength(2);
    expect(released).toEqual(created);
  });

  it("releases temporary canvases even when the downstream PDF renderer fails", async () => {
    const released: HTMLCanvasElement[] = [];
    await expect(
      renderStudioReviewPdf({
        pages: [fakeCanvas(690, 1_280)],
        pageMetadata: [{}],
        profile: "approval",
        title: "review",
        createReviewCanvas: (width, height) => fakeCanvas(width, height),
        releaseReviewCanvas: (canvas) => released.push(canvas),
        renderPdf: async (options) => {
          const source = options.pages[0];
          if (source) {
            const page = options.preparePage?.(source, 0) ?? source;
            options.releasePreparedPage?.(page, 0);
          }
          throw new Error("encode failed");
        },
      })
    ).rejects.toThrow("encode failed");
    expect(released).toHaveLength(1);
  });
});
