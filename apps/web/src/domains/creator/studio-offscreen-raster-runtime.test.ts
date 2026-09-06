import { describe, expect, it } from "vitest";

import {
  createStudioOffscreenCanvasHost,
  executeStudioOffscreenRasterJob,
  supportsStudioOffscreenCanvas2d,
  type StudioOffscreenRasterDrawable,
  type StudioOffscreenRasterHost,
  type StudioOffscreenRasterSurface,
} from "./studio-offscreen-raster-runtime";
import {
  STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
  adoptStudioOffscreenBitmap,
  adoptStudioOffscreenPixelBuffer,
  isStudioOffscreenRasterResponseMessage,
  type StudioOffscreenOwnedBitmap,
  type StudioOffscreenRasterPlacement,
  type StudioOffscreenRasterRunMessage,
  type StudioOffscreenRasterSource,
} from "./studio-offscreen-raster-worker-protocol";

interface RecordedDraw {
  readonly label: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly placement: StudioOffscreenRasterPlacement;
}

interface FakeHost extends StudioOffscreenRasterHost {
  readonly draws: RecordedDraw[];
  readonly fills: string[];
  readonly released: string[];
  releasedSurfaces: number;
}

function exactEncodedBlob(
  mime: "image/png" | "image/jpeg" | "image/webp",
): Blob {
  if (mime === "image/png") {
    return new Blob([
      Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    ], { type: mime });
  }
  if (mime === "image/jpeg") {
    return new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 0xe0)], { type: mime });
  }
  return new Blob([new TextEncoder().encode("RIFF0000WEBP")], { type: mime });
}

function createFakeHost(overrides: {
  createSurface?: () => never;
  encode?: (mime: "image/png" | "image/jpeg" | "image/webp", quality?: number) => Promise<Blob>;
  onDraw?: () => void;
} = {}): FakeHost {
  const draws: RecordedDraw[] = [];
  const fills: string[] = [];
  const released: string[] = [];
  const host: FakeHost = {
    draws,
    fills,
    released,
    releasedSurfaces: 0,
    createSurface(width, height) {
      if (overrides.createSurface) overrides.createSurface();
      const surface: StudioOffscreenRasterSurface = {
        width,
        height,
        fill(color) {
          fills.push(color);
        },
        drawSource(source, sourceWidth, sourceHeight, placement) {
          overrides.onDraw?.();
          draws.push({
            label: (source as { label?: string }).label ?? "unknown",
            sourceWidth,
            sourceHeight,
            placement,
          });
        },
        readPixels() {
          const bytes = new Uint8ClampedArray(width * height * 4);
          bytes.fill(draws.length);
          return adoptStudioOffscreenPixelBuffer(bytes);
        },
        transferToBitmap() {
          return { width, height, close: () => {} } as unknown as StudioOffscreenOwnedBitmap;
        },
        encode: overrides.encode ?? (async (mime) => exactEncodedBlob(mime)),
        release() {
          host.releasedSurfaces += 1;
        },
      };
      return surface;
    },
    async adoptPixels(pixels, width, height) {
      return { label: `pixels:${width}x${height}:${pixels.byteLength}` } as StudioOffscreenRasterDrawable;
    },
    releaseDrawable(drawable) {
      released.push((drawable as { label?: string }).label ?? "bitmap");
    },
  };
  return host;
}

function placement(overrides: Partial<StudioOffscreenRasterPlacement> = {}): StudioOffscreenRasterPlacement {
  return { dx: 0, dy: 0, dw: 4, dh: 2, opacity: 1, rotation: 0, flipX: false, flipY: false, ...overrides };
}

function pixelSource(width = 4, height = 2, dx = 0): StudioOffscreenRasterSource {
  return {
    kind: "pixels",
    width,
    height,
    pixels: adoptStudioOffscreenPixelBuffer(new Uint8ClampedArray(width * height * 4)),
    placement: placement({ dx, dw: width, dh: height }),
  };
}

function bitmapSource(label = "bitmap"): StudioOffscreenRasterSource {
  const bitmap = { width: 4, height: 2, close: () => {}, label } as unknown as ImageBitmap;
  return { kind: "bitmap", bitmap: adoptStudioOffscreenBitmap(bitmap), placement: placement() };
}

