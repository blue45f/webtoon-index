import { describe, expect, it } from "vitest";

import {
  computeHistogram,
  STUDIO_HISTOGRAM_MAX_SAMPLES,
  studioHistogramStride,
} from "./studio-histogram";

import type { StudioImageDataLike } from "./studio-filters";

/** [r,g,b,a] 픽셀 목록으로 작은 테스트 이미지를 만든다(행 우선). */
function imageOf(width: number, height: number, pixels: [number, number, number, number][]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach(([r, g, b, a], index) => {
    data[index * 4] = r;
    data[index * 4 + 1] = g;
    data[index * 4 + 2] = b;
    data[index * 4 + 3] = a;
  });
  return { data, width, height };
}

/** (x, y) → 픽셀 생성기 기반 큰 테스트 이미지. */
function generatedImage(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => [number, number, number, number]
): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
  return { data, width, height };
}

describe("computeHistogram — 휘도 채널", () => {
  it("알려진 픽셀에서 빈/평균/중앙값/클리핑을 정확히 집계하고 alpha 0은 제외한다", () => {
    // 검정(0), 흰색(255), 중간톤 luma 18, 완전 투명(집계 제외).
    const image = imageOf(2, 2, [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [10, 20, 30, 255], // luma = round(2.99 + 11.74 + 3.42) = 18
      [90, 90, 90, 0],
    ]);
    const result = computeHistogram(image, "luma");

    expect(result.sampledPixels).toBe(3);
    expect(result.bins[0]).toBe(1);
    expect(result.bins[18]).toBe(1);
    expect(result.bins[255]).toBe(1);
    expect(result.clippedLow).toBe(1);
    expect(result.clippedHigh).toBe(1);
    expect(result.max).toBe(1);
    expect(result.mean).toBe((0 + 18 + 255) / 3);
    // 하위 중앙값 — 누적이 ceil(3/2)=2에 처음 도달하는 값.
    expect(result.median).toBe(18);
    // 집계된 나머지 칸은 전부 0.
    const total = result.bins.reduce((sum, count) => sum + count, 0);
    expect(total).toBe(3);
  });

  it("luma 가중 합은 255를 넘지 않는다(흰색 픽셀 = 255번 칸)", () => {
    const image = imageOf(1, 1, [[255, 255, 255, 255]]);
    const result = computeHistogram(image, "luma");
    expect(result.bins[255]).toBe(1);
    expect(result.median).toBe(255);
    expect(result.mean).toBe(255);
  });
});

describe("computeHistogram — 채널 분리", () => {
  it("r/g/b 채널이 각자 해당 성분만 읽는다", () => {
    const image = imageOf(1, 1, [[10, 200, 77, 255]]);

    const r = computeHistogram(image, "r");
    const g = computeHistogram(image, "g");
    const b = computeHistogram(image, "b");

    expect(r.bins[10]).toBe(1);
    expect(g.bins[200]).toBe(1);
    expect(b.bins[77]).toBe(1);
    expect(r.sampledPixels).toBe(1);
    expect(g.median).toBe(200);
    expect(b.mean).toBe(77);
  });
});

describe("computeHistogram — 빈/무효 입력", () => {
  it("전부 투명한 이미지는 빈 결과(표본 0, 통계 0)", () => {
    const image = imageOf(2, 1, [
      [1, 2, 3, 0],
      [200, 200, 200, 0],
    ]);
    const result = computeHistogram(image, "luma");
    expect(result.sampledPixels).toBe(0);
    expect(result.max).toBe(0);
    expect(result.mean).toBe(0);
    expect(result.median).toBe(0);
    expect(result.clippedLow).toBe(0);
    expect(result.clippedHigh).toBe(0);
    expect(result.bins.every((count) => count === 0)).toBe(true);
  });

  it("치수·버퍼 길이가 무효면 빈 결과", () => {
    const shortBuffer: StudioImageDataLike = { data: new Uint8ClampedArray(4), width: 2, height: 2 };
    expect(computeHistogram(shortBuffer, "luma").sampledPixels).toBe(0);

    const zeroWidth: StudioImageDataLike = { data: new Uint8ClampedArray(0), width: 0, height: 3 };
    expect(computeHistogram(zeroWidth, "r").sampledPixels).toBe(0);
  });
});

describe("스트라이드 샘플링 — 결정적 격자, 표본 상한", () => {
  it("상한 이하 이미지는 stride 1(전 픽셀 집계)", () => {
    expect(studioHistogramStride(512, 512)).toBe(1);
    expect(studioHistogramStride(1, 1)).toBe(1);
  });

  it("문서화된 규칙 — 800×800은 stride 2, 400×400 표본", () => {
    // ceil(sqrt(640000 / 262144)) = ceil(1.5625) = 2
    expect(studioHistogramStride(800, 800)).toBe(2);

    const image = generatedImage(800, 800, (x, y) => {
      const value = (x * 3 + y * 5) % 256;
      return [value, value, value, 255];
    });
    const first = computeHistogram(image, "luma");
    const second = computeHistogram(image, "luma");

    expect(first.sampledPixels).toBe(400 * 400);
    expect(first.sampledPixels).toBeLessThanOrEqual(STUDIO_HISTOGRAM_MAX_SAMPLES);
    // 결정성 — 같은 입력이면 빈 단위까지 완전히 동일하다.
    expect(Array.from(first.bins)).toEqual(Array.from(second.bins));
    expect(first.mean).toBe(second.mean);
    expect(first.median).toBe(second.median);
  });

  it("극단 비율(1×N)도 ceil 가드로 표본 상한을 지킨다", () => {
    const width = 1;
    const height = 1_048_576;
    const stride = studioHistogramStride(width, height);
    // 초기값 ceil(sqrt(4)) = 2는 1×524288 표본으로 상한 초과 → 가드가 4까지 올린다.
    expect(stride).toBe(4);
    expect(Math.ceil(width / stride) * Math.ceil(height / stride)).toBeLessThanOrEqual(
      STUDIO_HISTOGRAM_MAX_SAMPLES
    );
  });

  it("스트라이드 격자는 투명 픽셀 제외와 함께 동작한다", () => {
    // 4×4, stride 강제 없음(16픽셀 전부 격자 위) — 짝수 좌표만 불투명.
    const image = generatedImage(4, 4, (x, y) =>
      (x + y) % 2 === 0 ? [128, 128, 128, 255] : [128, 128, 128, 0]
    );
    const result = computeHistogram(image, "luma");
    expect(result.sampledPixels).toBe(8);
    expect(result.bins[128]).toBe(8);
  });
});

describe("computeHistogram — 입력 불변", () => {
  it("입력 픽셀 버퍼를 변형하지 않는다", () => {
    const image = imageOf(2, 1, [
      [5, 6, 7, 255],
      [250, 251, 252, 255],
    ]);
    const snapshot = Array.from(image.data);
    computeHistogram(image, "luma");
    computeHistogram(image, "b");
    expect(Array.from(image.data)).toEqual(snapshot);
  });
});
