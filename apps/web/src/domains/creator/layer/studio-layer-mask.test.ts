import { describe, expect, it } from "vitest";

import {
  bakeLayerMaskStroke,
  canLayerMask,
  compositeLayerMask,
  createLayerMaskCanvas,
  hasLayerMask,
  invertLayerMaskAlpha,
  layerMaskFeatherPx,
  paintLayerMaskStroke,
  shouldApplyLayerMask,
  type LayerMaskBrushStroke,
  type LayerMaskLike,
} from "./studio-layer-mask";

import type { MaskCanvasLike, MaskCtx2DLike, SelectionCanvasFactory } from "../studio-selection-tools";

// ---------------------------------------------------------------------------
// 테스트 픽스처 — studio-alpha-lock.test.ts/studio-selection-tools.test.ts와 동일 패턴의 로컬
// 사본(이 코드베이스 컨벤션 — 순수 모듈마다 자체 테스트 픽스처를 갖고, 테스트 파일 간 import 없음).
// ---------------------------------------------------------------------------

type FakeCanvas = MaskCanvasLike & { id: number };

function fakeCtx(log: string[], label: string): MaskCtx2DLike {
  let gco = "source-over";
  let fillStyle: unknown = "#000000";
  let strokeStyle: unknown = "#000000";
  let filter = "none";
  return {
    get fillStyle(): unknown {
      return fillStyle;
    },
    set fillStyle(v: unknown) {
      fillStyle = v;
      log.push(`${label}:fillStyle=${String(v)}`);
    },
    get strokeStyle(): unknown {
      return strokeStyle;
    },
    set strokeStyle(v: unknown) {
      strokeStyle = v;
      log.push(`${label}:strokeStyle=${String(v)}`);
    },
    get filter(): string {
      return filter;
    },
    set filter(v: string) {
      filter = v;
      log.push(`${label}:filter=${v}`);
    },
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    get globalCompositeOperation(): string {
      return gco;
    },
    set globalCompositeOperation(v: string) {
      gco = v;
      log.push(`${label}:gco=${v}`);
    },
    beginPath: () => log.push(`${label}:beginPath`),
    moveTo: (x, y) => log.push(`${label}:moveTo(${x},${y})`),
    lineTo: (x, y) => log.push(`${label}:lineTo(${x},${y})`),
    closePath: () => log.push(`${label}:closePath`),
    fill: () => log.push(`${label}:fill`),
    stroke: () => log.push(`${label}:stroke`),
    fillRect: (x, y, w, h) => log.push(`${label}:fillRect(${x},${y},${w},${h})`),
    clearRect: (x, y, w, h) => log.push(`${label}:clearRect(${x},${y},${w},${h})`),
    drawImage: (image, dx, dy) => log.push(`${label}:drawImage(#${(image as FakeCanvas).id},${dx},${dy})`),
  };
}

/** 생성 순서대로 id를 붙이는 가짜 팩토리 — n번째 생성부터 실패시킬 수도 있다. */
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
// canLayerMask / hasLayerMask / shouldApplyLayerMask
// ---------------------------------------------------------------------------

describe("canLayerMask", () => {
  it("image 타입만 true", () => {
    expect(canLayerMask({ type: "image" })).toBe(true);
  });

  it("image가 아니거나 type이 없으면 false", () => {
    const nonImageTypes: LayerMaskLike[] = [
      { type: "text" },
      { type: "draw" },
      { type: "bubble" },
      { type: "sticker" },
      { type: "frame" },
      {},
    ];
    for (const el of nonImageTypes) {
      expect(canLayerMask(el)).toBe(false);
    }
  });
});

describe("hasLayerMask", () => {
  it("maskSrc가 있으면 true(type과 무관 — 존재 술어)", () => {
    expect(hasLayerMask({ type: "image", maskSrc: "data:image/png;base64,x" })).toBe(true);
    expect(hasLayerMask({ maskSrc: "data:image/png;base64,x" })).toBe(true);
  });

  it("maskSrc가 없거나 빈 문자열이면 false", () => {
    expect(hasLayerMask({ type: "image" })).toBe(false);
    expect(hasLayerMask({ type: "image", maskSrc: "" })).toBe(false);
  });
});

