import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PSD_IMPORTED_MASK_MAX_FEATHER_PX,
  applyPsdMaskDensity,
  convertPsdMaskPixelsToStudioAlpha,
  planPsdLayerMaskRaster,
  rasterizePsdLayerMasks,
} from "./studio-psd-mask-import";

import type { PsdLayerMaskRasterInput } from "./studio-psd-mask-import";
import type { LayerMaskData, PixelArray, PixelData } from "ag-psd";

function maskWithPixels(
  data: PixelArray,
  width: number,
  height: number,
  overrides: Partial<LayerMaskData> = {},
): LayerMaskData {
  return {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    imageData: { data, width, height },
    ...overrides,
  };
}

function rgba8(samples: readonly number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(samples.flatMap((sample) => [sample, sample, sample, 255]));
}

interface FakeCanvasOptions {
  createElementThrows?: boolean;
  drawImageThrows?: boolean;
  toDataUrlThrows?: boolean;
  toDataUrlValue?: string;
}

class AlphaCanvas {
  private pixelData = new Uint8ClampedArray(0);
  private pixelWidth = 0;
  private pixelHeight = 0;
  readonly context: AlphaCanvasContext;

  constructor(
    private readonly options: FakeCanvasOptions,
    filterAssignments: string[],
  ) {
    this.context = new AlphaCanvasContext(this, options, filterAssignments);
  }

  get width(): number {
    return this.pixelWidth;
  }

  set width(value: number) {
    this.pixelWidth = value;
    this.resetPixels();
  }

  get height(): number {
    return this.pixelHeight;
  }

  set height(value: number) {
    this.pixelHeight = value;
    this.resetPixels();
  }

  private resetPixels(): void {
    this.pixelData = new Uint8ClampedArray(this.pixelWidth * this.pixelHeight * 4);
  }

  get pixels(): Uint8ClampedArray {
    return this.pixelData;
  }

  getContext(kind: string): AlphaCanvasContext | null {
    return kind === "2d" ? this.context : null;
  }

  toDataURL(): string {
    if (this.options.toDataUrlThrows) throw new Error("encoder failed");
    if (this.options.toDataUrlValue !== undefined) return this.options.toDataUrlValue;
    const alpha = Array.from(this.pixelData).filter((_, index) => index % 4 === 3);
    return `data:image/png;base64,${alpha.join(".")}`;
  }
}

class AlphaCanvasContext {
  fillStyle = "#000000";
  globalCompositeOperation = "source-over";
  private filterValue = "none";

  constructor(
    private readonly canvas: AlphaCanvas,
    private readonly options: FakeCanvasOptions,
    private readonly filterAssignments: string[],
  ) {}

  get filter(): string {
    return this.filterValue;
  }

  set filter(value: string) {
    this.filterValue = value;
    this.filterAssignments.push(value);
  }

  createImageData(width: number, height: number): PixelData {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }

