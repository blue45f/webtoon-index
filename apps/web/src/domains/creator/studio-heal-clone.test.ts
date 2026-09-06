import { describe, expect, it } from "vitest";

import { planStudioRasterRetouchRegion } from "./render/studio-raster-retouch-region";
import {
  HEAL_CLONE_HARDNESS_DEFAULT,
  HEAL_CLONE_HARDNESS_RANGE,
  HEAL_CLONE_MODES,
  HEAL_CLONE_OPACITY_DEFAULT,
  HEAL_CLONE_OPACITY_RANGE,
  HEAL_CLONE_RADIUS_DEFAULT,
  HEAL_CLONE_RADIUS_RANGE,
  applyHealCloneDabs,
  applyHealCloneDabsFromSeparateRegions,
  computeHealCloneSourceOffset,
  healCloneSourcePoint,
  healLocalMeanRadius,
  localMeanColor,
  planHealCloneDabs,
  stampHealCloneDab,
  type HealCloneDab,
} from "./studio-heal-clone";
import {
  bakeHealCloneStrokeToCanvas,
  type HealCloneCanvasFactory,
  type HealCloneCtx2DLike,
} from "./studio-heal-clone-browser";

import type { StudioImageDataLike } from "./studio-filters";
import type { StudioHealCloneWorkerLike } from "./studio-heal-clone-worker-client";
import type { MaskCanvasLike, MaskImageSource } from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 픽스처 헬퍼
// ---------------------------------------------------------------------------

/** w×h 단색 이미지(알파 기본 255). */
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

/** 픽셀별 콜백으로 채운 이미지 — 좌표 기반 테스트 패턴(예: 좌/우 절반 다른 색)에 쓴다. */
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

/** 부동소수 오차를 허용하며 도장 목록을 비교 — offset/flip 산술은 이진 부동소수라 정확히 같지 않을 수 있다. */
function expectDabsClose(actual: HealCloneDab[], expected: HealCloneDab[]) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((d, i) => {
    const e = expected[i]!;
    expect(d.srcX).toBeCloseTo(e.srcX, 6);
    expect(d.srcY).toBeCloseTo(e.srcY, 6);
    expect(d.destX).toBeCloseTo(e.destX, 6);
    expect(d.destY).toBeCloseTo(e.destY, 6);
  });
}

// ---------------------------------------------------------------------------
// 상수 테이블
// ---------------------------------------------------------------------------

describe("상수", () => {
  it("HEAL_CLONE_MODES 는 heal/clone 두 항목", () => {
    expect(HEAL_CLONE_MODES.map((m) => m.id)).toEqual(["heal", "clone"]);
  });

  it("범위·기본값이 서로 정합적이다", () => {
    expect(HEAL_CLONE_RADIUS_DEFAULT).toBeGreaterThanOrEqual(HEAL_CLONE_RADIUS_RANGE.min);
    expect(HEAL_CLONE_RADIUS_DEFAULT).toBeLessThanOrEqual(HEAL_CLONE_RADIUS_RANGE.max);
    expect(HEAL_CLONE_HARDNESS_DEFAULT).toBeGreaterThanOrEqual(HEAL_CLONE_HARDNESS_RANGE.min);
    expect(HEAL_CLONE_HARDNESS_DEFAULT).toBeLessThanOrEqual(HEAL_CLONE_HARDNESS_RANGE.max);
    expect(HEAL_CLONE_OPACITY_DEFAULT).toBeGreaterThanOrEqual(HEAL_CLONE_OPACITY_RANGE.min);
    expect(HEAL_CLONE_OPACITY_DEFAULT).toBeLessThanOrEqual(HEAL_CLONE_OPACITY_RANGE.max);
  });
});

// ---------------------------------------------------------------------------
// (A) 기하
// ---------------------------------------------------------------------------

describe("computeHealCloneSourceOffset / healCloneSourcePoint", () => {
  it("오프셋 계산 후 첫 목적지 점에 되먹이면 소스 앵커로 정확히 돌아온다", () => {
    const anchor = { x: 0.6, y: 0.4 };
    const firstDest = { x: 0.2, y: 0.2 };
    const offset = computeHealCloneSourceOffset(anchor, firstDest);
    expect(offset.x).toBeCloseTo(0.4, 10);
    expect(offset.y).toBeCloseTo(0.2, 10);
    const roundTrip = healCloneSourcePoint(offset, firstDest);
    expect(roundTrip.x).toBeCloseTo(anchor.x, 10);
    expect(roundTrip.y).toBeCloseTo(anchor.y, 10);
  });

  it("오프셋을 다른 목적지 점에 적용하면 상대 위치가 유지된다", () => {
    const offset = { x: -0.1, y: 0.3 };
    expect(healCloneSourcePoint(offset, { x: 0.5, y: 0.5 })).toEqual({ x: 0.4, y: 0.8 });
  });
});

