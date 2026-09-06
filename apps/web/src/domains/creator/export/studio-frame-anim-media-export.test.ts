import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { pngChunkCrc32 } from "../studio-apng-encoder";

import {
  FRAME_ANIM_MEDIA_MIME,
  frameAnimMediaFileName,
  startFrameAnimMediaExport,
  type FrameAnimMediaCanvas2d,
  type FrameAnimMediaCanvasLike,
  type FrameAnimMediaDeps,
  type FrameAnimMediaProgress,
} from "./studio-frame-anim-media-export";
import { isMotionExportCancelled, type MotionCutImage } from "./studio-motion-export";

// ── 가짜 캔버스 — drawImage로 받은 마커 색을 getImageData가 그대로 돌려준다 ──

interface FakeImageSource {
  color: [number, number, number, number];
}

class FakeContext implements FrameAnimMediaCanvas2d {
  globalAlpha = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  fills: string[] = [];
  clearCount = 0;
  private lastDrawn: FakeImageSource | null = null;

  constructor(
    private readonly width: number,
    private readonly height: number
  ) {}

  clearRect(): void {
    this.lastDrawn = null;
    this.clearCount += 1;
  }

  fillRect(): void {
    this.fills.push(String(this.fillStyle));
  }

  drawImage(image: CanvasImageSource): void {
    this.lastDrawn = image as unknown as FakeImageSource;
  }

  getImageData(): { data: Uint8ClampedArray } {
    const data = new Uint8ClampedArray(this.width * this.height * 4);
    const color = this.lastDrawn?.color ?? [0, 0, 0, 0];
    for (let i = 0; i < this.width * this.height; i += 1) data.set(color, i * 4);
    return { data };
  }
}

class FakeCanvas implements FrameAnimMediaCanvasLike {
  readonly context: FakeContext;

  constructor(
    public width: number,
    public height: number
  ) {
    this.context = new FakeContext(width, height);
  }

  getContext(): FrameAnimMediaCanvas2d {
    return this.context;
  }
}

// 최소 유효 PNG(4x4 RGBA) — APNG 경로의 canvasToPngBytes 가짜 구현이 돌려준다.
function minimalPng(): Uint8Array {
  const u32be = (value: number): number[] => [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
  const chunk = (type: string, data: Uint8Array): number[] => [
    ...u32be(data.byteLength),
    ...[...type].map((ch) => ch.charCodeAt(0)),
    ...data,
    ...u32be(pngChunkCrc32(type, data)),
  ];
  const ihdr = Uint8Array.from([...u32be(4), ...u32be(4), 8, 6, 0, 0, 0]);
  const idat = new Uint8Array(deflateSync(new Uint8Array(4 * (1 + 4 * 4))));
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", idat),
    ...chunk("IEND", new Uint8Array(0)),
  ]);
}

function fakeImage(color: [number, number, number, number]): MotionCutImage {
  return {
    source: { color } as unknown as CanvasImageSource,
    width: 4,
    height: 4,
  };
}

function fakeDeps(overrides: Partial<FrameAnimMediaDeps> = {}): {
  deps: FrameAnimMediaDeps;
  canvases: FakeCanvas[];
  pngCalls: number[];
} {
  const canvases: FakeCanvas[] = [];
  const pngCalls: number[] = [];
  const deps: FrameAnimMediaDeps = {
    createCanvas(width, height) {
      const canvas = new FakeCanvas(width, height);
      canvases.push(canvas);
      return canvas;
    },
    canvasToPngBytes() {
      pngCalls.push(pngCalls.length);
      return Promise.resolve(minimalPng());
    },
    yieldToUi: () => Promise.resolve(),
    ...overrides,
  };
  return { deps, canvases, pngCalls };
}

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

