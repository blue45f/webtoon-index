import { describe, expect, it } from "vitest";

import {
  STUDIO_OFFSCREEN_RASTER_MAX_SOURCES,
  STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
  adoptStudioOffscreenBitmap,
  adoptStudioOffscreenPixelBuffer,
  detectStudioOffscreenRasterEncodedMime,
  isStudioOffscreenRasterEncodedBlobExact,
  isStudioOffscreenRasterCancelMessage,
  isStudioOffscreenRasterRequestMessage,
  isStudioOffscreenRasterResponseMessage,
  isStudioOffscreenRasterRunMessage,
  studioOffscreenRasterFailure,
  studioOffscreenRasterRequestTransfers,
  studioOffscreenRasterResponseTransfers,
  type StudioOffscreenRasterPlacement,
  type StudioOffscreenRasterResultMessage,
  type StudioOffscreenRasterRunMessage,
  type StudioOffscreenRasterSource,
} from "./studio-offscreen-raster-worker-protocol";

function placement(overrides: Partial<StudioOffscreenRasterPlacement> = {}): StudioOffscreenRasterPlacement {
  return { dx: 0, dy: 0, dw: 4, dh: 2, opacity: 1, rotation: 0, flipX: false, flipY: false, ...overrides };
}

function pixelSource(width = 4, height = 2, fill = 7): StudioOffscreenRasterSource {
  const view = new Uint8ClampedArray(width * height * 4);
  view.fill(fill);
  return {
    kind: "pixels",
    width,
    height,
    pixels: adoptStudioOffscreenPixelBuffer(view),
    placement: placement({ dw: width, dh: height }),
  };
}

function fakeBitmap(width = 4, height = 2): ImageBitmap {
  return { width, height, close: () => {} } as unknown as ImageBitmap;
}

function bitmapSource(bitmap = fakeBitmap()): StudioOffscreenRasterSource {
  return { kind: "bitmap", bitmap: adoptStudioOffscreenBitmap(bitmap), placement: placement() };
}

function runMessage(
  overrides: Partial<StudioOffscreenRasterRunMessage> = {},
): StudioOffscreenRasterRunMessage {
  return {
    version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
    kind: "run",
    runId: 1,
    jobKey: "thumbnail:page-1",
    target: { width: 8, height: 4, background: "#ffffff" },
    sources: [pixelSource()],
    output: { kind: "pixels" },
    ...overrides,
  };
}