describe("planHealCloneDabs", () => {
  const offset = { x: 0.1, y: -0.05 };

  it("flip 없이 정규화 점을 디바이스 px 로 환산한다", () => {
    const dabs = planHealCloneDabs([{ x: 0.2, y: 0.3 }], offset, 200, 100);
    expectDabsClose(dabs, [{ srcX: 60, srcY: 25, destX: 40, destY: 30 }]);
  });

  it("점 여러 개 — 순서대로 도장 목록을 만든다", () => {
    const dabs = planHealCloneDabs(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      { x: 0, y: 0 },
      100,
      100
    );
    expect(dabs).toEqual([
      { srcX: 0, srcY: 0, destX: 0, destY: 0 },
      { srcX: 100, srcY: 100, destX: 100, destY: 100 },
    ]);
  });

  it("flipX 는 dest/src 양쪽을 같은 축으로 되돌린다", () => {
    const dabs = planHealCloneDabs([{ x: 0.2, y: 0.3 }], offset, 200, 100, { flipX: true });
    // dest: (1-0.2)*200=160, y 그대로 30. src norm = dest+offset = (0.3,0.25) → flip x: (0.7,0.25) → (140,25)
    expectDabsClose(dabs, [{ srcX: 140, srcY: 25, destX: 160, destY: 30 }]);
  });

  it("flipY 는 dest/src 양쪽을 같은 축으로 되돌린다", () => {
    const dabs = planHealCloneDabs([{ x: 0.2, y: 0.3 }], offset, 200, 100, { flipY: true });
    // dest y flip: (1-0.3)*100=70, x 그대로 40. src norm=(0.3,0.25) → flip y: (0.3,0.75) → (60,75)
    expectDabsClose(dabs, [{ srcX: 60, srcY: 75, destX: 40, destY: 70 }]);
  });

  it("flipX+flipY 동시 적용", () => {
    const dabs = planHealCloneDabs([{ x: 0.2, y: 0.3 }], offset, 200, 100, { flipX: true, flipY: true });
    expectDabsClose(dabs, [{ srcX: 140, srcY: 75, destX: 160, destY: 70 }]);
  });

  it("이미지 크기가 0/비유한이면 빈 배열", () => {
    expect(planHealCloneDabs([{ x: 0.5, y: 0.5 }], offset, 0, 100)).toEqual([]);
    expect(planHealCloneDabs([{ x: 0.5, y: 0.5 }], offset, 100, Number.NaN)).toEqual([]);
  });

  it("빈 목적지 궤적 → 빈 배열", () => {
    expect(planHealCloneDabs([], offset, 100, 100)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (B) localMeanColor
// ---------------------------------------------------------------------------

describe("localMeanColor", () => {
  it("단색 이미지는 반경·위치와 무관하게 그 색을 그대로 반환한다", () => {
    const img = solidImage(20, 20, 10, 20, 30);
    expect(localMeanColor(img, 10, 10, 5)).toEqual({ r: 10, g: 20, b: 30 });
    expect(localMeanColor(img, 0, 0, 3)).toEqual({ r: 10, g: 20, b: 30 });
  });

  it("창이 이미지 밖으로 완전히 벗어나면 null", () => {
    const img = solidImage(10, 10, 1, 2, 3);
    expect(localMeanColor(img, -100, -100, 5)).toBeNull();
    expect(localMeanColor(img, 1000, 1000, 5)).toBeNull();
  });

  it("창이 경계 일부만 걸치면 이미지 안쪽 픽셀만 평균에 반영한다", () => {
    // 왼쪽 절반 검정(0), 오른쪽 절반 흰색(255) — 좌상단 코너(0,0) 주변 반경 0(자기 자신 1픽셀)만 재면 검정.
    const img = paintedImage(10, 10, (x) => (x < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const mean = localMeanColor(img, 0, 0, 0.4);
    expect(mean).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("반경·좌표·radius 가 비정상이면 null", () => {
    const img = solidImage(10, 10, 1, 1, 1);
    expect(localMeanColor(img, Number.NaN, 0, 5)).toBeNull();
    expect(localMeanColor(img, 0, 0, 0)).toBeNull();
    expect(localMeanColor(img, 0, 0, -5)).toBeNull();
  });

  it("완전 투명 픽셀은 평균에 기여하지 않는다(알파 가중) — 캐릭터 컷아웃 경계 근처에서 특히 중요", () => {
    // 왼쪽 절반: 완전 투명 "배경"(alpha=0, RGB 는 (0,0,0) 처럼 안 보이는 잔여값일 수 있음).
    // 오른쪽 절반: 완전 불투명 살구색 — 컷아웃 캐릭터의 실제 보이는 픽셀.
    const img = paintedImage(10, 10, (x) => (x < 5 ? [0, 0, 0, 0] : [240, 200, 180, 255]));
    // 경계에 걸친 창(반경 3, 중심이 경계 바로 위) — 알파 가중 없이 단순 평균을 내면 투명 배경의
    // (0,0,0)이 절반 가까이 섞여 들어가 살구색에서 크게 벗어난 어두운 색이 나온다(회귀 시 실패).
    const mean = localMeanColor(img, 5, 5, 3);
    expect(mean).not.toBeNull();
    expect(mean!.r).toBeCloseTo(240, 0);
    expect(mean!.g).toBeCloseTo(200, 0);
    expect(mean!.b).toBeCloseTo(180, 0);
  });

  it("반경 안이 전부 완전 투명이면 null(안 보이는 색의 평균은 의미가 없다)", () => {
    const img = paintedImage(10, 10, () => [123, 45, 67, 0]);
    expect(localMeanColor(img, 5, 5, 3)).toBeNull();
  });

  it("부분 투명(중간 알파) 픽셀은 알파 비중만큼만 평균에 기여한다", () => {
    // 왼쪽: 50% 불투명 검정, 오른쪽: 완전 불투명 흰색 — 단순 평균이면 (0+255)/2=127.5,
    // 알파 가중이면 흰색 쪽으로 쏠린다(가중치가 2배: 255 vs 128).
    const img = paintedImage(10, 10, (x) => (x < 5 ? [0, 0, 0, 128] : [255, 255, 255, 255]));
    const mean = localMeanColor(img, 5, 5, 5);
    expect(mean).not.toBeNull();
    expect(mean!.r).toBeGreaterThan(127.5); // 흰색(가중치 큼) 쪽으로 쏠려야 한다.
  });
});

describe("healLocalMeanRadius", () => {
  it("브러시 반경의 60%, 최소 2", () => {
    expect(healLocalMeanRadius(10)).toBe(6);
    expect(healLocalMeanRadius(1)).toBe(2); // 0.6 반올림 0이면 최소 2로 클램프
    expect(healLocalMeanRadius(0)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (B) stampHealCloneDab
// ---------------------------------------------------------------------------

describe("stampHealCloneDab", () => {
  it("clone 모드 + hardness=1 + opacity=1: 반경 안 픽셀은 src 로 완전히 교체된다", () => {
    const src = paintedImage(20, 20, (x) => (x < 10 ? [0, 0, 0, 255] : [200, 100, 50, 255]));
    const dst = solidImage(20, 20, 10, 10, 10);
    const dab: HealCloneDab = { srcX: 15, srcY: 5, destX: 5, destY: 5 };
    stampHealCloneDab(src, dst, dab, 3, 1, 1, "clone");
    // dest(5,5) 는 src(15,5)=[200,100,50] 로 완전히 교체.
    expect(pixelAt(dst, 5, 5)).toEqual([200, 100, 50, 255]);
  });

  it("clone 모드: 반경 밖 픽셀은 건드리지 않는다", () => {
    const src = solidImage(20, 20, 255, 255, 255);
    const dst = solidImage(20, 20, 10, 10, 10);
    const dab: HealCloneDab = { srcX: 10, srcY: 10, destX: 10, destY: 10 };
    stampHealCloneDab(src, dst, dab, 2, 1, 1, "clone");
    expect(pixelAt(dst, 0, 0)).toEqual([10, 10, 10, 255]); // 반경(2px) 훨씬 밖 — 무변화.
  });

  it("hardness=0: 중심은 완전 불투명, 가장자리로 갈수록 알파가 줄어든다", () => {
    const src = solidImage(20, 20, 255, 0, 0);
    const dst = solidImage(20, 20, 0, 0, 0);
    const dab: HealCloneDab = { srcX: 10, srcY: 10, destX: 10, destY: 10 };
    stampHealCloneDab(src, dst, dab, 10, 0, 1, "clone");
    const [centerR] = pixelAt(dst, 10, 10);
    const [nearEdgeR] = pixelAt(dst, 18, 10); // dist=8, edgeStart=0, span=10 → alpha=1-8/10=0.2
    expect(centerR).toBe(255);
    expect(nearEdgeR).toBeGreaterThan(0);
    expect(nearEdgeR).toBeLessThan(centerR);
  });

  it("opacity<1 로 같은 도장을 반복 적용하면 표준 알파 합성으로 누적된다", () => {
    const src = solidImage(4, 4, 255, 255, 255);
    const dst = solidImage(4, 4, 0, 0, 0);
    const dab: HealCloneDab = { srcX: 2, srcY: 2, destX: 2, destY: 2 };
    stampHealCloneDab(src, dst, dab, 1, 1, 0.5, "clone");
    const once = pixelAt(dst, 2, 2)[0];
    // Uint8ClampedArray 는 반올림 시 짝수로 타이브레이크하므로 정확히 127.5 대신 127~128 사이.
    expect(once).toBeGreaterThanOrEqual(127);
    expect(once).toBeLessThanOrEqual(128);
    stampHealCloneDab(src, dst, dab, 1, 1, 0.5, "clone");
    const twice = pixelAt(dst, 2, 2)[0];
    expect(twice).toBeGreaterThan(once); // 더 src 에 가까워졌다 — 누적.
  });

  it("heal 모드: 붙이는 영역과 소스 영역의 로컬 평균 차이만큼 색을 이동시킨다", () => {
    // src: 왼쪽(소스) 어두운 회색(50), 오른쪽(dest 주변) 밝은 회색(200) — 균일 배경이라 로컬평균=그 값.
    const src = paintedImage(30, 30, (x) => (x < 15 ? [50, 50, 50, 255] : [200, 200, 200, 255]));
    const dst = cloneImage(src);
    const dab: HealCloneDab = { srcX: 5, srcY: 15, destX: 25, destY: 15 }; // src=어두운 영역, dest=밝은 영역
    stampHealCloneDab(src, dst, dab, 3, 1, 1, "heal");
    // shift = dstMean(200) - srcMean(50) = 150 → 복사색 50+150=200 로, 주변(이미 200)과 자연스럽게 섞인다.
    const [r] = pixelAt(dst, 25, 15);
    expect(r).toBeCloseTo(200, 0);
  });

  it("heal 모드: dest 주변이 투명 경계에 걸쳐도 보이는 색만으로 톤을 맞춘다(알파 가중 회귀)", () => {
    // 소스 좌표(x<10)는 균일한 어두운 회색(50, 불투명) 결함 부위 — srcMean=(50,50,50).
    // dest 좌표(x=20) 주변(healLocalMeanRadius(3)=2 창)은 절반(x=18,19)이 완전 투명 "배경",
    // 절반(x=20,21,22)이 살구색(240,200,180) 캐릭터 컷아웃 — 알파 가중이 없으면(회귀 버그)
    // dstMean 이 투명 배경 쪽(0,0,0)에 끌려 내려가 (약 166,138,125)가 나와 결과가 주변과 겉돈다.
    // 알파 가중이면 투명 픽셀이 기여 0 이라 dstMean=(240,200,180) 그대로 — heal 결과도 정확히
    // 주변 살구색과 일치해야 한다(shift 적용 후 완전히 자연스럽게 섞임).
    const src = paintedImage(30, 30, (x) =>
      x < 10 ? [50, 50, 50, 255] : x < 20 ? [0, 0, 0, 0] : [240, 200, 180, 255]
    );
    const dst = cloneImage(src);
    const dab: HealCloneDab = { srcX: 5, srcY: 15, destX: 20, destY: 15 };
    stampHealCloneDab(src, dst, dab, 3, 1, 1, "heal");
    const [r, g, b] = pixelAt(dst, 20, 15);
    expect(r).toBeCloseTo(240, 0);
    expect(g).toBeCloseTo(200, 0);
    expect(b).toBeCloseTo(180, 0);
  });

  it("heal 모드에서 두 창이 모두 이미지 밖이면 clone 처럼 동작한다(안전 폴백)", () => {
    const src = paintedImage(10, 10, (x) => (x < 5 ? [0, 0, 0, 255] : [200, 200, 200, 255]));
    const dst = cloneImage(src);
    // srcX/srcY, destX/destY 모두 이미지 훨씬 밖 — localMeanColor 가 항상 null.
    const dab: HealCloneDab = { srcX: -500, srcY: -500, destX: -500, destY: -500 };
    // 도장 자체가 완전히 캔버스 밖이라 실제로 칠해지는 픽셀은 없지만, 크래시 없이 조용히 반환되어야 한다.
    expect(() => stampHealCloneDab(src, dst, dab, 3, 1, 1, "heal")).not.toThrow();
  });

  it("apps/web/src/dst 경계를 벗어나는 도장은 겹치는 부분만 그려지고 크래시하지 않는다", () => {
    const src = solidImage(10, 10, 255, 0, 0);
    const dst = solidImage(10, 10, 0, 0, 0);
    const dab: HealCloneDab = { srcX: 0, srcY: 0, destX: 0, destY: 0 }; // 코너 — 절반은 캔버스 밖
    expect(() => stampHealCloneDab(src, dst, dab, 5, 1, 1, "clone")).not.toThrow();
    expect(pixelAt(dst, 0, 0)).toEqual([255, 0, 0, 255]); // 안쪽 코너 픽셀은 정상 반영.
  });

  it("radiusPx<=0, opacity<=0, 비유한 입력은 아무 변화도 만들지 않는다(무연산)", () => {
    const src = solidImage(10, 10, 255, 255, 255);
    const dst = solidImage(10, 10, 0, 0, 0);
    const before = cloneImage(dst);
    const dab: HealCloneDab = { srcX: 5, srcY: 5, destX: 5, destY: 5 };
    stampHealCloneDab(src, dst, dab, 0, 1, 1, "clone");
    stampHealCloneDab(src, dst, dab, 5, 1, 0, "clone");
    stampHealCloneDab(src, dst, dab, Number.NaN, 1, 1, "clone");
    stampHealCloneDab(src, dst, { ...dab, srcX: Number.NaN }, 5, 1, 1, "clone");
    expect(dst.data).toEqual(before.data);
  });
});

describe("applyHealCloneDabs", () => {
  it("여러 도장을 순서대로 적용 — 뒤 도장이 앞 도장 결과를 덮는다", () => {
    const src = paintedImage(20, 20, (x) => (x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const dst = solidImage(20, 20, 128, 128, 128);
    const dabs: HealCloneDab[] = [
      { srcX: 15, srcY: 10, destX: 5, destY: 5 }, // 흰색을 (5,5)에
      { srcX: 2, srcY: 10, destX: 5, destY: 5 }, // 검정을 같은 자리(5,5)에 덮어쓰기
    ];
    applyHealCloneDabs(src, dst, dabs, 1, 1, 1, "clone");
    expect(pixelAt(dst, 5, 5)).toEqual([0, 0, 0, 255]); // 마지막 도장이 이긴다.
  });

  it("빈 도장 목록은 아무것도 하지 않는다", () => {
    const src = solidImage(4, 4, 1, 2, 3);
    const dst = solidImage(4, 4, 9, 9, 9);
    const before = cloneImage(dst);
    applyHealCloneDabs(src, dst, [], 2, 1, 1, "clone");
    expect(dst.data).toEqual(before.data);
  });
});

describe("applyHealCloneDabsFromSeparateRegions", () => {
  it.each(["clone", "heal"] as const)(
    "%s는 실제 ROI planner의 halo로 소수 반경·멀티 dab·네 모서리 경계를 모두 보존한다",
    (mode) => {
      const original = paintedImage(47, 31, (x, y) => [
        (x * 31 + y * 7) % 256,
        (x * 5 + y * 29) % 256,
        (x * 11 + y * 13) % 256,
        (x * 3 + y * 5) % 11 === 0 ? 80 : 255,
      ]);
      const cases: ReadonlyArray<{ radius: number; dabs: readonly HealCloneDab[] }> = [
        {
          radius: 0.5,
          dabs: [{ srcX: 46.2, srcY: 0.3, destX: 0.2, destY: 30.1 }],
        },
        {
          radius: 2.75,
          dabs: [
            { srcX: 39.4, srcY: 4.2, destX: 4.1, destY: 23.8 },
            { srcX: 41.6, srcY: 6.1, destX: 6.3, destY: 25.2 },
            { srcX: 43.2, srcY: 7.4, destX: 8.2, destY: 26.1 },
          ],
        },
        {
          radius: 5,
          dabs: [{ srcX: 0, srcY: 30, destX: 46, destY: 0 }],
        },
      ];

      for (const fixture of cases) {
        const expected = cloneImage(original);
        applyHealCloneDabs(original, expected, fixture.dabs, fixture.radius, 0.37, 0.63, mode);
        const sourceRegion = planStudioRasterRetouchRegion(
          fixture.dabs.map((dab) => ({ x: dab.srcX, y: dab.srcY })),
          fixture.radius,
          original.width,
          original.height,
        );
        const destinationRegion = planStudioRasterRetouchRegion(
          fixture.dabs.map((dab) => ({ x: dab.destX, y: dab.destY })),
          fixture.radius,
          original.width,
          original.height,
        );
        expect(sourceRegion).not.toBeNull();
        expect(destinationRegion).not.toBeNull();
        const sourcePatch = cropFakeImage(
          original,
          sourceRegion!.x,
          sourceRegion!.y,
          sourceRegion!.width,
          sourceRegion!.height,
        );
        const destinationPatch = cropFakeImage(
          original,
          destinationRegion!.x,
          destinationRegion!.y,
          destinationRegion!.width,
          destinationRegion!.height,
        );
        applyHealCloneDabsFromSeparateRegions(
          sourcePatch,
          destinationPatch,
          fixture.dabs.map((dab) => ({
            srcX: dab.srcX - sourceRegion!.x,
            srcY: dab.srcY - sourceRegion!.y,
            destX: dab.destX - destinationRegion!.x,
            destY: dab.destY - destinationRegion!.y,
          })),
          fixture.radius,
          0.37,
          0.63,
          mode,
        );
        const actual = cloneImage(original);
        pasteFakeImage(actual, destinationPatch, destinationRegion!.x, destinationRegion!.y);
        expect(actual.data).toEqual(expected.data);
      }
    },
  );

  it.each(["clone", "heal"] as const)(
    "%s는 멀리 떨어지고 크기가 다른 source/destination ROI에서도 full-frame과 byte-identical하다",
    (mode) => {
      const original = paintedImage(64, 48, (x, y) => [
        (x * 13 + y * 3) % 256,
        (x * 7 + y * 17) % 256,
        (x * 19 + y * 5) % 256,
        (x + y) % 9 === 0 ? 96 : 255,
      ]);
      const dabs: HealCloneDab[] = [
        { srcX: 55.25, srcY: 9.75, destX: 5.5, destY: 39.5 },
        { srcX: 57, srcY: 11, destX: 7.25, destY: 40.5 },
      ];
      const radius = 3.25;
      const expected = cloneImage(original);
      applyHealCloneDabs(original, expected, dabs, radius, 0.55, 0.72, mode);

      const sourceRegion = { x: 49, y: 3, width: 15, height: 15 };
      const destinationRegion = { x: 0, y: 33, width: 16, height: 15 };
      const sourcePatch = cropFakeImage(
        original,
        sourceRegion.x,
        sourceRegion.y,
        sourceRegion.width,
        sourceRegion.height,
      );
      const destinationPatch = cropFakeImage(
        original,
        destinationRegion.x,
        destinationRegion.y,
        destinationRegion.width,
        destinationRegion.height,
      );
      const localDabs = dabs.map((dab) => ({
        srcX: dab.srcX - sourceRegion.x,
        srcY: dab.srcY - sourceRegion.y,
        destX: dab.destX - destinationRegion.x,
        destY: dab.destY - destinationRegion.y,
      }));

      applyHealCloneDabsFromSeparateRegions(
        sourcePatch,
        destinationPatch,
        localDabs,
        radius,
        0.55,
        0.72,
        mode,
      );
      const actual = cloneImage(original);
      pasteFakeImage(actual, destinationPatch, destinationRegion.x, destinationRegion.y);

      expect(sourcePatch.width).not.toBe(destinationPatch.width);
      expect(actual.data).toEqual(expected.data);
    },
  );

  it.each(["clone", "heal"] as const)(
    "%s는 source 오른쪽·destination 왼쪽이 이미지 경계에 잘려도 full-frame 경계를 보존한다",
    (mode) => {
      const original = paintedImage(32, 24, (x, y) => [x * 7, y * 9, (x + y) * 3, 255]);
      const dabs: HealCloneDab[] = [{ srcX: 31, srcY: 8, destX: 0, destY: 16 }];
      const expected = cloneImage(original);
      applyHealCloneDabs(original, expected, dabs, 4, 0.4, 0.85, mode);

      const sourcePatch = cropFakeImage(original, 25, 2, 7, 13);
      const destinationPatch = cropFakeImage(original, 0, 10, 7, 14);
      applyHealCloneDabsFromSeparateRegions(
        sourcePatch,
        destinationPatch,
        [{ srcX: 6, srcY: 6, destX: 0, destY: 6 }],
        4,
        0.4,
        0.85,
        mode,
      );
      const actual = cloneImage(original);
      pasteFakeImage(actual, destinationPatch, 0, 10);

      expect(actual.data).toEqual(expected.data);
    },
  );
});

// ---------------------------------------------------------------------------
// (C) bakeHealCloneStrokeToCanvas — DOM 없는 가짜 팩토리
// ---------------------------------------------------------------------------

type FakeHealCanvas = MaskCanvasLike & MaskImageSource & { id: number };
type FakeSource = MaskImageSource & { testImage: StudioImageDataLike };

function cropFakeImage(
  image: StudioImageDataLike,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): StudioImageDataLike {
  const data = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y += 1) {
    const sourceStart = ((sy + y) * image.width + sx) * 4;
    const targetStart = y * sw * 4;
    data.set(image.data.subarray(sourceStart, sourceStart + sw * 4), targetStart);
  }
  return { data, width: sw, height: sh };
}

function pasteFakeImage(
  target: StudioImageDataLike,
  image: StudioImageDataLike,
  dx: number,
  dy: number,
): void {
  for (let y = 0; y < image.height; y += 1) {
    const sourceStart = y * image.width * 4;
    const targetStart = ((dy + y) * target.width + dx) * 4;
    target.data.set(image.data.subarray(sourceStart, sourceStart + image.width * 4), targetStart);
  }
}

/** 생성 순서대로 id 를 붙이고 drawImage/getImageData/putImageData 를 인메모리 버퍼로 흉내내는 가짜 팩토리. */
function fakeHealCloneFactory(
  log: string[],
  buffers: Map<number, StudioImageDataLike>,
  failAt = Infinity
): HealCloneCanvasFactory {
  let count = 0;
  const nativeImageData = new WeakSet<StudioImageDataLike>();
  return (width, height) => {
    count += 1;
    if (count >= failAt) return null;
    const id = count;
    const canvas: FakeHealCanvas = { id, width, height };
    buffers.set(id, { data: new Uint8ClampedArray(width * height * 4), width, height });
    const ctx: HealCloneCtx2DLike = {
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
      createImageData: (sw, sh) => {
        log.push(`c${id}:createImageData:${sw}x${sh}`);
        const imageData = {
          data: new Uint8ClampedArray(sw * sh * 4),
          width: sw,
          height: sh,
        };
        nativeImageData.add(imageData);
        return imageData;
      },
      drawImage: (image) => {
        log.push(`c${id}:drawImage`);
        const testImage = (image as FakeSource).testImage;
        buffers.set(id, { data: testImage.data.slice() as Uint8ClampedArray, width, height });
      },
      getImageData: (sx, sy, sw, sh) => {
        log.push(`c${id}:getImageData:${sx},${sy},${sw}x${sh}`);
        return cropFakeImage(buffers.get(id)!, sx, sy, sw, sh);
      },
      putImageData: (imageData, dx, dy) => {
        if (!nativeImageData.has(imageData)) {
          throw new TypeError("putImageData requires a context-created ImageData wrapper");
        }
        log.push(`c${id}:putImageData:${dx},${dy},${imageData.width}x${imageData.height}`);
        pasteFakeImage(buffers.get(id)!, imageData, dx, dy);
      },
    };
    return { canvas, ctx };
  };
}

describe("bakeHealCloneStrokeToCanvas", () => {
  const brush = { radiusPx: 3, hardness: 1, opacity: 1 };

  it("도장이 없으면 캔버스를 아예 만들지 않고 null", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeHealCloneFactory(log, buffers);
    const source: FakeSource = { testImage: solidImage(10, 10, 1, 1, 1) };
    const out = await bakeHealCloneStrokeToCanvas(source, 10, 10, [], brush, "clone", factory);
    expect(out).toBeNull();
    expect(log).toEqual([]);
  });

  it("멀리 떨어진 source/destination ROI를 분리해 bridge 없이 읽고 destination만 되붙인다", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeHealCloneFactory(log, buffers);
    const testImage = paintedImage(100, 80, (x, y) => [x * 2, y * 3, (x + y) % 256, 255]);
    const source: FakeSource = { testImage };
    const dabs: HealCloneDab[] = [{ srcX: 80, srcY: 20, destX: 20, destY: 60 }];

    const out = await bakeHealCloneStrokeToCanvas(
      source,
      100,
      80,
      dabs,
      brush,
      "clone",
      factory,
      { executionMode: "direct" },
    );

    expect(out).not.toBeNull();
    expect((out as FakeHealCanvas).id).toBe(1);
    expect(log).toEqual([
      "c1:drawImage",
      "c1:getImageData:75,15,11x11",
      "c1:getImageData:15,55,11x11",
      "c1:createImageData:11x11",
      "c1:putImageData:15,55,11x11",
    ]);

    // 직접 applyHealCloneDabs 를 호출한 결과와 정확히 일치해야 한다(오케스트레이션이 알고리즘을 바꾸지 않음).
    const expectedDst = cloneImage(testImage);
    applyHealCloneDabs(testImage, expectedDst, dabs, brush.radiusPx, brush.hardness, brush.opacity, "clone");
    expect(buffers.get(1)!.data).toEqual(expectedDst.data);

    // destination ROI 밖은 원본 전체 캔버스에서 byte-identical 하게 보존된다.
    expect(pixelAt(buffers.get(1)!, 0, 0)).toEqual(pixelAt(testImage, 0, 0));
    expect(pixelAt(buffers.get(1)!, 99, 79)).toEqual(pixelAt(testImage, 99, 79));
  });

  it("Worker 픽셀 바이트는 source-destination 거리와 무관하고 두 footprint 면적 합에만 비례한다", async () => {
    const measure = async (sourceX: number) => {
      const log: string[] = [];
      const buffers = new Map<number, StudioImageDataLike>();
      const testImage = paintedImage(3_000, 40, (x, y) => [x % 256, y * 5, (x + y) % 256, 255]);
      await bakeHealCloneStrokeToCanvas(
        { testImage },
        3_000,
        40,
        [{ srcX: sourceX, srcY: 12, destX: 100, destY: 28 }],
        brush,
        "clone",
        fakeHealCloneFactory(log, buffers),
        { executionMode: "direct" },
      );
      const reads = log
        .filter((entry) => entry.includes("getImageData"))
        .map((entry) => {
          const match = entry.match(/,(\d+)x(\d+)$/u);
          if (!match) throw new Error(`unexpected getImageData log: ${entry}`);
          return Number(match[1]) * Number(match[2]) * 4;
        });
      return { reads, log };
    };

    const near = await measure(120);
    const far = await measure(2_800);

    expect(near.reads).toEqual([11 * 11 * 4, 11 * 11 * 4]);
    expect(far.reads).toEqual(near.reads);
    expect(far.reads.reduce((sum, bytes) => sum + bytes, 0)).toBe(968);
    expect(far.log.some((entry) => entry.includes("2691x"))).toBe(false);
  });

  it("한 캔버스만 써도 source snapshot은 고정돼 앞선 dab 결과를 다음 source로 읽지 않는다", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const testImage = paintedImage(40, 20, (x) =>
      x >= 30 ? [255, 255, 255, 255] : [0, 0, 0, 255]
    );
    const dabs: HealCloneDab[] = [
      { srcX: 35, srcY: 10, destX: 10, destY: 10 },
      { srcX: 10, srcY: 10, destX: 20, destY: 10 },
    ];
    const out = await bakeHealCloneStrokeToCanvas(
      { testImage },
      40,
      20,
      dabs,
      { radiusPx: 1, hardness: 1, opacity: 1 },
      "clone",
      fakeHealCloneFactory(log, buffers),
      { executionMode: "direct" },
    );

    expect(out).not.toBeNull();
    expect(pixelAt(buffers.get(1)!, 10, 10)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(buffers.get(1)!, 20, 10)).toEqual([0, 0, 0, 255]);
    expect(log.filter((entry) => entry === "c1:drawImage")).toHaveLength(1);
  });

  it("유일한 결과 캔버스 생성이 실패하면 명시적으로 거부", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeHealCloneFactory(log, buffers, 1);
    const source: FakeSource = { testImage: solidImage(10, 10, 1, 1, 1) };
    const dabs: HealCloneDab[] = [{ srcX: 5, srcY: 5, destX: 5, destY: 5 }];
    await expect(
      bakeHealCloneStrokeToCanvas(source, 10, 10, dabs, brush, "clone", factory),
    ).rejects.toThrow("복구 브러시 결과 캔버스를 만들지 못했습니다.");
    expect(log).toEqual([]);
  });

  it("source와 destination footprint가 모두 이미지 밖이면 정상 no-op", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeHealCloneFactory(log, buffers);
    const source: FakeSource = { testImage: solidImage(10, 10, 1, 1, 1) };
    const dabs: HealCloneDab[] = [{ srcX: -100, srcY: -100, destX: -80, destY: -80 }];

    await expect(
      bakeHealCloneStrokeToCanvas(source, 10, 10, dabs, brush, "clone", factory),
    ).resolves.toBeNull();
    expect(log).toEqual([]);
  });

  it("width/height 가 비정상이면 캔버스를 만들지 않고 null", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeHealCloneFactory(log, buffers);
    const source: FakeSource = { testImage: solidImage(10, 10, 1, 1, 1) };
    const dabs: HealCloneDab[] = [{ srcX: 5, srcY: 5, destX: 5, destY: 5 }];
    expect(await bakeHealCloneStrokeToCanvas(source, 0, 10, dabs, brush, "clone", factory)).toBeNull();
    expect(await bakeHealCloneStrokeToCanvas(source, 10, Number.NaN, dabs, brush, "clone", factory)).toBeNull();
    expect(log).toEqual([]);
  });

  it("heal 모드도 orchestration 을 그대로 통과한다(알고리즘 위임 검증)", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const factory = fakeHealCloneFactory(log, buffers);
    const testImage = paintedImage(20, 20, (x) => (x < 10 ? [50, 50, 50, 255] : [200, 200, 200, 255]));
    const source: FakeSource = { testImage };
    const dabs: HealCloneDab[] = [{ srcX: 5, srcY: 10, destX: 15, destY: 10 }];
    const healBrush = { radiusPx: 3, hardness: 1, opacity: 1 };

    const out = await bakeHealCloneStrokeToCanvas(
      source,
      20,
      20,
      dabs,
      healBrush,
      "heal",
      factory,
      { executionMode: "direct" },
    );
    expect(out).not.toBeNull();

    const expectedDst = cloneImage(testImage);
    applyHealCloneDabs(testImage, expectedDst, dabs, healBrush.radiusPx, healBrush.hardness, healBrush.opacity, "heal");
    expect(buffers.get((out as FakeHealCanvas).id)!.data).toEqual(expectedDst.data);
  });

  it("이미 취소된 signal이면 캔버스 할당 전 AbortError", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const controller = new AbortController();
    controller.abort();
    const source: FakeSource = { testImage: solidImage(10, 10, 1, 1, 1) };
    const dabs: HealCloneDab[] = [{ srcX: 5, srcY: 5, destX: 5, destY: 5 }];

    await expect(bakeHealCloneStrokeToCanvas(
      source,
      10,
      10,
      dabs,
      brush,
      "clone",
      fakeHealCloneFactory(log, buffers),
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(log).toEqual([]);
  });

  it("실행 중 취소를 같은 signal로 Worker까지 전달하고 결과를 put하지 않는다", async () => {
    const log: string[] = [];
    const buffers = new Map<number, StudioImageDataLike>();
    const controller = new AbortController();
    let terminated = 0;
    const worker: StudioHealCloneWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: () => {},
      terminate: () => {
        terminated += 1;
      },
    };
    const source: FakeSource = { testImage: solidImage(20, 20, 1, 2, 3) };
    const dabs: HealCloneDab[] = [{ srcX: 8, srcY: 8, destX: 12, destY: 12 }];
    const pending = bakeHealCloneStrokeToCanvas(
      source,
      20,
      20,
      dabs,
      brush,
      "clone",
      fakeHealCloneFactory(log, buffers),
      { signal: controller.signal, workerFactory: () => worker },
    );

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(terminated).toBe(1);
    expect(log.some((entry) => entry.includes("putImageData"))).toBe(false);
  });
});
