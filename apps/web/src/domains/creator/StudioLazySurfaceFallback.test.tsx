import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudioPanelLoading, StudioRouteLoading } from "./StudioLazySurfaceFallback";

describe("StudioLazySurfaceFallback", () => {
  it("announces inline loading while keeping its skeleton decorative and stable", () => {
    const html = renderToStaticMarkup(<StudioPanelLoading label="색상 패널을 여는 중..." />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-studio-lazy-surface="inline"');
    expect(html).toContain("min-h-20");
    expect(html).toContain("색상 패널을 여는 중...");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("animate-spin");
  });

  it("renders a responsive editor-shell skeleton instead of a blocking spinner", () => {
    const html = renderToStaticMarkup(<StudioRouteLoading label="게시 스튜디오를 여는 중..." />);

    expect(html).toContain('data-studio-lazy-surface="route"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("grid-cols-[3.5rem_minmax(0,1fr)]");
    expect(html).toContain("lg:grid-cols-[3.5rem_minmax(0,1fr)_16rem]");
    expect(html).toContain("게시 스튜디오를 여는 중...");
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("svg");
  });
});
