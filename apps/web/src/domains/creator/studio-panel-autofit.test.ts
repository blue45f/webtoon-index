import { describe, it, expect } from "vitest";

import {
  rectOverlapRatio,
  isCenterInside,
  findBestAutoFitFrame,
  isEligibleForPanelAutoFit,
  computePanelAutoFitPatch,
  PANEL_AUTOFIT_OVERLAP_THRESHOLD,
  type FitBox,
} from "./studio-panel-autofit";

const frame: FitBox = { x: 100, y: 200, width: 400, height: 300 };

describe("rectOverlapRatio", () => {
  it("완전히 겹치는 동일 사각형은 1", () => {
    expect(rectOverlapRatio(frame, frame)).toBe(1);
  });

  it("겹치지 않으면 0", () => {
    const far: FitBox = { x: 10000, y: 10000, width: 10, height: 10 };
    expect(rectOverlapRatio(frame, far)).toBe(0);
  });

  it("한쪽이 다른 쪽을 완전히 포함하면(크기가 아무리 달라도) 1에 가깝다 — IoU가 아니라 min-area 분모", () => {
    // 프레임(400x300)을 완전히 뒤덮는 거대한 배경 이미지(캔버스 전체 크기 720x2000).
    const hugeImage: FitBox = { x: -1000, y: -1000, width: 3000, height: 4000 };
    expect(rectOverlapRatio(hugeImage, frame)).toBe(1);
  });

  it("절반만 겹치면 0.5", () => {
    // frame과 폭이 같고 세로로 절반만 겹치는 사각형.
    const half: FitBox = { x: 100, y: 200 + 150, width: 400, height: 300 };
    expect(rectOverlapRatio(frame, half)).toBeCloseTo(0.5, 5);
  });

  it("면적이 0인 사각형은 0", () => {
    expect(rectOverlapRatio({ x: 100, y: 200, width: 0, height: 300 }, frame)).toBe(0);
  });

  it("순서를 바꿔도(대칭) 같은 값", () => {
    const a: FitBox = { x: 0, y: 0, width: 100, height: 100 };
    const b: FitBox = { x: 50, y: 50, width: 100, height: 100 };
    expect(rectOverlapRatio(a, b)).toBe(rectOverlapRatio(b, a));
  });
});

describe("isCenterInside", () => {
  it("중심이 안에 있으면 true", () => {
    const inner: FitBox = { x: 200, y: 300, width: 20, height: 20 };
    expect(isCenterInside(inner, frame)).toBe(true);
  });

  it("중심이 밖에 있으면 false", () => {
    const inner: FitBox = { x: 5000, y: 5000, width: 20, height: 20 };
    expect(isCenterInside(inner, frame)).toBe(false);
  });

  it("중심이 정확히 경계선 위에 있으면 true(경계 포함)", () => {
    // frame의 오른쪽 경계(x=500)에 중심이 오도록 배치.
    const inner: FitBox = { x: 500 - 10, y: 300, width: 20, height: 20 };
    expect(isCenterInside(inner, frame)).toBe(true);
  });
});

describe("findBestAutoFitFrame", () => {
  it("중심 포함 + 겹침 임계값을 만족하는 프레임을 고른다", () => {
    const moved: FitBox = { x: 150, y: 250, width: 100, height: 100 };
    const found = findBestAutoFitFrame(moved, [frame]);
    expect(found).toBe(frame);
  });

  it("겹침 비율이 임계값 미만이면 null", () => {
    // moved의 중심을 frame의 좌상단 모서리(경계선 위 — "중심 포함" 조건 자체는 통과)에 두면
    // 가로/세로 각각 절반씩만 겹쳐 비율이 25%로 임계값(50%) 미만이 된다.
    const moved: FitBox = { x: 50, y: 150, width: 100, height: 100 }; // 중심 (100, 200) = frame 좌상단 모서리
    expect(isCenterInside(moved, frame)).toBe(true);
    expect(rectOverlapRatio(moved, frame)).toBeCloseTo(0.25, 5);
    expect(findBestAutoFitFrame(moved, [frame])).toBeNull();
  });

  it("겹침 비율은 높아도(포함) 중심이 프레임 밖이면 null", () => {
    // 프레임을 완전히 뒤덮는 거대한 이미지지만, 그 이미지의 중심 좌표 자체는 프레임 밖 저 멀리.
    const hugeButOffCenter: FitBox = { x: -5000, y: 150, width: 5500, height: 400 };
    // 위 사각형은 frame(100..500, 200..500)을 완전히 덮지만 중심은 x = -5000+2750 = -2250 로 프레임 밖.
    expect(rectOverlapRatio(hugeButOffCenter, frame)).toBe(1); // 겹침 비율 자체는 만점
    expect(findBestAutoFitFrame(hugeButOffCenter, [frame])).toBeNull(); // 그래도 중심 밖이라 제외
  });

  it("프레임이 없으면 null", () => {
    const moved: FitBox = { x: 150, y: 250, width: 100, height: 100 };
    expect(findBestAutoFitFrame(moved, [])).toBeNull();
  });

  it("여러 프레임이 겹치면(둘 다 임계값 이상) 겹침 비율이 더 큰 쪽을 고른다", () => {
    const moved: FitBox = { x: 0, y: 0, width: 100, height: 100 };
    const fullyOverlapping: FitBox = { x: 0, y: 0, width: 100, height: 100 }; // ratio 1
    const partiallyOverlapping: FitBox = { x: 25, y: 25, width: 100, height: 100 }; // ratio 0.5625 (>= 0.5)
    expect(rectOverlapRatio(moved, partiallyOverlapping)).toBeGreaterThanOrEqual(PANEL_AUTOFIT_OVERLAP_THRESHOLD);
    const found = findBestAutoFitFrame(moved, [partiallyOverlapping, fullyOverlapping]);
    expect(found).toBe(fullyOverlapping);
  });

  it("겹침 비율이 같으면(둘 다 1) 더 작은 프레임(더 안쪽 패널)을 고른다", () => {
    const moved: FitBox = { x: 0, y: 0, width: 100, height: 100 };
    // moved를 완전히 포함하는 훨씬 큰 프레임 — min-area 분모라 ratio는 outerBigger도 1이다.
    const outerBigger: FitBox = { x: 0, y: 0, width: 200, height: 200 };
    const innerSameSize: FitBox = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectOverlapRatio(moved, outerBigger)).toBe(1);
    expect(rectOverlapRatio(moved, innerSameSize)).toBe(1);
    const found = findBestAutoFitFrame(moved, [outerBigger, innerSameSize]);
    expect(found).toBe(innerSameSize);
  });

  it("threshold 기본값은 PANEL_AUTOFIT_OVERLAP_THRESHOLD(0.5)와 같다", () => {
    const moved: FitBox = { x: 150, y: 250, width: 100, height: 100 };
    expect(findBestAutoFitFrame(moved, [frame])).toEqual(findBestAutoFitFrame(moved, [frame], PANEL_AUTOFIT_OVERLAP_THRESHOLD));
  });
});

