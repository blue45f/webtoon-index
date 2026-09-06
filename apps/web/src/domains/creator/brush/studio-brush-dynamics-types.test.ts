import {
  DEFAULT_STUDIO_STROKE_BUDGET,
  resolveStrokeDabCapacity,
  STUDIO_CAUSAL_WATERCOLOR_DAB_RESIDENT_BYTES,
  STUDIO_DYNAMIC_BRUSH_DAB_RESIDENT_BYTES,
} from "@toonspectrum/studio-brush-platform";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_CAUSAL_WATERCOLOR_MAX_DABS,
  normalizeStudioCausalWatercolorSettings,
  STUDIO_CAUSAL_WATERCOLOR_DAB_CAP_RANGE,
} from "../studio-causal-watercolor-brush";
import { planStudioDynamicBrush } from "./studio-brush-dynamics-plan";
import {
  DEFAULT_STUDIO_DYNAMIC_BRUSH_MAX_DABS,
  STUDIO_DYNAMIC_BRUSH_DAB_CAP_RANGE,
} from "./studio-brush-dynamics-types";

/**
 * dab 상한을 StrokeBudget 파생으로 바꾼 리팩터링이 숫자를 한 자리도 움직이지 않았는지 고정한다
 * (2026-09-02 아키텍처 리뷰, 동작 중립 계약). 여기가 빨개지면 예산 상수가 바뀐 것이고,
 * 그건 브러시 동작 변경이므로 의도적이어야 한다.
 */
describe("dab cap ranges derived from StrokeBudget", () => {
  it("keeps the shipped dynamic-brush cap and default", () => {
    expect(STUDIO_DYNAMIC_BRUSH_DAB_CAP_RANGE.min).toBe(1);
    expect(STUDIO_DYNAMIC_BRUSH_DAB_CAP_RANGE.max).toBe(32_768);
    expect(DEFAULT_STUDIO_DYNAMIC_BRUSH_MAX_DABS).toBe(8_192);
  });

  it("keeps the shipped causal-watercolor cap and default", () => {
    expect(STUDIO_CAUSAL_WATERCOLOR_DAB_CAP_RANGE.min).toBe(2);
    expect(STUDIO_CAUSAL_WATERCOLOR_DAB_CAP_RANGE.max).toBe(32_768);
    expect(DEFAULT_STUDIO_CAUSAL_WATERCOLOR_MAX_DABS).toBe(16_384);
  });

  it("matches the budget arithmetic the platform exports", () => {
    expect(STUDIO_DYNAMIC_BRUSH_DAB_CAP_RANGE.max).toBe(
      resolveStrokeDabCapacity({
        budget: DEFAULT_STUDIO_STROKE_BUDGET,
        bytesPerDab: STUDIO_DYNAMIC_BRUSH_DAB_RESIDENT_BYTES,
      }),
    );
    expect(STUDIO_CAUSAL_WATERCOLOR_DAB_CAP_RANGE.max).toBe(
      resolveStrokeDabCapacity({
        budget: DEFAULT_STUDIO_STROKE_BUDGET,
        bytesPerDab: STUDIO_CAUSAL_WATERCOLOR_DAB_RESIDENT_BYTES,
      }),
    );
  });

  it("still clamps planner input against the derived range", () => {
    // 상한 쪽: 정규화 경계가 파생된 max 로 잘라낸다.
    expect(normalizeStudioCausalWatercolorSettings({ maxDabs: 1e9 }).maxDabs).toBe(
      STUDIO_CAUSAL_WATERCOLOR_DAB_CAP_RANGE.max,
    );
    expect(normalizeStudioCausalWatercolorSettings({ maxDabs: 0 }).maxDabs).toBe(
      STUDIO_CAUSAL_WATERCOLOR_DAB_CAP_RANGE.min,
    );

    // 하한 쪽: 동적 플래너는 min=1 로 잘려 최소 한 dab 은 남긴다(획이 사라지지 않는다).
    const clamped = planStudioDynamicBrush({
      points: [0, 0, 40, 0, 80, 0],
      baseWidth: 10,
      seed: 7,
      maxDabs: -5,
    });
    expect(clamped.dabs).toHaveLength(STUDIO_DYNAMIC_BRUSH_DAB_CAP_RANGE.min);
    expect(clamped.capped).toBe(true);
  });
});
