// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { computeHistogram } from "./studio-histogram";
import { StudioHistogramGraph, StudioHistogramSection } from "./StudioHistogramGraph";

import type { StudioImageDataLike } from "./studio-filters";

afterEach(cleanup);

/** [r,g,b,a] 픽셀 목록으로 작은 테스트 이미지를 만든다(행 우선). */
function imageOf(width: number, height: number, pixels: [number, number, number, number][]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach(([r, g, b, a], index) => {
    data[index * 4] = r;
    data[index * 4 + 1] = g;
    data[index * 4 + 2] = b;
    data[index * 4 + 3] = a;
  });
  return { data, width, height };
}

// 양끝 클리핑 + 중간톤 하나 — 마커/막대/통계를 한 번에 검증할 수 있는 최소 분포.
const clippedImage = imageOf(2, 2, [
  [0, 0, 0, 255],
  [255, 255, 255, 255],
  [128, 128, 128, 255],
  [128, 128, 128, 255],
]);

// 중간톤만 — 클리핑 마커가 없어야 하는 분포(빈도 3:1로 로그/선형 높이가 달라진다).
const midtoneImage = imageOf(2, 2, [
  [128, 128, 128, 255],
  [128, 128, 128, 255],
  [128, 128, 128, 255],
  [10, 10, 10, 255],
]);

describe("StudioHistogramGraph", () => {
  it("256칸 막대와 한국어 분포 라벨을 그린다", () => {
    const histogram = computeHistogram(clippedImage, "luma");
    const { container } = render(<StudioHistogramGraph histogram={histogram} />);

    const bars = container.querySelector('[data-studio-histogram-bars="true"]');
    expect(bars).not.toBeNull();
    expect(bars?.getAttribute("d")).toContain("V");

    const svg = screen.getByRole("img");
    expect(svg.getAttribute("aria-label")).toContain("휘도 히스토그램");
    expect(svg.getAttribute("aria-label")).toContain("평균");
    expect(svg.getAttribute("aria-label")).toContain("중앙값 128");
    expect(svg.getAttribute("viewBox")).toBe("0 0 256 64");
  });

  it("0/255 몰림이 있을 때만 양끝 클리핑 마커를 표시한다", () => {
    const clipped = computeHistogram(clippedImage, "luma");
    const { container } = render(<StudioHistogramGraph histogram={clipped} />);
    expect(container.querySelector('[data-studio-histogram-clip="low"]')).not.toBeNull();
    expect(container.querySelector('[data-studio-histogram-clip="high"]')).not.toBeNull();

    cleanup();

    const midtones = computeHistogram(midtoneImage, "luma");
    const { container: cleanContainer } = render(<StudioHistogramGraph histogram={midtones} />);
    expect(cleanContainer.querySelector('[data-studio-histogram-clip="low"]')).toBeNull();
    expect(cleanContainer.querySelector('[data-studio-histogram-clip="high"]')).toBeNull();
  });

  it("데이터가 없으면(null 또는 표본 0) 빈 상태 박스를 그린다", () => {
    const { container } = render(<StudioHistogramGraph histogram={null} />);
    expect(container.querySelector('[data-studio-histogram-empty="true"]')?.textContent).toBe(
      "히스토그램 데이터 없음"
    );
    expect(container.querySelector('[data-studio-histogram-bars="true"]')).toBeNull();

    cleanup();

    const transparent = computeHistogram(imageOf(1, 1, [[9, 9, 9, 0]]), "luma");
    const { container: zeroContainer } = render(<StudioHistogramGraph histogram={transparent} />);
    expect(zeroContainer.querySelector('[data-studio-histogram-empty="true"]')).not.toBeNull();
  });

  it("로그 스케일 prop이 막대 높이를 바꾼다(내부 상태 없음)", () => {
    const histogram = computeHistogram(midtoneImage, "luma");
    const { container: linear } = render(<StudioHistogramGraph histogram={histogram} logScale={false} />);
    const linearD = linear.querySelector('[data-studio-histogram-bars="true"]')?.getAttribute("d");
    cleanup();
    const { container: log } = render(<StudioHistogramGraph histogram={histogram} logScale />);
    const logD = log.querySelector('[data-studio-histogram-bars="true"]')?.getAttribute("d");

    expect(linearD).toBeTruthy();
    expect(logD).toBeTruthy();
    expect(logD).not.toBe(linearD);
  });

  it("r/g/b 채널은 채널 상징색 틴트와 채널명 라벨을 쓴다", () => {
    const histogram = computeHistogram(clippedImage, "r");
    render(<StudioHistogramGraph histogram={histogram} channel="r" />);
    const svg = screen.getByRole("img");
    expect(svg.getAttribute("aria-label")).toContain("빨강 히스토그램");
    expect(svg.getAttribute("class")).toContain("text-red-400");
  });
});

describe("StudioHistogramSection", () => {
  it("픽셀 소스가 없으면 아무것도 그리지 않는다(기존 패널 렌더 동일)", () => {
    const { container } = render(<StudioHistogramSection channel="master" />);
    expect(container.innerHTML).toBe("");
  });

  it("마스터 채널은 휘도 분포로 매핑하고 로그 토글을 제공한다", () => {
    const { container } = render(<StudioHistogramSection source={clippedImage} channel="master" />);
    expect(container.querySelector('[data-studio-histogram-section="true"]')).not.toBeNull();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("휘도 히스토그램");

    const toggle = screen.getByRole("button", { name: "히스토그램 로그 스케일" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("r 채널 편집 중에는 빨강 채널 분포를 그린다", () => {
    render(<StudioHistogramSection source={clippedImage} channel="r" />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("빨강 히스토그램");
  });
});