describe("isEligibleForPanelAutoFit", () => {
  it("회전 없음 + 기울임 없음 + 단일 프레임 + noClip 아님이면 true", () => {
    expect(isEligibleForPanelAutoFit({ rotation: 0 })).toBe(true);
  });

  it("회전이 있으면 false", () => {
    expect(isEligibleForPanelAutoFit({ rotation: 15 })).toBe(false);
  });

  it("기울임(skewX/skewY)이 있으면 false", () => {
    expect(isEligibleForPanelAutoFit({ rotation: 0, skewX: 10 })).toBe(false);
    expect(isEligibleForPanelAutoFit({ rotation: 0, skewY: -5 })).toBe(false);
  });

  it("skewX/skewY가 명시적으로 0이어도 true(undefined와 동일하게 취급 — isIdentitySkew 재사용)", () => {
    // studio-skew.ts의 직렬화 규약(0은 저장 시 undefined로 비움)은 스큐 패널 UI 경로에서만
    // 보장된다 — 이 함수는 임의의 el 형태를 받는 순수 함수라 `skewX: 0`이 명시적으로 들어올 수도
    // 있고, 그 경우도 시각적으로는 항등(기울임 없음)이므로 배제돼선 안 된다.
    expect(isEligibleForPanelAutoFit({ rotation: 0, skewX: 0, skewY: 0 })).toBe(true);
    expect(isEligibleForPanelAutoFit({ rotation: 0, skewX: 0 })).toBe(true);
    expect(isEligibleForPanelAutoFit({ rotation: 0, skewY: 0 })).toBe(true);
  });

  it("skewX가 반올림 시 0으로 정규화되는 미세값이면 true(isIdentitySkew의 clampSkewDeg 반올림 재사용)", () => {
    expect(isEligibleForPanelAutoFit({ rotation: 0, skewX: 0.04 })).toBe(true);
  });

  it("다중 프레임 셀 애니메이션(frameCount > 1)이면 false", () => {
    expect(isEligibleForPanelAutoFit({ rotation: 0, frameCount: 3 })).toBe(false);
  });

  it("frameCount가 0/1/undefined면 true(단일 셀)", () => {
    expect(isEligibleForPanelAutoFit({ rotation: 0, frameCount: 0 })).toBe(true);
    expect(isEligibleForPanelAutoFit({ rotation: 0, frameCount: 1 })).toBe(true);
    expect(isEligibleForPanelAutoFit({ rotation: 0 })).toBe(true);
  });

  it("noClip이면 false", () => {
    expect(isEligibleForPanelAutoFit({ rotation: 0, noClip: true })).toBe(false);
  });
});

describe("computePanelAutoFitPatch", () => {
  it("대상 프레임이 없으면 null", () => {
    const moved: FitBox = { x: 9999, y: 9999, width: 100, height: 100 };
    expect(computePanelAutoFitPatch(moved, [frame])).toBeNull();
  });

  it("대상이 있으면 coverFitInFrame과 동일한 결과를 돌려준다(정사각형 이미지를 400x300 프레임에 cover)", () => {
    const moved: FitBox = { x: 150, y: 250, width: 200, height: 200 };
    const patch = computePanelAutoFitPatch(moved, [frame]);
    expect(patch).not.toBeNull();
    // ratio = max(400/200, 300/200) = 2 → 400x400, 세로로 중앙정렬되며 넘침.
    expect(patch).toEqual({
      x: 100,
      y: 200 + (300 - 400) / 2,
      width: 400,
      height: 400,
    });
  });

  it("겹침이 임계값 미만이면 null(호출부가 기존 {x,y} 패치로 폴백해야 함)", () => {
    const moved: FitBox = { x: 50, y: 150, width: 100, height: 100 }; // 중심 = frame 모서리, 겹침 25%
    expect(computePanelAutoFitPatch(moved, [frame])).toBeNull();
  });

  it("프레임 배열이 비어 있으면 null", () => {
    const moved: FitBox = { x: 150, y: 250, width: 200, height: 200 };
    expect(computePanelAutoFitPatch(moved, [])).toBeNull();
  });
});
