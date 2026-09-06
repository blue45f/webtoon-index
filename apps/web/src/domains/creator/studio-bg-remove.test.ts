/** @vitest-environment jsdom */

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import {
  STUDIO_BG_REMOVE_MAX_DECODED_AXIS,
  STUDIO_BG_REMOVE_MAX_DECODED_PIXELS,
  composeForegroundPixelAlpha,
  createStudioLocalForegroundConfidenceProvider,
  getLocalForegroundConfidenceMask,
  getStudioLocalForegroundSegmenterRuntime,
  removeBackground,
  type StudioForegroundMaskResource,
  type StudioForegroundSegmentationResult,
  type StudioLocalForegroundSegmenterRuntime,
} from "./studio-bg-remove";

const mediaPipeMocks = vi.hoisted(() => ({
  createFromOptions: vi.fn(),
  isSimdSupported: vi.fn(),
}));

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: {
    isSimdSupported: mediaPipeMocks.isSimdSupported,
  },
  ImageSegmenter: {
    createFromOptions: mediaPipeMocks.createFromOptions,
  },
}));

interface ControlledImage {
  crossOrigin: string | null;
  height: number;
  naturalHeight: number;
  naturalWidth: number;
  onerror: ((event: Event) => void) | null;
  onload: ((event: Event) => void) | null;
  src: string;
  width: number;
}

function installControlledImage({
  width = 2,
  height = 1,
  naturalWidth = width,
  naturalHeight = height,
}: {
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
} = {}): ControlledImage[] {
  const instances: ControlledImage[] = [];

  class ImageMock implements ControlledImage {
    crossOrigin: string | null = null;
    height = height;
    naturalHeight = naturalHeight;
    naturalWidth = naturalWidth;
    onerror: ((event: Event) => void) | null = null;
    onload: ((event: Event) => void) | null = null;
    src = "";
    width = width;

    constructor() {
      instances.push(this);
    }
  }

  vi.stubGlobal("Image", ImageMock);
  return instances;
}

function decodedImage(width = 2, height = 1): HTMLImageElement {
  return {
    width,
    height,
    naturalWidth: width,
    naturalHeight: height,
  } as HTMLImageElement;
}

function maskResource(
  width: number,
  height: number,
  values: Float32Array,
): StudioForegroundMaskResource & {
  readonly close: Mock<() => void>;
  readonly getAsFloat32Array: Mock<() => Float32Array>;
} {
  return {
    width,
    height,
    getAsFloat32Array: vi.fn<() => Float32Array>(() => values),
    close: vi.fn<() => void>(),
  };
}

function segmentationResult(
  confidenceMasks: readonly StudioForegroundMaskResource[],
  categoryMask?: StudioForegroundMaskResource,
): StudioForegroundSegmentationResult & {
  readonly close: Mock<() => void>;
} {
  return {
    confidenceMasks,
    categoryMask,
    close: vi.fn<() => void>(),
  };
}

function runtime(
  segment: StudioLocalForegroundSegmenterRuntime["segmenter"]["segment"],
  activeDelegate: "GPU" | "CPU" = "GPU",
): StudioLocalForegroundSegmenterRuntime {
  return {
    segmenter: { segment },
    selectedDelegate: activeDelegate,
    activeDelegate,
    providerSelection: activeDelegate === "GPU"
      ? "product-default-gpu"
      : "explicit-before-execution",
    attemptedDelegates: [activeDelegate],
  };
}

function rgbaWithAlpha(alpha: readonly number[]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(alpha.length * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    rgba[index * 4] = 10 + index;
    rgba[index * 4 + 1] = 20 + index;
    rgba[index * 4 + 2] = 30 + index;
    rgba[index * 4 + 3] = alpha[index]!;
  }
  return rgba;
}

function mockCanvas2dContext(context: CanvasRenderingContext2D | null) {
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((
    ((contextId: string) => contextId === "2d" ? context : null) as
      typeof HTMLCanvasElement.prototype.getContext
  ));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mediaPipeMocks.createFromOptions.mockReset();
  mediaPipeMocks.isSimdSupported.mockReset();
});

