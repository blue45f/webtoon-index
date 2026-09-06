import { describe, expect, it, vi } from "vitest";

import {
  prepareStudioCbzImportPages,
  prepareStudioOpenRasterImportPage,
} from "./studio-archive-import-apply";
import { hasContiguousLayerGroups } from "./studio-layers";

function idFactory(): () => string {
  let value = 0;
  return () => `id-${++value}`;
}

function blob(label: string, type = "image/png"): Blob {
  return new Blob([label], { type });
}

describe("studio archive import apply", () => {
  it("converts ORA layers to Studio back-to-front elements with placement, paint, and groups", async () => {
    const encode = vi.fn(async (source: Blob) => `data:${source.type};base64,${source.size}`);
    const result = await prepareStudioOpenRasterImportPage({
      width: 2_000,
      height: 4_000,
      name: "  원고   01  ",
      layers: [
        {
          name: "배경",
          png: blob("back"),
          width: 2_000,
          height: 4_000,
          x: 0,
          y: 0,
          opacity: 1,
          visible: true,
          blendMode: "normal",
          groupPath: ["장면"],
        },
        {
          name: "인물",
          png: blob("front"),
          width: 400,
          height: 800,
          x: 200,
          y: 300,
          opacity: 0.5,
          visible: false,
          blendMode: "multiply",
          groupPath: ["장면"],
        },
      ],
    }, {
      canvasWidth: 1_000,
      createId: idFactory(),
      blobToDataUrl: encode,
      decodeImageBlob: vi.fn()
        .mockResolvedValueOnce({ width: 2_000, height: 4_000 })
        .mockResolvedValueOnce({ width: 400, height: 800 }),
    });

    expect(result).toMatchObject({ name: "원고 01", canvasH: 2_000 });
    expect(result.groups).toEqual([{ id: "id-1", name: "장면", collapsed: false }]);
    expect(result.elements).toHaveLength(2);
    expect(result.elements[0]).toMatchObject({
      id: "id-2",
      type: "image",
      name: "배경",
      x: 0,
      y: 0,
      width: 1_000,
      height: 2_000,
      groupId: "id-1",
    });
    expect(result.elements[0]).not.toHaveProperty("opacity");
    expect(result.elements[0]).not.toHaveProperty("blendMode");
    expect(result.elements[1]).toMatchObject({
      id: "id-3",
      name: "인물",
      x: 100,
      y: 150,
      width: 200,
      height: 400,
      opacity: 0.5,
      hidden: true,
      blendMode: "multiply",
      groupId: "id-1",
    });
    expect(encode).toHaveBeenCalledTimes(2);
  });

  it("rejects ORA embedding before reading any blob when the durable project budget is exceeded", async () => {
    const encode = vi.fn(async () => "data:image/png;base64,AA==");
    await expect(prepareStudioOpenRasterImportPage({
      width: 10,
      height: 10,
      layers: [{
        name: "large",
        png: new Blob([new Uint8Array(9)]),
        width: 10,
        height: 10,
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        blendMode: "normal",
      }],
    }, {
      canvasWidth: 10,
      createId: idFactory(),
      blobToDataUrl: encode,
      // The 9 raw bytes fit this limit, but their durable data-URL payload does not.
      limits: { maxEmbeddedBytes: 12 },
    })).rejects.toMatchObject({
      code: "EMBEDDED_SIZE_LIMIT",
    });
    expect(encode).not.toHaveBeenCalled();
  });

  it("maps OpenRaster additive plus blending to the Canvas/Konva lighter operation", async () => {
    const result = await prepareStudioOpenRasterImportPage({
      width: 10,
      height: 10,
      layers: [{
        name: "빛",
        png: blob("light"),
        width: 10,
        height: 10,
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        blendMode: "plus",
      }],
    }, {
      canvasWidth: 10,
      createId: idFactory(),
      blobToDataUrl: async () => "data:image/png;base64,bGlnaHQ=",
      decodeImageBlob: async () => ({ width: 10, height: 10 }),
    });

    expect(result.elements[0]).toMatchObject({ blendMode: "lighter" });
  });

  it("turns each validated CBZ image into a named page without upscaling low-resolution art", async () => {
    const result = await prepareStudioCbzImportPages({
      metadata: { title: "1화" },
      pages: [
        { path: "pages/001-cover.png", image: blob("first"), width: 2_000, height: 3_000 },
        {
          path: "pages/002-end.gif",
          image: blob("second", "image/gif"),
          width: 800,
          height: 1_600,
          mimeType: "image/gif",
          frameCount: 3,
        },
      ],
    }, {
      canvasWidth: 1_000,
      createId: idFactory(),
      blobToDataUrl: async (source) => `data:${source.type};base64,ok`,
      decodeImageBlob: vi.fn()
        .mockResolvedValueOnce({ width: 2_000, height: 3_000 })
        .mockResolvedValueOnce({ width: 800, height: 1_600 }),
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "001-cover",
      canvasH: 1_500,
      elements: [{ x: 0, y: 0, width: 1_000, height: 1_500, name: "001-cover" }],
    });
    expect(result[1]).toMatchObject({
      name: "002-end",
      canvasH: 1_600,
      elements: [{
        x: 100,
        y: 0,
        width: 800,
        height: 1_600,
        name: "002-end",
        isAnimatedGif: true,
      }],
    });
  });

  it("keeps duplicate-named ORA siblings distinct and splits non-contiguous nested runs", async () => {
    const layer = (
      name: string,
      groupIds: readonly string[],
      groupPath: readonly string[],
    ) => ({
      name,
      png: blob(name),
      width: 10,
      height: 10,
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      blendMode: "normal",
      groupIds,
      groupPath,
    });
    const result = await prepareStudioOpenRasterImportPage({
      width: 10,
      height: 10,
      layers: [
        layer("A 직속 1", ["a"], ["같은 이름"]),
        layer("A/B", ["a", "ab"], ["같은 이름", "하위"]),
        layer("A 직속 2", ["a"], ["같은 이름"]),
        layer("동명 형제", ["other"], ["같은 이름"]),
      ],
    }, {
      canvasWidth: 10,
      createId: idFactory(),
      blobToDataUrl: async () => "data:image/png;base64,b2s=",
      decodeImageBlob: async () => ({ width: 10, height: 10 }),
    });

    const groupIds = result.elements.map((element) => element.groupId);
    expect(groupIds[0]).not.toBe(groupIds[2]);
    expect(groupIds[0]).not.toBe(groupIds[3]);
    expect(result.groups?.map((group) => group.name)).toEqual([
      "같은 이름 · 구간 1",
      "같은 이름 / 하위",
      "같은 이름 · 구간 2",
      "같은 이름",
    ]);
    expect(hasContiguousLayerGroups(result.elements)).toBe(true);
  });

  it("fails closed when browser-decoded pixels disagree with the validated header", async () => {
    await expect(prepareStudioCbzImportPages({
      pages: [{ path: "001.png", image: blob("page"), width: 10, height: 20 }],
    }, {
      canvasWidth: 10,
      createId: idFactory(),
      blobToDataUrl: async () => "data:image/png;base64,b2s=",
      decodeImageBlob: async () => ({ width: 9, height: 20 }),
    })).rejects.toMatchObject({ code: "IMAGE_DECODE_FAILED" });
  });

  it("rejects CBZ pages that would exceed persisted page or canvas-height limits", async () => {
    await expect(prepareStudioCbzImportPages({
      pages: [
        { path: "001.png", image: blob("1"), width: 10, height: 20 },
        { path: "002.png", image: blob("2"), width: 10, height: 20 },
      ],
    }, {
      canvasWidth: 10,
      createId: idFactory(),
      existingPageCount: 199,
      blobToDataUrl: async () => "data:image/png;base64,b2s=",
      decodeImageBlob: async () => ({ width: 10, height: 20 }),
    })).rejects.toMatchObject({ code: "PAGE_COUNT_LIMIT" });

    await expect(prepareStudioCbzImportPages({
      pages: [{ path: "tall.png", image: blob("tall"), width: 1, height: 100_001 }],
    }, {
      canvasWidth: 1_080,
      createId: idFactory(),
      blobToDataUrl: async () => "data:image/png;base64,b2s=",
      decodeImageBlob: async () => ({ width: 1, height: 100_001 }),
    })).rejects.toMatchObject({ code: "INVALID_DIMENSION" });
  });

  it("stops CBZ conversion immediately when the operation is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const encode = vi.fn(async () => "data:image/png;base64,ok");
    await expect(prepareStudioCbzImportPages({
      pages: [{ path: "001.png", image: blob("page"), width: 10, height: 20 }],
    }, {
      canvasWidth: 10,
      createId: idFactory(),
      signal: controller.signal,
      blobToDataUrl: encode,
    })).rejects.toMatchObject({ code: "ABORTED" });
    expect(encode).not.toHaveBeenCalled();
  });
});
