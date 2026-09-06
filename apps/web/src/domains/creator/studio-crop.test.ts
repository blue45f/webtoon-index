import { describe, it, expect } from "vitest";

import {
  CROP_ASPECTS,
  CROP_MIN_SIZE_NORM,
  CROP_RESIZE_HANDLES,
  applyCropAspect,
  beginCropDrag,
  cropAspectRatio,
  cropHandlePoints,
  cropHitTolerance,
  cropRectLocalPx,
  cropShadeRects,
  cropThirdsLines,
  clampCropRect,
  hitTestCropHandle,
  initialCropRect,
  isCropRectNoop,
  normalizedCropRatio,
  planCropApply,
  updateCropDrag,
  type CropRect,
} from "./studio-crop";

/** 표시 비율(w/h) — rect 가 frameAspect 요소 위에서 화면에 보이는 비율. */
function displayRatio(rect: CropRect, frameAspect: number): number {
  return (rect.w / rect.h) * frameAspect;
}

describe("초기 rect·위생 처리", () => {
  it("initialCropRect 는 전체 영역", () => {
    expect(initialCropRect()).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("clampCropRect 는 NaN/경계 밖을 복구한다", () => {
    const r = clampCropRect({ x: NaN, y: -3, w: 5, h: NaN });
    expect(r).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("clampCropRect 는 최소 크기와 x+w≤1 불변식을 지킨다", () => {
    const r = clampCropRect({ x: 0.95, y: 0.5, w: 0.4, h: 0.001 });
    expect(r.w).toBeCloseTo(0.4, 6);
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(CROP_MIN_SIZE_NORM);
  });

  it("isCropRectNoop — 전체(≈전체)만 true", () => {
    expect(isCropRectNoop(initialCropRect())).toBe(true);
    expect(isCropRectNoop({ x: 0.001, y: 0, w: 0.998, h: 1 })).toBe(true);
    expect(isCropRectNoop({ x: 0.2, y: 0, w: 0.8, h: 1 })).toBe(false);
    expect(isCropRectNoop({ x: 0, y: 0, w: 0.5, h: 0.5 })).toBe(false);
  });
});

describe("비율 프리셋", () => {
  it("자유/1:1/4:3/16:9 네 가지를 제공한다", () => {
    expect(CROP_ASPECTS.map((a) => a.id)).toEqual(["free", "1:1", "4:3", "16:9"]);
    expect(cropAspectRatio("free")).toBeNull();
    expect(cropAspectRatio("16:9")).toBeCloseTo(16 / 9, 6);
  });

  it("normalizedCropRatio — 표시비를 요소 종횡비로 나눈다", () => {
    // 2:1 가로 요소 위에서 화면 1:1 이 되려면 정규화 w/h = 0.5
    expect(normalizedCropRatio(1, 2)).toBeCloseTo(0.5, 6);
    expect(normalizedCropRatio(null, 2)).toBeNull();
    expect(normalizedCropRatio(0, 2)).toBeNull();
    expect(normalizedCropRatio(1, 0)).toBeCloseTo(1, 6); // 비정상 종횡비는 1로 폴백
  });

  it("applyCropAspect — 중심을 보존하고 표시 비율을 맞춘다", () => {
    const before: CropRect = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
    const after = applyCropAspect(before, 16 / 9, 1); // 정사각 요소
    expect(displayRatio(after, 1)).toBeCloseTo(16 / 9, 3);
    expect(after.x + after.w / 2).toBeCloseTo(0.5, 3);
    expect(after.y + after.h / 2).toBeCloseTo(0.5, 3);
    // 넓이 근사 보존
    expect(after.w * after.h).toBeCloseTo(0.36, 2);
  });

  it("applyCropAspect — 0..1 을 벗어나면 비율 유지 축소·이동한다", () => {
    const wide = applyCropAspect({ x: 0, y: 0, w: 1, h: 1 }, 16 / 9, 1);
    expect(wide.w).toBeLessThanOrEqual(1);
    expect(wide.h).toBeLessThanOrEqual(1);
    expect(wide.x).toBeGreaterThanOrEqual(0);
    expect(wide.y).toBeGreaterThanOrEqual(0);
    expect(wide.x + wide.w).toBeLessThanOrEqual(1);
    expect(wide.y + wide.h).toBeLessThanOrEqual(1);
    expect(displayRatio(wide, 1)).toBeCloseTo(16 / 9, 3);
  });

  it("applyCropAspect — 자유(null)는 rect 를 그대로 둔다", () => {
    const before: CropRect = { x: 0.1, y: 0.2, w: 0.5, h: 0.3 };
    expect(applyCropAspect(before, null, 1)).toEqual(before);
  });
});

describe("드래그 리듀서 — 이동", () => {
  const start: CropRect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

  it("크기를 보존하며 델타만큼 이동한다", () => {
    const s = beginCropDrag(start, "move", { x: 0.5, y: 0.5 });
    const r = updateCropDrag(s, { x: 0.6, y: 0.45 });
    expect(r).toEqual({ x: 0.35, y: 0.2, w: 0.5, h: 0.5 });
  });

  it("경계 밖으로 못 나간다(클램프)", () => {
    const s = beginCropDrag(start, "move", { x: 0.5, y: 0.5 });
    const r = updateCropDrag(s, { x: 5, y: -5 });
    expect(r).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
  });

  it("NaN 포인터에도 유한 rect 를 유지한다", () => {
    const s = beginCropDrag(start, "move", { x: 0.5, y: 0.5 });
    const r = updateCropDrag(s, { x: NaN, y: NaN });
    expect([r.x, r.y, r.w, r.h].every(Number.isFinite)).toBe(true);
  });
});

describe("드래그 리듀서 — 자유 리사이즈", () => {
  const start: CropRect = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };

  it("se 코너: 잡은 코너만 델타를 따라간다(반대 코너 고정)", () => {
    const s = beginCropDrag(start, "se", { x: 0.8, y: 0.8 });
    const r = updateCropDrag(s, { x: 0.7, y: 0.9 });
    expect(r.x).toBeCloseTo(0.2, 4);
    expect(r.y).toBeCloseTo(0.2, 4);
    expect(r.w).toBeCloseTo(0.5, 4);
    expect(r.h).toBeCloseTo(0.7, 4);
  });

  it("nw 코너: 좌상단이 움직이고 우하단이 고정된다", () => {
    const s = beginCropDrag(start, "nw", { x: 0.2, y: 0.2 });
    const r = updateCropDrag(s, { x: 0.1, y: 0.3 });
    expect(r.x).toBeCloseTo(0.1, 4);
    expect(r.y).toBeCloseTo(0.3, 4);
    expect(r.x + r.w).toBeCloseTo(0.8, 4);
    expect(r.y + r.h).toBeCloseTo(0.8, 4);
  });

  it("변 핸들(e)은 가로만 바꾼다", () => {
    const s = beginCropDrag(start, "e", { x: 0.8, y: 0.5 });
    const r = updateCropDrag(s, { x: 0.95, y: 0.1 });
    expect(r.w).toBeCloseTo(0.75, 4);
    expect(r.y).toBeCloseTo(start.y, 4);
    expect(r.h).toBeCloseTo(start.h, 4);
  });

  it("최소 크기 가드 — anchor 를 넘어 뒤집히지 않는다", () => {
    const s = beginCropDrag(start, "se", { x: 0.8, y: 0.8 });
    const r = updateCropDrag(s, { x: -1, y: -1 });
    expect(r.w).toBeCloseTo(CROP_MIN_SIZE_NORM, 4);
    expect(r.h).toBeCloseTo(CROP_MIN_SIZE_NORM, 4);
    expect(r.x).toBeCloseTo(0.2, 4);
    expect(r.y).toBeCloseTo(0.2, 4);
  });

  it("경계 밖 드래그는 0..1 에서 멈춘다", () => {
    const s = beginCropDrag(start, "se", { x: 0.8, y: 0.8 });
    const r = updateCropDrag(s, { x: 2, y: 2 });
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
    expect(r.w).toBeCloseTo(0.8, 4);
    expect(r.h).toBeCloseTo(0.8, 4);
  });
});

describe("드래그 리듀서 — 비율 잠금", () => {
  const start: CropRect = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
  const square = { ratio: 1, frameAspect: 1 }; // 정사각 요소 + 1:1

  it("코너 드래그가 비율을 유지한다(직교 투영)", () => {
    const s = beginCropDrag(start, "se", { x: 0.7, y: 0.7 });
    const r = updateCropDrag(s, { x: 0.9, y: 0.75 }, square);
    expect(displayRatio(r, 1)).toBeCloseTo(1, 3);
    // 두 축 델타(+0.2, +0.05)의 균형 — 한 축만 따라가지 않는다.
    expect(r.w).toBeGreaterThan(0.4);
    expect(r.w).toBeLessThan(0.6);
    // anchor(좌상단) 고정.
    expect(r.x).toBeCloseTo(0.3, 4);
    expect(r.y).toBeCloseTo(0.3, 4);
  });

  it("코너를 안쪽으로 끌면 비율 유지한 채 줄어든다", () => {
    const s = beginCropDrag(start, "se", { x: 0.7, y: 0.7 });
    const r = updateCropDrag(s, { x: 0.55, y: 0.55 }, square);
    expect(displayRatio(r, 1)).toBeCloseTo(1, 3);
    expect(r.w).toBeCloseTo(0.25, 3);
  });

  it("비정사각 요소에서는 정규화 비율이 보정된다", () => {
    // 2:1 요소에서 화면 1:1 → 정규화 w/h = 0.5
    const s = beginCropDrag(start, "se", { x: 0.7, y: 0.7 });
    const r = updateCropDrag(s, { x: 0.9, y: 0.9 }, { ratio: 1, frameAspect: 2 });
    expect(displayRatio(r, 2)).toBeCloseTo(1, 3);
  });

  it("가로변(e) 드래그: 세로가 중앙 고정으로 파생된다", () => {
    const s = beginCropDrag(start, "e", { x: 0.7, y: 0.5 });
    const r = updateCropDrag(s, { x: 0.85, y: 0.5 }, square);
    expect(displayRatio(r, 1)).toBeCloseTo(1, 3);
    expect(r.w).toBeCloseTo(0.55, 3);
    // 세로 중앙 0.5 유지
    expect(r.y + r.h / 2).toBeCloseTo(0.5, 3);
    expect(r.x).toBeCloseTo(0.3, 4);
  });

  it("세로변(s) 드래그: 가로가 중앙 고정으로 파생된다", () => {
    const s = beginCropDrag(start, "s", { x: 0.5, y: 0.7 });
    const r = updateCropDrag(s, { x: 0.5, y: 0.9 }, square);
    expect(displayRatio(r, 1)).toBeCloseTo(1, 3);
    expect(r.h).toBeCloseTo(0.6, 3);
    expect(r.x + r.w / 2).toBeCloseTo(0.5, 3);
  });

  it("경계 캡이 비율을 깨지 않는다(0..1 탈출 방지)", () => {
    const nearEdge: CropRect = { x: 0.7, y: 0.7, w: 0.25, h: 0.25 };
    const s = beginCropDrag(nearEdge, "se", { x: 0.95, y: 0.95 });
    const r = updateCropDrag(s, { x: 3, y: 3 }, square);
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
    expect(displayRatio(r, 1)).toBeCloseTo(1, 3);
  });

  it("비율 잠금에도 최소 크기 가드가 작동한다", () => {
    const s = beginCropDrag(start, "se", { x: 0.7, y: 0.7 });
    const r = updateCropDrag(s, { x: -2, y: -2 }, square);
    expect(r.w).toBeGreaterThanOrEqual(CROP_MIN_SIZE_NORM);
    expect(r.h).toBeGreaterThanOrEqual(CROP_MIN_SIZE_NORM);
    expect(displayRatio(r, 1)).toBeCloseTo(1, 3);
  });
});

describe("히트테스트", () => {
  const rect: CropRect = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
  const tol = { x: 0.03, y: 0.03 };

  it("코너 4방 판정(코너가 변보다 우선)", () => {
    expect(hitTestCropHandle({ x: 0.2, y: 0.2 }, rect, tol)).toBe("nw");
    expect(hitTestCropHandle({ x: 0.8, y: 0.21 }, rect, tol)).toBe("ne");
    expect(hitTestCropHandle({ x: 0.79, y: 0.8 }, rect, tol)).toBe("se");
    expect(hitTestCropHandle({ x: 0.2, y: 0.8 }, rect, tol)).toBe("sw");
  });

  it("변은 전체 길이가 잡힌다(중점만이 아니라)", () => {
    expect(hitTestCropHandle({ x: 0.35, y: 0.2 }, rect, tol)).toBe("n");
    expect(hitTestCropHandle({ x: 0.65, y: 0.8 }, rect, tol)).toBe("s");
    expect(hitTestCropHandle({ x: 0.2, y: 0.6 }, rect, tol)).toBe("w");
    expect(hitTestCropHandle({ x: 0.8, y: 0.4 }, rect, tol)).toBe("e");
  });

  it("안쪽은 move, 바깥·비유한은 null", () => {
    expect(hitTestCropHandle({ x: 0.5, y: 0.5 }, rect, tol)).toBe("move");
    expect(hitTestCropHandle({ x: 0.05, y: 0.05 }, rect, tol)).toBeNull();
    expect(hitTestCropHandle({ x: NaN, y: 0.5 }, rect, tol)).toBeNull();
  });

  it("cropHitTolerance — 화면 px 를 축별 정규화로 환산한다", () => {
    const t = cropHitTolerance({ width: 400, height: 200 }, 12);
    expect(t.x).toBeCloseTo(0.03, 6);
    expect(t.y).toBeCloseTo(0.06, 6);
    // 퇴화 프레임 방어
    const d = cropHitTolerance({ width: 0, height: -1 }, 12);
    expect(Number.isFinite(d.x)).toBe(true);
    expect(Number.isFinite(d.y)).toBe(true);
  });
});

describe("오버레이 기하", () => {
  const rect: CropRect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const size = { width: 400, height: 200 };

  it("cropRectLocalPx — 정규화 → 로컬 px", () => {
    expect(cropRectLocalPx(rect, size)).toEqual({ x: 100, y: 50, w: 200, h: 100 });
  });

  it("핸들 8개가 코너·변 중점에 놓인다", () => {
    const pts = cropHandlePoints(rect, size);
    expect(pts.map((p) => p.id)).toEqual([...CROP_RESIZE_HANDLES]);
    const byId = Object.fromEntries(pts.map((p) => [p.id, p]));
    expect(byId["nw"]).toMatchObject({ x: 100, y: 50 });
    expect(byId["n"]).toMatchObject({ x: 200, y: 50 });
    expect(byId["se"]).toMatchObject({ x: 300, y: 150 });
    expect(byId["w"]).toMatchObject({ x: 100, y: 100 });
  });

  it("어둡게 마스킹 4조각이 rect 바깥을 정확히 덮는다(합계 = 전체 - rect)", () => {
    const shades = cropShadeRects(rect, size);
    expect(shades).toHaveLength(4);
    const area = shades.reduce((sum, s) => sum + s.w * s.h, 0);
    expect(area).toBeCloseTo(400 * 200 - 200 * 100, 4);
    // 어떤 조각도 rect 안을 침범하지 않는다.
    for (const s of shades) {
      const overlapW = Math.max(0, Math.min(s.x + s.w, 300) - Math.max(s.x, 100));
      const overlapH = Math.max(0, Math.min(s.y + s.h, 150) - Math.max(s.y, 50));
      expect(overlapW * overlapH).toBe(0);
    }
  });

  it("전체 rect 면 마스킹 조각 넓이가 전부 0", () => {
    const shades = cropShadeRects(initialCropRect(), size);
    for (const s of shades) expect(s.w * s.h).toBe(0);
  });

  it("3분할 안내선 — 세로 2 + 가로 2가 rect 안에 놓인다", () => {
    const lines = cropThirdsLines(rect, size);
    expect(lines).toHaveLength(4);
    for (const l of lines) expect(l).toHaveLength(4);
    // 첫 세로선 x = 100 + 200/3
    expect(lines[0]![0]).toBeCloseTo(100 + 200 / 3, 4);
    expect(lines[0]![1]).toBeCloseTo(50, 4);
    expect(lines[0]![3]).toBeCloseTo(150, 4);
    // 첫 가로선 y = 50 + 100/3
    expect(lines[2]![1]).toBeCloseTo(50 + 100 / 3, 4);
  });
});

describe("적용 계획 — planCropApply", () => {
  const natural = { width: 800, height: 600 };
  const frame = { x: 100, y: 50, width: 400, height: 300, rotation: 0 };

  it("소스 rect 를 자연 해상도 정수 px 로 환산한다", () => {
    const plan = planCropApply({ rect: { x: 0.25, y: 0.2, w: 0.5, h: 0.5 }, natural, frame });
    expect(plan?.source).toEqual({ sx: 200, sy: 120, sw: 400, sh: 300 });
  });

  it("요소 프레임 보정 — 화면상 크롭 영역 자리를 그대로 유지한다(무회전)", () => {
    const plan = planCropApply({ rect: { x: 0.25, y: 0.2, w: 0.5, h: 0.5 }, natural, frame });
    expect(plan?.el).toEqual({ x: 200, y: 110, width: 200, height: 150 });
  });

  it("flipX — 표시 기준 rect 를 원본 좌표로 되반전한다", () => {
    const plan = planCropApply({ rect: { x: 0.1, y: 0, w: 0.3, h: 1 }, natural, frame, flipX: true });
    // u0 = 1 - (0.1+0.3) = 0.6 → sx = 480
    expect(plan?.source).toMatchObject({ sx: 480, sw: 240 });
    // 프레임은 표시 기준 그대로(반전은 이미지 내용에만 적용).
    expect(plan?.el.x).toBeCloseTo(100 + 0.1 * 400, 2);
  });

  it("flipY — 상하 되반전", () => {
    const plan = planCropApply({ rect: { x: 0, y: 0.1, w: 1, h: 0.4 }, natural, frame, flipY: true });
    // v0 = 1 - 0.5 = 0.5 → sy = 300
    expect(plan?.source).toMatchObject({ sy: 300, sh: 240 });
  });

  it("회전 요소 — 새 좌상단이 회전 변환을 따른다(90°)", () => {
    const plan = planCropApply({
      rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      natural,
      frame: { ...frame, rotation: 90 },
    });
    // 로컬 (200,150) 을 90° 회전: (-150, 200) → (100-150, 50+200)
    expect(plan?.el.x).toBeCloseTo(-50, 2);
    expect(plan?.el.y).toBeCloseTo(250, 2);
    expect(plan?.el.width).toBeCloseTo(200, 2);
    expect(plan?.el.height).toBeCloseTo(150, 2);
  });

  it("소스 rect 가 자연 크기를 절대 넘지 않는다(반올림 안전)", () => {
    const plan = planCropApply({ rect: { x: 0.333, y: 0.333, w: 0.667, h: 0.667 }, natural: { width: 3, height: 3 }, frame });
    expect(plan).not.toBeNull();
    const s = plan!.source;
    expect(s.sx + s.sw).toBeLessThanOrEqual(3);
    expect(s.sy + s.sh).toBeLessThanOrEqual(3);
    expect(s.sw).toBeGreaterThanOrEqual(1);
    expect(s.sh).toBeGreaterThanOrEqual(1);
  });

  it("퇴화 입력은 null", () => {
    const rect: CropRect = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(planCropApply({ rect, natural: { width: 0, height: 600 }, frame })).toBeNull();
    expect(planCropApply({ rect, natural, frame: { ...frame, width: 0 } })).toBeNull();
    expect(planCropApply({ rect, natural: { width: NaN, height: 600 }, frame })).toBeNull();
  });

  it("왕복 정합 — 무회전·무반전이면 (el.x - frame.x)/frame.width == rect.x", () => {
    const rect: CropRect = { x: 0.15, y: 0.35, w: 0.5, h: 0.4 };
    const plan = planCropApply({ rect, natural, frame });
    expect((plan!.el.x - frame.x) / frame.width).toBeCloseTo(rect.x, 3);
    expect((plan!.el.y - frame.y) / frame.height).toBeCloseTo(rect.y, 3);
  });
});