describe("foreground pixel-alpha composition", () => {
  it("multiplies source alpha and nearest-neighbour resamples a smaller mask", () => {
    const sourceRgba = rgbaWithAlpha([
      255, 128, 64, 0,
      200, 100, 50, 25,
    ]);
    const result = composeForegroundPixelAlpha({
      sourceWidth: 4,
      sourceHeight: 2,
      sourceRgba,
      confidenceMask: {
        width: 2,
        height: 1,
        confidence: new Float32Array([0.25, 0.75]),
      },
      threshold: 0.2,
    });

    expect([...result.alpha]).toEqual([
      64, 32, 48, 0,
      50, 25, 38, 19,
    ]);
    expect(result.alpha).not.toBe(sourceRgba);
    expect([...sourceRgba.filter((_, index) => index % 4 === 3)])
      .toEqual([255, 128, 64, 0, 200, 100, 50, 25]);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0.01,
    1.01,
  ])("rejects a non-finite or out-of-range threshold (%s)", (threshold) => {
    expect(() => composeForegroundPixelAlpha({
      sourceWidth: 1,
      sourceHeight: 1,
      sourceRgba: rgbaWithAlpha([255]),
      confidenceMask: {
        width: 1,
        height: 1,
        confidence: new Float32Array([1]),
      },
      threshold,
    })).toThrow(/임계값/u);
  });

  it("fails closed for unsafe dimensions, buffer lengths, and confidence values", () => {
    const validMask = {
      width: 1,
      height: 1,
      confidence: new Float32Array([1]),
    };
    expect(() => composeForegroundPixelAlpha({
      sourceWidth: STUDIO_BG_REMOVE_MAX_DECODED_AXIS + 1,
      sourceHeight: 1,
      sourceRgba: new Uint8ClampedArray(4),
      confidenceMask: validMask,
    })).toThrow(/한 축/u);
    expect(() => composeForegroundPixelAlpha({
      sourceWidth: STUDIO_BG_REMOVE_MAX_DECODED_AXIS,
      sourceHeight:
        Math.floor(
          STUDIO_BG_REMOVE_MAX_DECODED_PIXELS
            / STUDIO_BG_REMOVE_MAX_DECODED_AXIS,
        ) + 1,
      sourceRgba: new Uint8ClampedArray(4),
      confidenceMask: validMask,
    })).toThrow(/픽셀 수/u);
    expect(() => composeForegroundPixelAlpha({
      sourceWidth: 2,
      sourceHeight: 1,
      sourceRgba: new Uint8ClampedArray(4),
      confidenceMask: validMask,
    })).toThrow(/RGBA 버퍼 길이/u);

    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -0.1,
      1.1,
    ]) {
      expect(() => composeForegroundPixelAlpha({
        sourceWidth: 1,
        sourceHeight: 1,
        sourceRgba: rgbaWithAlpha([255]),
        confidenceMask: {
          width: 1,
          height: 1,
          confidence: new Float32Array([value]),
        },
      })).toThrow(/신뢰도/u);
    }
  });
});

