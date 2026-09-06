import { Blur } from "konva/lib/filters/Blur";
import { Brighten } from "konva/lib/filters/Brighten";
import { Contrast } from "konva/lib/filters/Contrast";
import { HSL } from "konva/lib/filters/HSL";
import { Pixelate } from "konva/lib/filters/Pixelate";
import { describe, expect, it } from "vitest";

import {
  nativeBlur,
  nativeBrighten,
  nativeContrast,
  nativeHSL,
  nativePixelate,
} from "./studio-konva-native-filters";

import type { StudioImageDataLike } from "../studio-filters";

// 두 포팅이 동일 입력에서 픽셀 단위로 일치하는지 검증한다 — nativeXxx는 Worker(DOM 없음)에서도
// 도는 attrs 기반 버전, 실제 konva 함수는 Konva 노드의 getter 메서드(this.blurRadius() 등)를 읽는다.
// 이 테스트가 깨지면 Worker 경로가 메인 스레드와 다른 결과를 그리게 된다.
// Konva의 Filter 타입은 FilterFunction | string 유니언이라 .call 호출을 위해 함수 형태로 좁힌다.
type RealFilterFn = (this: unknown, imageData: unknown) => void;
const realBlur = Blur as unknown as RealFilterFn;
const realBrighten = Brighten as unknown as RealFilterFn;
const realContrast = Contrast as unknown as RealFilterFn;
const realHSL = HSL as unknown as RealFilterFn;
const realPixelate = Pixelate as unknown as RealFilterFn;

function makeImageData(width: number, height: number, seed = 1): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 7 * seed) % 256;
    data[i + 1] = (i * 13 * seed) % 256;
    data[i + 2] = (i * 3 * seed) % 256;
    data[i + 3] = 200 + ((i * seed) % 56);
  }
  return { data, width, height };
}

describe("studio-konva-native-filters parity with real Konva filters", () => {
  it("nativeBrighten matches Konva Brighten", () => {
    const a = makeImageData(12, 9);
    const b = makeImageData(12, 9);
    nativeBrighten.call({ attrs: { brightness: 0.35 } }, a);
    realBrighten.call({ brightness: () => 0.35 }, b);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("nativeContrast matches Konva Contrast", () => {
    const a = makeImageData(12, 9, 2);
    const b = makeImageData(12, 9, 2);
    nativeContrast.call({ attrs: { contrast: 42 } }, a);
    realContrast.call({ contrast: () => 42 }, b);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("nativeHSL matches Konva HSL", () => {
    const a = makeImageData(14, 10, 3);
    const b = makeImageData(14, 10, 3);
    nativeHSL.call({ attrs: { hue: 120, saturation: 0.4, luminance: 0.1 } }, a);
    realHSL.call(
      { hue: () => 120, saturation: () => 0.4, luminance: () => 0.1 },
      b,
    );
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("nativePixelate matches Konva Pixelate", () => {
    const a = makeImageData(20, 17, 4);
    const b = makeImageData(20, 17, 4);
    nativePixelate.call({ attrs: { pixelSize: 5 } }, a);
    realPixelate.call({ pixelSize: () => 5 }, b);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("nativeBlur matches Konva Blur across several radii", () => {
    for (const radius of [1, 3, 8, 16]) {
      const a = makeImageData(24, 18, radius + 1);
      const b = makeImageData(24, 18, radius + 1);
      nativeBlur.call({ attrs: { blurRadius: radius } }, a);
      realBlur.call({ blurRadius: () => radius }, b);
      expect(Array.from(a.data)).toEqual(Array.from(b.data));
    }
  });

  it("nativeBlur is a no-op for radius 0, matching Konva", () => {
    const a = makeImageData(10, 10, 5);
    const b = makeImageData(10, 10, 5);
    nativeBlur.call({ attrs: { blurRadius: 0 } }, a);
    realBlur.call({ blurRadius: () => 0 }, b);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("all natives fall back to Konva defaults when attrs are missing", () => {
    const a = makeImageData(8, 8, 6);
    const b = makeImageData(8, 8, 6);
    nativeBrighten.call({}, a);
    realBrighten.call({ brightness: () => 0 }, b);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("non-finite scalar attrs fail closed and a huge blur radius stays bounded", () => {
    for (const run of [
      (img: StudioImageDataLike) => nativeBrighten.call({ attrs: { brightness: Number.NaN } }, img),
      (img: StudioImageDataLike) => nativeContrast.call({ attrs: { contrast: Number.POSITIVE_INFINITY } }, img),
      (img: StudioImageDataLike) => nativeHSL.call({ attrs: { hue: Number.NaN } }, img),
      (img: StudioImageDataLike) => nativeBlur.call({ attrs: { blurRadius: Number.POSITIVE_INFINITY } }, img),
    ]) {
      const img = makeImageData(5, 5, 7);
      const before = Array.from(img.data);
      expect(() => run(img)).not.toThrow();
      expect(Array.from(img.data)).toEqual(before);
    }

    const onePixel = makeImageData(1, 1, 8);
    expect(() => nativeBlur.call({ attrs: { blurRadius: Number.MAX_VALUE } }, onePixel)).not.toThrow();
  });
});
