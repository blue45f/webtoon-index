import { describe, expect, it } from "vitest";

import {
  computeMagicResize,
  findMagicResizePreset,
  MAGIC_RESIZE_DEFAULT_STRATEGY,
  MAGIC_RESIZE_PRESETS,
  MAGIC_RESIZE_STRATEGIES,
  normalizedRepositionResize,
  presetCanvasSize,
  scaleToFitResize,
  type MagicResizeElementLike,
  type MagicResizePreset,
} from "./studio-magic-resize";

// ---------------------------------------------------------------------------
// 프리셋 카탈로그
// ---------------------------------------------------------------------------

describe("MAGIC_RESIZE_PRESETS", () => {
  it("정확히 5개 프리셋, id 중복 없음", () => {
    expect(MAGIC_RESIZE_PRESETS).toHaveLength(5);
    const ids = new Set(MAGIC_RESIZE_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(5);
  });

  it("각 프리셋의 종횡비는 양수", () => {
    for (const preset of MAGIC_RESIZE_PRESETS) {
      expect(preset.aspectW).toBeGreaterThan(0);
      expect(preset.aspectH).toBeGreaterThan(0);
    }
  });
});

describe("findMagicResizePreset", () => {
  it("존재하는 id를 찾는다", () => {
    expect(findMagicResizePreset("square")?.label).toBe("정방형");
  });

  it("존재하지 않는 id는 undefined", () => {
    expect(findMagicResizePreset("nope")).toBeUndefined();
  });
});

describe("presetCanvasSize", () => {
  it("기본 baseWidth(CANVAS_W=720) — 정방형은 720x720", () => {
    const preset = findMagicResizePreset("square")!;
    expect(presetCanvasSize(preset)).toEqual({ width: 720, height: 720 });
  });

  it("가로 썸네일(16:9)은 720x405", () => {
    const preset = findMagicResizePreset("landscape-thumb")!;
    expect(presetCanvasSize(preset)).toEqual({ width: 720, height: 405 });
  });

  it("세로 스토리(9:16)는 720x1280", () => {
    const preset = findMagicResizePreset("portrait-story")!;
    expect(presetCanvasSize(preset)).toEqual({ width: 720, height: 1280 });
  });

  it("세로 컷(3:4)은 720x960", () => {
    const preset = findMagicResizePreset("tall-cut")!;
    expect(presetCanvasSize(preset)).toEqual({ width: 720, height: 960 });
  });

  it("가로 카드(1.91:1)는 720x377(반올림)", () => {
    const preset = findMagicResizePreset("landscape-card")!;
    expect(presetCanvasSize(preset)).toEqual({ width: 720, height: 377 });
  });

  it("커스텀 baseWidth를 반영한다", () => {
    const preset = findMagicResizePreset("square")!;
    expect(presetCanvasSize(preset, 1000)).toEqual({ width: 1000, height: 1000 });
  });

  it("aspectW<=0인 방어적 입력에서도 0-나눗셈 없이 계산(1로 대체)", () => {
    const broken: MagicResizePreset = { id: "x", label: "x", hint: "", aspectW: 0, aspectH: 2 };
    const size = presetCanvasSize(broken, 100);
    expect(Number.isFinite(size.height)).toBe(true);
    expect(size).toEqual({ width: 100, height: 200 });
  });

  it("baseWidth<=0이면 최소 1로 클램프", () => {
    const preset = findMagicResizePreset("square")!;
    expect(presetCanvasSize(preset, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe("MAGIC_RESIZE_STRATEGIES / MAGIC_RESIZE_DEFAULT_STRATEGY", () => {
  it("reposition·scaleToFit 두 전략을 제공한다", () => {
    expect(MAGIC_RESIZE_STRATEGIES.map((s) => s.id).sort()).toEqual(["reposition", "scaleToFit"]);
  });

  it("기본 전략은 reposition", () => {
    expect(MAGIC_RESIZE_DEFAULT_STRATEGY).toBe("reposition");
  });
});

// ---------------------------------------------------------------------------
// scaleToFitResize
// ---------------------------------------------------------------------------

describe("scaleToFitResize", () => {
  it("빈 배열 입력은 빈 배열", () => {
    expect(scaleToFitResize([], { width: 720, height: 1080 }, { width: 720, height: 720 })).toEqual([]);
  });

  it("from 크기가 0 이하면 원본을 그대로 복제(항등)", () => {
    const els: MagicResizeElementLike[] = [{ id: "a", x: 10, y: 20 }];
    const out = scaleToFitResize(els, { width: 0, height: 1080 }, { width: 720, height: 720 });
    expect(out).toEqual(els);
    expect(out).not.toBe(els); // 새 배열(복제) — 참조는 다름
  });

  it("to 크기가 0 이하면 원본을 그대로 복제(항등)", () => {
    const els: MagicResizeElementLike[] = [{ id: "a", x: 10, y: 20 }];
    const out = scaleToFitResize(els, { width: 720, height: 1080 }, { width: 720, height: -5 });
    expect(out).toEqual(els);
  });

  it("높이 절반으로 축소 시 이미지형 요소(x/y/width/height)를 정확히 스케일+오프셋한다", () => {
    // scale = min(720/720, 540/1080) = 0.5, offsetX=(720-360)/2=180, offsetY=(540-540)/2=0
    const els = [{ id: "img1", type: "image", x: 100, y: 100, width: 200, height: 200, rotation: 15 }];
    const out = scaleToFitResize(els, { width: 720, height: 1080 }, { width: 720, height: 540 });
    expect(out[0]).toMatchObject({ id: "img1", x: 230, y: 50, width: 100, height: 100 });
  });

  it("rotation은 건드리지 않는다", () => {
    const els = [{ id: "img1", type: "image", x: 0, y: 0, width: 10, height: 10, rotation: 42 }];
    const out = scaleToFitResize(els, { width: 720, height: 1080 }, { width: 720, height: 540 });
    expect(out[0].rotation).toBe(42);
  });

  it("fontSize가 있는 요소(sticker/text)는 fontSize도 배율만큼 줄인다", () => {
    const els = [{ id: "s1", type: "sticker", x: 360, y: 540, fontSize: 40, rotation: 0 }];
    const out = scaleToFitResize(els, { width: 720, height: 1080 }, { width: 720, height: 540 });
    expect(out[0].fontSize).toBe(20);
  });

  it("draw 요소(points=캔버스 절대좌표)는 각 좌표쌍을 배율+오프셋으로 변환한다", () => {
    const els = [{ id: "d1", type: "draw", points: [0, 0, 100, 100], stroke: "#000" }];
    const out = scaleToFitResize(els, { width: 720, height: 1080 }, { width: 720, height: 540 });
    // scale=0.5, offsetX=180, offsetY=0
    expect(out[0].points).toEqual([180, 0, 230, 50]);
    // duck-type 밖의 필드(stroke)도 그대로 보존된다.
    expect((out[0] as { stroke?: string }).stroke).toBe("#000");
  });

  it("frame 요소(points=로컬 오프셋 폴리곤)는 오프셋 없이 배율만 곱한다", () => {
    const els = [{ id: "f1", type: "frame", x: 100, y: 100, width: 200, height: 200, points: [0, 0, 200, 0, 200, 200, 0, 200] }];
    const out = scaleToFitResize(els, { width: 720, height: 1080 }, { width: 720, height: 540 });
    expect(out[0].points).toEqual([0, 0, 100, 0, 100, 100, 0, 100]);
    // x/y는 이미지형과 동일하게 스케일+오프셋됨.
    expect(out[0].x).toBe(230);
    expect(out[0].y).toBe(50);
  });

  it("draw의 symmetry.centerX/centerY도 points와 같은 배율+오프셋으로 변환한다(type/radialCount는 보존)", () => {
    // scale=0.5, offsetX=180, offsetY=0 (위 draw 테스트와 동일한 from/to).
    const els = [
      { id: "d1", type: "draw", points: [0, 0, 100, 100], symmetry: { type: "radial", centerX: 50, centerY: 50, radialCount: 6 } },
    ];
    const out = scaleToFitResize(els, { width: 720, height: 1080 }, { width: 720, height: 540 });
    expect(out[0].points).toEqual([180, 0, 230, 50]);
    expect(out[0].symmetry).toEqual({ type: "radial", centerX: 205, centerY: 25, radialCount: 6 });
  });

  it("x/y/width/height가 전혀 없는 요소도 에러 없이 통과한다(필드 미부여)", () => {
    const els: MagicResizeElementLike[] = [{ id: "bare" }];
    const out = scaleToFitResize(els, { width: 720, height: 1080 }, { width: 720, height: 540 });
    expect(out[0]).toEqual({ id: "bare" });
  });

  it("동일 크기(from===to)면 배율 1·오프셋 0으로 값이 보존된다", () => {
    const els = [{ id: "img1", type: "image", x: 12, y: 34, width: 56, height: 78, rotation: 0 }];
    const out = scaleToFitResize(els, { width: 720, height: 1080 }, { width: 720, height: 1080 });
    expect(out[0]).toMatchObject({ x: 12, y: 34, width: 56, height: 78 });
  });
});

// ---------------------------------------------------------------------------
// normalizedRepositionResize
// ---------------------------------------------------------------------------

describe("normalizedRepositionResize", () => {
  it("빈 배열 입력은 빈 배열", () => {
    expect(normalizedRepositionResize([], { width: 720, height: 1080 }, { width: 720, height: 720 })).toEqual([]);
  });

  it("from 크기가 0 이하면 원본을 그대로 복제(항등)", () => {
    const els: MagicResizeElementLike[] = [{ id: "a", x: 10, y: 20 }];
    const out = normalizedRepositionResize(els, { width: 720, height: 0 }, { width: 720, height: 720 });
    expect(out).toEqual(els);
    expect(out).not.toBe(els);
  });

  it("to 크기가 0 이하면 원본을 그대로 복제(항등) — scaleToFitResize와 동일한 방어", () => {
    const els: MagicResizeElementLike[] = [{ id: "a", x: 10, y: 20 }];
    const out = normalizedRepositionResize(els, { width: 720, height: 1080 }, { width: 720, height: -5 });
    expect(out).toEqual(els);
    expect(out).not.toBe(els);
  });

  it("세로 중앙 요소는 새 높이에서도 세로 중앙에 남는다(크기는 불변)", () => {
    // from: 720x1080, el center y = 440+100=540 = from.height/2 정확히 중앙.
    const els = [{ id: "img1", type: "image", x: 260, y: 440, width: 200, height: 200, rotation: 0 }];
    const out = normalizedRepositionResize(els, { width: 720, height: 1080 }, { width: 720, height: 2160 });
    const el = out[0];
    expect(el.width).toBe(200);
    expect(el.height).toBe(200);
    const newCenterY = (el.y as number) + (el.height as number) / 2;
    expect(newCenterY).toBe(1080); // 2160의 절반
  });

  it("폭이 그대로면(from.width===to.width) x는 이동하지 않는다", () => {
    const els = [{ id: "img1", type: "image", x: 123, y: 50, width: 40, height: 40, rotation: 0 }];
    const out = normalizedRepositionResize(els, { width: 720, height: 1080 }, { width: 720, height: 2160 });
    expect(out[0].x).toBe(123);
  });

  it("크기(width/height/fontSize)는 절대 바꾸지 않는다", () => {
    const els = [{ id: "s1", type: "sticker", x: 10, y: 10, fontSize: 32, rotation: 0 }];
    const out = normalizedRepositionResize(els, { width: 720, height: 1080 }, { width: 720, height: 540 });
    expect(out[0].fontSize).toBe(32);
  });

  it("draw 요소는 바운딩 박스 중심 기준으로 좌표쌍 전체를 평행이동한다", () => {
    // points bbox: x:[0,100] y:[400,600] → center (50, 500), from.height=1000 → normY=0.5
    const els = [{ id: "d1", type: "draw", points: [0, 400, 100, 600] }];
    const out = normalizedRepositionResize(els, { width: 720, height: 1000 }, { width: 720, height: 2000 });
    // newCenterY = 0.5*2000=1000, dy=1000-500=500. newCenterX: normX=50/720, to.width=720(동일)→dx=0.
    expect(out[0].points).toEqual([0, 900, 100, 1100]);
  });

  it("frame 요소는 points(로컬 오프셋)를 그대로 두고 x/y만 옮긴다", () => {
    const points = [0, 0, 200, 0, 200, 200, 0, 200];
    const els = [{ id: "f1", type: "frame", x: 260, y: 440, width: 200, height: 200, points }];
    const out = normalizedRepositionResize(els, { width: 720, height: 1080 }, { width: 720, height: 2160 });
    expect(out[0].points).toBe(points); // 동일 참조 — 변형되지 않음
    expect(out[0].y).not.toBe(440); // x/y는 옮겨짐
  });

  it("rotation은 건드리지 않는다", () => {
    const els = [{ id: "img1", type: "image", x: 0, y: 0, width: 10, height: 10, rotation: 77 }];
    const out = normalizedRepositionResize(els, { width: 720, height: 1080 }, { width: 720, height: 2160 });
    expect(out[0].rotation).toBe(77);
  });

  it("sticker는 elBounds 관례(fontSize 정사각형 박스)로 중심점을 계산한다 — 0크기 점 취급이 아니다", () => {
    // bounds: x=100,y=100,w=h=fontSize=40 → center=(120,120). from.width===to.width→dx=0.
    // normY=120/1080, nextCenterY=(120/1080)*2160=240, dy=120 → newY=100+120=220.
    // (fontSize를 0으로 취급했다면 dy=100이 되어 newY=200이 됐을 것 — elBounds 관례와 어긋남.)
    const els = [{ id: "s1", type: "sticker", x: 100, y: 100, fontSize: 40, rotation: 0 }];
    const out = normalizedRepositionResize(els, { width: 720, height: 1080 }, { width: 720, height: 2160 });
    expect(out[0].x).toBe(100);
    expect(out[0].y).toBe(220);
  });

  it("text는 elBounds 관례(fontSize*1.4 유도 높이)로 중심점을 계산한다 — 0높이 선분 취급이 아니다", () => {
    // bounds: x=50,y=50,w=200,h=fontSize*1.4=28 → center=(150,64). from.width===to.width→dx=0.
    // normY=64/1080, nextCenterY=(64/1080)*2160=128, dy=64 → newY=50+64=114.
    // (height=0 취급이면 dy=50이 되어 newY=100이 됐을 것.)
    const els = [{ id: "t1", type: "text", x: 50, y: 50, width: 200, fontSize: 20, rotation: 0 }];
    const out = normalizedRepositionResize(els, { width: 720, height: 1080 }, { width: 720, height: 2160 });
    expect(out[0].x).toBe(50);
    expect(out[0].y).toBe(114);
  });

  it("draw의 symmetry.centerX/centerY도 points와 같은 dx,dy로 평행이동한다(type/radialCount는 보존)", () => {
    // bbox([100,100,150,150]) center=(125,125). from.width===to.width→dx=0.
    // normY=125/600, nextCenterY=(125/600)*1200=250, dy=125.
    const els = [
      { id: "d1", type: "draw", points: [100, 100, 150, 150], symmetry: { type: "horizontal", centerX: 200, centerY: 300, radialCount: 4 } },
    ];
    const out = normalizedRepositionResize(els, { width: 720, height: 600 }, { width: 720, height: 1200 });
    expect(out[0].points).toEqual([100, 225, 150, 275]);
    expect(out[0].symmetry).toEqual({ type: "horizontal", centerX: 200, centerY: 425, radialCount: 4 });
  });

  it("symmetry 필드가 없는 draw 요소는 symmetry를 만들어내지 않는다", () => {
    const els = [{ id: "d1", type: "draw", points: [0, 0, 10, 10] }];
    const out = normalizedRepositionResize(els, { width: 720, height: 600 }, { width: 720, height: 1200 });
    expect("symmetry" in out[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeMagicResize (진입점)
// ---------------------------------------------------------------------------

describe("computeMagicResize", () => {
  const els = [{ id: "img1", type: "image", x: 260, y: 440, width: 200, height: 200, rotation: 0 }];
  const from = { width: 720, height: 1080 };
  const to = { width: 720, height: 2160 };

  it("strategy 생략 시 reposition(기본)과 동일한 결과", () => {
    expect(computeMagicResize(els, from, to)).toEqual(normalizedRepositionResize(els, from, to));
  });

  it('strategy="reposition"은 normalizedRepositionResize와 동일', () => {
    expect(computeMagicResize(els, from, to, "reposition")).toEqual(normalizedRepositionResize(els, from, to));
  });

  it('strategy="scaleToFit"은 scaleToFitResize와 동일', () => {
    expect(computeMagicResize(els, from, to, "scaleToFit")).toEqual(scaleToFitResize(els, from, to));
  });

  it("요소가 여럿이어도 순서를 보존한다", () => {
    const many = [
      { id: "a", type: "sticker", x: 1, y: 1, fontSize: 10, rotation: 0 },
      { id: "b", type: "sticker", x: 2, y: 2, fontSize: 20, rotation: 0 },
      { id: "c", type: "sticker", x: 3, y: 3, fontSize: 30, rotation: 0 },
    ];
    const out = computeMagicResize(many, from, to);
    expect(out.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});