describe("local foreground confidence provider", () => {
  it("returns a defensive confidence snapshot and closes every result resource", async () => {
    const backgroundValues = new Float32Array([0.9, 0.2]);
    const foregroundValues = new Float32Array([0.1, 0.8]);
    const expectedForeground = new Float32Array(foregroundValues);
    const background = maskResource(2, 1, backgroundValues);
    const foreground = maskResource(2, 1, foregroundValues);
    const category = maskResource(2, 1, new Float32Array([0, 1]));
    const result = segmentationResult([background, foreground], category);
    const segment = vi.fn(() => result);
    const provider = createStudioLocalForegroundConfidenceProvider({
      loadImage: async () => decodedImage(),
      loadRuntime: async () => runtime(segment),
    });

    const extracted = await provider.getForegroundConfidenceMask("data:image/png;base64,AA==");

    expect(extracted).toMatchObject({
      width: 2,
      height: 1,
      sourceWidth: 2,
      sourceHeight: 1,
      receipt: {
        providerId: "mediapipe-image-segmenter",
        execution: "local-device",
        imageUpload: false,
        selectedDelegate: "GPU",
        providerSelection: "product-default-gpu",
        attemptedDelegates: ["GPU"],
        activeDelegate: "GPU",
      },
    });
    expect(extracted.confidence).toEqual(foregroundValues);
    expect(extracted.confidence).not.toBe(foregroundValues);
    foregroundValues.fill(0);
    expect(extracted.confidence).toEqual(expectedForeground);
    expect(background.close).toHaveBeenCalledTimes(1);
    expect(foreground.close).toHaveBeenCalledTimes(1);
    expect(category.close).toHaveBeenCalledTimes(1);
    expect(result.close).toHaveBeenCalledTimes(1);
  });

  it("closes every resource when mask admission fails", async () => {
    const background = maskResource(1, 1, new Float32Array([0.5]));
    const malformed = maskResource(1, 1, new Float32Array([Number.NaN]));
    const category = maskResource(1, 1, new Float32Array([0]));
    const result = segmentationResult([background, malformed], category);
    const provider = createStudioLocalForegroundConfidenceProvider({
      loadImage: async () => decodedImage(1, 1),
      loadRuntime: async () => runtime(() => result),
    });

    await expect(
      provider.getForegroundConfidenceMask("data:image/png;base64,AA=="),
    ).rejects.toThrow(/신뢰도/u);
    expect(background.close).toHaveBeenCalledTimes(1);
    expect(malformed.close).toHaveBeenCalledTimes(1);
    expect(category.close).toHaveBeenCalledTimes(1);
    expect(result.close).toHaveBeenCalledTimes(1);
  });

  it("checks cancellation before work and immediately after synchronous segmentation", async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    const loadImage = vi.fn(async () => decodedImage(1, 1));
    const loadRuntime = vi.fn(async () => runtime(vi.fn()));
    const provider = createStudioLocalForegroundConfidenceProvider({
      loadImage,
      loadRuntime,
    });

    await expect(provider.getForegroundConfidenceMask(
      "data:image/png;base64,AA==",
      { signal: preAborted.signal },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(loadImage).not.toHaveBeenCalled();
    expect(loadRuntime).not.toHaveBeenCalled();

    const controller = new AbortController();
    const foreground = maskResource(1, 1, new Float32Array([1]));
    const result = segmentationResult([foreground]);
    const staleProvider = createStudioLocalForegroundConfidenceProvider({
      loadImage: async () => decodedImage(1, 1),
      loadRuntime: async () => runtime(() => {
        controller.abort();
        return result;
      }),
    });
    await expect(staleProvider.getForegroundConfidenceMask(
      "data:image/png;base64,AA==",
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(foreground.getAsFloat32Array).not.toHaveBeenCalled();
    expect(foreground.close).toHaveBeenCalledTimes(1);
    expect(result.close).toHaveBeenCalledTimes(1);
  });

  it("aborts DOM image loading, clears its source, and never segments", async () => {
    const images = installControlledImage();
    const segment = vi.fn();
    const provider = createStudioLocalForegroundConfidenceProvider({
      loadRuntime: async () => runtime(segment),
    });
    const controller = new AbortController();
    const pending = provider.getForegroundConfidenceMask(
      "https://assets.example.test/character.png",
      { signal: controller.signal },
    );

    expect(images).toHaveLength(1);
    expect(images[0]!.crossOrigin).toBe("anonymous");
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(images[0]!.src).toBe("");
    expect(segment).not.toHaveBeenCalled();
  });

  it("rejects decoded-image budgets before dispatching segmentation", async () => {
    const segment = vi.fn();
    const provider = createStudioLocalForegroundConfidenceProvider({
      loadImage: async () =>
        decodedImage(STUDIO_BG_REMOVE_MAX_DECODED_AXIS + 1, 1),
      loadRuntime: async () => runtime(segment),
    });

    await expect(
      provider.getForegroundConfidenceMask("data:image/png;base64,AA=="),
    ).rejects.toThrow(/한 축/u);
    expect(segment).not.toHaveBeenCalled();
  });
});

describe("MediaPipe adapter and legacy wrapper", () => {
  const defaultSegmenter = {
    segment: vi.fn(),
  };

  it("fails the default GPU provider without retrying CPU", async () => {
    const images = installControlledImage({ width: 1, height: 1 });
    mediaPipeMocks.isSimdSupported.mockResolvedValue(false);
    mediaPipeMocks.createFromOptions.mockImplementation(
      async (_vision: unknown, options: unknown) => {
        const delegate = (
          options as { baseOptions: { delegate: "GPU" | "CPU" } }
        ).baseOptions.delegate;
        if (delegate === "GPU") throw new Error("GPU delegate unavailable");
        return defaultSegmenter;
      },
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const pending = getLocalForegroundConfidenceMask(
      "data:image/png;base64,AA==",
    );
    images[0]!.onload?.(new Event("load"));
    await expect(pending).rejects.toThrow();

    expect(mediaPipeMocks.createFromOptions.mock.calls.map(([, options]) =>
      (options as { baseOptions: { delegate: string } }).baseOptions.delegate,
    )).toEqual(["GPU"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses CPU only through a provider selected explicitly before image work", async () => {
    const foregroundValues = new Float32Array([0.8]);
    const foreground = maskResource(1, 1, foregroundValues);
    const result = segmentationResult([foreground]);
    defaultSegmenter.segment.mockReturnValue(result);
    mediaPipeMocks.isSimdSupported.mockResolvedValue(false);
    mediaPipeMocks.createFromOptions.mockResolvedValue(defaultSegmenter);
    const loadImage = vi.fn(async () => decodedImage(1, 1));
    const provider = createStudioLocalForegroundConfidenceProvider({
      delegate: "CPU",
      loadImage,
    });

    const extracted = await provider.getForegroundConfidenceMask(
      "data:image/png;base64,AA==",
    );

    expect(loadImage).toHaveBeenCalledOnce();
    expect(mediaPipeMocks.createFromOptions.mock.calls.map(([, options]) =>
      (options as { baseOptions: { delegate: string } }).baseOptions.delegate,
    )).toEqual(["CPU"]);
    expect(extracted.receipt).toMatchObject({
      providerId: "mediapipe-image-segmenter",
      providerVersion: "0.10.35",
      model: {
        id: "selfie-segmenter",
        format: "tflite-float16",
        revision: "latest",
      },
      execution: "local-device",
      imageUpload: false,
      selectedDelegate: "CPU",
      providerSelection: "explicit-before-execution",
      attemptedDelegates: ["CPU"],
      activeDelegate: "CPU",
    });
    expect("fallback" in extracted.receipt).toBe(false);
    expect(extracted.confidence).not.toBe(foregroundValues);
    expect(foreground.close).toHaveBeenCalledTimes(1);
    expect(result.close).toHaveBeenCalledTimes(1);
  });

  it("validates the legacy threshold before loading an image or allocating a canvas", async () => {
    const images = installControlledImage();
    const createElement = vi.spyOn(document, "createElement");

    await expect(removeBackground(
      "data:image/png;base64,AA==",
      { threshold: Number.NaN },
    )).rejects.toThrow(/임계값/u);
    expect(images).toHaveLength(0);
    expect(createElement).not.toHaveBeenCalled();
  });

  it("rejects an oversized decoded image before canvas and ImageData allocation", async () => {
    defaultSegmenter.segment.mockClear();
    mediaPipeMocks.isSimdSupported.mockResolvedValue(false);
    mediaPipeMocks.createFromOptions.mockResolvedValue(defaultSegmenter);
    await getStudioLocalForegroundSegmenterRuntime();
    const images = installControlledImage({
      width: STUDIO_BG_REMOVE_MAX_DECODED_AXIS + 1,
      height: 1,
    });
    const createElement = vi.spyOn(document, "createElement");
    const pending = removeBackground("data:image/png;base64,AA==");
    images[0]!.onload?.(new Event("load"));

    await expect(pending).rejects.toThrow(/한 축/u);
    expect(defaultSegmenter.segment).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
  });

  it("preserves the PNG wrapper, default threshold, mask sampling, and source alpha", async () => {
    defaultSegmenter.segment.mockClear();
    const images = installControlledImage({ width: 2, height: 1 });
    const foreground = maskResource(
      2,
      1,
      new Float32Array([0.75, 0.6]),
    );
    const result = segmentationResult([foreground]);
    defaultSegmenter.segment.mockReturnValue(result);
    const imageData = {
      data: new Uint8ClampedArray([
        10, 20, 30, 128,
        40, 50, 60, 255,
      ]),
      width: 2,
      height: 1,
      colorSpace: "srgb",
    } as ImageData;
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => imageData),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    mockCanvas2dContext(context);
    const toDataUrl = vi.spyOn(
      HTMLCanvasElement.prototype,
      "toDataURL",
    ).mockReturnValue("data:image/png;base64,foreground");

    const pending = removeBackground("data:image/png;base64,AA==");
    images[0]!.onload?.(new Event("load"));

    await expect(pending).resolves.toBe(
      "data:image/png;base64,foreground",
    );
    expect([...imageData.data]).toEqual([
      10, 20, 30, 96,
      40, 50, 60, 153,
    ]);
    expect(context.drawImage).toHaveBeenCalledWith(
      images[0],
      0,
      0,
      2,
      1,
    );
    expect(context.putImageData).toHaveBeenCalledWith(imageData, 0, 0);
    expect(toDataUrl).toHaveBeenCalledWith("image/png");
    expect(foreground.close).toHaveBeenCalledTimes(1);
    expect(result.close).toHaveBeenCalledTimes(1);
  });
});
