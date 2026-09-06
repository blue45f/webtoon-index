import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_LEVELS } from "./studio-levels";
import { StudioLevelsPanel } from "./StudioLevelsPanel";

import type { StudioImageDataLike } from "./studio-filters";

// 양끝 클리핑 + 중간톤 — 히스토그램 막대/마커가 확실히 생기는 최소 픽셀 소스.
function histogramSource(): StudioImageDataLike {
  const data = new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 255, 255, 255,
    128, 128, 128, 255,
    9, 9, 9, 0, // 완전 투명 — 집계 제외
  ]);
  return { data, width: 2, height: 2 };
}

function renderLevelsPanel(extraProps: { histogramSource?: StudioImageDataLike | null } = {}): string {
  return renderToStaticMarkup(
    <StudioLevelsPanel
      value={{ ...DEFAULT_LEVELS }}
      onPatch={vi.fn()}
      onApplyPreset={vi.fn()}
      onReset={vi.fn()}
      {...extraProps}
    />,
  );
}

describe("StudioLevelsPanel histogram", () => {
  it("histogramSource 없이는 기존과 동일하게 렌더된다(히스토그램 미표시)", () => {
    const html = renderLevelsPanel();
    expect(html).toContain("레벨 보정 (Levels)");
    expect(html).toContain("입력 검정");
    expect(html).not.toContain("data-studio-histogram");
  });

  it("histogramSource가 주어지면 슬라이더 위에 휘도 히스토그램을 그린다", () => {
    const html = renderLevelsPanel({ histogramSource: histogramSource() });

    expect(html).toContain('data-studio-histogram-section="true"');
    expect(html).toContain('data-studio-histogram-bars="true"');
    expect(html).toContain("휘도 히스토그램");
    expect(html).toContain('data-studio-histogram-clip="low"');
    expect(html).toContain('data-studio-histogram-clip="high"');

    // 배치 — 히스토그램 섹션이 첫 슬라이더("입력 검정")보다 앞에 온다.
    const histogramIndex = html.indexOf("data-studio-histogram-section");
    const sliderIndex = html.indexOf("입력 검정");
    expect(histogramIndex).toBeGreaterThan(0);
    expect(sliderIndex).toBeGreaterThan(histogramIndex);
  });

  it("null 소스는 미지정과 동일하게 조용히 생략된다", () => {
    const html = renderLevelsPanel({ histogramSource: null });
    expect(html).not.toContain("data-studio-histogram");
  });
});
