import { describe, expect, it, vi } from "vitest";

import { prepareStudioDocumentInterchangeCommit } from "./studio-document-interchange-commit";

import type { PageState } from "./studio-page-state";

function ids(): () => string {
  let value = 0;
  return () => `new-${++value}`;
}

function page(id: string): PageState {
  return { id, elements: [], bg: "#fff", bgGrad: null, canvasH: 1_080 };
}

function blankPage(createId: () => string, canvasH: number): PageState {
  return { id: createId(), elements: [], bg: "#fff", bgGrad: null, canvasH };
}

describe("studio document interchange commit runtime", () => {
  it("places PSD layers on the current page and reports durable success", async () => {
    const result = await prepareStudioDocumentInterchangeCommit({
      kind: "psd",
      fileName: "episode.psd",
      preview: {} as never,
      result: {
        elements: [{ id: "psd-layer", type: "image" } as never],
        sourceWidth: 1_080,
        sourceHeight: 2_000,
        scale: 1,
        skipped: [],
      },
    }, {
      pages: [page("anchor")],
      anchorPageId: "anchor",
      choice: "current-page",
      canvasWidth: 1_080,
      createId: ids(),
      createBlankPage: blankPage,
      maxEmbeddedBytes: 1_000,
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({ canvasH: 2_000, elements: [{ id: "psd-layer" }] });
    expect(result).toMatchObject({ status: { tone: "good" }, psdStatus: { tone: "good" } });
  });

  it("creates a separately selected PSD page without mutating the source list", async () => {
    const source = [page("anchor")];
    const result = await prepareStudioDocumentInterchangeCommit({
      kind: "psd",
      fileName: "  컷 01.psd",
      preview: {} as never,
      result: {
        elements: [{ id: "psd-layer", type: "image" } as never],
        sourceWidth: 1_080,
        sourceHeight: 1_920,
        scale: 0.5,
        skipped: ["텍스트 래스터화"],
      },
    }, {
      pages: source,
      anchorPageId: "anchor",
      choice: "new-page",
      canvasWidth: 1_080,
      createId: ids(),
      createBlankPage: blankPage,
      maxEmbeddedBytes: 1_000,
    });

    expect(source).toHaveLength(1);
    expect(result.pages[1]).toMatchObject({ id: "new-1", name: "  컷 01", canvasH: 960 });
    expect(result).toMatchObject({ selectedPageId: "new-1", status: { tone: "warn" } });
  });

  it("loads the archive apply runtime only after confirmation and merges ORA on the anchor", async () => {
    const loadArchiveApplyRuntime = vi.fn(async () => ({
      prepareStudioOpenRasterImportPage: vi.fn(async () => ({
        name: "ORA",
        canvasH: 2_400,
        elements: [{ id: "ora-layer", type: "image" } as never],
        groups: [{ id: "ora-group", name: "인물", collapsed: false }],
      })),
      prepareStudioCbzImportPages: vi.fn(),
    }));
    const result = await prepareStudioDocumentInterchangeCommit({
      kind: "ora",
      fileName: "episode.ora",
      preview: {} as never,
      result: { layers: [{}], warnings: [] } as never,
    }, {
      pages: [page("anchor")],
      anchorPageId: "anchor",
      choice: "current-page",
      canvasWidth: 1_080,
      createId: ids(),
      createBlankPage: blankPage,
      maxEmbeddedBytes: 1_000,
      loadArchiveApplyRuntime,
    });

    expect(loadArchiveApplyRuntime).toHaveBeenCalledOnce();
    expect(result.pages[0]).toMatchObject({
      canvasH: 2_400,
      elements: [{ id: "ora-layer" }],
      groups: [{ id: "ora-group" }],
    });
  });

  it("inserts every CBZ draft after the anchor and selects the first page", async () => {
    const loadArchiveApplyRuntime = vi.fn(async () => ({
      prepareStudioOpenRasterImportPage: vi.fn(),
      prepareStudioCbzImportPages: vi.fn(async () => [
        { name: "001", canvasH: 1_920, elements: [] },
        { name: "002", canvasH: 2_160, elements: [] },
      ]),
    }));
    const result = await prepareStudioDocumentInterchangeCommit({
      kind: "cbz",
      fileName: "episode.cbz",
      preview: {} as never,
      result: { pages: [{}, {}], warnings: [] } as never,
    }, {
      pages: [page("before"), page("anchor"), page("after")],
      anchorPageId: "anchor",
      choice: "new-page",
      canvasWidth: 1_080,
      createId: ids(),
      createBlankPage: blankPage,
      maxEmbeddedBytes: 1_000,
      loadArchiveApplyRuntime,
    });

    expect(result.pages.map((candidate) => candidate.id)).toEqual([
      "before",
      "anchor",
      "new-1",
      "new-2",
      "after",
    ]);
    expect(result).toMatchObject({ selectedPageId: "new-1", status: { tone: "good" } });
  });

  it("fails before loading an archive runtime when the anchor disappeared", async () => {
    const loadArchiveApplyRuntime = vi.fn();
    await expect(prepareStudioDocumentInterchangeCommit({
      kind: "cbz",
      fileName: "episode.cbz",
      preview: {} as never,
      result: { pages: [{}], warnings: [] } as never,
    }, {
      pages: [page("other")],
      anchorPageId: "missing",
      choice: "new-page",
      canvasWidth: 1_080,
      createId: ids(),
      createBlankPage: blankPage,
      maxEmbeddedBytes: 1_000,
      loadArchiveApplyRuntime,
    })).rejects.toThrow(/기준 페이지/u);
    expect(loadArchiveApplyRuntime).not.toHaveBeenCalled();
  });
});