describe("studio offscreen raster protocol — 요청 형태 검증", () => {
  it("픽셀·비트맵 소스가 섞인 올바른 run 메시지를 통과시킨다", () => {
    const message = runMessage({ sources: [pixelSource(), bitmapSource()] });
    expect(isStudioOffscreenRasterRunMessage(message)).toBe(true);
    expect(isStudioOffscreenRasterRequestMessage(message)).toBe(true);
  });

  it("프로토콜 버전이 다르면 거부한다", () => {
    expect(isStudioOffscreenRasterRunMessage({ ...runMessage(), version: 2 })).toBe(false);
  });

  it("계약에 없는 키가 붙으면 거부한다", () => {
    expect(isStudioOffscreenRasterRunMessage({ ...runMessage(), extra: 1 })).toBe(false);
  });

  it("runId·jobKey 가 유효하지 않으면 거부한다", () => {
    expect(isStudioOffscreenRasterRunMessage(runMessage({ runId: 0 }))).toBe(false);
    expect(isStudioOffscreenRasterRunMessage(runMessage({ runId: 1.5 }))).toBe(false);
    expect(isStudioOffscreenRasterRunMessage(runMessage({ jobKey: "" }))).toBe(false);
    expect(isStudioOffscreenRasterRunMessage(runMessage({ jobKey: "k".repeat(129) }))).toBe(false);
  });

  it("픽셀 버퍼 길이가 width*height*4 와 다르면 거부한다", () => {
    const source = pixelSource(4, 2);
    const broken = { ...source, width: 5 } as StudioOffscreenRasterSource;
    expect(isStudioOffscreenRasterRunMessage(runMessage({ sources: [broken] }))).toBe(false);
  });

  it("SharedArrayBuffer 백킹 픽셀은 transferable 이 아니므로 거부한다", () => {
    const shared = new SharedArrayBuffer(4 * 2 * 4);
    const source = {
      kind: "pixels",
      width: 4,
      height: 2,
      pixels: shared,
      placement: placement(),
    } as unknown as StudioOffscreenRasterSource;
    expect(isStudioOffscreenRasterRunMessage(runMessage({ sources: [source] }))).toBe(false);
  });

  it("배치(placement) 범위를 벗어난 opacity·비유한 좌표를 거부한다", () => {
    const bad = { ...pixelSource(), placement: placement({ opacity: 1.5 }) } as StudioOffscreenRasterSource;
    expect(isStudioOffscreenRasterRunMessage(runMessage({ sources: [bad] }))).toBe(false);
    const nan = { ...pixelSource(), placement: placement({ dx: Number.NaN }) } as StudioOffscreenRasterSource;
    expect(isStudioOffscreenRasterRunMessage(runMessage({ sources: [nan] }))).toBe(false);
  });

  it("소스가 없거나 상한을 넘으면 거부한다", () => {
    expect(isStudioOffscreenRasterRunMessage(runMessage({ sources: [] }))).toBe(false);
    const many = Array.from({ length: STUDIO_OFFSCREEN_RASTER_MAX_SOURCES + 1 }, () => pixelSource(1, 1));
    expect(isStudioOffscreenRasterRunMessage(runMessage({ sources: many }))).toBe(false);
  });

  it("PNG 출력에 quality 를 붙이면 거부하고, WebP 는 허용한다", () => {
    expect(isStudioOffscreenRasterRunMessage(
      runMessage({ output: { kind: "encoded", mime: "image/png", quality: 0.9 } }),
    )).toBe(false);
    expect(isStudioOffscreenRasterRunMessage(
      runMessage({ output: { kind: "encoded", mime: "image/webp", quality: 0.9 } }),
    )).toBe(true);
    expect(isStudioOffscreenRasterRunMessage(
      runMessage({ output: { kind: "encoded", mime: "image/gif" } as never }),
    )).toBe(false);
  });

  it("치수 예산을 넘긴 타깃을 거부한다", () => {
    expect(isStudioOffscreenRasterRunMessage(
      runMessage({ target: { width: 20_000, height: 4, background: null } }),
    )).toBe(false);
  });

  it("cancel 메시지는 별도 형태로 검증된다", () => {
    const cancel = {
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "cancel" as const,
      runId: 3,
    };
    expect(isStudioOffscreenRasterCancelMessage(cancel)).toBe(true);
    expect(isStudioOffscreenRasterRunMessage(cancel)).toBe(false);
    expect(isStudioOffscreenRasterRequestMessage(cancel)).toBe(true);
    expect(isStudioOffscreenRasterCancelMessage({ ...cancel, runId: -1 })).toBe(false);
  });
});