  putImageData(image: PixelData, destinationX: number, destinationY: number): void {
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        this.copyPixel(image.data, image.width, x, y, destinationX + x, destinationY + y);
      }
    }
  }

  getImageData(sourceX: number, sourceY: number, width: number, height: number): PixelData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceOffset = ((sourceY + y) * this.canvas.width + sourceX + x) * 4;
        const destinationOffset = (y * width + x) * 4;
        data.set(this.canvas.pixels.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
      }
    }
    return { width, height, data };
  }

  clearRect(left: number, top: number, width: number, height: number): void {
    this.forEachPixel(left, top, width, height, (offset) => {
      this.canvas.pixels.fill(0, offset, offset + 4);
    });
  }

  fillRect(left: number, top: number, width: number, height: number): void {
    const alpha = this.fillStyle.startsWith("rgba")
      ? Math.round(Number(this.fillStyle.slice(this.fillStyle.lastIndexOf(",") + 1, -1)) * 255)
      : 255;
    this.forEachPixel(left, top, width, height, (offset) => {
      this.canvas.pixels[offset] = 255;
      this.canvas.pixels[offset + 1] = 255;
      this.canvas.pixels[offset + 2] = 255;
      this.canvas.pixels[offset + 3] = alpha;
    });
  }

  drawImage(source: AlphaCanvas, ...values: number[]): void {
    if (this.options.drawImageThrows) throw new Error("draw failed");
    const [sourceX, sourceY, sourceWidth, sourceHeight, destinationX, destinationY, destinationWidth, destinationHeight]
      = values.length === 2
        ? [0, 0, source.width, source.height, values[0], values[1], source.width, source.height]
        : values;
    for (let y = 0; y < destinationHeight; y += 1) {
      for (let x = 0; x < destinationWidth; x += 1) {
        const targetX = destinationX + x;
        const targetY = destinationY + y;
        if (targetX < 0 || targetY < 0 || targetX >= this.canvas.width || targetY >= this.canvas.height) continue;
        const sampleX = Math.min(
          source.width - 1,
          Math.floor(sourceX + (x + 0.5) * sourceWidth / destinationWidth),
        );
        const sampleY = Math.min(
          source.height - 1,
          Math.floor(sourceY + (y + 0.5) * sourceHeight / destinationHeight),
        );
        const sourceOffset = (sampleY * source.width + sampleX) * 4;
        const destinationOffset = (targetY * this.canvas.width + targetX) * 4;
        const sourceAlpha = source.pixels[sourceOffset + 3] ?? 0;
        if (this.globalCompositeOperation === "destination-in") {
          this.canvas.pixels[destinationOffset + 3] = Math.round(
            this.canvas.pixels[destinationOffset + 3]! * sourceAlpha / 255,
          );
        } else {
          this.canvas.pixels.set(source.pixels.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
        }
      }
    }
  }

  private copyPixel(
    source: PixelArray,
    sourceWidth: number,
    sourceX: number,
    sourceY: number,
    destinationX: number,
    destinationY: number,
  ): void {
    if (
      destinationX < 0
      || destinationY < 0
      || destinationX >= this.canvas.width
      || destinationY >= this.canvas.height
    ) return;
    const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
    const destinationOffset = (destinationY * this.canvas.width + destinationX) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      this.canvas.pixels[destinationOffset + channel] = source[sourceOffset + channel] ?? 0;
    }
  }

  private forEachPixel(
    left: number,
    top: number,
    width: number,
    height: number,
    visit: (offset: number) => void,
  ): void {
    const startX = Math.max(0, Math.floor(left));
    const startY = Math.max(0, Math.floor(top));
    const endX = Math.min(this.canvas.width, Math.ceil(left + width));
    const endY = Math.min(this.canvas.height, Math.ceil(top + height));
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) visit((y * this.canvas.width + x) * 4);
    }
  }
}

function installAlphaCanvas(options: FakeCanvasOptions = {}): { filterAssignments: string[] } {
  const filterAssignments: string[] = [];
  vi.stubGlobal("document", {
    createElement: (tagName: string) => {
      if (tagName !== "canvas") throw new Error(`unexpected element: ${tagName}`);
      if (options.createElementThrows) throw new Error("canvas allocation failed");
      return new AlphaCanvas(options, filterAssignments);
    },
  });
  return { filterAssignments };
}

function maskAlpha(maskSrc: string | undefined): number[] {
  expect(maskSrc).toMatch(/^data:image\/png;base64,/u);
  return maskSrc!.slice(maskSrc!.indexOf(",") + 1).split(".").map(Number);
}

