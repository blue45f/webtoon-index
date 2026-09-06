import { describe, expect, it } from "vitest";

import {
  LIQUIFY_RADIUS_DEFAULT,
  LIQUIFY_RADIUS_RANGE,
  LIQUIFY_STRENGTH_DEFAULT,
  LIQUIFY_STRENGTH_RANGE,
  applyLiquifyDisplacement,
  buildLiquifyDisplacementField,
  liquifyBrushWeight,
  resampleLiquifyPath,
  sampleBilinearClamped,
  type LiquifyPixelPoint,
} from "./studio-liquify";
import {
  bakeLiquifyStrokeToCanvas,
  type LiquifyCanvasFactory,
  type LiquifyCtx2DLike,
} from "./studio-liquify-browser";

import type { StudioImageDataLike } from "./studio-filters";
import type { MaskCanvasLike, MaskImageSource } from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 픽스처 헬퍼(studio-heal-clone.test.ts와 동일 관례)
// ---------------------------------------------------------------------------

function solidImage(w: number, h: number, r: number, g: number, b: number, a = 255): StudioImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width: w, height: h };
}

function paintedImage(
  w: number,
  h: number,
  fn: (x: number, y: number) => [number, number, number, number]
): StudioImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = fn(x, y);
      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { data, width: w, height: h };
}

function pixelAt(img: StudioImageDataLike, x: number, y: number): [number, number, number, number] {
  const idx = (y * img.width + x) * 4;
  return [img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!, img.data[idx + 3]!];
}

function cloneImage(img: StudioImageDataLike): StudioImageDataLike {
  return { data: img.data.slice() as Uint8ClampedArray, width: img.width, height: img.height };
}

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

describe("상수", () => {
  it("범위·기본값이 서로 정합적이다", () => {
    expect(LIQUIFY_RADIUS_DEFAULT).toBeGreaterThanOrEqual(LIQUIFY_RADIUS_RANGE.min);
    expect(LIQUIFY_RADIUS_DEFAULT).toBeLessThanOrEqual(LIQUIFY_RADIUS_RANGE.max);
    expect(LIQUIFY_STRENGTH_DEFAULT).toBeGreaterThanOrEqual(LIQUIFY_STRENGTH_RANGE.min);
    expect(LIQUIFY_STRENGTH_DEFAULT).toBeLessThanOrEqual(LIQUIFY_STRENGTH_RANGE.max);
  });
});

// ---------------------------------------------------------------------------
// (A) resampleLiquifyPath
// ---------------------------------------------------------------------------

