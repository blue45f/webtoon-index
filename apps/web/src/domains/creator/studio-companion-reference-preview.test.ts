import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_COMPANION_REFERENCE_MAX_ENCODER_FLIGHTS,
  STUDIO_COMPANION_REFERENCE_MAX_RGBA_BYTES,
  STUDIO_COMPANION_REFERENCE_WEBP_QUALITIES,
  STUDIO_COMPANION_REFERENCE_WEBP_RESIZE_SCALE,
  createStudioCompanionReferencePreview,
  createStudioCompanionReferencePreviewFrame,
  encodeStudioCompanionReferencePreviewWebp,
  fitStudioCompanionReferencePreviewDimensions,
  renderStudioCompanionReferencePreview,
  sampleStudioCompanionReferenceColor,
  type StudioCompanionReferencePreviewCanvas,
  type StudioCompanionReferencePreviewContext,
  type StudioCompanionReferencePreviewItem,
  type StudioCompanionReferencePreviewItemView,
  type StudioCompanionReferencePreviewSource,
  type StudioCompanionReferenceRenderedPreview,
} from "./studio-companion-reference-preview";
import {
  STUDIO_COMPANION_REFERENCE_MAX_BYTES,
  STUDIO_COMPANION_REFERENCE_MAX_EDGE,
  STUDIO_COMPANION_REFERENCE_MAX_PIXELS,
  isStudioCompanionReferencePreviewFrame,
} from "./studio-companion-reference-projection";

type DrawRecord = {
  image: unknown;
  destination: [number, number, number, number];
  alpha: number;
  filter: string;
};

class FakeContext implements StudioCompanionReferencePreviewContext {
  globalAlpha = 1;
  filter = "none";
  imageSmoothingEnabled = false;
  readonly draws: DrawRecord[] = [];
  readonly translations: Array<[number, number]> = [];
  readonly rotations: number[] = [];
  readonly scales: Array<[number, number]> = [];
  clearCount = 0;
  restoreCount = 0;
  saveCount = 0;
  failDrawAt = Number.POSITIVE_INFINITY;

  clearRect(): void {
    this.clearCount += 1;
  }

  save(): void {
    this.saveCount += 1;
  }

  restore(): void {
    this.restoreCount += 1;
  }

  translate(x: number, y: number): void {
    this.translations.push([x, y]);
  }

  rotate(angle: number): void {
    this.rotations.push(angle);
  }

  scale(x: number, y: number): void {
    this.scales.push([x, y]);
  }

  drawImage(
    image: unknown,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number
  ): void {
    if (this.draws.length + 1 === this.failDrawAt) throw new Error("draw failed");
    this.draws.push({
      image,
      destination: [dx, dy, dWidth, dHeight],
      alpha: this.globalAlpha,
      filter: this.filter,
    });
  }
}

class FakeCanvas implements StudioCompanionReferencePreviewCanvas {
  convertToBlob?: StudioCompanionReferencePreviewCanvas["convertToBlob"];
  toBlob?: StudioCompanionReferencePreviewCanvas["toBlob"];

  constructor(
    public width: number,
    public height: number,
    readonly context: FakeContext | null = new FakeContext()
  ) {}

  getContext(): StudioCompanionReferencePreviewContext | null {
    return this.context;
  }
}

const DEFAULT_VIEW: StudioCompanionReferencePreviewItemView = {
  centerX: 0.5,
  centerY: 0.5,
  zoom: 1,
  rotationDeg: 0,
  flipX: false,
  flipY: false,
  opacity: 1,
  grayscale: false,
};

function source(
  marker: string,
  width: number,
  height: number,
  options: {
    pixels?: Uint8ClampedArray;
    layoutWidth?: number;
    layoutHeight?: number;
  } = {}
): StudioCompanionReferencePreviewSource {
  return {
    drawable: { marker },
    width,
    height,
    ...(options.pixels ? { pixels: options.pixels } : {}),
    ...(options.layoutWidth === undefined ? {} : { layoutWidth: options.layoutWidth }),
    ...(options.layoutHeight === undefined ? {} : { layoutHeight: options.layoutHeight }),
  };
}

function item(
  resolvedSource: StudioCompanionReferencePreviewSource | null,
  view: Partial<StudioCompanionReferencePreviewItemView> = {}
): StudioCompanionReferencePreviewItem {
  return { source: resolvedSource, view: { ...DEFAULT_VIEW, ...view } };
}

function solidPixels(
  width: number,
  height: number,
  red: number,
  green: number,
  blue: number,
  alpha = 255
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([red, green, blue, alpha], offset);
  }
  return data;
}

function rendered(
  width = 400,
  height = 200,
  canvas: StudioCompanionReferencePreviewCanvas = new FakeCanvas(width, height)
): StudioCompanionReferenceRenderedPreview {
  return { canvas, width, height, resolvedItemCount: 1 };
}