describe("studio offscreen raster protocol — 응답 형태 검증", () => {
  it("ready·unavailable 핸드셰이크를 통과시킨다", () => {
    expect(isStudioOffscreenRasterResponseMessage({
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "ready",
    })).toBe(true);
    expect(isStudioOffscreenRasterResponseMessage({
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "unavailable",
      code: "offscreen-canvas",
    })).toBe(true);
    expect(isStudioOffscreenRasterResponseMessage({
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "unavailable",
      code: "nope",
    })).toBe(false);
  });

  it("픽셀 결과는 결과 치수와 byteLength 가 정확히 일치할 때만 통과한다", () => {
    const good: StudioOffscreenRasterResultMessage = {
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "result",
      runId: 4,
      width: 4,
      height: 2,
      payload: { kind: "pixels", pixels: adoptStudioOffscreenPixelBuffer(new Uint8ClampedArray(4 * 2 * 4)) },
    };
    expect(isStudioOffscreenRasterResponseMessage(good)).toBe(true);
    const truncated = {
      ...good,
      payload: { kind: "pixels", pixels: new ArrayBuffer(8) },
    };
    expect(isStudioOffscreenRasterResponseMessage(truncated)).toBe(false);
  });

  it("실패 응답은 알려진 코드만 통과한다", () => {
    const failure = studioOffscreenRasterFailure(9, "encode-failed", "인코딩 실패");
    expect(isStudioOffscreenRasterResponseMessage(failure)).toBe(true);
    expect(failure.kind).toBe("failure");
    expect(isStudioOffscreenRasterResponseMessage({ ...failure, code: "kaboom" })).toBe(false);
    expect(isStudioOffscreenRasterResponseMessage({ ...failure, runId: 0 })).toBe(false);
  });

  it("인코딩 결과는 요청 MIME과 같은 비어 있지 않은 Blob 라벨을 요구한다", () => {
    const base = {
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "result" as const,
      runId: 2,
      width: 4,
      height: 2,
    };
    expect(isStudioOffscreenRasterResponseMessage({
      ...base,
      payload: {
        kind: "encoded",
        mime: "image/png",
        blob: new Blob([Uint8Array.of(0x89)], { type: "image/png" }),
      },
    })).toBe(true);
    expect(isStudioOffscreenRasterResponseMessage({
      ...base,
      payload: {
        kind: "encoded",
        mime: "image/webp",
        blob: new Blob([Uint8Array.of(0x89)], { type: "image/png" }),
      },
    })).toBe(false);
    expect(isStudioOffscreenRasterResponseMessage({
      ...base,
      payload: { kind: "encoded", mime: "image/png", blob: { size: 3 } },
    })).toBe(false);
  });

  it("인코딩 컨테이너 magic까지 요청 MIME과 정확히 일치시킨다", async () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0);
    const webp = new TextEncoder().encode("RIFF0000WEBP");
    expect(detectStudioOffscreenRasterEncodedMime(png)).toBe("image/png");
    expect(detectStudioOffscreenRasterEncodedMime(jpeg)).toBe("image/jpeg");
    expect(detectStudioOffscreenRasterEncodedMime(webp)).toBe("image/webp");
    await expect(isStudioOffscreenRasterEncodedBlobExact(
      new Blob([webp], { type: "image/webp" }),
      "image/webp",
    )).resolves.toBe(true);
    await expect(isStudioOffscreenRasterEncodedBlobExact(
      new Blob([png], { type: "image/webp" }),
      "image/webp",
    )).resolves.toBe(false);
  });

  it("요청/응답이 서로의 검증기를 왕복 통과한다(round-trip)", () => {
    const request = runMessage({ runId: 11, sources: [pixelSource(), bitmapSource()] });
    // 클라이언트가 만든 요청 → Worker 검증기
    expect(isStudioOffscreenRasterRunMessage(request)).toBe(true);
    // Worker 가 만든 결과 → 클라이언트 검증기
    const response: StudioOffscreenRasterResultMessage = {
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "result",
      runId: request.runId,
      width: request.target.width,
      height: request.target.height,
      payload: {
        kind: "pixels",
        pixels: adoptStudioOffscreenPixelBuffer(
          new Uint8ClampedArray(request.target.width * request.target.height * 4),
        ),
      },
    };
    expect(isStudioOffscreenRasterResponseMessage(response)).toBe(true);
    expect(response.runId).toBe(request.runId);
  });
});