describe("resampleLiquifyPath", () => {
  it("점이 2개 미만이면 그대로 반환", () => {
    expect(resampleLiquifyPath([], 5)).toEqual([]);
    expect(resampleLiquifyPath([{ x: 1, y: 1 }], 5)).toEqual([{ x: 1, y: 1 }]);
  });

  it("직선을 균등 간격으로 재추출하고 마지막 점을 보존한다", () => {
    const out = resampleLiquifyPath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      2
    );
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 10, y: 0 });
    // 0,2,4,6,8,10 — 6개 점.
    expect(out.length).toBe(6);
    expect(out[1]).toEqual({ x: 2, y: 0 });
  });

  it("정지 구간(길이 0 세그먼트)은 건너뛴다", () => {
    const out = resampleLiquifyPath(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      2
    );
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(out[out.length - 1]).toEqual({ x: 4, y: 0 });
  });

  it("중간에 비유한(NaN) 점이 섞여도 걸러내고 나머지 유한 점만으로 리샘플한다(회귀 — 이 점을 그대로 흘려보내면 이후 carried 누적이 NaN으로 오염돼 리샘플이 조용히 끊긴다)", () => {
    const out = resampleLiquifyPath(
      [
        { x: 0, y: 0 },
        { x: Number.NaN, y: 0 },
        { x: 10, y: 0 },
      ],
      2
    );
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    // NaN 점을 제거하면 (0,0)→(10,0) 단일 세그먼트로 취급돼 0,2,4,6,8,10 이 나와야 한다.
    expect(out.map((p) => p.x)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(out[out.length - 1]).toEqual({ x: 10, y: 0 });
  });

  it("Infinity 좌표 점도 걸러낸다", () => {
    const out = resampleLiquifyPath(
      [
        { x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 0 },
        { x: 5, y: 0 },
      ],
      2
    );
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(out[out.length - 1]).toEqual({ x: 5, y: 0 });
  });

  it("점이 전부 비유한이면 빈 배열(길이<2 취급)", () => {
    expect(
      resampleLiquifyPath(
        [
          { x: Number.NaN, y: Number.NaN },
          { x: Number.NaN, y: 1 },
        ],
        2
      )
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (A) liquifyBrushWeight
// ---------------------------------------------------------------------------

describe("liquifyBrushWeight", () => {
  it("중심(dist=0)에서 1, 가장자리(dist>=radius)에서 0", () => {
    expect(liquifyBrushWeight(0, 0, 10)).toBeCloseTo(1, 10);
    expect(liquifyBrushWeight(10, 0, 10)).toBe(0);
    expect(liquifyBrushWeight(20, 0, 10)).toBe(0);
  });

  it("중간 지점은 0과 1 사이이고 중심에서 멀수록 단조 감소한다", () => {
    const near = liquifyBrushWeight(2, 0, 10);
    const far = liquifyBrushWeight(8, 0, 10);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(near).toBeLessThan(1);
  });

  it("radiusPx<=0 또는 비유한이면 0", () => {
    expect(liquifyBrushWeight(1, 1, 0)).toBe(0);
    expect(liquifyBrushWeight(1, 1, -5)).toBe(0);
    expect(liquifyBrushWeight(1, 1, Number.NaN)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (B) buildLiquifyDisplacementField
// ---------------------------------------------------------------------------

describe("buildLiquifyDisplacementField", () => {
  const P: LiquifyPixelPoint[] = [
    { x: 20, y: 20 },
    { x: 30, y: 20 },
  ];

  it("점<2, radius<=0, strength<=0, 캔버스 크기 비정상이면 null", () => {
    expect(buildLiquifyDisplacementField([{ x: 1, y: 1 }], 5, 0.5, 100, 100)).toBeNull();
    expect(buildLiquifyDisplacementField(P, 0, 0.5, 100, 100)).toBeNull();
    expect(buildLiquifyDisplacementField(P, 5, 0, 100, 100)).toBeNull();
    expect(buildLiquifyDisplacementField(P, 5, 0.5, 0, 100)).toBeNull();
    expect(buildLiquifyDisplacementField(P, 5, 0.5, 100, Number.NaN)).toBeNull();
  });

  it("필드 바운딩박스는 점 궤적 범위를 반경만큼 확장한 크기다(캔버스 안쪽으로 클램프)", () => {
    const field = buildLiquifyDisplacementField(P, 5, 1, 100, 100)!;
    expect(field).not.toBeNull();
    // x: [20,30] ± 5 = [15,35] → width 21. y: 20±5=[15,25] → height 11.
    expect(field.originX).toBe(15);
    expect(field.originY).toBe(15);
    expect(field.width).toBe(21);
    expect(field.height).toBe(11);
  });

  it("오른쪽으로 드래그하면 그 구간 중심 픽셀의 변위는 +x 방향이다", () => {
    const field = buildLiquifyDisplacementField(P, 8, 1, 100, 100)!;
    const idx = (20 - field.originY) * field.width + (25 - field.originX);
    expect(field.dx[idx]).toBeGreaterThan(0);
  });

  it("strength가 클수록 같은 궤적의 변위 크기도 커진다", () => {
    const weak = buildLiquifyDisplacementField(P, 8, 0.2, 100, 100)!;
    const strong = buildLiquifyDisplacementField(P, 8, 1, 100, 100)!;
    const idx = (20 - weak.originY) * weak.width + (25 - weak.originX);
    expect(Math.abs(strong.dx[idx]!)).toBeGreaterThan(Math.abs(weak.dx[idx]!));
  });

  it("겹치는 두 스트로크(왕복)는 변위를 단순 합산한다 — 반대 방향 왕복은 서로 상쇄된다", () => {
    // 오른쪽으로 갔다가 정확히 같은 경로로 되돌아옴 — 세그먼트 방향 벡터가 서로 반대라 합산하면
    // 대칭 지점에서 상쇄에 가까워진다(완전히 0은 아닐 수 있음 — falloff 가중치가 위치마다 달라서).
    const roundTrip: LiquifyPixelPoint[] = [
      { x: 20, y: 20 },
      { x: 30, y: 20 },
      { x: 20, y: 20 },
    ];
    const field = buildLiquifyDisplacementField(roundTrip, 8, 1, 100, 100)!;
    const idx = (20 - field.originY) * field.width + (25 - field.originX);
    // 왕복이 아닌 편도(한 방향)보다는 절대값이 작아야 한다(상쇄 효과 확인).
    const oneWay = buildLiquifyDisplacementField(P, 8, 1, 100, 100)!;
    const oneWayIdx = (20 - oneWay.originY) * oneWay.width + (25 - oneWay.originX);
    expect(Math.abs(field.dx[idx]!)).toBeLessThan(Math.abs(oneWay.dx[oneWayIdx]!));
  });

  it("필드 경계(바운딩박스 가장자리)의 변위는 정확히 0이다(falloff가 경계에서 0으로 수렴)", () => {
    const field = buildLiquifyDisplacementField(P, 8, 1, 100, 100)!;
    // 좌상단 코너(원거리) — 어떤 궤적 점에서도 dist>=radius 이므로 가중치 0.
    expect(field.dx[0]).toBe(0);
    expect(field.dy[0]).toBe(0);
  });

  it("회귀: 궤적 중간에 비유한 점이 섞여도 필드가 NaN으로 오염되지 않는다", () => {
    // 이 케이스는 이전엔 resampleLiquifyPath 가 비유한 점을 그대로 통과시켜, 이 함수의 가중치
    // 누적 루프에서 clampInt/clampFloat 의 "NaN → min 인자로 폴백" 특성과 맞물려 필드의 한
    // 행/열 전체가 NaN 으로 오염되는 버그가 있었다(렌더 시 그 줄이 원본 (0,0) 픽셀 색으로
    // 잘못 칠해짐 — 크래시가 아니라 조용한 픽셀 손상이라 더 위험했다). resampleLiquifyPath 가
    // 입력 단계에서 비유한 점을 걸러내도록 고쳐 필드 자체에 NaN 이 전혀 생기지 않아야 한다.
    const withNaN: LiquifyPixelPoint[] = [
      { x: 20, y: 20 },
      { x: Number.NaN, y: 20 },
      { x: 30, y: 20 },
    ];
    const field = buildLiquifyDisplacementField(withNaN, 8, 1, 100, 100);
    expect(field).not.toBeNull();
    if (field) {
      for (let i = 0; i < field.dx.length; i++) {
        expect(Number.isFinite(field.dx[i])).toBe(true);
        expect(Number.isFinite(field.dy[i])).toBe(true);
      }
      // NaN 점 하나를 걸러낸 결과는 (20,20)→(30,20) 편도와 사실상 동일해야 한다.
      const clean = buildLiquifyDisplacementField(P, 8, 1, 100, 100)!;
      expect(field.originX).toBe(clean.originX);
      expect(field.originY).toBe(clean.originY);
      expect(Array.from(field.dx)).toEqual(Array.from(clean.dx));
      expect(Array.from(field.dy)).toEqual(Array.from(clean.dy));
    }
  });

  it("회귀: 궤적 끝점이 비유한이어도(유효 점이 1개로 줄어) null — 렌더링 오염 대신 안전하게 무변화", () => {
    const onlyOneValid: LiquifyPixelPoint[] = [
      { x: 20, y: 20 },
      { x: Number.NaN, y: 20 },
    ];
    expect(buildLiquifyDisplacementField(onlyOneValid, 8, 1, 100, 100)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (B) sampleBilinearClamped
// ---------------------------------------------------------------------------

describe("sampleBilinearClamped", () => {
  it("정수 좌표에서는 해당 픽셀 색을 정확히 반환한다", () => {
    const img = paintedImage(4, 4, (x, y) => [x * 10, y * 10, 0, 255]);
    expect(sampleBilinearClamped(img, 2, 3)).toEqual([20, 30, 0, 255]);
  });

  it("반 픽셀 지점은 인접 두 픽셀의 평균이다", () => {
    const img = paintedImage(4, 4, (x) => [x < 2 ? 0 : 100, 0, 0, 255]);
    // (1,0)=0, (2,0)=100 사이 x=1.5 지점 → 평균 50.
    const [r] = sampleBilinearClamped(img, 1.5, 0);
    expect(r).toBeCloseTo(50, 5);
  });

  it("이미지 밖 좌표는 클램프-투-엣지(가장자리 픽셀을 그대로 반환, 블러 없음)", () => {
    const img = paintedImage(4, 4, (x, y) => [x * 10, y * 10, 0, 255]);
    expect(sampleBilinearClamped(img, -50, -50)).toEqual([0, 0, 0, 255]);
    expect(sampleBilinearClamped(img, 999, 999)).toEqual([30, 30, 0, 255]);
  });

  it("w/h<=0 이면 [0,0,0,0]", () => {
    expect(sampleBilinearClamped({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, 0, 0)).toEqual([
      0, 0, 0, 0,
    ]);
  });
});

// ---------------------------------------------------------------------------
// (B) applyLiquifyDisplacement
// ---------------------------------------------------------------------------

describe("applyLiquifyDisplacement", () => {
  it("변위 (dx,dy)만큼 역방향(backward mapping)으로 원본을 샘플링해 dst에 쓴다", () => {
    const src = paintedImage(10, 10, (x) => (x < 5 ? [0, 0, 0, 255] : [200, 200, 200, 255]));
    const dst = cloneImage(src);
    // (7,5) 지점에 dx=+2 변위 → 원본의 (5,5)=[200,200,200] 이 아니라, 정확히는 x-dx=5 지점(경계라
    // 200/0 사이 반반) 근처를 읽는다. 더 명확한 지점(9,5, dx=+2 → 원본 x=7=200)으로 검증.
    const field = {
      originX: 9,
      originY: 5,
      width: 1,
      height: 1,
      dx: new Float32Array([2]),
      dy: new Float32Array([0]),
    };
    applyLiquifyDisplacement(src, dst, field);
    expect(pixelAt(dst, 9, 5)).toEqual([200, 200, 200, 255]);
  });

  it("변위가 정확히 (0,0)인 셀은 건드리지 않는다(no-op 최적화)", () => {
    const src = solidImage(4, 4, 10, 20, 30);
    const dst = solidImage(4, 4, 99, 99, 99); // dst가 src와 다른 값이어도 변위 0이면 그대로 유지.
    const field = { originX: 0, originY: 0, width: 4, height: 4, dx: new Float32Array(16), dy: new Float32Array(16) };
    applyLiquifyDisplacement(src, dst, field);
    expect(pixelAt(dst, 1, 1)).toEqual([99, 99, 99, 255]);
  });

  it("필드가 캔버스 경계를 벗어나는 부분은 건너뛰고 크래시하지 않는다", () => {
    const src = solidImage(4, 4, 1, 2, 3);
    const dst = cloneImage(src);
    const field = {
      originX: -2,
      originY: -2,
      width: 4,
      height: 4,
      dx: new Float32Array(16).fill(1),
      dy: new Float32Array(16).fill(1),
    };
    expect(() => applyLiquifyDisplacement(src, dst, field)).not.toThrow();
  });

  it("회귀: 궤적 중간 비유한 점이 있어도 전체 파이프라인(필드→렌더)에서 무관한 먼 픽셀이 (0,0) 색으로 오염되지 않는다", () => {
    // buildLiquifyDisplacementField 의 회귀 테스트가 필드 자체의 NaN 부재를 확인한다면, 이 테스트는
    // 그 필드를 실제로 렌더링했을 때 최종 픽셀 색까지 정확한지 end-to-end 로 재확인한다(회귀 발견
    // 당시엔 필드의 특정 행/열 전체가 원본의 (0,0) 픽셀 색으로 잘못 칠해졌었다).
    const src = paintedImage(100, 100, (x, y) => [x, y, 128, 255]); // 픽셀(0,0)=[0,0,128,255], 서로 다른 색.
    const withNaN: LiquifyPixelPoint[] = [
      { x: 20, y: 20 },
      { x: Number.NaN, y: 20 },
      { x: 30, y: 20 },
    ];
    const field = buildLiquifyDisplacementField(withNaN, 8, 1, 100, 100)!;
    expect(field).not.toBeNull();
    const dst = cloneImage(src);
    applyLiquifyDisplacement(src, dst, field);
    // 스트로크가 전혀 닿지 않는 먼 지점(필드 바운딩박스 밖)은 원본과 정확히 같아야 한다 —
    // 회귀 당시엔 필드 왼쪽 경계 열 전체가 (0,0)의 [0,0,128,255]로 잘못 칠해졌다.
    const farX = field.originX - 5 >= 0 ? field.originX - 5 : field.originX + field.width + 5;
    for (let y = field.originY; y < field.originY + field.height; y++) {
      expect(pixelAt(dst, farX, y)).toEqual(pixelAt(src, farX, y));
    }
  });
});

// ---------------------------------------------------------------------------
// (C) bakeLiquifyStrokeToCanvas — DOM 없는 가짜 팩토리(studio-heal-clone.test.ts와 동일 패턴)
// ---------------------------------------------------------------------------

type FakeCanvas = MaskCanvasLike & MaskImageSource & { id: number };
type FakeSource = MaskImageSource & { testImage: StudioImageDataLike };

function fakeLiquifyFactory(
  log: string[],
  buffers: Map<number, StudioImageDataLike>,
  failAt = Infinity
): LiquifyCanvasFactory {
  let count = 0;
  return (width, height) => {
    count += 1;
    if (count >= failAt) return null;
    const id = count;
    const canvas: FakeCanvas = { id, width, height };
    buffers.set(id, { data: new Uint8ClampedArray(width * height * 4), width, height });
    const ctx: LiquifyCtx2DLike = {
      fillStyle: "#fff",
      strokeStyle: "#fff",
      globalCompositeOperation: "source-over",
      filter: "none",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      fillRect: () => {},
      clearRect: () => {},
      drawImage: (image) => {
        log.push(`c${id}:drawImage`);
        const testImage = (image as FakeSource).testImage;
        buffers.set(id, { data: testImage.data.slice() as Uint8ClampedArray, width, height });
      },
      getImageData: (sx, sy, sw, sh) => {
        log.push(`c${id}:getImageData`);
        const buf = buffers.get(id)!;
        const data = new Uint8ClampedArray(sw * sh * 4);
        for (let y = 0; y < sh; y += 1) {
          for (let x = 0; x < sw; x += 1) {
            const sourceOffset = ((sy + y) * width + sx + x) * 4;
            data.set(buf.data.subarray(sourceOffset, sourceOffset + 4), (y * sw + x) * 4);
          }
        }
        return { data, width: sw, height: sh };
      },
      putImageData: (imageData, dx, dy) => {
        log.push(`c${id}:putImageData`);
        const buf = buffers.get(id)!;
        for (let y = 0; y < imageData.height; y += 1) {
          for (let x = 0; x < imageData.width; x += 1) {
            const sourceOffset = (y * imageData.width + x) * 4;
            const targetOffset = ((dy + y) * width + dx + x) * 4;
            buf.data.set(imageData.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
          }
        }
      },
    };
    return { canvas, ctx };
  };
}

describe("bakeLiquifyStrokeToCanvas", () => {
  const points: LiquifyPixelPoint[] = [
    { x: 5, y: 10 },
    { x: 15, y: 10 },
  ];

  it("변위 필드가 없으면(점<2 등) 캔버스를 아예 만들지 않고 null", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeLiquifyFactory(log, buffers);
    const source: FakeSource = { testImage: solidImage(20, 20, 1, 1, 1) };
    const out = await bakeLiquifyStrokeToCanvas(source, 20, 20, [{ x: 1, y: 1 }], 5, 0.5, factory);
    expect(out).toBeNull();
    expect(log).toEqual([]);
  });

  it("full-size 결과 캔버스 하나만 만들고 ROI만 읽고 써서 반환한다", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeLiquifyFactory(log, buffers);
    const testImage = paintedImage(20, 20, (x) => (x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const source: FakeSource = { testImage };

    const out = await bakeLiquifyStrokeToCanvas(source, 20, 20, points, 8, 1, factory, {
      executionMode: "direct",
    });

    expect(out).not.toBeNull();
    expect((out as FakeCanvas).id).toBe(1);
    expect(log).toEqual([
      "c1:drawImage",
      "c1:getImageData",
      "c1:putImageData",
    ]);

    const workBuf = buffers.get(1)!;

    // 오케스트레이션이 알고리즘을 바꾸지 않는다 — 직접 계산한 결과와 정확히 일치해야 한다.
    const field = buildLiquifyDisplacementField(points, 8, 1, 20, 20)!;
    const expectedDst = cloneImage(testImage);
    applyLiquifyDisplacement(testImage, expectedDst, field);
    expect(workBuf.data).toEqual(expectedDst.data);
  });

  it.each([
    { flipX: false, flipY: false, expectedPoints: [{ x: 4, y: 6 }, { x: 9, y: 12 }] },
    { flipX: true, flipY: false, expectedPoints: [{ x: 16, y: 6 }, { x: 11, y: 12 }] },
    { flipX: false, flipY: true, expectedPoints: [{ x: 4, y: 24 }, { x: 9, y: 18 }] },
    { flipX: true, flipY: true, expectedPoints: [{ x: 16, y: 24 }, { x: 11, y: 18 }] },
  ])(
    "표시 좌표를 원본 좌표로 보정한다(flipX=$flipX, flipY=$flipY)",
    async ({ flipX, flipY, expectedPoints }) => {
      const log: string[] = [];
      const buffers = new Map<number, StudioImageDataLike>();
      const factory = fakeLiquifyFactory(log, buffers);
      const testImage = paintedImage(20, 30, (x, y) => [x * 9, y * 7, (x + y) * 3, 255]);
      const source: FakeSource = { testImage };
      const displayPoints: LiquifyPixelPoint[] = [
        { x: 4, y: 6 },
        { x: 9, y: 12 },
      ];

      const out = await bakeLiquifyStrokeToCanvas(
        source,
        20,
        30,
        displayPoints,
        4,
        0.75,
        factory,
        { flipX, flipY, executionMode: "direct" }
      );

      expect(out).not.toBeNull();
      const expectedField = buildLiquifyDisplacementField(expectedPoints, 4, 0.75, 20, 30)!;
      const expectedDst = cloneImage(testImage);
      applyLiquifyDisplacement(testImage, expectedDst, expectedField);
      expect(buffers.get(1)!.data).toEqual(expectedDst.data);
    }
  );

  it("결과 캔버스 생성이 실패하면 null", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeLiquifyFactory(log, buffers, 1);
    const source: FakeSource = { testImage: solidImage(20, 20, 1, 1, 1) };
    const out = await bakeLiquifyStrokeToCanvas(source, 20, 20, points, 8, 1, factory);
    expect(out).toBeNull();
  });

  it("width/height가 비정상이면 캔버스를 만들지 않고 null", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeLiquifyFactory(log, buffers);
    const source: FakeSource = { testImage: solidImage(20, 20, 1, 1, 1) };
    expect(await bakeLiquifyStrokeToCanvas(source, 0, 20, points, 8, 1, factory)).toBeNull();
    expect(await bakeLiquifyStrokeToCanvas(source, 20, Number.NaN, points, 8, 1, factory)).toBeNull();
    expect(log).toEqual([]);
  });
});
