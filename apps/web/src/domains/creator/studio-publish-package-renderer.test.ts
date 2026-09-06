import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
  planStudioPublishPackage,
} from "./studio-publish-package";
import { renderStudioPublishPackageImages } from "./studio-publish-package-renderer";
import { DEFAULT_WATERMARK } from "./studio-watermark";

interface DrawCall {
  args: unknown[];
}

class FakeCanvas {
  width: number;
  height: number;
  readonly drawCalls: DrawCall[] = [];
  readonly textCalls: unknown[][] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return {
      fillStyle: "",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      globalAlpha: 1,
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      lineJoin: "miter",
      lineWidth: 1,
      strokeStyle: "",
      fillRect: vi.fn(),
      drawImage: (...args: unknown[]) => this.drawCalls.push({ args }),
      save: vi.fn(),
      restore: vi.fn(),
      strokeText: (...args: unknown[]) => this.textCalls.push(args),
      fillText: (...args: unknown[]) => this.textCalls.push(args),
    };
  }
}

function asCanvas(canvas: FakeCanvas): HTMLCanvasElement {
  return canvas as unknown as HTMLCanvasElement;
}

function fakeImageBlob(mimeType: string, payload = "rendered"): Blob {
  const suffix = new TextEncoder().encode(payload);
  const signature = mimeType === "image/png"
    ? Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : mimeType === "image/jpeg"
      ? Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])
      : mimeType === "image/webp"
        ? new TextEncoder().encode("RIFF0000WEBP")
        : new TextEncoder().encode("GIF89a");
  return new Blob([signature, suffix], { type: mimeType });
}

