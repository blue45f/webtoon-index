import { describe, expect, it } from "vitest";

import { resampleSmudgePath, smudgeBrushWeight, smudgeStroke, type SmudgePixelPoint } from "./studio-smudge";

// ---------------------------------------------------------------------------
// 테스트 픽스처 — studio-magic-wand.test.ts 의 imageDataFromGrid 와 동일한 기법(색 그리드 → RGBA 버퍼).
// ---------------------------------------------------------------------------

/** w*h RGBA 버퍼를 좌표 기반 색상 함수로 만든다(2색 하드 에지 등 임의 패턴에 쓰기 편함). */
function makeImageData(
  w: number,
  h: number,
  colorAt: (x: number, y: number) => readonly [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = colorAt(x, y);
      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return data;
}

function pixelAt(data: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number, number] {
  const idx = (y * w + x) * 4;
  return [data[idx]!, data[idx + 1]!, data[idx + 2]!, data[idx + 3]!];
}

// ---------------------------------------------------------------------------
// resampleSmudgePath
// ---------------------------------------------------------------------------

describe("resampleSmudgePath", () => {
  it("0-point input passes through unchanged", () => {
    const points: SmudgePixelPoint[] = [];
    expect(resampleSmudgePath(points, 5)).toEqual([]);
  });

  it("1-point input passes through unchanged", () => {
    const points: SmudgePixelPoint[] = [{ x: 1, y: 2 }];
    expect(resampleSmudgePath(points, 5)).toEqual([{ x: 1, y: 2 }]);
  });

  it("produces evenly spaced points along a straight horizontal path", () => {
    const points: SmudgePixelPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const out = resampleSmudgePath(points, 2.5);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 2.5, y: 0 },
      { x: 5, y: 0 },
      { x: 7.5, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("produces evenly spaced points along a diagonal path", () => {
    const points: SmudgePixelPoint[] = [
      { x: 0, y: 0 },
      { x: 6, y: 8 }, // 3-4-5 triangle scaled ×2 → length 10
    ];
    const out = resampleSmudgePath(points, 5);
    expect(out.length).toBeGreaterThanOrEqual(2);
    // 각 연속 점 사이 거리가 대략 step(5)와 같아야 한다(마지막 구간만 짧을 수 있음).
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1]!;
      const b = out[i]!;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(5, 5);
    }
    const last = out[out.length - 1]!;
    expect(last.x).toBeCloseTo(6);
    expect(last.y).toBeCloseTo(8);
  });

  it("degenerate zero-length segments do not produce duplicate or NaN points", () => {
    const points: SmudgePixelPoint[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 }, // 정지 — 길이 0 구간
      { x: 0, y: 0 }, // 정지 — 길이 0 구간
      { x: 10, y: 0 },
    ];
    const out = resampleSmudgePath(points, 3);
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    // 연속 중복점이 없어야 한다(정지 구간이 그대로 반복 추가되지 않음).
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1]!;
      const b = out[i]!;
      expect(a.x === b.x && a.y === b.y).toBe(false);
    }
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 10, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// smudgeBrushWeight
// ---------------------------------------------------------------------------

describe("smudgeBrushWeight", () => {
  it("is 1 at the center", () => {
    expect(smudgeBrushWeight(0, 0, 10)).toBe(1);
  });

  it("is 0 exactly at the radius and beyond", () => {
    expect(smudgeBrushWeight(10, 0, 10)).toBe(0);
    expect(smudgeBrushWeight(11, 0, 10)).toBe(0);
    expect(smudgeBrushWeight(0, 20, 10)).toBe(0);
  });

  it("is monotonically non-increasing as distance grows along a radius", () => {
    const distances = [0, 2, 4, 6, 8, 9.9];
    const weights = distances.map((d) => smudgeBrushWeight(d, 0, 10));
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]!).toBeLessThanOrEqual(weights[i - 1]!);
    }
  });
});

// ---------------------------------------------------------------------------
// smudgeStroke
// ---------------------------------------------------------------------------

