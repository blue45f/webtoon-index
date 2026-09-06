import { describe, expect, it, vi } from "vitest";

import {
  LIQUIFY_MAX_DAB_CELL_VISITS,
  LIQUIFY_MAX_FIELD_CELLS,
  STUDIO_LIQUIFY_MODES,
  applyLiquifyDisplacement,
  buildLiquifyDisplacementField,
  normalizeStudioLiquifyMode,
  type LiquifyDisplacementField,
  type LiquifyPixelPoint,
  type StudioLiquifyMode,
} from "./studio-liquify";
import { bakeLiquifyStrokeToCanvas, type LiquifyCanvasFactory } from "./studio-liquify-browser";
import {
  runStudioLiquifyWorker,
  type StudioLiquifyWorkerLike,
} from "./studio-liquify-worker-client";

import type { StudioImageDataLike } from "./studio-filters";
import type { MaskImageSource } from "./studio-selection-tools";

function vectorAt(field: LiquifyDisplacementField, x: number, y: number): [number, number] {
  const idx = (y - field.originY) * field.width + (x - field.originX);
  return [field.dx[idx]!, field.dy[idx]!];
}

function blankImage(width: number, height: number): StudioImageDataLike {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function fakeCanvasFactory(calls: string[]): LiquifyCanvasFactory {
  let id = 0;
  return (width, height) => {
    id += 1;
    const canvas = { width, height } as MaskImageSource & { width: number; height: number };
    let image = blankImage(width, height);
    return {
      canvas,
      ctx: {
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
        drawImage: () => calls.push(`canvas-${id}:draw`),
        getImageData: () => ({ ...image, data: image.data.slice() as Uint8ClampedArray }),
        putImageData: (next) => {
          image = next;
          calls.push(`canvas-${id}:put`);
        },
      },
    };
  };
}

describe("studio liquify commercial modes", () => {
  const center: LiquifyPixelPoint = { x: 50, y: 50 };

  it("publishes a stable, duplicate-free mode contract and safely normalizes persisted input", () => {
    expect(STUDIO_LIQUIFY_MODES).toEqual([
      "push",
      "twirl-clockwise",
      "twirl-counterclockwise",
      "pinch",
      "bloat",
    ]);
    expect(new Set(STUDIO_LIQUIFY_MODES).size).toBe(STUDIO_LIQUIFY_MODES.length);
    expect(normalizeStudioLiquifyMode("pinch")).toBe("pinch");
    expect(normalizeStudioLiquifyMode("unknown-from-storage")).toBe("push");
    expect(normalizeStudioLiquifyMode(null)).toBe("push");
  });

  it("twirl 방향은 화면 좌표계에서 시계/반시계가 정확히 반대다", () => {
    const clockwise = buildLiquifyDisplacementField([center], 20, 1, 100, 100, {
      mode: "twirl-clockwise",
    })!;
    const counterclockwise = buildLiquifyDisplacementField([center], 20, 1, 100, 100, {
      mode: "twirl-counterclockwise",
    })!;

    const [clockwiseX, clockwiseY] = vectorAt(clockwise, 60, 50);
    const [counterclockwiseX, counterclockwiseY] = vectorAt(counterclockwise, 60, 50);
    expect(clockwiseY).toBeGreaterThan(0);
    expect(counterclockwiseY).toBeLessThan(0);
    expect(clockwiseX).toBeCloseTo(counterclockwiseX, 6);
    expect(clockwiseY).toBeCloseTo(-counterclockwiseY, 6);
  });

  it("pinch는 중심 쪽, bloat는 중심 바깥쪽으로 움직이며 중심과 반경 경계는 안정적이다", () => {
    const pinch = buildLiquifyDisplacementField([center], 20, 1, 100, 100, { mode: "pinch" })!;
    const bloat = buildLiquifyDisplacementField([center], 20, 1, 100, 100, { mode: "bloat" })!;

    expect(vectorAt(pinch, 60, 50)[0]).toBeLessThan(0);
    expect(vectorAt(bloat, 60, 50)[0]).toBeGreaterThan(0);
    expect(vectorAt(pinch, 50, 50)).toEqual([0, 0]);
    expect(vectorAt(bloat, 50, 50)).toEqual([0, 0]);
    expect(vectorAt(pinch, 70, 50)).toEqual([0, 0]);
    expect(vectorAt(bloat, 70, 50)).toEqual([0, 0]);
  });

  it.each<StudioLiquifyMode>([
    "twirl-clockwise",
    "twirl-counterclockwise",
    "pinch",
    "bloat",
  ])("%s는 한 점 dab도 유효하지만 Push 한 점은 방향이 없어 null이다", (mode) => {
    expect(buildLiquifyDisplacementField([center], 12, 0.5, 100, 100, { mode })).not.toBeNull();
    expect(buildLiquifyDisplacementField([center], 12, 0.5, 100, 100)).toBeNull();
  });

  it("강도는 0..1로 제한되고 반경·강도 증가는 효과를 단조롭게 키운다", () => {
    const weak = buildLiquifyDisplacementField([center], 20, 0.25, 100, 100, { mode: "bloat" })!;
    const strong = buildLiquifyDisplacementField([center], 20, 1, 100, 100, { mode: "bloat" })!;
    const excessive = buildLiquifyDisplacementField([center], 20, 10_000, 100, 100, { mode: "bloat" })!;
    const wide = buildLiquifyDisplacementField([center], 30, 1, 100, 100, { mode: "bloat" })!;

    expect(vectorAt(strong, 60, 50)[0]).toBeGreaterThan(vectorAt(weak, 60, 50)[0]);
    expect(Array.from(excessive.dx)).toEqual(Array.from(strong.dx));
    expect(Array.from(excessive.dy)).toEqual(Array.from(strong.dy));
    expect(vectorAt(wide, 60, 50)[0]).toBeGreaterThan(vectorAt(strong, 60, 50)[0]);
  });

  it.each<StudioLiquifyMode>(STUDIO_LIQUIFY_MODES)("%s 필드는 같은 입력에서 바이트 단위로 결정적이다", (mode) => {
    const path = [
      { x: 30.25, y: 40.75 },
      { x: 50.5, y: 55.125 },
      { x: 72.75, y: 48.25 },
    ];
    const first = buildLiquifyDisplacementField(path, 18.5, 0.63, 120, 100, { mode })!;
    const second = buildLiquifyDisplacementField(path, 18.5, 0.63, 120, 100, { mode })!;
    expect(second).toEqual(first);
    expect(new Uint8Array(second.dx.buffer)).toEqual(new Uint8Array(first.dx.buffer));
    expect(new Uint8Array(second.dy.buffer)).toEqual(new Uint8Array(first.dy.buffer));
  });

  it("병적 캔버스·경로는 필드 상한 전에 거절하고 누적 변위는 반경의 두 배로 제한한다", () => {
    const tooLarge = buildLiquifyDisplacementField(
      [{ x: 0, y: 0 }, { x: 100_000_000, y: 100_000_000 }],
      100,
      1,
      1_000_000_000,
      1_000_000_000
    );
    expect(tooLarge).toBeNull();
    expect(LIQUIFY_MAX_FIELD_CELLS).toBeLessThan(20_000_000);
    expect(LIQUIFY_MAX_DAB_CELL_VISITS).toBeLessThan(100_000_000);

    const pathologicalScrub = Array.from({ length: 5_000 }, (_, index) => ({
      x: index % 2 === 0 ? 1_000 : 3_000,
      y: 1_000,
    }));
    expect(buildLiquifyDisplacementField(
      pathologicalScrub,
      1_000,
      1,
      4_001,
      2_001,
      { mode: "twirl-clockwise" }
    )).toBeNull();

    const loopingPath = Array.from({ length: 300 }, (_, index) => {
      const angle = index * 0.31;
      return { x: 50 + Math.cos(angle) * 2, y: 50 + Math.sin(angle) * 2 };
    });
    const field = buildLiquifyDisplacementField(loopingPath, 12, 1, 100, 100, { mode: "bloat" })!;
    for (let index = 0; index < field.dx.length; index += 1) {
      expect(Math.hypot(field.dx[index]!, field.dy[index]!)).toBeLessThanOrEqual(24.000_01);
    }
  });

  it("잘못된 필드 차원·NaN 변위는 렌더러를 중단시키거나 픽셀을 오염시키지 않는다", () => {
    const src = blankImage(4, 4);
    const dst = blankImage(4, 4);
    dst.data.fill(77);
    applyLiquifyDisplacement(src, dst, {
      originX: 0,
      originY: 0,
      width: 1_000_000,
      height: 1_000_000,
      dx: new Float32Array(1),
      dy: new Float32Array(1),
    });
    expect([...dst.data]).toEqual(Array.from({ length: dst.data.length }, () => 77));

    applyLiquifyDisplacement(src, dst, {
      originX: 1,
      originY: 1,
      width: 1,
      height: 1,
      dx: new Float32Array([Number.NaN]),
      dy: new Float32Array([1]),
    });
    expect(dst.data[20]).toBe(77);
  });

  it("Canvas 오케스트레이션이 선택 모드를 코어에 전달하고 기존 생략 호출은 Push를 유지한다", async () => {
    const source = {} as MaskImageSource;
    const bloatCalls: string[] = [];
    const bloat = await bakeLiquifyStrokeToCanvas(
      source,
      20,
      20,
      [{ x: 10, y: 10 }],
      8,
      1,
      fakeCanvasFactory(bloatCalls),
      { mode: "bloat", executionMode: "direct" }
    );
    expect(bloat).not.toBeNull();
    expect(bloatCalls).toEqual(["canvas-1:draw", "canvas-1:put"]);

    const pushCalls: string[] = [];
    const push = await bakeLiquifyStrokeToCanvas(
      source,
      20,
      20,
      [{ x: 10, y: 10 }],
      8,
      1,
      fakeCanvasFactory(pushCalls),
      { executionMode: "direct" }
    );
    expect(push).toBeNull();
    expect(pushCalls).toEqual([]);
  });
});

describe("studio liquify cancellation", () => {
  it("이미 취소된 신호는 필드 할당과 Canvas 생성을 시작하지 않는다", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => buildLiquifyDisplacementField(
      [{ x: 5, y: 5 }, { x: 10, y: 10 }],
      8,
      1,
      20,
      20,
      { signal: controller.signal }
    )).toThrow(expect.objectContaining({ name: "AbortError" }));

    const calls: string[] = [];
    const source = {} as MaskImageSource;
    await expect(bakeLiquifyStrokeToCanvas(
      source,
      20,
      20,
      [{ x: 10, y: 10 }],
      8,
      1,
      fakeCanvasFactory(calls),
      { mode: "bloat", signal: controller.signal }
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toEqual([]);
  });

  it("긴 dab 내부에서도 취소 신호를 주기적으로 관찰한다", () => {
    let abortReads = 0;
    const signal = {
      get aborted() {
        abortReads += 1;
        return abortReads >= 3;
      },
    } as AbortSignal;

    expect(() => buildLiquifyDisplacementField(
      [{ x: 100, y: 100 }],
      80,
      1,
      240,
      240,
      { mode: "bloat", signal }
    )).toThrow(expect.objectContaining({ name: "AbortError" }));
    expect(abortReads).toBeGreaterThanOrEqual(3);
  });

  it("대기 중 Worker 실행을 취소하면 AbortError로 끝내고 Worker를 종료한다", async () => {
    const controller = new AbortController();
    const worker: StudioLiquifyWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    const field = buildLiquifyDisplacementField(
      [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      1,
      1,
      4,
      4
    )!;
    const promise = runStudioLiquifyWorker(
      { src: blankImage(4, 4), dst: blankImage(4, 4), field },
      { signal: controller.signal, workerFactory: () => worker }
    );
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.postMessage).not.toHaveBeenCalled();
  });
});