function rasterInput(
  masks: PsdLayerMaskRasterInput["masks"],
  fallbackMask?: PsdLayerMaskRasterInput["fallbackMask"],
  overrides: Partial<PsdLayerMaskRasterInput> = {},
): PsdLayerMaskRasterInput {
  return {
    layerLeft: 0,
    layerTop: 0,
    layerPixelWidth: 1,
    layerPixelHeight: 1,
    masks,
    fallbackMask,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("convertPsdMaskPixelsToStudioAlpha", () => {
  it("8-bit grayscale를 white RGB와 같은 alpha 값으로 변환한다", () => {
    expect(convertPsdMaskPixelsToStudioAlpha(rgba8([0, 128, 255]), 3, 1)).toEqual(
      new Uint8ClampedArray([
        255, 255, 255, 0,
        255, 255, 255, 128,
        255, 255, 255, 255,
      ]),
    );
  });

  it("16-bit와 0..1 float 샘플을 8-bit alpha로 정규화한다", () => {
    const sixteen = new Uint16Array([
      0, 0, 0, 65_535,
      32_768, 32_768, 32_768, 65_535,
      65_535, 65_535, 65_535, 65_535,
    ]);
    const floats = new Float32Array([
      0, 0, 0, 1,
      0.5, 0.5, 0.5, 1,
      1, 1, 1, 1,
    ]);
    expect([...convertPsdMaskPixelsToStudioAlpha(sixteen, 3, 1)!].filter((_, index) => index % 4 === 3)).toEqual([0, 128, 255]);
    expect([...convertPsdMaskPixelsToStudioAlpha(floats, 3, 1)!].filter((_, index) => index % 4 === 3)).toEqual([0, 128, 255]);
  });

  it("density 공식 255-density*(255-value)을 적용한다", () => {
    expect(applyPsdMaskDensity(0, 0)).toBe(255);
    expect(applyPsdMaskDensity(0, 0.5)).toBe(128);
    expect(applyPsdMaskDensity(64, 1)).toBe(64);
    expect(convertPsdMaskPixelsToStudioAlpha(rgba8([0, 128]), 2, 1, 0.5)?.[3]).toBe(128);
  });

  it("짧은 버퍼와 non-finite float는 파괴적인 마스크를 만들지 않고 fail closed 한다", () => {
    expect(convertPsdMaskPixelsToStudioAlpha(new Uint8Array(3), 1, 1)).toBeNull();
    expect(convertPsdMaskPixelsToStudioAlpha(new Uint8Array(5), 1, 1)).toBeNull();
    expect(convertPsdMaskPixelsToStudioAlpha(new Float32Array([Number.NaN, 0, 0, 1]), 1, 1)).toBeNull();
    expect(convertPsdMaskPixelsToStudioAlpha([0, 0, 0, 255] as never, 1, 1)).toBeNull();
  });
});

describe("planPsdLayerMaskRaster", () => {
  const layer = {
    layerLeft: 100,
    layerTop: 200,
    layerPixelWidth: 400,
    layerPixelHeight: 300,
  } as const;

  it("document 좌표 마스크를 layer-local offset으로 환산한다", () => {
    const mask = maskWithPixels(rgba8(new Array(50 * 40).fill(255)), 50, 40, {
      left: 120,
      top: 230,
      right: 170,
      bottom: 270,
      positionRelativeToLayer: false,
    });
    expect(planPsdLayerMaskRaster({ ...layer, mask })).toMatchObject({
      destinationLeft: 20,
      destinationTop: 30,
      destinationWidth: 50,
      destinationHeight: 40,
    });
  });

  it("positionRelativeToLayer=true면 layer 원점과 무관하게 좌표를 그대로 쓴다", () => {
    const mask = maskWithPixels(rgba8(new Array(50 * 40).fill(255)), 50, 40, {
      left: -10,
      top: 15,
      right: 40,
      bottom: 55,
      positionRelativeToLayer: true,
    });
    expect(planPsdLayerMaskRaster({ ...layer, mask })).toMatchObject({
      destinationLeft: -10,
      destinationTop: 15,
    });
  });

  it("source와 같은 width-based 1280 proxy scale을 좌표와 자연 크기에 적용한다", () => {
    const mask = maskWithPixels(rgba8(new Array(200 * 100).fill(255)), 200, 100, {
      left: 400,
      top: 200,
      right: 600,
      bottom: 300,
      positionRelativeToLayer: true,
    });
    expect(planPsdLayerMaskRaster({
      layerLeft: 0,
      layerTop: 0,
      layerPixelWidth: 2560,
      layerPixelHeight: 1600,
      mask,
    })).toMatchObject({
      proxyScale: 0.5,
      outputWidth: 1280,
      outputHeight: 800,
      destinationLeft: 200,
      destinationTop: 100,
      destinationWidth: 100,
      destinationHeight: 50,
    });
  });

  it("outside defaultColor와 density, bounded feather 계획을 계산한다", () => {
    const mask = maskWithPixels(rgba8([255]), 1, 1, {
      defaultColor: 0,
      userMaskDensity: 0.5,
      userMaskFeather: 1_000,
    });
    expect(planPsdLayerMaskRaster({ ...layer, mask })).toMatchObject({
      defaultAlpha: 128,
      density: 0.5,
      featherPx: PSD_IMPORTED_MASK_MAX_FEATHER_PX,
      featherWasClamped: true,
    });
  });

  it("pixel/bounds 불일치와 proxy pixel budget 초과는 fail closed 한다", () => {
    const malformed = maskWithPixels(rgba8(new Array(4).fill(255)), 2, 2, { right: 3 });
    expect(planPsdLayerMaskRaster({ ...layer, mask: malformed })).toBeNull();

    const valid = maskWithPixels(rgba8([255]), 1, 1);
    expect(planPsdLayerMaskRaster({
      layerLeft: 0,
      layerTop: 0,
      layerPixelWidth: 1280,
      layerPixelHeight: 20_000,
      mask: valid,
    })).toBeNull();
  });

  it("fractional dimensions와 잘못된 defaultColor/density/feather를 보정하지 않고 거부한다", () => {
    const fractional = maskWithPixels(rgba8([255]), 1, 1);
    fractional.imageData!.width = 1.4;
    expect(planPsdLayerMaskRaster({ ...layer, mask: fractional })).toBeNull();

    for (const overrides of [
      { left: Number.NaN },
      { top: 0.5 },
      { defaultColor: 127 },
      { userMaskDensity: Number.NaN },
      { userMaskDensity: 1.1 },
      { userMaskFeather: -1 },
    ] satisfies Partial<LayerMaskData>[]) {
      expect(planPsdLayerMaskRaster({
        ...layer,
        mask: maskWithPixels(rgba8([255]), 1, 1, overrides),
      })).toBeNull();
    }
  });
});

describe("rasterizePsdLayerMasks browser Canvas contract", () => {
  it("realMask 최종 composite를 primary와 다시 곱하지 않는다 (128 × 64가 아니라 64)", () => {
    installAlphaCanvas();
    const primary = maskWithPixels(rgba8([128]), 1, 1);
    const real = maskWithPixels(rgba8([64]), 1, 1);

    const result = rasterizePsdLayerMasks(rasterInput(
      [{ kind: "real", mask: real, parameterMask: primary }],
      { kind: "primary", mask: primary },
    ));

    expect(maskAlpha(result.maskSrc)).toEqual([64]);
  });

  it("authoritative realMask의 disabled 상태를 primary 상태와 무관하게 보존한다", () => {
    installAlphaCanvas();
    const primary = maskWithPixels(rgba8([255]), 1, 1, { disabled: false });
    const real = maskWithPixels(rgba8([96]), 1, 1, { disabled: true });

    const result = rasterizePsdLayerMasks(rasterInput(
      [{ kind: "real", mask: real, parameterMask: primary }],
      { kind: "primary", mask: primary },
    ));

    expect(maskAlpha(result.maskSrc)).toEqual([96]);
    expect(result.disabled).toBe(true);
  });

  it("primary descriptor의 density와 feather를 real composite에 정확히 한 번 적용한다", () => {
    const { filterAssignments } = installAlphaCanvas();
    const primary = maskWithPixels(rgba8([0]), 1, 1, {
      userMaskDensity: 0.5,
      userMaskFeather: 2,
    });
    const real = maskWithPixels(rgba8([0]), 1, 1, { fromVectorData: false });

    const result = rasterizePsdLayerMasks(rasterInput(
      [{ kind: "real", mask: real, parameterMask: primary }],
      { kind: "primary", mask: primary },
    ));

    expect(maskAlpha(result.maskSrc)).toEqual([128]);
    expect(filterAssignments.filter((value) => value.startsWith("blur("))).toEqual(["blur(2px)"]);
  });

  it("손상된 real composite는 primary pixels로 명시적으로 fallback하고 경고한다", () => {
    installAlphaCanvas();
    const primary = maskWithPixels(rgba8([128]), 1, 1);
    const malformedReal = maskWithPixels(new Uint8Array(3), 1, 1);

    const result = rasterizePsdLayerMasks(rasterInput(
      [{ kind: "real", mask: malformedReal, parameterMask: primary }],
      { kind: "primary", mask: primary },
    ));

    expect(maskAlpha(result.maskSrc)).toEqual([128]);
    expect(result.warnings.join(" ")).toContain("최종 합성 마스크 채널이 손상");
  });

  it("mask bounds 밖은 defaultColor로 채우고 내부는 clear 후 decoded pixels로 대체한다", () => {
    installAlphaCanvas();
    const mask = maskWithPixels(rgba8([255]), 1, 1, {
      left: 1,
      right: 2,
      defaultColor: 0,
      positionRelativeToLayer: true,
    });

    const result = rasterizePsdLayerMasks(rasterInput(
      [{ kind: "primary", mask }],
      undefined,
      { layerPixelWidth: 3 },
    ));

    expect(maskAlpha(result.maskSrc)).toEqual([0, 255, 0]);
  });

  it("realMask가 없는 다중 primary 입력은 alpha multiplication을 유지한다", () => {
    installAlphaCanvas();
    const first = maskWithPixels(rgba8([128]), 1, 1);
    const second = maskWithPixels(rgba8([128]), 1, 1);
    const result = rasterizePsdLayerMasks(rasterInput([
      { kind: "primary", mask: first },
      { kind: "primary", mask: second },
    ]));
    expect(maskAlpha(result.maskSrc)).toEqual([64]);
  });

  it("활성 primary가 있으면 disabled channel은 적용하지 않고 명시한다", () => {
    installAlphaCanvas();
    const enabled = maskWithPixels(rgba8([80]), 1, 1);
    const disabled = maskWithPixels(rgba8([10]), 1, 1, { disabled: true });
    const result = rasterizePsdLayerMasks(rasterInput([
      { kind: "primary", mask: enabled },
      { kind: "primary", mask: disabled },
    ]));
    expect(maskAlpha(result.maskSrc)).toEqual([80]);
    expect(result.disabled).toBe(false);
    expect(result.warnings.join(" ")).toContain("비활성 마스크 채널");
  });

  it("Canvas taint/allocation/draw/encode failures와 empty data URL을 모두 fail closed 한다", () => {
    const valid = maskWithPixels(rgba8([255]), 1, 1);

    installAlphaCanvas({ createElementThrows: true });
    expect(rasterizePsdLayerMasks(rasterInput([{ kind: "primary", mask: valid }])).maskSrc).toBeUndefined();
    vi.unstubAllGlobals();

    installAlphaCanvas({ drawImageThrows: true });
    expect(rasterizePsdLayerMasks(rasterInput([{ kind: "primary", mask: valid }])).maskSrc).toBeUndefined();
    vi.unstubAllGlobals();

    installAlphaCanvas({ toDataUrlThrows: true });
    expect(rasterizePsdLayerMasks(rasterInput([{ kind: "primary", mask: valid }])).maskSrc).toBeUndefined();
    vi.unstubAllGlobals();

    installAlphaCanvas({ toDataUrlValue: "data:," });
    const empty = rasterizePsdLayerMasks(rasterInput([{ kind: "primary", mask: valid }]));
    expect(empty.maskSrc).toBeUndefined();
    expect(empty.warnings.join(" ")).toContain("PNG 인코딩에 실패");
    vi.unstubAllGlobals();

    installAlphaCanvas();
    const tainted = {
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
      canvas: {
        width: 1,
        height: 1,
        getContext: () => {
          throw new DOMException("tainted", "SecurityError");
        },
      } as unknown as HTMLCanvasElement,
    } satisfies LayerMaskData;
    expect(rasterizePsdLayerMasks(rasterInput([{ kind: "primary", mask: tainted }])).maskSrc).toBeUndefined();
  });
});