function request(
  overrides: Partial<StudioOffscreenRasterRunMessage> = {},
): StudioOffscreenRasterRunMessage {
  return {
    version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
    kind: "run",
    runId: 1,
    jobKey: "page:1",
    target: { width: 8, height: 4, background: "#ffffff" },
    sources: [pixelSource()],
    output: { kind: "pixels" },
    ...overrides,
  };
}

describe("studio offscreen raster runtime — 합성 실행", () => {
  it("배경을 칠하고 소스를 제출 순서대로 그린 뒤 픽셀을 돌려준다", async () => {
    const host = createFakeHost();
    const response = await executeStudioOffscreenRasterJob({
      host,
      request: request({ sources: [pixelSource(4, 2, 0), pixelSource(2, 2, 4)] }),
    });

    expect(response.kind).toBe("result");
    expect(host.fills).toEqual(["#ffffff"]);
    expect(host.draws.map((draw) => draw.label)).toEqual(["pixels:4x2:32", "pixels:2x2:16"]);
    expect(host.draws.map((draw) => draw.placement.dx)).toEqual([0, 4]);
    expect(host.releasedSurfaces).toBe(1);
    expect(isStudioOffscreenRasterResponseMessage(response)).toBe(true);
    if (response.kind === "result" && response.payload.kind === "pixels") {
      expect(response.payload.pixels.byteLength).toBe(8 * 4 * 4);
    }
  });

  it("배경이 null 이면 투명 유지를 위해 칠하지 않는다", async () => {
    const host = createFakeHost();
    await executeStudioOffscreenRasterJob({
      host,
      request: request({ target: { width: 8, height: 4, background: null } }),
    });
    expect(host.fills).toEqual([]);
  });

  it("비트맵 소스는 그린 뒤 즉시 해제한다(누수 방지)", async () => {
    const host = createFakeHost();
    await executeStudioOffscreenRasterJob({ host, request: request({ sources: [bitmapSource("cover")] }) });
    expect(host.draws[0]?.label).toBe("cover");
    expect(host.released).toEqual(["cover"]);
  });

  it("인코딩 출력은 Blob 결과로 나온다", async () => {
    const host = createFakeHost();
    const response = await executeStudioOffscreenRasterJob({
      host,
      request: request({ output: { kind: "encoded", mime: "image/webp", quality: 0.9 } }),
    });
    expect(response.kind).toBe("result");
    if (response.kind === "result" && response.payload.kind === "encoded") {
      expect(response.payload.mime).toBe("image/webp");
      expect(response.payload.blob.size).toBeGreaterThan(0);
    }
  });

  it("브라우저가 요청한 WebP 대신 PNG를 반환하면 encode-failed로 닫는다", async () => {
    const host = createFakeHost({
      encode: async () => exactEncodedBlob("image/png"),
    });
    const response = await executeStudioOffscreenRasterJob({
      host,
      request: request({ output: { kind: "encoded", mime: "image/webp", quality: 0.9 } }),
    });
    expect(response).toMatchObject({ kind: "failure", code: "encode-failed" });
  });

  it("요청 MIME 라벨만 맞고 실제 컨테이너가 다르면 encode-failed로 닫는다", async () => {
    const host = createFakeHost({
      encode: async () => new Blob([
        Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      ], { type: "image/jpeg" }),
    });
    const response = await executeStudioOffscreenRasterJob({
      host,
      request: request({ output: { kind: "encoded", mime: "image/jpeg", quality: 0.9 } }),
    });
    expect(response).toMatchObject({ kind: "failure", code: "encode-failed" });
  });

  it("비트맵 출력은 표면 백킹을 그대로 이관한다", async () => {
    const host = createFakeHost();
    const response = await executeStudioOffscreenRasterJob({
      host,
      request: request({ output: { kind: "bitmap" } }),
    });
    expect(response.kind).toBe("result");
    if (response.kind === "result") expect(response.payload.kind).toBe("bitmap");
  });
});

