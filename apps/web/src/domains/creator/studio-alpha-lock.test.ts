import { describe, expect, it } from "vitest";

import {
  applyAlphaLockToRasterPixels,
  canAlphaLock,
  compositeAlphaLocked,
  shouldClipToExistingAlpha,
  type AlphaLockLayerLike,
} from "./studio-alpha-lock";

import type { MaskCanvasLike, MaskCtx2DLike, SelectionCanvasFactory } from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 테스트 픽스처 — 가짜 ctx(호출 기록) + 가짜 캔버스 팩토리
// studio-selection-tools.test.ts 의 fakeCtx/fakeFactory 와 동일 패턴의 로컬 사본
// (이 코드베이스 컨벤션 — 순수 모듈마다 자체 테스트 픽스처를 갖고, 테스트 파일 간 import 없음).
// compositeAlphaLocked 가 실제로 쓰는 멤버(globalCompositeOperation/drawImage)만 로그를 남기면
// 충분하지만, MaskCtx2DLike 구조 타입 전체를 채워야 대입이 컴파일된다.
// ---------------------------------------------------------------------------

type FakeCanvas = MaskCanvasLike & { id: number };

function fakeCtx(log: string[], label: string): MaskCtx2DLike {
  let gco = "source-over";
  return {
    fillStyle: "#ffffff",
    strokeStyle: "#ffffff",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    filter: "none",
    set globalCompositeOperation(v: string) {
      gco = v;
      log.push(`${label}:gco=${v}`);
    },
    get globalCompositeOperation(): string {
      return gco;
    },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    clearRect: (x: number, y: number, w: number, h: number) => log.push(`${label}:clearRect(${x},${y},${w},${h})`),
    drawImage: (image: any, dx: number, dy: number) => log.push(`${label}:drawImage(#${(image as FakeCanvas).id},${dx},${dy})`),
    getImageData: (x: number, y: number, w: number, h: number) => {
      log.push(`${label}:getImageData(${x},${y},${w},${h})`);
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
    putImageData: (_data: any, x: number, y: number) => log.push(`${label}:putImageData(${x},${y})`),
  } as unknown as MaskCtx2DLike;
}

/** 생성 순서대로 id 를 붙이는 가짜 팩토리 — n 번째 생성부터 실패시킬 수도 있다. */
function fakeFactory(log: string[], failAt = Infinity): SelectionCanvasFactory {
  let count = 0;
  return (width, height) => {
    count += 1;
    if (count >= failAt) return null;
    const canvas: FakeCanvas = { id: count, width, height };
    log.push(`create#${count}(${width}x${height})`);
    return { canvas, ctx: fakeCtx(log, `c${count}`) };
  };
}

// ---------------------------------------------------------------------------
// canAlphaLock / shouldClipToExistingAlpha
// ---------------------------------------------------------------------------

describe("canAlphaLock", () => {
  it("image 타입만 true — 자체 래스터(src) 픽셀을 가진 요소만 알파 락이 의미 있다", () => {
    expect(canAlphaLock({ type: "image" })).toBe(true);
  });

  it("image 가 아니거나 type 이 없으면 false", () => {
    const nonImageTypes: AlphaLockLayerLike[] = [
      { type: "text" },
      { type: "draw" },
      { type: "bubble" },
      { type: "sticker" },
      { type: "frame" },
      { type: "focusLines" },
      { type: "speedLines" },
      {},
    ];
    for (const el of nonImageTypes) {
      expect(canAlphaLock(el)).toBe(false);
    }
  });
});

describe("shouldClipToExistingAlpha", () => {
  it("image + alphaLocked:true 일 때만 true", () => {
    expect(shouldClipToExistingAlpha({ type: "image", alphaLocked: true })).toBe(true);
  });

  it("alphaLocked 가 false/undefined 면 false", () => {
    expect(shouldClipToExistingAlpha({ type: "image", alphaLocked: false })).toBe(false);
    expect(shouldClipToExistingAlpha({ type: "image" })).toBe(false);
  });

  it("방어적 — image 가 아닌 요소에 alphaLocked:true 가 붙어 있어도 무시(false)", () => {
    expect(shouldClipToExistingAlpha({ type: "text", alphaLocked: true })).toBe(false);
    expect(shouldClipToExistingAlpha({ alphaLocked: true })).toBe(false);
  });
});

describe("applyAlphaLockToRasterPixels", () => {
  it("forces the immutable alpha silhouette while copying edited RGB without source-atop reblending", () => {
    const lockSource = new Uint8ClampedArray([
      10, 20, 30, 128,
      40, 50, 60, 255,
    ]);
    const before = new Uint8ClampedArray([
      70, 80, 90, 128,
      100, 110, 120, 255,
    ]);
    const edited = new Uint8ClampedArray([
      200, 30, 40, 255,
      20, 210, 50, 190,
    ]);

    expect(applyAlphaLockToRasterPixels(lockSource, before, edited)).toEqual({
      data: new Uint8ClampedArray([
        200, 30, 40, 128,
        20, 210, 50, 255,
      ]),
      changedPixelCount: 2,
    });
  });

  it("retains fully transparent prior bytes and counts only this continuous-fill increment", () => {
    const lockSource = new Uint8ClampedArray([
      1, 2, 3, 0,
      4, 5, 6, 255,
      7, 8, 9, 255,
    ]);
    const before = new Uint8ClampedArray([
      11, 12, 13, 0,
      210, 20, 30, 255,
      40, 50, 60, 255,
    ]);
    const edited = new Uint8ClampedArray([
      250, 250, 250, 255,
      210, 20, 30, 255,
      30, 220, 40, 255,
    ]);

    const result = applyAlphaLockToRasterPixels(lockSource, before, edited);

    expect(result.data).toEqual(new Uint8ClampedArray([
      11, 12, 13, 0,
      210, 20, 30, 255,
      30, 220, 40, 255,
    ]));
    expect(result.changedPixelCount).toBe(1);
  });

  it("rejects mismatched or non-RGBA buffers", () => {
    expect(() =>
      applyAlphaLockToRasterPixels(
        new Uint8ClampedArray(4),
        new Uint8ClampedArray(8),
        new Uint8ClampedArray(4),
      ),
    ).toThrow(RangeError);
    expect(() =>
      applyAlphaLockToRasterPixels(
        new Uint8ClampedArray(3),
        new Uint8ClampedArray(3),
        new Uint8ClampedArray(3),
      ),
    ).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// compositeAlphaLocked
// ---------------------------------------------------------------------------

describe("compositeAlphaLocked", () => {
  it("원본, 편집후 이미지를 각각 그리고 getImageData 로 가져와 픽셀단위 알파 합성후 putImageData, 반환은 유일하게 생성된 캔버스", () => {
    const log: string[] = [];
    const original: FakeCanvas = { id: 900, width: 100, height: 50 };
    const edited: FakeCanvas = { id: 901, width: 100, height: 50 };
    const out = compositeAlphaLocked(original, edited, 100, 50, fakeFactory(log));
    expect((out as FakeCanvas).id).toBe(1);
    expect(log).toEqual([
      "create#1(100x50)",
      "c1:drawImage(#900,0,0)",
      "c1:getImageData(0,0,100,50)",
      "c1:clearRect(0,0,100,50)",
      "c1:drawImage(#901,0,0)",
      "c1:getImageData(0,0,100,50)",
      "c1:putImageData(0,0)",
    ]);
  });

  it("팩토리가 null 을 주면(2D 컨텍스트 획득 실패) null — drawImage 를 전혀 시도하지 않는다", () => {
    const log: string[] = [];
    const original: FakeCanvas = { id: 1, width: 10, height: 10 };
    const edited: FakeCanvas = { id: 2, width: 10, height: 10 };
    const out = compositeAlphaLocked(original, edited, 10, 10, fakeFactory(log, 1));
    expect(out).toBeNull();
    expect(log.some((l) => l.includes("drawImage"))).toBe(false);
  });

  it("width<=0 / height<=0 / NaN / Infinity 는 null(팩토리 호출 없음)", () => {
    const log: string[] = [];
    const original: FakeCanvas = { id: 1, width: 10, height: 10 };
    const edited: FakeCanvas = { id: 2, width: 10, height: 10 };
    const factory = fakeFactory(log);
    expect(compositeAlphaLocked(original, edited, 0, 10, factory)).toBeNull();
    expect(compositeAlphaLocked(original, edited, 10, 0, factory)).toBeNull();
    expect(compositeAlphaLocked(original, edited, -5, 10, factory)).toBeNull();
    expect(compositeAlphaLocked(original, edited, Number.NaN, 10, factory)).toBeNull();
    expect(compositeAlphaLocked(original, edited, Number.POSITIVE_INFINITY, 10, factory)).toBeNull();
    expect(log).toEqual([]);
  });

  it("분수 크기는 반올림, 1 미만은 1로 바닥(applySelectionAdjustToCanvas 와 동일 가드)", () => {
    const log: string[] = [];
    const original: FakeCanvas = { id: 1, width: 1, height: 1 };
    const edited: FakeCanvas = { id: 2, width: 1, height: 1 };
    compositeAlphaLocked(original, edited, 100.4, 50.6, fakeFactory(log));
    expect(log[0]).toBe("create#1(100x51)");
    log.length = 0;
    compositeAlphaLocked(original, edited, 0.2, 0.2, fakeFactory(log));
    expect(log[0]).toBe("create#1(1x1)");
  });
});