describe("studio offscreen raster protocol — transfer 목록", () => {
  it("모든 픽셀 버퍼와 비트맵을 정확히 한 번씩 담는다", () => {
    const first = pixelSource(4, 2);
    const second = pixelSource(2, 2);
    const bitmap = fakeBitmap();
    const message = runMessage({ sources: [first, second, bitmapSource(bitmap)] });
    const transfers = studioOffscreenRasterRequestTransfers(message);
    expect(transfers).toHaveLength(3);
    expect(transfers).toContain((first as { pixels: ArrayBuffer }).pixels);
    expect(transfers).toContain((second as { pixels: ArrayBuffer }).pixels);
    expect(transfers).toContain(bitmap as unknown as Transferable);
  });

  it("같은 버퍼를 두 소스가 공유해도 한 번만 담는다", () => {
    const shared = pixelSource(4, 2);
    if (shared.kind !== "pixels") throw new Error("픽셀 소스가 아닙니다.");
    const twin: StudioOffscreenRasterSource = {
      kind: "pixels",
      width: 4,
      height: 2,
      pixels: shared.pixels,
      placement: placement({ dx: 4 }),
    };
    const transfers = studioOffscreenRasterRequestTransfers(runMessage({ sources: [shared, twin] }));
    expect(transfers).toHaveLength(1);
  });

  it("cancel 메시지는 아무것도 전송하지 않는다", () => {
    expect(studioOffscreenRasterRequestTransfers({
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "cancel",
      runId: 5,
    })).toEqual([]);
  });

  it("응답 쪽은 픽셀/비트맵만 전송하고 Blob 은 전송 목록에서 제외한다", () => {
    const pixels = adoptStudioOffscreenPixelBuffer(new Uint8ClampedArray(4 * 2 * 4));
    expect(studioOffscreenRasterResponseTransfers({
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "result",
      runId: 1,
      width: 4,
      height: 2,
      payload: { kind: "pixels", pixels },
    })).toEqual([pixels]);

    const bitmap = fakeBitmap();
    expect(studioOffscreenRasterResponseTransfers({
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "result",
      runId: 1,
      width: 4,
      height: 2,
      payload: { kind: "bitmap", bitmap: adoptStudioOffscreenBitmap(bitmap) },
    })).toEqual([bitmap]);

    expect(studioOffscreenRasterResponseTransfers({
      version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
      kind: "result",
      runId: 1,
      width: 4,
      height: 2,
      payload: {
        kind: "encoded",
        mime: "image/png",
        blob: new Blob([Uint8Array.of(0x89)], { type: "image/png" }),
      },
    })).toEqual([]);

    expect(studioOffscreenRasterResponseTransfers(
      studioOffscreenRasterFailure(1, "cancelled", "취소"),
    )).toEqual([]);
  });
});

describe("studio offscreen raster protocol — 소유권 확정", () => {
  it("전용 버퍼는 복사 없이 그대로 소유권을 넘긴다", () => {
    const view = new Uint8ClampedArray(16);
    expect(adoptStudioOffscreenPixelBuffer(view)).toBe(view.buffer);
  });

  it("부분 view 는 전용 버퍼로 복제해 형제 view 가 함께 detach 되지 않게 한다", () => {
    const backing = new ArrayBuffer(32);
    const view = new Uint8ClampedArray(backing, 8, 16);
    view.fill(3);
    const owned = adoptStudioOffscreenPixelBuffer(view);
    expect(owned).not.toBe(backing);
    expect(owned.byteLength).toBe(16);
    expect(Array.from(new Uint8Array(owned))).toEqual(Array.from({ length: 16 }, () => 3));
  });

  it("SharedArrayBuffer 백킹도 전용 ArrayBuffer 로 복제한다", () => {
    const shared = new SharedArrayBuffer(16);
    const view = new Uint8ClampedArray(shared);
    view.fill(9);
    const owned = adoptStudioOffscreenPixelBuffer(view);
    expect(owned).toBeInstanceOf(ArrayBuffer);
    expect(owned.byteLength).toBe(16);
    expect(new Uint8Array(owned)[0]).toBe(9);
  });

  it("비트맵이 아닌 값은 소유권 승격에서 정직하게 거부한다", () => {
    expect(() => adoptStudioOffscreenBitmap({ width: 1 } as unknown as ImageBitmap)).toThrow(TypeError);
  });
});
