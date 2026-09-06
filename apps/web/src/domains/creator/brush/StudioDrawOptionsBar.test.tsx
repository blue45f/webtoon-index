// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STUDIO_ALL_BRUSH_CATALOG_ITEMS } from "./studio-brush-catalog";
import { StudioBrushLibrarySheet } from "./StudioBrushLibrarySheet";
import { StudioDrawOptionsBar } from "./StudioDrawOptionsBar";

const drawOptionsSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/brush/StudioDrawOptionsBar.tsx"),
  "utf8"
);
const studioGlobalsSource = readFileSync(resolve(process.cwd(), "apps/web/src/styles/globals.css"), "utf8");

afterEach(cleanup);

describe("StudioDrawOptionsBar", () => {
  it("renders a compact primary dock with continuous size, opacity, and smart-shape controls", () => {
    const html = renderToStaticMarkup(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="pen"
        strokeWidth={8}
        brushOpacity={0.85}
        stabilizer={6}
        color="#112233"
        secondaryColor="#445566"
        recentSwatches={["#000000", "#ffffff"]}
        quickShapeActive
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onSecondaryColorChange={vi.fn()}
        onSwapColors={vi.fn()}
        eyedropperActive
        onToggleEyedropper={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );
    expect(html).toContain('data-studio-draw-options="true"');
    expect(html).toContain('data-studio-icon-first="true"');
    // Icon-first controls retain accessible names; only the selected mode gains a compact label.
    expect(html).toContain('aria-label="스마트 도형"');
    expect(html).toContain('aria-label="브러시 크기"');
    expect(html).toContain('aria-label="브러시 불투명도"');
    expect(html).toContain('data-studio-draw-options-end="true"');
    expect(html).not.toContain("브러시 크기 프리셋");
    expect(html).not.toContain('data-studio-size-chip="');
    expect(html).toContain('aria-pressed="true"');
    // CSP/Photopea dual well on the commercial options strip
    expect(html).toContain('data-studio-dual-color-well="true"');
    expect(html).toContain('data-studio-color-swap="true"');
    expect(html).toContain('data-studio-eyedropper-trigger="true"');
    expect(html).toContain('aria-label="스포이드 사용 중"');
    expect(html).toContain('data-studio-size-preview="true"');
    expect(html).toContain('data-studio-opacity-glyph="true"');
    // Active brush pill + continuous controls + progressive disclosure
    expect(html).toContain('data-studio-brush-active-pill="true"');
    expect(html).toContain('data-studio-draw-advanced-toggle="true"');
  });

  it("keeps the shared basic-preset catalog reachable from the compact active-brush control", () => {
    // Advanced row is closed by default; stabilizer lives behind toggle.
    // The library pill and two continuous controls remain visible; preset chips are progressive.
    const html = renderToStaticMarkup(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="neon"
        strokeWidth={18}
        brushOpacity={0.75}
        stabilizer={6}
        color="#39ff14"
        quickShapeActive={false}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
        favoriteBrushIds={["neon", "pen"]}
        onToggleFavoriteBrush={vi.fn()}
      />
    );
    expect(html).toContain("브러시 선택 열기");
    expect(html).toContain("네온");
  });

  it("keeps a Pro catalogue identity visible and favoriteable while rendering canonically", () => {
    const onToggleFavoriteBrush = vi.fn();
    const onSelectBrush = vi.fn();
    render(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="ink-particle"
        activeCatalogBrushId="heart-stamp"
        activeCatalogBrushName="하트 도장"
        brushCatalogItems={STUDIO_ALL_BRUSH_CATALOG_ITEMS}
        strokeWidth={26}
        brushOpacity={0.94}
        stabilizer={4}
        color="#cc3366"
        quickShapeActive={false}
        favoriteBrushIds={["heart-stamp"]}
        recentBrushIds={["hair-fiber", "ink-particle"]}
        onSelectBrush={onSelectBrush}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
        onToggleFavoriteBrush={onToggleFavoriteBrush}
      />
    );

    const activePill = screen.getByRole("button", {
      name: "현재 도구 하트 도장, 26px, 불투명도 94%, 브러시 선택 열기",
    });
    expect(activePill.textContent).toContain("하트");
    // Icon/raster routing stays on the canonical renderer id, never the catalogue id.
    expect(activePill.querySelector('[data-studio-brush-icon-for="ink-particle"]')).toBeTruthy();
    expect(activePill.querySelector('[data-studio-brush-icon-for="heart-stamp"]')).toBeNull();

    const favorite = screen.getByRole("button", { name: "즐겨찾기 해제" });
    expect(favorite.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(favorite);
    expect(onToggleFavoriteBrush).toHaveBeenCalledWith("heart-stamp");

    // Quick shelf is always on the primary strip (wash/favorites one-tap; no expand required).
    const activeQuickBrush = screen.getByRole("option", {
      name: /즐겨찾기 브러시 하트 도장/,
    });
    expect(activeQuickBrush.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: /최근 사용 브러시 머리카락 결/ }));
    expect(onSelectBrush.mock.calls[0]?.[0]).toMatchObject({ id: "hair-fiber" });
  });

  it("surfaces wash and air starter chips without expanding advanced options", () => {
    render(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="pen"
        strokeWidth={6}
        brushOpacity={1}
        stabilizer={0}
        color="#111111"
        quickShapeActive={false}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("option", { name: /추천 브러시 수채 번짐/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: /추천 브러시 소프트 에어브러시/ }),
    ).toBeTruthy();
    // Advanced still collapses size/stabilizer chrome; shelf itself is primary.
    expect(screen.getByRole("button", { name: "빠른 세부 옵션 펼치기" })).toBeTruthy();
  });

  it("presents the selected brush as the current tool and reapplies its full preset in one click", () => {
    const onSelectBrush = vi.fn();
    render(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="marker"
        strokeWidth={9}
        brushOpacity={0.9}
        stabilizer={4}
        color="#224466"
        quickShapeActive={false}
        onSetDrawMode={vi.fn()}
        onSelectBrush={onSelectBrush}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );

    expect(
      screen
        .getByRole("toolbar", {
          name: "그리기 옵션 · 현재 반투명 마커",
        })
        .getAttribute("data-studio-active-draw-mode")
    ).toBe("pen");
    expect(screen.getByRole("button", { name: "펜" }).getAttribute("data-studio-active-mode")).toBe(
      "pen"
    );
    expect(screen.getByText("펜", { selector: '[data-studio-active-mode-label="true"]' })).toBeTruthy();

    const activeTool = screen.getByRole("button", {
      name: "현재 도구 반투명 마커, 9px, 불투명도 90%, 브러시 선택 열기",
    });
    expect(activeTool.getAttribute("data-studio-active-tool-summary")).toBe("pen");
    expect(activeTool.textContent).toContain("반투명 마커");
    expect(activeTool.textContent).toContain("9px · 90%");

    const reset = screen.getByRole("button", {
      name: "반투명 마커 기본값으로 복원, 변경된 설정 1개",
    });
    expect(reset.getAttribute("data-studio-brush-preset-modified")).toBe("true");
    fireEvent.click(reset);
    expect(onSelectBrush).toHaveBeenCalledOnce();
    expect(onSelectBrush.mock.calls[0]?.[0]).toMatchObject({
      id: "marker",
      defaultWidth: 16,
      defaultOpacity: 0.6,
    });

    const quickDetails = screen.getByRole("button", { name: "빠른 세부 옵션 펼치기" });
    expect(quickDetails.getAttribute("data-studio-draw-advanced-toggle")).toBe("true");
    expect(quickDetails.textContent).toContain("세부 옵션");
    fireEvent.click(quickDetails);
    expect(
      screen.getByRole("button", { name: "빠른 세부 옵션 접기" }).getAttribute("aria-expanded")
    ).toBe("true");
  });

  it("uses the canonical full-brush restore action and exposes its exact modified count", () => {
    const onRestoreBrushDefaults = vi.fn();
    render(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="gpen"
        strokeWidth={11}
        brushOpacity={0.72}
        stabilizer={9}
        color="#224466"
        quickShapeActive={false}
        brushDefaultRestore={{
          sourceName: "G펜",
          modifiedCount: 4,
          loading: false,
          available: true,
        }}
        onRestoreBrushDefaults={onRestoreBrushDefaults}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );

    const reset = screen.getByRole("button", {
      name: "G펜 기본값으로 복원, 변경된 설정 4개",
    });
    expect(reset.getAttribute("data-studio-brush-preset-modified-count")).toBe("4");
    fireEvent.click(reset);
    expect(onRestoreBrushDefaults).toHaveBeenCalledOnce();
  });

  it("turns the clean post-restore control into an explicit one-step undo", () => {
    const onRestoreBrushDefaults = vi.fn();
    render(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="gpen"
        strokeWidth={7}
        brushOpacity={1}
        stabilizer={5}
        color="#111111"
        quickShapeActive={false}
        brushDefaultRestore={{
          sourceName: "G펜",
          modifiedCount: 0,
          loading: false,
          available: true,
          undoAvailable: true,
        }}
        onRestoreBrushDefaults={onRestoreBrushDefaults}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );

    const undo = screen.getByRole("button", { name: "G펜 기본값 복원 취소" });
    expect(undo.textContent).toContain("되돌리기");
    fireEvent.click(undo);
    expect(onRestoreBrushDefaults).toHaveBeenCalledOnce();
  });

  it("fails closed with a clear reselect instruction when a safe brush baseline is unavailable", () => {
    render(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="gpen"
        strokeWidth={7}
        brushOpacity={1}
        stabilizer={5}
        color="#111111"
        quickShapeActive={false}
        brushDefaultRestore={{
          sourceName: "삭제된 저장 브러시",
          modifiedCount: 0,
          loading: false,
          available: false,
        }}
        onRestoreBrushDefaults={vi.fn()}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );

    const reset = screen.getByRole("button", {
      name: "삭제된 저장 브러시 기본값 없음, 브러시를 다시 선택하세요",
    });
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    expect(reset.textContent).toContain("기준 없음");
    const recoveryHintTarget = screen.getByRole("group", {
      name: "삭제된 저장 브러시 기본값 없음, 브러시를 다시 선택하세요",
    });
    expect(recoveryHintTarget.getAttribute("tabindex")).toBe("0");
    recoveryHintTarget.focus();
    expect(document.activeElement).toBe(recoveryHintTarget);
  });

  it("keeps preset reapplication available without falsely marking untouched defaults as changed", () => {
    const html = renderToStaticMarkup(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="gpen"
        strokeWidth={7}
        brushOpacity={1}
        stabilizer={5}
        color="#111111"
        quickShapeActive={false}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );

    expect(html).toContain('aria-label="G펜(필압) 기본값 다시 적용"');
    expect(html).toContain('data-studio-brush-preset-modified="false"');
    expect(html).toContain(">7px · 100%<");
  });

  it("does not claim locked size or opacity will be reset when reapplying a brush preset", () => {
    const html = renderToStaticMarkup(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="marker"
        strokeWidth={9}
        brushOpacity={0.9}
        stabilizer={4}
        color="#111111"
        quickShapeActive={false}
        sizeLocked
        opacityLocked
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );

    expect(html).toContain('aria-label="반투명 마커 기본값 다시 적용"');
    expect(html).toContain('data-studio-brush-preset-modified="false"');
    expect(drawOptionsSource).toContain("잠금 상태를 유지합니다.");
  });

  it.each([
    ["pixel", "픽셀 펜"],
    ["eraser", "지우개"],
    ["shape", "도형"],
  ] as const)("makes the active %s mode visible without relying on icon recognition", (drawMode, label) => {
    const html = renderToStaticMarkup(
      <StudioDrawOptionsBar
        drawMode={drawMode}
        brushId="pen"
        strokeWidth={6}
        brushOpacity={1}
        stabilizer={4}
        color="#112233"
        quickShapeActive={false}
        onSetDrawMode={vi.fn()}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );

    expect(html).toContain(`data-studio-active-draw-mode="${drawMode}"`);
    expect(html).toContain(`data-studio-active-mode="${drawMode}"`);
    expect(html).toContain('data-studio-active-mode-label="true"');
    expect(html).toContain(`>${label}<`);
  });

  it("keeps a named low-density eraser visible while generic eraser mode has no brush identity", () => {
    const named = renderToStaticMarkup(
      <StudioDrawOptionsBar
        drawMode="eraser"
        brushId="kneaded-eraser"
        activeCatalogBrushId="kneaded-eraser"
        activeCatalogBrushName="떡지우개(저농도)"
        brushCatalogItems={STUDIO_ALL_BRUSH_CATALOG_ITEMS}
        strokeWidth={26}
        brushOpacity={0.38}
        stabilizer={0}
        color="#112233"
        quickShapeActive={false}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );
    expect(named).toContain("그리기 옵션 · 현재 떡지우개(저농도)");
    expect(named).toContain("현재 도구 떡지우개(저농도), 26px, 지우기 강도 38%");
    expect(named).toContain('data-studio-active-tool-summary="eraser"');

    const generic = renderToStaticMarkup(
      <StudioDrawOptionsBar
        drawMode="eraser"
        brushId="pen"
        strokeWidth={26}
        brushOpacity={0.38}
        stabilizer={0}
        color="#112233"
        quickShapeActive={false}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );
    expect(generic).toContain("그리기 옵션 · 현재 지우개");
    expect(generic).not.toContain('data-studio-brush-active-pill="true"');
  });

  it.each([
    ["pen", "브러시 크기", "브러시 불투명도", true],
    ["pixel", null, "픽셀 불투명도", false],
    ["eraser", "지우개 크기", "지우기 강도", true],
    ["shape", "도형 선 굵기", "도형 불투명도", false],
  ] as const)(
    "keeps %s properties contextual and hides irrelevant advanced brush settings",
    (drawMode, sizeLabel, opacityLabel, advancedAvailable) => {
      render(
        <StudioDrawOptionsBar
          drawMode={drawMode}
          brushId="pen"
          strokeWidth={6}
          brushOpacity={0.8}
          stabilizer={4}
          color="#112233"
          quickShapeActive={false}
          shapeKind="rect"
          onShapeKindChange={vi.fn()}
          onSelectBrush={vi.fn()}
          onStrokeWidthChange={vi.fn()}
          onOpacityChange={vi.fn()}
          onStabilizerChange={vi.fn()}
          onColorChange={vi.fn()}
          onToggleQuickShape={vi.fn()}
        />
      );

      if (sizeLabel) {
        expect(screen.getByRole("slider", { name: sizeLabel })).toBeTruthy();
      } else {
        expect(screen.queryByRole("slider", { name: /크기|굵기/ })).toBeNull();
      }
      expect(screen.getByRole("slider", { name: opacityLabel })).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "빠른 세부 옵션 펼치기" }) !== null
      ).toBe(advancedAvailable);
    }
  );

  it("uses the StudioPage-owned catalog session instead of mounting a second sheet", () => {
    expect(drawOptionsSource).toContain("brushCatalogOpen?: boolean");
    expect(drawOptionsSource).toContain("onToggleBrushCatalog?: (trigger: HTMLButtonElement) => void");
    expect(drawOptionsSource).not.toContain('import { StudioBrushLibrarySheet }');
    expect(drawOptionsSource).not.toContain("<StudioBrushLibrarySheet");
    expect(drawOptionsSource).not.toContain("setLibraryOpen");
    expect(drawOptionsSource).toContain("toggleBrushCatalog(event.currentTarget)");
    expect(drawOptionsSource).not.toContain("brushLibraryTriggerRef");
  });

  it("keeps every core control reachable in a visible, keyboard-navigable narrow-dock scroller", () => {
    const primaryIndex = drawOptionsSource.indexOf('data-studio-draw-options-primary="true"');
    const utilityIndex = drawOptionsSource.indexOf('data-studio-draw-options-end="true"');
    const advancedIndex = drawOptionsSource.indexOf('data-studio-draw-advanced-toggle="true"');

    expect(primaryIndex).toBeGreaterThan(0);
    expect(utilityIndex).toBeGreaterThan(primaryIndex);
    expect(advancedIndex).toBeGreaterThan(utilityIndex);
    expect(drawOptionsSource).toContain('data-studio-draw-options-scroll="visible"');
    expect(drawOptionsSource).toContain('role="group"');
    expect(drawOptionsSource).toContain("좌우로 스크롤할 수 있습니다");
    expect(drawOptionsSource).toContain("overflow-x-auto overflow-y-hidden");
    expect(drawOptionsSource).not.toContain(
      'data-studio-draw-options-primary="true"\n          className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden"'
    );
    for (const control of ["mode", "brush", "shape", "size", "opacity"]) {
      expect(drawOptionsSource).toContain(`data-studio-core-draw-control="${control}"`);
    }
    expect(studioGlobalsSource).toContain("container-name: studio-draw-options");
    expect(studioGlobalsSource).toContain("@container studio-draw-options (max-width: 60rem)");
    expect(studioGlobalsSource).toContain('[data-studio-draw-secondary-action="favorite"]');
    expect(studioGlobalsSource).toContain('[data-studio-draw-options-primary="true"]::-webkit-scrollbar');
    expect(studioGlobalsSource).toContain("scrollbar-width: auto");
  });

  it("gives high-frequency primary controls one rich coach target without native-title duplication", () => {
    const html = renderToStaticMarkup(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="pen"
        strokeWidth={8}
        brushOpacity={0.85}
        stabilizer={6}
        color="#112233"
        quickShapeActive={false}
        onSetDrawMode={vi.fn()}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
        onToggleFavoriteBrush={vi.fn()}
        onToggleCanvasFlipH={vi.fn()}
        onOpenBrushStudio={vi.fn()}
      />
    );

    expect(html.match(/data-studio-tool-hint-target="true"/g)?.length ?? 0).toBeGreaterThanOrEqual(11);
    expect(html).not.toContain('title="캔버스 좌우 반전"');
    expect(html).not.toContain('title="브러시 스튜디오');
    expect(html).not.toContain('title="스마트 도형');
    expect(html).toContain('aria-label="브러시 크기"');
    expect(html).toContain('aria-label="브러시 불투명도"');
  });

  it("assigns semantic animated previews across advanced drawing workflows", () => {
    for (const preview of [
      "brush-size",
      "brush-library",
      "brush-favorite",
      "brush-slot",
      "brush-studio",
      "draw-settings",
      "flip-view",
      "opacity",
      "shape-fill",
      "stabilizer",
      "pressure",
      "symmetry",
      "shape",
      "smart-shape",
      "ink",
      "erase",
    ]) {
      expect(drawOptionsSource).toContain(`"${preview}"`);
    }
    expect(drawOptionsSource).toContain("`symmetry-${item.id}`");
    expect(drawOptionsSource).toContain("`stabilizer-${stabilizerMode}`");
    expect(drawOptionsSource).toContain("`stabilizer-${item.id}`");
    expect(drawOptionsSource).toContain('"post-correction"');
    expect(drawOptionsSource).toContain("`pressure-${item.id}`");

    expect(drawOptionsSource.match(/<StudioToolHintTarget/g)?.length ?? 0).toBeGreaterThanOrEqual(16);
    expect(drawOptionsSource).not.toContain('title="캔버스 좌우 반전"');
    expect(drawOptionsSource).not.toContain('title="브러시 스튜디오');
    expect(drawOptionsSource).not.toContain('title="스마트 도형');
    expect(drawOptionsSource).not.toContain("title={`손떨림 보정");
    expect(drawOptionsSource).not.toContain("title={`후처리");
    expect(drawOptionsSource).not.toContain("title={`보정 방식:");
    expect(drawOptionsSource).not.toContain("title={`필압:");
    expect(drawOptionsSource).not.toContain("title={`대칭:");
  });

  it("describes the next stateful drawing-dock action with an exact preview variant", () => {
    for (const [preview, variantExpression] of [
      ["brush-favorite", 'isFavorite ? "remove" : "add"'],
      ["shape-fill", 'shapeFill ? "disable" : "enable"'],
      ["draw-settings", 'advancedOpen ? "collapse" : "expand"'],
      ["flip-view", 'canvasFlipH ? "restore" : "flip"'],
      ["smart-shape", 'quickShapeActive ? "disable" : "enable"'],
    ]) {
      const previewIndex = drawOptionsSource.indexOf(`"${preview}"`);
      expect(previewIndex, `missing preview family: ${preview}`).toBeGreaterThanOrEqual(0);
      expect(drawOptionsSource.slice(previewIndex, previewIndex + 180)).toContain(variantExpression);
    }
  });

  it("uses exact rich previews for every size and opacity preset without native titles", () => {
    for (const sizeVariant of ["xs", "s", "m", "l", "xl", "xxl"]) {
      expect(drawOptionsSource).toContain(`preset-${sizeVariant}`);
    }
    for (const opacityVariant of [20, 40, 60, 80, 100]) {
      expect(drawOptionsSource).toContain(`preset-${opacityVariant}`);
    }
    expect(drawOptionsSource).toContain("BRUSH_SIZE_HINT_VARIANT[chip.id]");
    expect(drawOptionsSource).toContain("BRUSH_OPACITY_HINT_VARIANT[chip.id]");
    expect(drawOptionsSource).toContain('sizeLocked ? "unlock" : "lock"');
    expect(drawOptionsSource).toContain('opacityLocked ? "unlock" : "lock"');
    expect(drawOptionsSource).not.toContain("title=");
    expect(drawOptionsSource).toContain("이후 새로 그리는 획부터 이 크기가 적용돼요.");
    expect(drawOptionsSource).toContain("브러시 프리셋을 선택할 때 해당 프리셋의 기본 크기");
    expect(drawOptionsSource).toContain("브러시 프리셋을 선택할 때 해당 프리셋의 기본 불투명도");
  });

  it("keeps advanced size and opacity presets keyboard-named, stateful, and actionable", () => {
    const onStrokeWidthChange = vi.fn();
    const onOpacityChange = vi.fn();
    const onToggleSizeLock = vi.fn();
    const onToggleOpacityLock = vi.fn();

    render(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="pen"
        strokeWidth={24}
        brushOpacity={0.8}
        stabilizer={4}
        color="#112233"
        quickShapeActive={false}
        sizeLocked
        opacityLocked={false}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={onStrokeWidthChange}
        onOpacityChange={onOpacityChange}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
        onToggleSizeLock={onToggleSizeLock}
        onToggleOpacityLock={onToggleOpacityLock}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "빠른 세부 옵션 펼치기" }));

    const sizeGroup = screen.getByRole("group", { name: "브러시 크기 프리셋" });
    const activeSize = within(sizeGroup).getByRole("button", {
      name: "브러시 크기 L 24픽셀",
    });
    expect(activeSize.getAttribute("aria-pressed")).toBe("true");
    expect(activeSize.hasAttribute("title")).toBe(false);
    fireEvent.click(within(sizeGroup).getByRole("button", { name: "브러시 크기 XS 2픽셀" }));
    expect(onStrokeWidthChange).toHaveBeenCalledWith(2);

    const sizeUnlock = within(sizeGroup).getByRole("button", {
      name: "브러시 크기 잠금 해제",
    });
    expect(sizeUnlock.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(sizeUnlock);
    expect(onToggleSizeLock).toHaveBeenCalledOnce();

    const opacityGroup = screen.getByRole("group", { name: "브러시 불투명도 프리셋" });
    const activeOpacity = within(opacityGroup).getByRole("button", {
      name: "브러시 불투명도 80%",
    });
    expect(activeOpacity.getAttribute("aria-pressed")).toBe("true");
    expect(activeOpacity.hasAttribute("title")).toBe(false);
    fireEvent.click(
      within(opacityGroup).getByRole("button", { name: "브러시 불투명도 20%" })
    );
    expect(onOpacityChange).toHaveBeenCalledWith(0.2);

    const opacityLock = within(opacityGroup).getByRole("button", {
      name: "브러시 불투명도 잠금",
    });
    expect(opacityLock.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(opacityLock);
    expect(onToggleOpacityLock).toHaveBeenCalledOnce();
  });

  it("keeps symmetry and slots behind the advanced disclosure", () => {
    const html = renderToStaticMarkup(
      <StudioDrawOptionsBar
        drawMode="pen"
        brushId="pen"
        strokeWidth={6}
        brushOpacity={1}
        stabilizer={4}
        color="#112233"
        brushSlots={[
          { brushId: "pen", strokeWidth: 6, brushOpacity: 1 },
          null,
          null,
          null,
          null,
          null,
        ]}
        symmetryType="vertical"
        quickShapeActive={false}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
        onRecallBrushSlot={vi.fn()}
        onAssignBrushSlot={vi.fn()}
        onSymmetryTypeChange={vi.fn()}
      />
    );
    // Progressive disclosure: slots only when advanced is open
    expect(html).not.toContain("브러시 슬롯 1");
    expect(html).toContain('data-studio-draw-advanced-toggle="true"');
    expect(html).not.toContain("대칭 그리기");
    expect(html).not.toContain('aria-label="대칭 세로"');
  });

  it("renders commercial shape strip and fill when shape mode is active", () => {
    const html = renderToStaticMarkup(
      <StudioDrawOptionsBar
        drawMode="shape"
        brushId="pen"
        strokeWidth={4}
        brushOpacity={1}
        stabilizer={0}
        color="#112233"
        quickShapeActive={false}
        shapeKind="rect"
        shapeFill
        onShapeKindChange={vi.fn()}
        onShapeFillChange={vi.fn()}
        onSetDrawMode={vi.fn()}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );
    expect(html).toContain('data-studio-shape-strip="true"');
    expect(html).toContain("도형 채우기");
    expect(html).toContain("도형");
    expect(html).toContain('aria-label="그리기 모드"');
  });

  it("keeps unavailable shape fill discoverable from a named disabled coach", () => {
    const html = renderToStaticMarkup(
      <StudioDrawOptionsBar
        drawMode="shape"
        brushId="pen"
        strokeWidth={4}
        brushOpacity={1}
        stabilizer={0}
        color="#112233"
        quickShapeActive={false}
        shapeKind="line"
        shapeFill={false}
        onShapeKindChange={vi.fn()}
        onShapeFillChange={vi.fn()}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );

    const unavailableCoach = html.slice(
      html.indexOf('data-studio-tool-hint-unavailable="true"'),
      html.indexOf('data-studio-tool-hint-unavailable="true"') + 900,
    );
    expect(unavailableCoach).toContain('role="group"');
    expect(unavailableCoach).not.toContain('role="button"');
    expect(unavailableCoach).toContain('aria-label="도형 채우기"');
    expect(unavailableCoach).toContain('aria-disabled="true"');
    expect(unavailableCoach).toContain('tabindex="0"');
  });

  it("keeps the fixed dock inside the canvas column when desktop panels are open", () => {
    const html = renderToStaticMarkup(
      <StudioDrawOptionsBar
        docked
        dockInsets={{ left: 308, right: 420 }}
        drawMode="pen"
        brushId="pen"
        strokeWidth={6}
        brushOpacity={1}
        stabilizer={4}
        color="#112233"
        quickShapeActive={false}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );
    expect(html).toContain('data-studio-draw-options-dock-left="308"');
    expect(html).toContain('data-studio-draw-options-dock-right="420"');
    expect(html).toContain("100vw - 752px");
    expect(html).toContain("max(calc(100vw - 752px), 20rem)");
    expect(html).toContain("clamp(10.75rem");
    expect(drawOptionsSource).toContain(
      'bottom: "max(0.75rem, env(safe-area-inset-bottom))"',
    );
  });

  it("widens the dock when chrome is intentionally hidden", () => {
    const html = renderToStaticMarkup(
      <StudioDrawOptionsBar
        docked
        dockInsets={{ left: 0, right: 0 }}
        drawMode="pen"
        brushId="pen"
        strokeWidth={6}
        brushOpacity={1}
        stabilizer={4}
        color="#112233"
        quickShapeActive={false}
        onSelectBrush={vi.fn()}
        onStrokeWidthChange={vi.fn()}
        onOpacityChange={vi.fn()}
        onStabilizerChange={vi.fn()}
        onColorChange={vi.fn()}
        onToggleQuickShape={vi.fn()}
      />
    );
    expect(html).toContain('data-studio-draw-options-dock-left="0"');
    expect(html).toContain('data-studio-draw-options-dock-right="0"');
    expect(html).toContain("100vw - 24px");
    expect(html).toContain("max(calc(100vw - 24px), 20rem)");
  });

  it("keeps the brush library a keyboard-friendly non-modal popover", () => {
    const html = renderToStaticMarkup(
      <StudioBrushLibrarySheet
        open
        activeBrushId="pen"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-describedby="');
    expect(html).not.toContain('aria-modal="true"');
  });
});
