import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StudioPressureCurveGraph } from "./StudioPressureCurveGraph";

describe("StudioPressureCurveGraph", () => {
  it("renders the direct editor, presets, and isolated pressure test pad", () => {
    const html = renderToStaticMarkup(
      <StudioPressureCurveGraph
        pressureCurve={1}
        onPressureCurveChange={vi.fn()}
        pressureMinSize={0.25}
      />
    );
    expect(html).toContain('data-studio-pressure-curve-graph="true"');
    expect(html).toContain('data-studio-pressure-curve-chart="true"');
    expect(html).toContain('data-studio-pressure-curve-handle="true"');
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-label="필압 곡선 제어점"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain("중간 필압 출력 50%");
    expect(html).toContain('data-studio-pressure-test-pad="true"');
    expect(html).toContain("실시간 필압 테스트");
    expect(html).toContain("자동 보정");
    expect(html).toContain("시험선은 실제 작품에 기록되지 않으며");
    expect(html).toContain('aria-label="필압 반응 강도"');
    expect(html).toContain('data-studio-pressure-curve="soft"');
    expect(html).toContain('data-studio-pressure-curve="linear"');
    expect(html).toContain('data-studio-pressure-curve="firm"');
  });
});
