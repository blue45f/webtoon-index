// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Market3dAssetPreview } from "./Market3dAssetPreview";
import { MarketBrushPreview } from "./MarketBrushPreview";
import { MarketFilterPreview } from "./MarketFilterPreview";
import { MarketPalettePreview } from "./MarketPalettePreview";
import { MarketScene3dPreview } from "./MarketScene3dPreview";
import { MarketTemplatePreview } from "./MarketTemplatePreview";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function createCanvasContext() {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(),
  };
}

let canvasContext = createCanvasContext();

beforeEach(() => {
  canvasContext = createCanvasContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((
    ((contextId: string) => contextId === "2d"
      ? canvasContext as unknown as CanvasRenderingContext2D
      : null) as typeof HTMLCanvasElement.prototype.getContext
  ));
});

afterEach(() => {
  cleanup();
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
  vi.restoreAllMocks();
});

describe("market interactive preview accessibility", () => {
  it("names the brush region and lets a keyboard user draw and reset", () => {
    render(
      <MarketBrushPreview
        brush={{ name: "잉크 펜", size: 14, opacity: 0.8, color: "#b4532a" }}
      />,
    );

    expect(screen.getByRole("region", { name: "잉크 펜" })).toBeTruthy();
    const canvas = screen.getByRole("application", { name: "잉크 펜 브러시 연습 캔버스" });
    expect(canvas.getAttribute("tabindex")).toBe("0");
    expect(canvas.className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("slider", { name: /크기/u }).className).toContain("pointer-coarse:h-11");
    expect(screen.getByLabelText("브러시 색상").className).toContain("pointer-coarse:size-11");
    expect(screen.getByRole("button", { name: "초기화" }).className).toContain("pointer-coarse:min-h-11");

    canvasContext.stroke.mockClear();
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(canvasContext.stroke).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("포인터 또는 키보드로 직접 그려보세요")).toBeNull();
  });

  it("exposes pressed sample tabs and a visible, focusable filter comparison slider", () => {
    const { container } = render(
      <MarketFilterPreview
        filter={{ name: "따뜻한 대비", engine: "canvas2d", values: { contrast: 1.15 } }}
      />,
    );

    const scene = screen.getByRole("button", { name: "배경 씬" });
    const character = screen.getByRole("button", { name: "캐릭터 컷" });
    expect(scene.getAttribute("aria-pressed")).toBe("true");
    expect(character.getAttribute("aria-pressed")).toBe("false");
    expect(scene.className).toContain("pointer-coarse:min-h-11");
    fireEvent.click(character);
    expect(scene.getAttribute("aria-pressed")).toBe("false");
    expect(character.getAttribute("aria-pressed")).toBe("true");

    const slider = screen.getByRole("slider", { name: "필터 전후 비교 슬라이더" });
    expect(slider.className).not.toContain("opacity-0");
    expect(slider.className).toContain("focus-visible:ring-2");
    expect(slider.className).toContain("pointer-coarse:h-11");
    fireEvent.change(slider, { target: { value: "70" } });
    expect(slider.getAttribute("aria-valuetext")).toBe("왼쪽 효과 예시 70%, 오른쪽 원본 30%");
    expect(screen.getByText(/실제 Studio 렌더가 아닌/u)).toBeTruthy();
    expect(container.innerHTML).not.toContain("bg-black");
    expect(container.innerHTML).not.toContain("text-white");
  });

  it("announces palette clipboard failures instead of silently ignoring them", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const { container } = render(
      <MarketPalettePreview colors={["#f2c078", "#5b2f22"]} paletteName="가을 잉크" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "#f2c078 색상 복사" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("#f2c078 복사 실패");
    });
    expect(container.innerHTML).not.toContain("bg-black");
    expect(container.innerHTML).not.toContain("bg-white");
  });

  it("labels scene and template visuals as illustrations without unsupported apply claims", () => {
    const longRecipeId = `background/${"mobile-overflow-segment-".repeat(8)}`;
    render(
      <>
        <MarketScene3dPreview recipe={{ name: "작업실", recipeId: longRecipeId }} />
        <MarketTemplatePreview template={{ name: "세로 흐름", templateId: "webtoon-scroll" }} />
      </>,
    );

    expect(screen.getByRole("region", { name: "3D 프리셋 참고 일러스트 (작업실)" })).toBeTruthy();
    expect(screen.getByText(/실제 Studio 렌더 결과가 아닙니다/u)).toBeTruthy();
    expect(screen.getByRole("region", { name: "템플릿 참고 레이아웃 (세로 흐름)" })).toBeTruthy();
    expect(screen.getByText(/실제 Studio 적용 결과와 다를 수 있습니다/u)).toBeTruthy();
    const recipeBadge = screen.getByText((content) => content.includes(longRecipeId));
    expect(recipeBadge.className).toContain("max-w-full");
    expect(recipeBadge.className).toContain("break-all");
    expect(document.body.textContent).not.toContain("실시간 렌더링 및 카메라 회전");
    expect(document.body.textContent).not.toContain("1클릭으로 해당 컷 가이드와 여백을 자동 설정");
  });

  it("renders Market3dAssetPreview with accessible region, parameters count, and disclaimer", () => {
    render(
      <Market3dAssetPreview
        recipe={{
          name: "휴머노이드 모델",
          recipeId: "humanoid-base-v1",
          parameters: { height: 175, pose: "standing", gender: "neutral" },
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "3D 에셋 미리보기 (휴머노이드 모델)" })).toBeTruthy();
    expect(screen.getByText("3개 파라미터")).toBeTruthy();
    expect(screen.getByText("3D 에셋")).toBeTruthy();
    expect(screen.getByText("회전 가능")).toBeTruthy();
    expect(screen.getByText(/3D 에셋의 구조를 설명하기 위한 단순화된 일러스트이며/u)).toBeTruthy();
  });
});
