// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  requestStudioCommandSearch,
  subscribeStudioCommandSearchRequests,
  type StudioCommandSearchRequest,
} from "./studio-help-center-channel";
import { STUDIO_IMAGE_INSPECTOR_SECTIONS } from "./studio-inspector-layout";
import { createStudioInspectorTabA11y } from "./studio-inspector-tab-a11y";
import { StudioInspectorNavigator } from "./StudioInspectorNavigator";

import type { StudioInspectorLayout } from "./studio-inspector-layout";

const noop = () => {
  // 정적 렌더에서는 내비게이션 콜백을 실행하지 않는다.
};
const TAB_A11Y = createStudioInspectorTabA11y("test");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderNavigator(
  layout: StudioInspectorLayout,
  selectedType: string | null = "image",
  imageToolsAvailable?: boolean,
  imageToolsStatus?: Readonly<{
    label: string;
    description: string;
    tone: "neutral" | "accent" | "good" | "warn";
  }>,
  selectionCount = selectedType === null ? 0 : 1,
): string {
  return renderToStaticMarkup(
    <StudioInspectorNavigator
      layout={layout}
      tabA11y={TAB_A11Y}
      selectedType={selectedType}
      selectionLabel={
        selectedType === "text"
          ? "텍스트"
          : selectedType
            ? "이미지"
            : null
      }
      selectionCount={selectionCount}
      drawing={false}
      imageToolsAvailable={imageToolsAvailable}
      imageToolsStatusLabel={imageToolsStatus?.label}
      imageToolsStatusDescription={imageToolsStatus?.description}
      imageToolsStatusTone={imageToolsStatus?.tone}
      layerCount={128}
      onChange={noop}
    />
  );
}