describe("shouldApplyLayerMask", () => {
  it("image + maskSrc 있음 + maskEnabled 미설정(기본 켜짐)이면 true", () => {
    expect(shouldApplyLayerMask({ type: "image", maskSrc: "data:x" })).toBe(true);
  });

  it("maskEnabled:false면 마스크가 있어도 false(비활성화 — 삭제와 구분)", () => {
    expect(shouldApplyLayerMask({ type: "image", maskSrc: "data:x", maskEnabled: false })).toBe(false);
  });

  it("maskEnabled:true는 명시적으로 켜짐", () => {
    expect(shouldApplyLayerMask({ type: "image", maskSrc: "data:x", maskEnabled: true })).toBe(true);
  });

  it("방어적 — image가 아닌 요소에 maskSrc가 붙어 있어도 무시(false)", () => {
    expect(shouldApplyLayerMask({ type: "text", maskSrc: "data:x" })).toBe(false);
  });

  it("maskSrc가 없으면 false(canLayerMask만으론 부족)", () => {
    expect(shouldApplyLayerMask({ type: "image" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// layerMaskFeatherPx
// ---------------------------------------------------------------------------

describe("layerMaskFeatherPx", () => {
  it("hardness=1(하드 엣지)이면 0", () => {
    expect(layerMaskFeatherPx(40, 1)).toBe(0);
  });

  it("hardness=0(최대 페더)이면 반경*0.6", () => {
    expect(layerMaskFeatherPx(40, 0)).toBeCloseTo(24, 5);
  });

  it("hardness 범위를 벗어나면 0..1로 클램프", () => {
    expect(layerMaskFeatherPx(40, -1)).toBeCloseTo(24, 5);
    expect(layerMaskFeatherPx(40, 2)).toBe(0);
  });

  it("비양수/비유한 반경은 0 취급", () => {
    expect(layerMaskFeatherPx(0, 0)).toBe(0);
    expect(layerMaskFeatherPx(-5, 0)).toBe(0);
    expect(layerMaskFeatherPx(Number.NaN, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// paintLayerMaskStroke
// ---------------------------------------------------------------------------

const revealStroke = (points: { x: number; y: number }[]): LayerMaskBrushStroke => ({
  points,
  radiusPx: 10,
  hardness: 1, // feather=0 이라 filter 로그가 단순해짐
  strength: 1,
  mode: "reveal",
});

describe("paintLayerMaskStroke", () => {
  it("reveal 모드는 source-over + 흰색 rgba로 칠하고 끝에 원복한다", () => {
    const log: string[] = [];
    const ctx = fakeCtx(log, "c");
    paintLayerMaskStroke(ctx, revealStroke([{ x: 0, y: 0 }, { x: 10, y: 10 }]));
    expect(log).toEqual([
      "c:gco=source-over",
      "c:filter=none",
      "c:strokeStyle=rgba(255,255,255,1)",
      "c:fillStyle=rgba(255,255,255,1)",
      "c:beginPath",
      "c:moveTo(0,0)",
      "c:lineTo(10,10)",
      "c:stroke",
      "c:filter=none",
      "c:gco=source-over",
    ]);
  });

  it("conceal 모드는 destination-out으로 칠한다", () => {
    const log: string[] = [];
    const ctx = fakeCtx(log, "c");
    paintLayerMaskStroke(ctx, { ...revealStroke([{ x: 0, y: 0 }, { x: 5, y: 5 }]), mode: "conceal" });
    expect(log[0]).toBe("c:gco=destination-out");
    expect(log[log.length - 1]).toBe("c:gco=source-over"); // 항상 source-over로 원복
  });

  it("점 1개(탭)는 같은 점으로 lineTo해 라운드 캡이 점을 찍게 한다", () => {
    const log: string[] = [];
    const ctx = fakeCtx(log, "c");
    paintLayerMaskStroke(ctx, revealStroke([{ x: 3, y: 4 }]));
    expect(log).toContain("c:moveTo(3,4)");
    expect(log).toContain("c:lineTo(3,4)");
  });

  it("hardness<1이면 blur(px) filter가 설정된다", () => {
    const log: string[] = [];
    const ctx = fakeCtx(log, "c");
    paintLayerMaskStroke(ctx, { ...revealStroke([{ x: 0, y: 0 }, { x: 1, y: 1 }]), hardness: 0.5, radiusPx: 20 });
    // layerMaskFeatherPx(20, 0.5) = 20*0.5*0.6 = 6
    expect(log).toContain("c:filter=blur(6px)");
  });

  it("strength가 rgba 알파에 그대로 인코딩된다", () => {
    const log: string[] = [];
    const ctx = fakeCtx(log, "c");
    paintLayerMaskStroke(ctx, { ...revealStroke([{ x: 0, y: 0 }, { x: 1, y: 1 }]), strength: 0.4 });
    expect(log).toContain("c:strokeStyle=rgba(255,255,255,0.4)");
  });

  it("빈 점 배열은 no-op", () => {
    const log: string[] = [];
    const ctx = fakeCtx(log, "c");
    paintLayerMaskStroke(ctx, revealStroke([]));
    expect(log).toEqual([]);
  });

  it("radiusPx<=0 또는 strength<=0이면 no-op", () => {
    const log: string[] = [];
    const ctx = fakeCtx(log, "c");
    paintLayerMaskStroke(ctx, { ...revealStroke([{ x: 0, y: 0 }, { x: 1, y: 1 }]), radiusPx: 0 });
    paintLayerMaskStroke(ctx, { ...revealStroke([{ x: 0, y: 0 }, { x: 1, y: 1 }]), strength: 0 });
    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// bakeLayerMaskStroke
// ---------------------------------------------------------------------------

describe("bakeLayerMaskStroke", () => {
  it("existingMask가 있으면 먼저 drawImage로 그 위에 얹는다", () => {
    const log: string[] = [];
    const existing: FakeCanvas = { id: 900, width: 50, height: 50 };
    const out = bakeLayerMaskStroke(existing, 50, 50, revealStroke([{ x: 0, y: 0 }, { x: 5, y: 5 }]), fakeFactory(log));
    expect((out as FakeCanvas).id).toBe(1);
    expect(log[0]).toBe("create#1(50x50)");
    expect(log[1]).toBe("c1:drawImage(#900,0,0)");
    expect(log.some((l) => l === "c1:stroke")).toBe(true);
  });

  it("existingMask가 null이면 흰색(전체 보임) 풀-마스크를 베이스로 새로 만든다", () => {
    const log: string[] = [];
    bakeLayerMaskStroke(null, 20, 20, revealStroke([{ x: 0, y: 0 }, { x: 5, y: 5 }]), fakeFactory(log));
    expect(log[0]).toBe("create#1(20x20)");
    expect(log[1]).toBe("c1:fillStyle=#ffffff");
    expect(log[2]).toBe("c1:fillRect(0,0,20,20)");
  });

  it("팩토리가 null을 주면 null(2D 컨텍스트 획득 실패)", () => {
    const log: string[] = [];
    const out = bakeLayerMaskStroke(null, 10, 10, revealStroke([{ x: 0, y: 0 }, { x: 1, y: 1 }]), fakeFactory(log, 1));
    expect(out).toBeNull();
  });

  it("width<=0/height<=0/NaN/Infinity는 null(팩토리 호출 없음)", () => {
    const log: string[] = [];
    const factory = fakeFactory(log);
    const stroke = revealStroke([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(bakeLayerMaskStroke(null, 0, 10, stroke, factory)).toBeNull();
    expect(bakeLayerMaskStroke(null, 10, -1, stroke, factory)).toBeNull();
    expect(bakeLayerMaskStroke(null, Number.NaN, 10, stroke, factory)).toBeNull();
    expect(bakeLayerMaskStroke(null, 10, Number.POSITIVE_INFINITY, stroke, factory)).toBeNull();
    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createLayerMaskCanvas
// ---------------------------------------------------------------------------

describe("createLayerMaskCanvas", () => {
  it('fill="reveal"은 흰색으로 전체를 채운다', () => {
    const log: string[] = [];
    createLayerMaskCanvas(30, 40, "reveal", fakeFactory(log));
    expect(log).toEqual(["create#1(30x40)", "c1:fillStyle=#ffffff", "c1:fillRect(0,0,30,40)"]);
  });

  it('fill="conceal"은 아무것도 그리지 않는다(새 캔버스=이미 투명)', () => {
    const log: string[] = [];
    createLayerMaskCanvas(30, 40, "conceal", fakeFactory(log));
    expect(log).toEqual(["create#1(30x40)"]);
  });

  it("팩토리 실패/비정상 크기(0/NaN/Infinity)는 null", () => {
    const log: string[] = [];
    expect(createLayerMaskCanvas(10, 10, "reveal", fakeFactory(log, 1))).toBeNull();
    expect(createLayerMaskCanvas(0, 10, "reveal", fakeFactory(log))).toBeNull();
    expect(createLayerMaskCanvas(Number.NaN, 10, "reveal", fakeFactory(log))).toBeNull();
    expect(createLayerMaskCanvas(10, Number.POSITIVE_INFINITY, "reveal", fakeFactory(log))).toBeNull();
  });

  it("분수 크기는 반올림, 1 미만은 1로 바닥(compositeAlphaLocked와 동일 가드)", () => {
    const log: string[] = [];
    createLayerMaskCanvas(100.4, 50.6, "conceal", fakeFactory(log));
    expect(log[0]).toBe("create#1(100x51)");
  });
});

// ---------------------------------------------------------------------------
// invertLayerMaskAlpha
// ---------------------------------------------------------------------------

describe("invertLayerMaskAlpha", () => {
  it("흰색 전체를 채운 뒤 destination-out으로 기존 마스크를 파낸다(rasterizeSelectionMask의 invert와 동일 트릭)", () => {
    const log: string[] = [];
    const mask: FakeCanvas = { id: 5, width: 20, height: 20 };
    const out = invertLayerMaskAlpha(mask, 20, 20, fakeFactory(log));
    expect((out as FakeCanvas).id).toBe(1);
    expect(log).toEqual([
      "create#1(20x20)",
      "c1:fillStyle=#ffffff",
      "c1:fillRect(0,0,20,20)",
      "c1:gco=destination-out",
      "c1:drawImage(#5,0,0)",
      "c1:gco=source-over",
    ]);
  });

  it("비정상 크기(0/Infinity)/팩토리 실패는 null", () => {
    const log: string[] = [];
    const mask: FakeCanvas = { id: 1, width: 10, height: 10 };
    expect(invertLayerMaskAlpha(mask, 0, 10, fakeFactory(log))).toBeNull();
    expect(invertLayerMaskAlpha(mask, 10, 10, fakeFactory(log, 1))).toBeNull();
    expect(invertLayerMaskAlpha(mask, Number.POSITIVE_INFINITY, 10, fakeFactory(log))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// compositeLayerMask
// ---------------------------------------------------------------------------

describe("compositeLayerMask", () => {
  it("source를 그린 뒤 destination-in으로 mask를 합성하고 원복한다", () => {
    const log: string[] = [];
    const source: FakeCanvas = { id: 900, width: 64, height: 64 };
    const mask: FakeCanvas = { id: 901, width: 64, height: 64 };
    const out = compositeLayerMask(source, mask, 64, 64, fakeFactory(log));
    expect((out as FakeCanvas).id).toBe(1);
    expect(log).toEqual([
      "create#1(64x64)",
      "c1:drawImage(#900,0,0)",
      "c1:gco=destination-in",
      "c1:drawImage(#901,0,0)",
      "c1:gco=source-over",
    ]);
  });

  it("팩토리가 null을 주면 null — drawImage를 전혀 시도하지 않는다", () => {
    const log: string[] = [];
    const source: FakeCanvas = { id: 1, width: 10, height: 10 };
    const mask: FakeCanvas = { id: 2, width: 10, height: 10 };
    const out = compositeLayerMask(source, mask, 10, 10, fakeFactory(log, 1));
    expect(out).toBeNull();
    expect(log.some((l) => l.includes("drawImage"))).toBe(false);
  });

  it("width<=0/height<=0/NaN/Infinity는 null(팩토리 호출 없음)", () => {
    const log: string[] = [];
    const source: FakeCanvas = { id: 1, width: 10, height: 10 };
    const mask: FakeCanvas = { id: 2, width: 10, height: 10 };
    const factory = fakeFactory(log);
    expect(compositeLayerMask(source, mask, 0, 10, factory)).toBeNull();
    expect(compositeLayerMask(source, mask, 10, 0, factory)).toBeNull();
    expect(compositeLayerMask(source, mask, Number.NaN, 10, factory)).toBeNull();
    expect(compositeLayerMask(source, mask, 10, Number.POSITIVE_INFINITY, factory)).toBeNull();
    expect(log).toEqual([]);
  });
});