describe("studio offscreen raster runtime — 정직한 타입 실패", () => {
  it("형식이 틀린 요청은 throw 대신 protocol 실패를 돌려준다", async () => {
    const host = createFakeHost();
    const response = await executeStudioOffscreenRasterJob({ host, request: { kind: "run", runId: 77 } });
    expect(response).toMatchObject({ kind: "failure", code: "protocol", runId: 77 });
    expect(host.draws).toEqual([]);
  });

  it("표면 생성 실패는 선택된 provider의 typed unsupported로 환원한다", async () => {
    const host = createFakeHost({
      createSurface: () => {
        throw new Error("no offscreen");
      },
    });
    const response = await executeStudioOffscreenRasterJob({ host, request: request() });
    expect(response).toMatchObject({ kind: "failure", code: "unsupported" });
  });

  it("합성 중 예외는 raster-failed 로 환원되고 표면은 반드시 해제된다", async () => {
    const host = createFakeHost({
      onDraw: () => {
        throw new Error("draw exploded");
      },
    });
    const response = await executeStudioOffscreenRasterJob({ host, request: request() });
    expect(response).toMatchObject({ kind: "failure", code: "raster-failed", message: "draw exploded" });
    expect(host.releasedSurfaces).toBe(1);
  });

  it("인코딩 실패와 빈 결과는 encode-failed 로 구분된다", async () => {
    const thrown = createFakeHost({
      encode: () => Promise.reject(new Error("convertToBlob failed")),
    });
    const encoded = { kind: "encoded", mime: "image/png" } as const;
    await expect(executeStudioOffscreenRasterJob({
      host: thrown,
      request: request({ output: encoded }),
    })).resolves.toMatchObject({ kind: "failure", code: "encode-failed" });

    const empty = createFakeHost({ encode: async () => new Blob([]) });
    await expect(executeStudioOffscreenRasterJob({
      host: empty,
      request: request({ output: encoded }),
    })).resolves.toMatchObject({ kind: "failure", code: "encode-failed" });
  });

  it("모든 실패 응답이 프로토콜 검증기를 통과한다", async () => {
    const host = createFakeHost({
      createSurface: () => {
        throw new Error("nope");
      },
    });
    const response = await executeStudioOffscreenRasterJob({ host, request: request() });
    expect(isStudioOffscreenRasterResponseMessage(response)).toBe(true);
  });
});

describe("studio offscreen raster runtime — 비행 중 취소", () => {
  it("시작 전 취소는 소스를 하나도 그리지 않는다", async () => {
    const host = createFakeHost();
    const response = await executeStudioOffscreenRasterJob({
      host,
      request: request(),
      isCancelled: () => true,
    });
    expect(response).toMatchObject({ kind: "failure", code: "cancelled" });
    expect(host.draws).toEqual([]);
  });

  it("소스 경계에서 취소를 관측하면 남은 소스를 그리지 않고 즉시 멈춘다", async () => {
    const host = createFakeHost();
    const response = await executeStudioOffscreenRasterJob({
      host,
      request: request({ sources: [pixelSource(4, 2, 0), pixelSource(4, 2, 4), pixelSource(4, 2, 8)] }),
      // 첫 소스를 그린 직후부터 취소 상태가 된다.
      isCancelled: () => host.draws.length >= 1,
    });
    expect(response).toMatchObject({ kind: "failure", code: "cancelled" });
    expect(host.draws).toHaveLength(1);
    expect(host.releasedSurfaces).toBe(1);
  });

  it("그리기가 끝난 뒤 취소되면 인코딩도 하지 않는다", async () => {
    let encodeCalls = 0;
    const host = createFakeHost({
      encode: async () => {
        encodeCalls += 1;
        return new Blob([new Uint8Array([1])]);
      },
    });
    const response = await executeStudioOffscreenRasterJob({
      host,
      request: request({ output: { kind: "encoded", mime: "image/png" } }),
      isCancelled: () => host.draws.length >= 1,
    });
    expect(response).toMatchObject({ kind: "failure", code: "cancelled" });
    expect(encodeCalls).toBe(0);
  });
});

describe("studio offscreen raster runtime — 결정성과 능력 프로브", () => {
  it("같은 요청을 두 번 실행하면 같은 draw 시퀀스를 만든다", async () => {
    const build = () => request({
      sources: [pixelSource(4, 2, 0), bitmapSource("b"), pixelSource(2, 2, 6)],
    });
    const first = createFakeHost();
    const second = createFakeHost();
    await executeStudioOffscreenRasterJob({ host: first, request: build() });
    await executeStudioOffscreenRasterJob({ host: second, request: build() });

    expect(first.draws).toEqual(second.draws);
    expect(first.released).toEqual(second.released);
  });

  it("OffscreenCanvas 가 없는 런타임에서는 프로브가 false, host 는 null 이다", () => {
    expect(supportsStudioOffscreenCanvas2d()).toBe(false);
    expect(createStudioOffscreenCanvasHost()).toBeNull();
  });
});