describe("studio-frame-anim-media-export", () => {
  it("파일명은 WebM 규칙과 나란한 -frames.gif/-frames.apng를 만든다", () => {
    expect(frameAnimMediaFileName("겨울 단편  ", "gif")).toBe("겨울 단편-frames.gif");
    expect(frameAnimMediaFileName("", "apng")).toBe("toonspectrum-frame-anim-frames.apng");
  });

  it("GIF 경로는 렌더→인코딩 진행률과 함께 GIF89a Blob을 만든다", async () => {
    const { deps, canvases } = fakeDeps();
    const events: FrameAnimMediaProgress[] = [];
    const handle = startFrameAnimMediaExport({
      format: "gif",
      width: 4,
      height: 4,
      frameDurations: [100, 50],
      images: [fakeImage([255, 0, 0, 255]), fakeImage([0, 0, 255, 255])],
      background: "#ffffff",
      onProgress: (progress) => events.push(progress),
      deps,
    });
    const result = await handle.done;

    expect(result.mimeType).toBe(FRAME_ANIM_MEDIA_MIME.gif);
    expect(result.blob.type).toBe("image/gif");
    expect(result.byteLength).toBeGreaterThan(0);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(ascii(bytes, 0, 6)).toBe("GIF89a");
    expect(bytes[bytes.length - 1]).toBe(0x3b);

    // 배경색이 프레임마다 채워졌다(불투명 내보내기).
    expect(canvases).toHaveLength(1);
    expect(canvases[0]!.context.fills).toEqual(["#ffffff", "#ffffff"]);

    const phases = new Set(events.map((event) => event.phase));
    expect(phases.has("render")).toBe(true);
    expect(phases.has("encode")).toBe(true);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.ratio).toBeGreaterThanOrEqual(events[i - 1]!.ratio);
    }
    expect(events[events.length - 1]!.ratio).toBe(1);
  });

  it("APNG 경로는 투명 배경(fill 없음)으로 acTL을 포함한 PNG Blob을 만든다", async () => {
    const { deps, canvases, pngCalls } = fakeDeps();
    const handle = startFrameAnimMediaExport({
      format: "apng",
      width: 4,
      height: 4,
      frameDurations: [80, 120],
      images: [fakeImage([1, 2, 3, 255]), fakeImage([4, 5, 6, 255])],
      background: null,
      deps,
    });
    const result = await handle.done;

    expect(result.mimeType).toBe(FRAME_ANIM_MEDIA_MIME.apng);
    expect(pngCalls).toHaveLength(2);
    expect(canvases[0]!.context.fills).toEqual([]); // 투명 배경 — fillRect 미호출
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const text = String.fromCharCode(...bytes);
    expect(text).toContain("acTL");
    expect(text).toContain("fcTL");
    expect(text).toContain("fdAT");
  });

  it("cancel()은 MotionExport 취소 규약(isMotionExportCancelled)으로 reject한다", async () => {
    const { deps } = fakeDeps();
    const handle = startFrameAnimMediaExport({
      format: "gif",
      width: 4,
      height: 4,
      frameDurations: [100, 100],
      images: [fakeImage([255, 0, 0, 255]), fakeImage([0, 255, 0, 255])],
      background: "#ffffff",
      deps,
    });
    handle.cancel();
    await expect(handle.done).rejects.toSatisfy((err: unknown) => isMotionExportCancelled(err));
  });

  it("프레임이 2장 미만이거나 이미지 수가 모자라면 fail-closed로 거부한다", async () => {
    const { deps } = fakeDeps();
    await expect(
      startFrameAnimMediaExport({
        format: "gif",
        width: 4,
        height: 4,
        frameDurations: [100],
        images: [fakeImage([255, 0, 0, 255])],
        background: null,
        deps,
      }).done
    ).rejects.toThrow("내보낼 프레임이 2장 이상 필요해요.");
    await expect(
      startFrameAnimMediaExport({
        format: "apng",
        width: 4,
        height: 4,
        frameDurations: [100, 100],
        images: [fakeImage([255, 0, 0, 255])],
        background: null,
        deps,
      }).done
    ).rejects.toThrow("프레임 이미지 수가 플랜과 맞지 않아요. 다시 시도해주세요.");
  });
});