describe("studio-publish-package-renderer", () => {
  it("WEBTOON 회차 이미지를 800×1280 이하로 분할하고 썸네일을 cover crop한다", async () => {
    const outputs: FakeCanvas[] = [];
    const progress: Array<[number, number]> = [];
    const result = await renderStudioPublishPackageImages({
      settings: {
        ...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
        destination: "webtoon",
        requestedThumbnailSlots: ["episode"],
        policyReviewConfirmed: true,
        thumbnailSafetyConfirmed: true,
      },
      seriesTitle: "Memory Market",
      sources: [{ id: "page-1", canvas: asCanvas(new FakeCanvas(720, 2_304)) }],
      createCanvas: (width, height) => {
        const canvas = new FakeCanvas(width, height);
        outputs.push(canvas);
        return asCanvas(canvas);
      },
      encode: async (canvas, mimeType) => fakeImageBlob(
        mimeType,
        `${canvas.width}x${canvas.height}:${mimeType}`
      ),
      digestSha256: async () => "a".repeat(64),
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(result.episodeImages.map(({ metadata }) => [metadata.width, metadata.height])).toEqual([
      [800, 1280],
      [800, 1280],
    ]);
    expect(result.episodeImages.map(({ fileName }) => fileName).every((name) => name.endsWith(".png"))).toBe(true);
    expect(result.episodeImages[0]?.metadata.sha256).toBe("a".repeat(64));
    expect(result.thumbnails[0]?.metadata).toMatchObject({
      slot: "episode",
      width: 202,
      height: 142,
      mimeType: "image/png",
    });
    const finalPlan = planStudioPublishPackage({
      settings: {
        ...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
        destination: "webtoon",
        requestedThumbnailSlots: ["episode"],
        policyReviewConfirmed: true,
        thumbnailSafetyConfirmed: true,
      },
      seriesTitle: "Memory Market",
      episodeTitle: "Episode",
      canvases: [{ id: "page-1", width: 720, height: 2_304 }],
      episodeImages: result.episodeImages.map(({ metadata }) => metadata),
      thumbnails: result.thumbnails.map(({ metadata }) => metadata),
    });
    const manifestThumbnailName = finalPlan.manifest.artifacts.find(
      ({ role }) => role === "thumbnail"
    )?.fileName;
    expect(result.thumbnails[0]?.fileName).toBe("episode000thumbnail.png");
    expect(result.thumbnails[0]?.fileName).toBe(manifestThumbnailName);
    expect(outputs).toHaveLength(3);
    expect(outputs[0]?.drawCalls[0]?.args.slice(5)).toEqual([0, 0, 800, 1280]);
    expect(progress.at(-1)).toEqual([3, 3]);
  });

  it("Tapas 출력은 940px 폭과 안전한 ASCII 파일명을 사용한다", async () => {
    const result = await renderStudioPublishPackageImages({
      settings: {
        ...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
        destination: "tapas",
        outputFormat: "jpeg",
        requestedThumbnailSlots: ["episode", "series-cover"],
      },
      seriesTitle: "../기억 시장",
      sources: [{ id: "page-1", canvas: asCanvas(new FakeCanvas(720, 1_080)) }],
      createCanvas: (width, height) => asCanvas(new FakeCanvas(width, height)),
      encode: async (_canvas, mimeType) => fakeImageBlob(mimeType),
      digestSha256: async () => "b".repeat(64),
    });

    expect(result.episodeImages[0]?.metadata).toMatchObject({ width: 940, height: 1410, mimeType: "image/jpeg" });
    expect(result.thumbnails.map(({ fileName }) => fileName).every((name) => /^[A-Za-z0-9_-]+\.jpeg$/u.test(name))).toBe(true);
    expect(result.thumbnails.map(({ metadata }) => [metadata.width, metadata.height])).toEqual([
      [300, 300],
      [960, 1440],
    ]);
  });

  it("워터마크는 회차 이미지에만 합성하고 원본을 변경하지 않는다", async () => {
    const source = new FakeCanvas(800, 1_000);
    const outputs: FakeCanvas[] = [];
    await renderStudioPublishPackageImages({
      settings: { ...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS, requestedThumbnailSlots: ["episode"] },
      seriesTitle: "작품",
      sources: [{ id: "page-1", canvas: asCanvas(source) }],
      watermark: { ...DEFAULT_WATERMARK, enabled: true, text: "© 작가" },
      createCanvas: (width, height) => {
        const output = new FakeCanvas(width, height);
        outputs.push(output);
        return asCanvas(output);
      },
      encode: async (_canvas, mimeType) => fakeImageBlob(mimeType),
      digestSha256: async () => "c".repeat(64),
    });

    expect(source.drawCalls).toHaveLength(0);
    expect(outputs[0]?.textCalls.length).toBeGreaterThan(0);
    expect(outputs[1]?.textCalls).toHaveLength(0);
  });

  it("빈 원본, 중복 ID, 손상 크기를 명시적으로 거부한다", async () => {
    const base = {
      settings: DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
      seriesTitle: "작품",
      encode: async (_canvas: HTMLCanvasElement, mimeType: string) => fakeImageBlob(mimeType),
      digestSha256: async () => "d".repeat(64),
    };
    await expect(renderStudioPublishPackageImages({ ...base, sources: [] })).rejects.toThrow("캔버스가 없어요");
    await expect(renderStudioPublishPackageImages({
      ...base,
      sources: [
        { id: "same", canvas: asCanvas(new FakeCanvas(100, 100)) },
        { id: "same", canvas: asCanvas(new FakeCanvas(100, 100)) },
      ],
    })).rejects.toThrow("ID 또는 크기");
    await expect(renderStudioPublishPackageImages({
      ...base,
      sources: [{ id: "bad", canvas: asCanvas(new FakeCanvas(0, 100)) }],
    })).rejects.toThrow("ID 또는 크기");
  });

  it("브라우저가 요청 형식 대신 다른 이미지 바이트로 폴백하면 즉시 중단한다", async () => {
    await expect(renderStudioPublishPackageImages({
      settings: { ...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS, outputFormat: "jpeg" },
      seriesTitle: "작품",
      sources: [{ id: "page-1", canvas: asCanvas(new FakeCanvas(800, 1_000)) }],
      createCanvas: (width, height) => asCanvas(new FakeCanvas(width, height)),
      encode: async () => fakeImageBlob("image/png"),
      digestSha256: async () => "e".repeat(64),
    })).rejects.toThrow("요청한 이미지 형식과 다른 파일");
  });

  it("성공과 인코딩 실패 모두에서 임시 출력 캔버스를 해제하고 원본은 보존한다", async () => {
    const source = new FakeCanvas(800, 1_000);
    const created: FakeCanvas[] = [];
    const released: FakeCanvas[] = [];
    await renderStudioPublishPackageImages({
      settings: {
        ...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
        requestedThumbnailSlots: ["episode"],
      },
      seriesTitle: "작품",
      sources: [{ id: "page-1", canvas: asCanvas(source) }],
      createCanvas: (width, height) => {
        const output = new FakeCanvas(width, height);
        created.push(output);
        return asCanvas(output);
      },
      releaseCanvas: (canvas) => {
        const output = canvas as unknown as FakeCanvas;
        released.push(output);
        canvas.width = 0;
        canvas.height = 0;
      },
      encode: async (_canvas, mimeType) => fakeImageBlob(mimeType),
      digestSha256: async () => "f".repeat(64),
    });

    expect(released).toEqual(created);
    expect(created.map(({ width, height }) => [width, height])).toEqual([[0, 0], [0, 0]]);
    expect([source.width, source.height]).toEqual([800, 1_000]);

    const failedOutput = new FakeCanvas(800, 1_000);
    const failedRelease = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    await expect(renderStudioPublishPackageImages({
      settings: DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
      seriesTitle: "작품",
      sources: [{ id: "page-1", canvas: asCanvas(source) }],
      createCanvas: () => asCanvas(failedOutput),
      releaseCanvas: failedRelease,
      encode: async () => {
        throw new Error("encoder failed");
      },
      digestSha256: async () => "f".repeat(64),
    })).rejects.toThrow("encoder failed");
    expect(failedRelease).toHaveBeenCalledWith(asCanvas(failedOutput));
  });
});