describe("smudgeStroke", () => {
  const W = 20;
  const H = 10;
  const RED: [number, number, number, number] = [255, 0, 0, 255];
  const BLUE: [number, number, number, number] = [0, 0, 255, 255];

  function hardEdgeImage(): Uint8ClampedArray {
    return makeImageData(W, H, (x) => (x < 10 ? RED : BLUE));
  }

  it("points.length < 2 returns the input unchanged (same reference)", () => {
    const data = hardEdgeImage();
    const result = smudgeStroke(data, W, H, [{ x: 5, y: 5 }], 5, 0.5);
    expect(result).toBe(data);
    expect(pixelAt(data, W, 5, 5)).toEqual(RED);
  });

  it("strength = 0 returns the input unchanged (same reference)", () => {
    const data = hardEdgeImage();
    const points: SmudgePixelPoint[] = [
      { x: 4, y: 5 },
      { x: 16, y: 5 },
    ];
    const result = smudgeStroke(data, W, H, points, 5, 0);
    expect(result).toBe(data);
    expect(pixelAt(data, W, 11, 5)).toEqual(BLUE);
  });

  it("flat-color image is unchanged after smudge (no-op sanity check)", () => {
    const flat = makeImageData(W, H, () => [123, 45, 67, 200]);
    const before = flat.slice();
    const points: SmudgePixelPoint[] = [
      { x: 4, y: 5 },
      { x: 16, y: 5 },
    ];
    smudgeStroke(flat, W, H, points, 5, 0.8);
    expect(flat).toEqual(before);
  });

  it("blends the leading (blue) side toward red near a crossed hard edge, and leaves far pixels untouched", () => {
    const data = hardEdgeImage();
    const points: SmudgePixelPoint[] = [
      { x: 4, y: 5 },
      { x: 16, y: 5 },
    ];
    smudgeStroke(data, W, H, points, 3, 0.9);

    // 경계 바로 오른쪽(파랑 쪽)이 빨강 방향으로 섞여야 한다.
    const [r, g, b, a] = pixelAt(data, W, 11, 5);
    expect(r).toBeGreaterThan(0);
    expect(b).toBeLessThan(255);
    expect(g).toBe(0); // 빨강/파랑 둘 다 G=0 이므로 블렌드해도 G 는 변하지 않는다.
    expect(a).toBe(255); // 양쪽 다 불투명이므로 알파는 그대로.

    // 스트로크 반경 밖(수직으로 멀리 떨어진, 또는 스트로크 범위 밖 모서리)은 영향받지 않는다.
    expect(pixelAt(data, W, 11, 9)).toEqual(BLUE); // dy=4 > radius=3
    expect(pixelAt(data, W, 0, 0)).toEqual(RED); // 스트로크에서 멀리 떨어진 모서리
  });

  it("stroke starting at/near x=0,y=0 does not crash and clamps sampling to image bounds", () => {
    const data = makeImageData(W, H, (x, y) => [x * 10, y * 20, 100, 255]);
    const points: SmudgePixelPoint[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ];
    expect(() => smudgeStroke(data, W, H, points, 5, 0.7)).not.toThrow();
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
      expect(data[i]!).toBeGreaterThanOrEqual(0);
      expect(data[i]!).toBeLessThanOrEqual(255);
    }
  });

  it("dragging from an opaque region into a fully transparent region raises alpha partway", () => {
    const OPAQUE: [number, number, number, number] = [200, 50, 50, 255];
    const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0];
    const data = makeImageData(W, H, (x) => (x < 10 ? OPAQUE : TRANSPARENT));
    const points: SmudgePixelPoint[] = [
      { x: 4, y: 5 },
      { x: 16, y: 5 },
    ];
    smudgeStroke(data, W, H, points, 4, 0.9);

    const [, , , a] = pixelAt(data, W, 11, 5);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);

    /*
     * 번져 나간 자락은 옅어질 뿐 어두워지지 않는다.
     *
     * getImageData 의 straight RGBA 를 그대로 보간하면 투명 픽셀의 의미 없는 (0,0,0) 이 섞여
     * 색이 알파와 같은 비율로 끌려 내려간다 — 합성에서 알파가 이미 한 번 옅게 만드는데 색까지
     * 어두워지므로 자락이 탁한 회갈색이 된다. 실측(원본 200,50,50): 알파 55 인 픽셀이
     * (43,12,12) 로 읽혔다. 프리멀티플라이드로 섞으면 같은 픽셀이 (200,50,50) 을 유지한다.
     */
    for (let x = 0; x < W; x += 1) {
      const [r, g, b, alpha] = pixelAt(data, W, x, 5);
      if (alpha <= 0) continue;
      expect(r).toBeGreaterThan(190);
      expect(g).toBeGreaterThan(40);
      expect(g).toBeLessThan(60);
      expect(b).toBeLessThan(60);
    }

    // 반경 밖(수직으로 멀리 떨어진 지점)은 알파가 그대로 0.
    expect(pixelAt(data, W, 11, 9)[3]).toBe(0);
  });

  it("an opaque-on-opaque smudge is unchanged by premultiplication", () => {
    const LEFT: [number, number, number, number] = [200, 50, 50, 255];
    const RIGHT: [number, number, number, number] = [20, 180, 90, 255];
    const data = makeImageData(W, H, (x) => (x < 10 ? LEFT : RIGHT));
    smudgeStroke(data, W, H, [{ x: 4, y: 5 }, { x: 16, y: 5 }], 4, 0.9);

    // 양쪽이 불투명하면 프리멀티플라이드 식은 straight 보간과 같은 값이라, 기존 결과가
    // 한 비트도 움직이지 않아야 한다 — 알파는 255 로 남고 색은 두 색 사이에 머문다.
    for (let x = 0; x < W; x += 1) {
      const [r, g, b, alpha] = pixelAt(data, W, x, 5);
      expect(alpha).toBe(255);
      expect(r).toBeGreaterThanOrEqual(Math.min(LEFT[0], RIGHT[0]) - 1);
      expect(r).toBeLessThanOrEqual(Math.max(LEFT[0], RIGHT[0]) + 1);
      expect(g).toBeGreaterThanOrEqual(Math.min(LEFT[1], RIGHT[1]) - 1);
      expect(g).toBeLessThanOrEqual(Math.max(LEFT[1], RIGHT[1]) + 1);
      expect(b).toBeGreaterThanOrEqual(Math.min(LEFT[2], RIGHT[2]) - 1);
      expect(b).toBeLessThanOrEqual(Math.max(LEFT[2], RIGHT[2]) + 1);
    }
  });
});