function webp(size: number, width = 400, height = 200): Blob {
  const bytes = new Uint8Array(size);
  if (size >= 30) {
    const view = new DataView(bytes.buffer);
    const writeAscii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        bytes[offset + index] = value.charCodeAt(index);
      }
    };
    writeAscii(0, "RIFF");
    view.setUint32(4, size - 8, true);
    writeAscii(8, "WEBP");
    writeAscii(12, "VP8X");
    view.setUint32(16, 10, true);
    const widthMinusOne = width - 1;
    const heightMinusOne = height - 1;
    bytes.set([
      widthMinusOne & 0xff,
      (widthMinusOne >>> 8) & 0xff,
      (widthMinusOne >>> 16) & 0xff,
      heightMinusOne & 0xff,
      (heightMinusOne >>> 8) & 0xff,
      (heightMinusOne >>> 16) & 0xff,
    ], 24);
  }
  return new Blob([bytes], { type: "image/webp" });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("reference preview dimension and composition bounds", () => {
  it("fits both longest-edge and total-pixel projection limits", () => {
    expect(fitStudioCompanionReferencePreviewDimensions(2_560, 720))
      .toEqual({ width: 1_280, height: 360 });
    expect(fitStudioCompanionReferencePreviewDimensions(2_000, 2_000))
      .toEqual({ width: 1_108, height: 1_108 });
    const fitted = fitStudioCompanionReferencePreviewDimensions(99_999, 71_111);
    expect(Math.max(fitted?.width ?? 0, fitted?.height ?? 0))
      .toBeLessThanOrEqual(STUDIO_COMPANION_REFERENCE_MAX_EDGE);
    expect((fitted?.width ?? 0) * (fitted?.height ?? 0))
      .toBeLessThanOrEqual(STUDIO_COMPANION_REFERENCE_MAX_PIXELS);
    expect(fitStudioCompanionReferencePreviewDimensions(Number.NaN, 100)).toBeNull();
    expect(fitStudioCompanionReferencePreviewDimensions(0, 100)).toBeNull();
  });

  it("renders items back-to-front with centered contain, opacity, grayscale and CSS transforms", () => {
    const context = new FakeContext();
    const canvas = new FakeCanvas(1, 1, context);
    const back = source("back", 200, 100);
    const front = source("front", 100, 100);
    const result = renderStudioCompanionReferencePreview({
      boardWidth: 400,
      boardHeight: 400,
      items: [
        item(back, {
          centerX: 0.25,
          centerY: 0.75,
          zoom: 2,
          rotationDeg: 90,
          flipX: true,
          opacity: 0.4,
          grayscale: true,
        }),
        item(front),
      ],
    }, { createCanvas: () => canvas });

    expect(result).toMatchObject({ width: 400, height: 400, resolvedItemCount: 2 });
    expect(context.clearCount).toBe(1);
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(context.translations).toEqual([[100, 300], [200, 200]]);
    expect(context.rotations[0]).toBeCloseTo(Math.PI / 2);
    expect(context.scales).toEqual([[-2, 2], [1, 1]]);
    expect(context.draws).toEqual([
      {
        image: back.drawable,
        destination: [-108, -54, 216, 108],
        alpha: 0.4,
        filter: "grayscale(1)",
      },
      {
        image: front.drawable,
        destination: [-108, -108, 216, 216],
        alpha: 1,
        filter: "none",
      },
    ]);
    expect(context.saveCount).toBe(2);
    expect(context.restoreCount).toBe(2);
  });

  it("skips unresolved sources without disturbing resolved z-order", () => {
    const context = new FakeContext();
    const resolved = source("resolved", 10, 10);
    const result = renderStudioCompanionReferencePreview({
      boardWidth: 200,
      boardHeight: 100,
      items: [item(null), item(resolved), item(null)],
    }, { createCanvas: () => new FakeCanvas(200, 100, context) });

    expect(result?.resolvedItemCount).toBe(1);
    expect(context.draws.map((entry) => entry.image)).toEqual([resolved.drawable]);
  });

  it("fails closed for invalid geometry, context setup and any item draw failure", () => {
    const valid = source("valid", 10, 10);
    const factory = () => new FakeCanvas(100, 100);
    expect(renderStudioCompanionReferencePreview({
      boardWidth: 100,
      boardHeight: 100,
      items: [item(valid, { zoom: 0 })],
    }, { createCanvas: factory })).toBeNull();
    expect(renderStudioCompanionReferencePreview({
      boardWidth: 100,
      boardHeight: 100,
      items: [{ ...item(valid), id: "must-not-cross-boundary" } as StudioCompanionReferencePreviewItem],
    }, { createCanvas: factory })).toBeNull();
    expect(renderStudioCompanionReferencePreview({
      boardWidth: 100,
      boardHeight: 100,
      items: [item(valid)],
    }, { createCanvas: () => new FakeCanvas(100, 100, null) })).toBeNull();

    const context = new FakeContext();
    context.failDrawAt = 2;
    expect(renderStudioCompanionReferencePreview({
      boardWidth: 100,
      boardHeight: 100,
      items: [item(valid), item(source("second", 10, 10))],
    }, { createCanvas: () => new FakeCanvas(100, 100, context) })).toBeNull();
    expect(context.draws).toHaveLength(1);
    expect(context.restoreCount).toBe(2);
  });

  it("fails closed for hostile typed-array brands and aggregate RGBA pressure", () => {
    const pixels = new Uint8ClampedArray(2_048 * 2_048 * 4);
    const large = source("large", 2_048, 2_048, { pixels });
    expect(STUDIO_COMPANION_REFERENCE_MAX_RGBA_BYTES).toBe(32 * 1024 * 1024);
    expect(renderStudioCompanionReferencePreview({
      boardWidth: 100,
      boardHeight: 100,
      items: [item(large), item(large), item(large)],
    }, { createCanvas: () => new FakeCanvas(100, 100) })).toBeNull();

    const hostilePixels = new Proxy(solidPixels(1, 1, 1, 2, 3), {
      getPrototypeOf() {
        throw new Error("typed-array brand trap");
      },
    });
    const hostile = source("hostile", 1, 1, {
      pixels: hostilePixels as Uint8ClampedArray,
    });
    expect(() => renderStudioCompanionReferencePreview({
      boardWidth: 100,
      boardHeight: 100,
      items: [item(hostile)],
    }, { createCanvas: () => new FakeCanvas(100, 100) })).not.toThrow();
    expect(renderStudioCompanionReferencePreview({
      boardWidth: 100,
      boardHeight: 100,
      items: [item(hostile)],
    }, { createCanvas: () => new FakeCanvas(100, 100) })).toBeNull();

    const throwingByteLength = solidPixels(1, 1, 1, 2, 3);
    Object.defineProperty(throwingByteLength, "byteLength", {
      configurable: true,
      get() {
        throw new Error("ordinary byteLength access is forbidden");
      },
    });
    expect(() => renderStudioCompanionReferencePreview({
      boardWidth: 100,
      boardHeight: 100,
      items: [item(source("intrinsic-length", 1, 1, { pixels: throwingByteLength }))],
    }, { createCanvas: () => new FakeCanvas(100, 100) })).not.toThrow();

    const throwingLength = solidPixels(1, 1, 1, 2, 3);
    Object.defineProperty(throwingLength, "length", {
      configurable: true,
      get() {
        throw new Error("ordinary length access is forbidden");
      },
    });
    expect(sampleStudioCompanionReferenceColor(
      [item(source("intrinsic-sample", 1, 1, { pixels: throwingLength }))],
      { x: 0.5, y: 0.5 },
      100,
      100
    )).toBe("#010203");
  });
});