describe("StudioInspectorNavigator", () => {
  it("links every primary and image tab to stable, non-duplicated panel ids", () => {
    const html = renderNavigator({
      primary: "properties",
      image: "quick",
      document: "canvas",
    });

    for (const section of ["properties", "layers"] as const) {
      expect(html).toContain(`id="${TAB_A11Y.primary[section].tabId}"`);
      expect(html).toContain(`aria-controls="${TAB_A11Y.primary[section].panelId}"`);
    }
    expect(html).toContain(`id="${TAB_A11Y.primary.document.tabId}"`);
    expect(html).toContain(`aria-controls="${TAB_A11Y.document.canvas.panelId}"`);
    for (const tabId of Object.values(TAB_A11Y.imageTabs)) {
      expect(html).toContain(`id="${tabId}"`);
    }
    expect(html.match(new RegExp(`aria-controls="${TAB_A11Y.imagePanels.selected}"`, "gu")))
      .toHaveLength(5);
    expect(TAB_A11Y.imagePanels.selected).not.toBe(TAB_A11Y.imagePanels.unselected);
  });

  it("links each document subtab to its own stable panel", () => {
    const html = renderNavigator({
      primary: "document",
      image: "quick",
      document: "grade",
    });

    for (const link of Object.values(TAB_A11Y.document)) {
      expect(html).toContain(`id="${link.tabId}"`);
      expect(html).toContain(`aria-controls="${link.panelId}"`);
    }
  });

  it("renders a three-tab dock (대상·레이어·문서) with a capped layer badge", () => {
    const html = renderNavigator({
      primary: "properties",
      image: "quick",
      document: "canvas",
    });

    expect(html).toContain('aria-label="스튜디오 작업 패널"');
    // 3 primary + 5 image tabs. 작품 정보 is no longer a permanent fourth tab (감사 §5.3).
    expect(html.match(/role="tab"/g)).toHaveLength(8);
    expect(html).toContain("대상");
    expect(html).toContain("레이어");
    expect(html).toContain("문서");
    expect(html).not.toContain('data-studio-inspector-primary-tab="publish"');
    expect(html).toContain("99+");
    expect(html).toContain('data-studio-inspector-primary-tab="layers"');
    expect(html).toContain('aria-label="기능·설정 찾기"');
    // 검색 표면은 화면당 하나 — 데스크톱은 위의 통합 검색 행이 그 하나이므로 이 버튼은 lg 에서 숨는다.
    expect(html).toMatch(/data-studio-inspector-search-trigger="true"[^>]*class="[^"]*lg:hidden/u);
  });

  it("shows the 게시 준비 mode with a way back instead of a fourth tab", () => {
    const html = renderNavigator({
      primary: "publish",
      image: "quick",
      document: "canvas",
    });

    expect(html).toContain('data-studio-inspector-publish-mode="true"');
    // The publish panel's aria-labelledby still resolves to this heading.
    expect(html).toContain(`id="${TAB_A11Y.primary.publish.tabId}"`);
    expect(html).toContain("작품 정보");
    expect(html).toContain("편집으로 돌아가기");
    expect(html).not.toContain('aria-selected="true"');
    // Roving tabindex survives with no selected tab.
    expect(html).toMatch(/data-studio-inspector-primary-tab="properties"[^>]*tabindex="0"/u);
  });

  it("uses the shared work-panel name for the mobile close action", () => {
    const html = renderToStaticMarkup(
      <StudioInspectorNavigator
        layout={{ primary: "layers", image: "quick", document: "canvas" }}
        selectedType={null}
        selectionLabel={null}
        drawing={false}
        layerCount={0}
        onRequestClose={noop}
        onChange={noop}
      />,
    );

    expect(html).toContain('aria-label="작업 패널 닫기"');
    expect(html).not.toContain('aria-label="속성 시트 닫기"');
  });

  it("shows image categories only for an image selection, in canonical order, without a hidden scroll strip", () => {
    const imageHtml = renderNavigator({
      primary: "properties",
      image: "fill",
      document: "canvas",
    });
    const textHtml = renderNavigator(
      { primary: "properties", image: "fill", document: "canvas" },
      "text"
    );

    expect(imageHtml).toContain('aria-label="이미지 전문 도구"');
    expect(imageHtml).toContain("빠른 수정");
    expect(imageHtml).toContain("채우기·선화");
    expect(imageHtml).toContain("선택·리터치");
    expect(imageHtml).toContain("마스크");
    expect(imageHtml).toContain("변형");
    expect(imageHtml).toContain('aria-selected="true"');
    expect(textHtml).not.toContain('aria-label="이미지 전문 도구"');

    // 표시 순서는 모델의 정본 순서와 같다(감사 P1: 두 순서가 갈라져 있었다).
    const rendered = [...imageHtml.matchAll(/id="test-studio-inspector-image-tab-([a-z]+)"/gu)]
      .map((match) => match[1]);
    expect(rendered).toEqual([...STUDIO_IMAGE_INSPECTOR_SECTIONS]);
    // 3+2 그리드 — 320px 에서도 다섯 탭이 전부 보인다.
    expect(imageHtml).toMatch(/aria-label="이미지 전문 도구"[^>]*class="[^"]*grid-cols-3/u);
    expect(imageHtml).not.toContain("overflow-x-auto");
  });

  it("keeps professional pixel tools discoverable before a raster target is selected", () => {
    const html = renderNavigator(
      { primary: "properties", image: "retouch", document: "canvas" },
      null,
      true,
      {
        label: "합성본 준비",
        description: "페이지 합성본 준비 후 실행",
        tone: "accent",
      },
    );

    expect(html).toContain('aria-label="이미지 전문 도구"');
    expect(html).toContain("채우기·선화");
    expect(html).toContain("선택·리터치");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("합성본 준비");
    expect(html).toContain("페이지 합성본 준비 후 실행");
    expect(html).toMatch(/aria-describedby="[^"]*-image-tools-status"/u);
  });

  it("shows all image tabs for draw selections", () => {
    const drawHtml = renderNavigator({
      primary: "properties",
      image: "fill",
      document: "canvas",
    }, "draw");

    expect(drawHtml).toContain('aria-label="이미지 전문 도구"');
    expect(drawHtml).toContain("채우기·선화");
    expect(drawHtml).toContain("빠른 수정");
    expect(drawHtml).toContain("선택·리터치");
    expect(drawHtml).toContain("마스크");
    expect(drawHtml).toContain("변형");
    expect(drawHtml).toContain('aria-selected="true"');
  });

  it("uses an independent compact sub-navigation for document settings", () => {
    const html = renderNavigator({
      primary: "document",
      image: "quick",
      document: "grade",
    });

    expect(html).toContain('aria-label="문서 설정"');
    expect(html).toContain("캔버스");
    expect(html).toContain("색보정");
    expect(html).toContain("미니맵");
    expect(html).not.toContain('aria-label="이미지 전문 도구"');
  });

  it("keeps all dock controls mobile-safe and every caption at or above 11px", () => {
    const html = renderNavigator({
      primary: "properties",
      image: "retouch",
      document: "navigator",
    });

    // 모바일 44px 계약은 기본값(`min-h-11`/`size-11`)으로 제공하고 일부 보조 탭만
    // coarse-pointer 보강을 함께 둔다. 구현 방식이 아니라 실제 최소 터치 크기 토큰을 센다.
    expect(html.match(/(?:min-h-11|size-11)/g)?.length).toBeGreaterThanOrEqual(9);
    expect(html).toContain("sticky top-0");
    // 감사 §5.10: 0.52~0.7rem 의 깨알 글씨가 좁은 폭을 메우고 있었다. 배지·보조 문구의 하한은 11px.
    const tinySizes = [...html.matchAll(/text-\[(0\.\d+)rem\]/gu)]
      .map((match) => Number(match[1]))
      .filter((rem) => rem * 16 < 11);
    expect(tinySizes).toEqual([]);
  });

  it("offers a direct return to selected-object properties from another tab", () => {
    const html = renderNavigator(
      { primary: "layers", image: "quick", document: "canvas" },
      "text",
    );

    expect(html).toContain("텍스트 편집");
    expect(html).toContain("선택한 대상의 속성을 바로 엽니다");
    expect(html).toContain("대상 열기");
  });

  it("treats a marquee count as a selection and summarizes it as generic elements", () => {
    const html = renderNavigator(
      { primary: "properties", image: "quick", document: "canvas" },
      null,
      undefined,
      undefined,
      3,
    );

    expect(html).toContain("3개 요소");
    expect(html).not.toContain("3개 이미지");
  });

  it("opens the unified search scoped to the current panel instead of a second search box", () => {
    const seen: StudioCommandSearchRequest[] = [];
    const unsubscribe = subscribeStudioCommandSearchRequests((request) => seen.push(request));
    try {
      render(
        <StudioInspectorNavigator
          layout={{ primary: "properties", image: "quick", document: "canvas" }}
          tabA11y={TAB_A11Y}
          selectedType={null}
          selectionLabel={null}
          drawing={false}
          layerCount={0}
          onChange={noop}
        />,
      );
      expect(screen.queryByRole("searchbox")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "기능·설정 찾기" }));
      expect(seen).toEqual([{ scope: "inspector" }]);
      // Sanity: the channel round-trips a bare request too.
      expect(requestStudioCommandSearch()).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it("focuses the active properties tab after the contextual CTA opens it", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const onChange = vi.fn();

    function NavigatorHarness() {
      const [layout, setLayout] = useState<StudioInspectorLayout>({
        primary: "layers",
        image: "quick",
        document: "canvas",
      });
      return (
        <StudioInspectorNavigator
          layout={layout}
          tabA11y={TAB_A11Y}
          selectedType={null}
          selectionLabel={null}
          selectionCount={2}
          drawing={false}
          layerCount={2}
          onChange={(next) => {
            onChange(next);
            setLayout(next);
          }}
        />
      );
    }

    render(<NavigatorHarness />);

    fireEvent.click(screen.getByRole("button", { name: /대상 열기/u }));

    expect(onChange).toHaveBeenCalledWith({
      primary: "properties",
      image: "quick",
      document: "canvas",
    });
    const propertiesTab = screen.getByRole("tab", { name: "대상" });
    expect(propertiesTab.getAttribute("aria-selected")).toBe("true");
    expect(propertiesTab).toBe(document.activeElement);
  });

  it("returns to editing from the 게시 준비 mode", () => {
    const onChange = vi.fn();
    render(
      <StudioInspectorNavigator
        layout={{ primary: "publish", image: "quick", document: "canvas" }}
        tabA11y={TAB_A11Y}
        selectedType={null}
        selectionLabel={null}
        drawing={false}
        layerCount={0}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "편집으로 돌아가기" }));
    expect(onChange).toHaveBeenCalledWith({
      primary: "properties",
      image: "quick",
      document: "canvas",
    });
  });
});