describe("bounded reference preview WebP encoding", () => {
  it("reduces quality first and accepts an exact stricter byte boundary", async () => {
    const calls: Array<{ width: number; quality: number }> = [];
    const encodeCanvas = vi.fn((canvas: StudioCompanionReferencePreviewCanvas, options: {
      type: "image/webp";
      quality: number;
    }) => {
      calls.push({ width: canvas.width, quality: options.quality });
      return webp(calls.length === 1 ? 41 : 40);
    });

    const result = await encodeStudioCompanionReferencePreviewWebp(
      rendered(),
      { maximumBytes: 40 },
      { encodeCanvas }
    );

    expect(calls).toEqual([
      { width: 400, quality: STUDIO_COMPANION_REFERENCE_WEBP_QUALITIES[0] },
      { width: 400, quality: STUDIO_COMPANION_REFERENCE_WEBP_QUALITIES[1] },
    ]);
    expect(result).toMatchObject({ width: 400, height: 200, resolvedItemCount: 1 });
    expect(result?.blob.size).toBe(40);
  });

  it("falls back to smaller dimensions only after every original-size quality is oversized", async () => {
    const calls: Array<{ width: number; height: number; quality: number }> = [];
    const resizedCanvases: FakeCanvas[] = [];
    const initial = rendered();
    const result = await encodeStudioCompanionReferencePreviewWebp(
      initial,
      { maximumBytes: 40 },
      {
        createCanvas: (width, height) => {
          const canvas = new FakeCanvas(width, height);
          resizedCanvases.push(canvas);
          return canvas;
        },
        encodeCanvas: (canvas, options) => {
          calls.push({ width: canvas.width, height: canvas.height, quality: options.quality });
          return webp(
            canvas.width === 400 ? 41 : 40,
            canvas.width,
            canvas.height
          );
        },
      }
    );

    expect(calls.slice(0, 3).map((entry) => entry.quality))
      .toEqual([...STUDIO_COMPANION_REFERENCE_WEBP_QUALITIES]);
    expect(calls.slice(0, 3).every((entry) => entry.width === 400)).toBe(true);
    expect(calls[3]).toEqual({
      width: Math.floor(400 * STUDIO_COMPANION_REFERENCE_WEBP_RESIZE_SCALE),
      height: Math.floor(200 * STUDIO_COMPANION_REFERENCE_WEBP_RESIZE_SCALE),
      quality: STUDIO_COMPANION_REFERENCE_WEBP_QUALITIES.at(-1),
    });
    expect(result).toMatchObject({ width: 312, height: 156 });
    expect(result?.blob.size).toBe(40);
    expect(resizedCanvases[0]?.context?.draws[0]?.image).toBe(initial.canvas);
  });

  it("rejects wrong MIME, empty, failed and over-budget final encodes", async () => {
    const badMime = new Blob([new Uint8Array(4)], { type: "image/png" });
    await expect(encodeStudioCompanionReferencePreviewWebp(
      rendered(),
      {},
      { encodeCanvas: () => badMime }
    )).resolves.toBeNull();
    await expect(encodeStudioCompanionReferencePreviewWebp(
      rendered(),
      {},
      { encodeCanvas: () => new Blob([], { type: "image/webp" }) }
    )).resolves.toBeNull();
    await expect(encodeStudioCompanionReferencePreviewWebp(
      rendered(),
      {},
      { encodeCanvas: () => Promise.reject(new Error("encoder failed")) }
    )).resolves.toBeNull();
    await expect(encodeStudioCompanionReferencePreviewWebp(
      rendered(),
      { maximumBytes: 1 },
      { encodeCanvas: () => webp(2), createCanvas: (width, height) => new FakeCanvas(width, height) }
    )).resolves.toBeNull();
    expect(STUDIO_COMPANION_REFERENCE_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it("returns null when an injected deadline expires around a hanging encoder", async () => {
    let scheduled: (() => void) | null = null;
    let settleEncode: ((blob: Blob | null) => void) | null = null;
    const cancel = vi.fn();
    const pending = encodeStudioCompanionReferencePreviewWebp(
      rendered(),
      { timeoutMs: 50 },
      {
        encodeCanvas: () => new Promise<Blob | null>((resolve) => {
          settleEncode = resolve;
        }),
        clock: {
          now: () => 100,
          schedule: (callback) => {
            scheduled = callback;
            return "deadline";
          },
          cancel,
        },
      }
    );
    await Promise.resolve();
    expect(scheduled).not.toBeNull();
    (scheduled as unknown as () => void)();
    await expect(pending).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledWith("deadline");
    expect(settleEncode).not.toBeNull();
    (settleEncode as unknown as (blob: Blob | null) => void)(webp(64));
    await Promise.resolve();
    await Promise.resolve();
  });

  it("rejects an already-aborted capture before allocating its staging canvas", async () => {
    const controller = new AbortController();
    controller.abort();
    const createCanvas = vi.fn((width: number, height: number) => new FakeCanvas(width, height));
    const encodeCanvas = vi.fn(() => webp(64, 320, 180));

    await expect(createStudioCompanionReferencePreview({
      boardWidth: 320,
      boardHeight: 180,
      items: [item(source("already-aborted", 4, 2))],
    }, { signal: controller.signal }, { createCanvas, encodeCanvas })).resolves.toBeNull();

    expect(createCanvas).not.toHaveBeenCalled();
    expect(encodeCanvas).not.toHaveBeenCalled();
  });

  it("rejects a deadline exhausted before compositing without allocating a canvas", async () => {
    const createCanvas = vi.fn((width: number, height: number) => new FakeCanvas(width, height));
    const encodeCanvas = vi.fn(() => webp(64, 320, 180));
    const now = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValue(150);

    await expect(createStudioCompanionReferencePreview({
      boardWidth: 320,
      boardHeight: 180,
      items: [item(source("expired-before-render", 4, 2))],
    }, { timeoutMs: 50 }, {
      createCanvas,
      encodeCanvas,
      clock: { now, schedule: vi.fn(), cancel: vi.fn() },
    })).resolves.toBeNull();

    expect(createCanvas).not.toHaveBeenCalled();
    expect(encodeCanvas).not.toHaveBeenCalled();
  });

  it("quarantines a hanging custom encoder per stable scope and resumes after late settle", async () => {
    let settleFirst: ((blob: Blob | null) => void) | null = null;
    const encodeCanvas = vi.fn(() => {
      if (encodeCanvas.mock.calls.length === 1) {
        return new Promise<Blob | null>((resolve) => {
          settleFirst = resolve;
        });
      }
      return Promise.resolve(webp(64, 320, 180));
    });
    const createCanvas = vi.fn((width: number, height: number) => new FakeCanvas(width, height));
    const scheduled: Array<() => void> = [];
    const dependencies = {
      createCanvas,
      encodeCanvas,
      encoderScope: {},
      clock: {
        now: () => 100,
        schedule: (callback: () => void) => {
          scheduled.push(callback);
          return `custom-deadline-${scheduled.length}`;
        },
        cancel: vi.fn(),
      },
    };
    const input = {
      boardWidth: 320,
      boardHeight: 180,
      items: [item(source("custom-scope", 4, 2))],
    };

    const first = createStudioCompanionReferencePreview(
      input,
      { timeoutMs: 50 },
      dependencies
    );
    await Promise.resolve();
    scheduled[0]?.();
    await expect(first).resolves.toBeNull();

    await expect(createStudioCompanionReferencePreview(
      input,
      { timeoutMs: 50 },
      dependencies
    )).resolves.toBeNull();
    expect(createCanvas).toHaveBeenCalledOnce();
    expect(encodeCanvas).toHaveBeenCalledOnce();

    expect(settleFirst).not.toBeNull();
    (settleFirst as unknown as (blob: Blob | null) => void)(webp(64, 320, 180));
    await Promise.resolve();
    await Promise.resolve();

    await expect(createStudioCompanionReferencePreview(
      input,
      { timeoutMs: 50 },
      dependencies
    )).resolves.toMatchObject({ width: 320, height: 180 });
    expect(createCanvas).toHaveBeenCalledTimes(2);
    expect(encodeCanvas).toHaveBeenCalledTimes(2);
  });

  it("bounds quarantined native encoders while allowing an independent second scope", async () => {
    const settleNative: Array<(blob: Blob | null) => void> = [];
    const createCanvas = vi.fn((width: number, height: number) => {
      const canvas = new FakeCanvas(width, height);
      canvas.convertToBlob = () => new Promise<Blob | null>((resolve) => {
        settleNative.push(resolve);
      }) as Promise<Blob>;
      return canvas;
    });
    const scheduled: Array<() => void> = [];
    const dependencies = {
      createCanvas,
      clock: {
        now: () => 100,
        schedule: (callback: () => void) => {
          scheduled.push(callback);
          return `bounded-deadline-${scheduled.length}`;
        },
        cancel: vi.fn(),
      },
    };
    const makeInput = (marker: string) => ({
      boardWidth: 320,
      boardHeight: 180,
      items: [item(source(marker, 4, 2))],
    });

    const first = createStudioCompanionReferencePreview(
      makeInput("native-scope-a"),
      { timeoutMs: 50 },
      dependencies
    );
    const second = createStudioCompanionReferencePreview(
      makeInput("native-scope-b"),
      { timeoutMs: 50 },
      dependencies
    );
    await Promise.resolve();

    expect(STUDIO_COMPANION_REFERENCE_MAX_ENCODER_FLIGHTS).toBe(2);
    expect(createCanvas).toHaveBeenCalledTimes(2);
    expect(settleNative).toHaveLength(2);
    await expect(createStudioCompanionReferencePreview(
      makeInput("native-scope-c"),
      { timeoutMs: 50 },
      dependencies
    )).resolves.toBeNull();
    expect(createCanvas).toHaveBeenCalledTimes(2);

    scheduled[0]?.();
    scheduled[1]?.();
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    settleNative[0]?.(webp(64, 320, 180));
    settleNative[1]?.(webp(64, 320, 180));
    await Promise.resolve();
    await Promise.resolve();
  });

  it("cleans up a hostile signal that invokes its abort listener synchronously", async () => {
    const removeEventListener = vi.fn();
    const signal = {
      aborted: false,
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        listener(new Event("abort"));
      }),
      removeEventListener,
    } as unknown as AbortSignal;
    const createCanvas = vi.fn((width: number, height: number) => new FakeCanvas(width, height));
    const encodeCanvas = vi.fn(() => webp(64, 320, 180));

    await expect(createStudioCompanionReferencePreview({
      boardWidth: 320,
      boardHeight: 180,
      items: [item(source("hostile-signal", 4, 2))],
    }, { signal }, { createCanvas, encodeCanvas })).resolves.toBeNull();

    expect(createCanvas).toHaveBeenCalledOnce();
    expect(encodeCanvas).not.toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalledOnce();
  });

  it("fails closed when abort arrives while the WebP header is being verified", async () => {
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    let releaseVerification: (() => void) | null = null;
    const arrayBufferSpy = vi.spyOn(Blob.prototype, "arrayBuffer").mockImplementation(function (
      this: Blob
    ) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        releaseVerification = () => {
          Reflect.apply(originalArrayBuffer, this, []).then(resolve, reject);
        };
      });
    });
    const controller = new AbortController();
    try {
      const pending = encodeStudioCompanionReferencePreviewWebp(
        rendered(),
        { signal: controller.signal },
        { encodeCanvas: () => webp(64) }
      );
      for (let index = 0; index < 8 && releaseVerification === null; index += 1) {
        await Promise.resolve();
      }
      expect(releaseVerification).not.toBeNull();
      controller.abort();
      (releaseVerification as unknown as () => void)();
      await expect(pending).resolves.toBeNull();
    } finally {
      arrayBufferSpy.mockRestore();
    }
  });

  it("fails closed when the absolute deadline expires during WebP verification", async () => {
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    let releaseVerification: (() => void) | null = null;
    let now = 100;
    const arrayBufferSpy = vi.spyOn(Blob.prototype, "arrayBuffer").mockImplementation(function (
      this: Blob
    ) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        releaseVerification = () => {
          Reflect.apply(originalArrayBuffer, this, []).then(resolve, reject);
        };
      });
    });
    try {
      const pending = encodeStudioCompanionReferencePreviewWebp(
        rendered(),
        { timeoutMs: 50 },
        {
          encodeCanvas: () => webp(64),
          clock: {
            now: () => now,
            schedule: vi.fn(() => "verification-deadline"),
            cancel: vi.fn(),
          },
        }
      );
      for (let index = 0; index < 8 && releaseVerification === null; index += 1) {
        await Promise.resolve();
      }
      expect(releaseVerification).not.toBeNull();
      now = 150;
      (releaseVerification as unknown as () => void)();
      await expect(pending).resolves.toBeNull();
    } finally {
      arrayBufferSpy.mockRestore();
    }
  });

  it("returns promptly when abort stops a never-settling WebP verification", async () => {
    const arrayBufferSpy = vi.spyOn(Blob.prototype, "arrayBuffer").mockImplementation(() => (
      new Promise<ArrayBuffer>(() => undefined)
    ));
    const controller = new AbortController();
    const schedule = vi.fn(() => "abort-verification-deadline");
    const cancel = vi.fn();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    try {
      const pending = encodeStudioCompanionReferencePreviewWebp(
        rendered(),
        { signal: controller.signal, timeoutMs: 50 },
        {
          encodeCanvas: () => webp(64),
          clock: { now: () => 100, schedule, cancel },
        }
      );
      for (let index = 0; index < 8 && arrayBufferSpy.mock.calls.length === 0; index += 1) {
        await Promise.resolve();
      }
      expect(arrayBufferSpy).toHaveBeenCalledOnce();
      expect(schedule).toHaveBeenCalledTimes(2);

      controller.abort();
      await expect(pending).resolves.toBeNull();
      expect(cancel).toHaveBeenCalledTimes(2);
      expect(removeListener).toHaveBeenCalledTimes(2);
    } finally {
      arrayBufferSpy.mockRestore();
    }
  });

  it("returns promptly when the deadline stops a never-settling WebP verification", async () => {
    const arrayBufferSpy = vi.spyOn(Blob.prototype, "arrayBuffer").mockImplementation(() => (
      new Promise<ArrayBuffer>(() => undefined)
    ));
    const scheduled: Array<() => void> = [];
    const cancel = vi.fn();
    try {
      const pending = encodeStudioCompanionReferencePreviewWebp(
        rendered(),
        { timeoutMs: 50 },
        {
          encodeCanvas: () => webp(64),
          clock: {
            now: () => 100,
            schedule: (callback) => {
              scheduled.push(callback);
              return `verification-deadline-${scheduled.length}`;
            },
            cancel,
          },
        }
      );
      for (let index = 0; index < 8 && arrayBufferSpy.mock.calls.length === 0; index += 1) {
        await Promise.resolve();
      }
      expect(arrayBufferSpy).toHaveBeenCalledOnce();
      expect(scheduled).toHaveLength(2);

      scheduled[1]?.();
      await expect(pending).resolves.toBeNull();
      expect(cancel).toHaveBeenCalledTimes(2);
    } finally {
      arrayBufferSpy.mockRestore();
    }
  });

  it("blocks native timeout retries before staging-canvas allocation and resumes after late settle", async () => {
    let resolveFirst: ((blob: Blob) => void) | null = null;
    const nativeEncode = vi.fn(() => {
      if (nativeEncode.mock.calls.length === 1) {
        return new Promise<Blob>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(webp(64, 320, 180));
    });
    const createCanvas = vi.fn((width: number, height: number) => {
      const canvas = new FakeCanvas(width, height);
      canvas.convertToBlob = nativeEncode;
      return canvas;
    });
    const scheduled: Array<() => void> = [];
    const cancel = vi.fn();
    const clock = {
      now: () => 100,
      schedule: (callback: () => void) => {
        scheduled.push(callback);
        return `deadline-${scheduled.length}`;
      },
      cancel,
    };
    const input = {
      boardWidth: 320,
      boardHeight: 180,
      items: [item(source("reference", 4, 2))],
    };

    const first = createStudioCompanionReferencePreview(
      input,
      { timeoutMs: 50 },
      { createCanvas, clock }
    );
    await Promise.resolve();
    expect(createCanvas).toHaveBeenCalledOnce();
    expect(nativeEncode).toHaveBeenCalledOnce();
    expect(scheduled).toHaveLength(1);

    scheduled[0]?.();
    await expect(first).resolves.toBeNull();
    await expect(createStudioCompanionReferencePreview(
      input,
      { timeoutMs: 50 },
      { createCanvas, clock }
    )).resolves.toBeNull();
    expect(createCanvas).toHaveBeenCalledOnce();
    expect(nativeEncode).toHaveBeenCalledOnce();
    expect(scheduled).toHaveLength(1);
    expect(cancel).toHaveBeenCalledOnce();

    const customEncode = vi.fn(() => webp(64, 320, 180));
    const customCreateCanvas = vi.fn((width: number, height: number) => (
      new FakeCanvas(width, height)
    ));
    await expect(createStudioCompanionReferencePreview(
      input,
      { timeoutMs: 50 },
      { createCanvas: customCreateCanvas, encodeCanvas: customEncode }
    )).resolves.toMatchObject({ width: 320, height: 180 });
    expect(customCreateCanvas).toHaveBeenCalledOnce();
    expect(customEncode).toHaveBeenCalledOnce();
    expect(createCanvas).toHaveBeenCalledOnce();
    expect(nativeEncode).toHaveBeenCalledOnce();

    expect(resolveFirst).not.toBeNull();
    (resolveFirst as unknown as (blob: Blob) => void)(webp(64, 320, 180));
    await Promise.resolve();
    await Promise.resolve();

    await expect(createStudioCompanionReferencePreview(
      input,
      { timeoutMs: 50 },
      { createCanvas, clock }
    )).resolves.toMatchObject({ width: 320, height: 180 });
    expect(createCanvas).toHaveBeenCalledTimes(2);
    expect(nativeEncode).toHaveBeenCalledTimes(2);
    expect(scheduled).toHaveLength(3);
    expect(cancel).toHaveBeenCalledTimes(3);
  });

  it("keeps an aborted native encode single-flight and releases its listener before late settle", async () => {
    let resolveFirst: ((blob: Blob) => void) | null = null;
    const nativeEncode = vi.fn(() => {
      if (nativeEncode.mock.calls.length === 1) {
        return new Promise<Blob>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(webp(64, 320, 180));
    });
    const createCanvas = vi.fn((width: number, height: number) => {
      const canvas = new FakeCanvas(width, height);
      canvas.convertToBlob = nativeEncode;
      return canvas;
    });
    const schedule = vi.fn(() => "abort-deadline");
    const cancel = vi.fn();
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const input = {
      boardWidth: 320,
      boardHeight: 180,
      items: [item(source("reference", 4, 2))],
    };
    const dependencies = {
      createCanvas,
      clock: { now: () => 100, schedule, cancel },
    };

    const first = createStudioCompanionReferencePreview(
      input,
      { signal: controller.signal, timeoutMs: 50 },
      dependencies
    );
    await Promise.resolve();
    controller.abort();
    await expect(first).resolves.toBeNull();
    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();

    await expect(createStudioCompanionReferencePreview(
      input,
      { timeoutMs: 50 },
      dependencies
    )).resolves.toBeNull();
    expect(createCanvas).toHaveBeenCalledOnce();
    expect(nativeEncode).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledOnce();

    expect(resolveFirst).not.toBeNull();
    (resolveFirst as unknown as (blob: Blob) => void)(webp(64, 320, 180));
    await Promise.resolve();
    await Promise.resolve();

    await expect(createStudioCompanionReferencePreview(
      input,
      { timeoutMs: 50 },
      dependencies
    )).resolves.toMatchObject({ width: 320, height: 180 });
    expect(createCanvas).toHaveBeenCalledTimes(2);
    expect(nativeEncode).toHaveBeenCalledTimes(2);
    expect(schedule).toHaveBeenCalledTimes(3);
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it("applies the same stuck-encoder circuit to the native toBlob callback path", async () => {
    let settleFirst: ((blob: Blob | null) => void) | null = null;
    let nativeCalls = 0;
    const createCanvas = vi.fn((width: number, height: number) => {
      const canvas = new FakeCanvas(width, height);
      canvas.toBlob = (callback) => {
        nativeCalls += 1;
        if (nativeCalls === 1) settleFirst = callback;
        else callback(webp(64, 320, 180));
      };
      return canvas;
    });
    const scheduled: Array<() => void> = [];
    const cancel = vi.fn();
    const dependencies = {
      createCanvas,
      clock: {
        now: () => 100,
        schedule: (callback: () => void) => {
          scheduled.push(callback);
          return `to-blob-deadline-${scheduled.length}`;
        },
        cancel,
      },
    };
    const input = {
      boardWidth: 320,
      boardHeight: 180,
      items: [item(source("reference", 4, 2))],
    };

    const first = createStudioCompanionReferencePreview(
      input,
      { timeoutMs: 50 },
      dependencies
    );
    await Promise.resolve();
    scheduled[0]?.();
    await expect(first).resolves.toBeNull();
    await expect(createStudioCompanionReferencePreview(
      input,
      { timeoutMs: 50 },
      dependencies
    )).resolves.toBeNull();
    expect(createCanvas).toHaveBeenCalledOnce();
    expect(nativeCalls).toBe(1);

    expect(settleFirst).not.toBeNull();
    (settleFirst as unknown as (blob: Blob | null) => void)(webp(64, 320, 180));
    await Promise.resolve();
    await Promise.resolve();

    await expect(createStudioCompanionReferencePreview(
      input,
      { timeoutMs: 50 },
      dependencies
    )).resolves.toMatchObject({ width: 320, height: 180 });
    expect(createCanvas).toHaveBeenCalledTimes(2);
    expect(nativeCalls).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(3);
  });

  it("reopens the native encoder circuit after rejection without affecting injected encoders", async () => {
    const nativeEncode = vi.fn()
      .mockRejectedValueOnce(new Error("native encoder rejected"))
      .mockResolvedValueOnce(webp(64, 320, 180));
    const createCanvas = vi.fn((width: number, height: number) => {
      const canvas = new FakeCanvas(width, height);
      canvas.convertToBlob = nativeEncode;
      return canvas;
    });
    const input = {
      boardWidth: 320,
      boardHeight: 180,
      items: [item(source("reference", 4, 2))],
    };

    await expect(createStudioCompanionReferencePreview(
      input,
      {},
      { createCanvas }
    )).resolves.toBeNull();
    await expect(createStudioCompanionReferencePreview(
      input,
      {},
      { createCanvas }
    )).resolves.toMatchObject({ width: 320, height: 180 });
    expect(nativeEncode).toHaveBeenCalledTimes(2);

    const customEncode = vi.fn(() => webp(64, 320, 180));
    await expect(createStudioCompanionReferencePreview(
      input,
      {},
      {
        createCanvas: (width, height) => new FakeCanvas(width, height),
        encodeCanvas: customEncode,
      }
    )).resolves.toMatchObject({ width: 320, height: 180 });
    expect(customEncode).toHaveBeenCalledOnce();
  });

  it("uses canvas WebP methods and produces an exact validated transport frame", async () => {
    const context = new FakeContext();
    const canvas = new FakeCanvas(320, 180, context);
    const convertToBlob = vi.fn(async (options?: { type?: string; quality?: number }) => {
      expect(options?.type).toBe("image/webp");
      return webp(64, 320, 180);
    });
    canvas.convertToBlob = convertToBlob;

    const frame = await createStudioCompanionReferencePreviewFrame({
      generation: 2,
      revision: 4,
      referenceRevision: 7,
      sequence: 3,
      boardWidth: 320,
      boardHeight: 180,
      items: [item(source("reference", 4, 2))],
    }, {}, { createCanvas: () => canvas });

    expect(convertToBlob).toHaveBeenCalledOnce();
    expect(frame).toMatchObject({
      generation: 2,
      revision: 4,
      referenceRevision: 7,
      sequence: 3,
      width: 320,
      height: 180,
    });
    expect(isStudioCompanionReferencePreviewFrame(frame)).toBe(true);
  });

  it("pins frame cursor metadata before awaiting an asynchronous encoder", async () => {
    let resolveEncode: ((blob: Blob) => void) | null = null;
    const input = {
      generation: 2,
      revision: 4,
      referenceRevision: 7,
      sequence: 3,
      boardWidth: 320,
      boardHeight: 180,
      items: [item(source("reference", 4, 2))],
    };
    const pending = createStudioCompanionReferencePreviewFrame(input, {}, {
      createCanvas: (width, height) => new FakeCanvas(width, height),
      encodeCanvas: () => new Promise<Blob>((resolve) => {
        resolveEncode = resolve;
      }),
    });
    await Promise.resolve();
    input.generation = 99;
    input.revision = 99;
    input.referenceRevision = 99;
    input.sequence = 99;
    expect(resolveEncode).not.toBeNull();
    (resolveEncode as unknown as (blob: Blob) => void)(webp(64, 320, 180));

    await expect(pending).resolves.toMatchObject({
      generation: 2,
      revision: 4,
      referenceRevision: 7,
      sequence: 3,
    });
  });
});

describe("authoritative reference preview color sampling", () => {
  it("samples the epoch-owned RGBA buffer without cloning the full raster", () => {
    const pixels = solidPixels(64, 64, 12, 34, 56);
    const setSpy = vi.spyOn(Uint8ClampedArray.prototype, "set");
    try {
      expect(sampleStudioCompanionReferenceColor(
        [item(source("zero-copy", 64, 64, { pixels }))],
        { x: 0.5, y: 0.5 },
        100,
        100
      )).toBe("#0c2238");
      expect(setSpy).not.toHaveBeenCalled();
    } finally {
      setSpy.mockRestore();
    }
  });

  it("walks front-to-back, falls through transparent pixels and ignores display grayscale", () => {
    const behind = source("behind", 2, 2, { pixels: solidPixels(2, 2, 0, 0, 255) });
    const transparentFrontPixels = solidPixels(2, 2, 255, 0, 0);
    transparentFrontPixels.set([255, 0, 0, 0], 12);
    const transparentFront = source("front-transparent", 2, 2, {
      pixels: transparentFrontPixels,
    });
    expect(sampleStudioCompanionReferenceColor(
      [item(behind), item(transparentFront)],
      { x: 0.5, y: 0.5 },
      100,
      100
    )).toBe("#0000ff");

    const redFront = source("front-red", 2, 2, { pixels: solidPixels(2, 2, 255, 0, 0) });
    expect(sampleStudioCompanionReferenceColor(
      [item(behind), item(redFront, { opacity: 0.25, grayscale: true })],
      { x: 0.5, y: 0.5 },
      100,
      100
    )).toBe("#ff0000");
    expect(sampleStudioCompanionReferenceColor(
      [item(behind), item(redFront, { opacity: 0 })],
      { x: 0.5, y: 0.5 },
      100,
      100
    )).toBe("#0000ff");
  });

  it("uses inverse rotation and falls through object-contain letterbox misses", () => {
    const rotatedPixels = Uint8ClampedArray.from([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]);
    const rotated = source("rotated", 2, 1, { pixels: rotatedPixels });
    expect(sampleStudioCompanionReferenceColor(
      [item(rotated, { rotationDeg: 90 })],
      { x: 0.5, y: 0.7 },
      100,
      100
    )).toBe("#00ff00");

    const behind = source("behind-square", 1, 1, {
      pixels: solidPixels(1, 1, 0, 0, 255),
    });
    const letterboxed = source("front-wide", 2, 1, {
      pixels: solidPixels(2, 1, 255, 0, 0),
      layoutWidth: 1,
      layoutHeight: 1,
    });
    expect(sampleStudioCompanionReferenceColor(
      [item(behind), item(letterboxed)],
      { x: 0.5, y: 0.25 },
      100,
      100
    )).toBe("#0000ff");
  });

  it("skips unresolved/no-pixel sources and rejects invalid normalized points", () => {
    const sampled = source("sampled", 1, 1, { pixels: solidPixels(1, 1, 1, 2, 3) });
    expect(sampleStudioCompanionReferenceColor(
      [item(sampled), item(null), item(source("display-only", 1, 1))],
      { x: 0.5, y: 0.5 },
      100,
      100
    )).toBe("#010203");
    expect(sampleStudioCompanionReferenceColor(
      [item(sampled)],
      { x: 1.01, y: 0.5 },
      100,
      100
    )).toBeNull();
  });
});
