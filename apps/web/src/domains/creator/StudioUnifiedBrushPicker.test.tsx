import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { readStudioInspectorAsideSurface } from "./read-studio-inspector-aside-source";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import { DEFAULT_STUDIO_PRO_DRAW_PREFS } from "./studio-pro-draw-prefs";
import {
  StudioInspectorBrushCatalogButton,
  StudioInspectorDrawColorControls,
} from "./StudioInspectorUtilityPanels";
import { StudioUnifiedBrushPicker } from "./StudioUnifiedBrushPicker";


const pickerSource = readFileSync(new URL("./StudioUnifiedBrushPicker.tsx", import.meta.url), "utf8");
const studioPageSource = readStudioCuttoonEditorSource();
const inspectorSource = readStudioInspectorAsideSurface();
const inspectorUtilitySource = readFileSync(
  new URL("./StudioInspectorUtilityPanels.tsx", import.meta.url),
  "utf8"
);
const mobileDockSource = readFileSync(new URL("./StudioMobileEditingDock.tsx", import.meta.url), "utf8");

function renderPicker(): string {
  return renderToStaticMarkup(
    <StudioUnifiedBrushPicker
      activeBrushId="pen"
      brushOpacity={0.75}
      catalogOpen
      color="#7c5cfc"
      proDrawPrefs={{
        ...DEFAULT_STUDIO_PRO_DRAW_PREFS,
        sizeLocked: false,
        opacityLocked: false,
        favoriteBrushIds: ["pen", "neon"],
        recentBrushIds: ["marker", "gpen"],
      }}
      stampTuning={{ flow: 0.48, hardness: 0.35, minSize: 0.18 }}
      stabilizer={6}
      stabilizerMode="adaptive"
      strokeWidth={12}
      tipAngle={-30}
      tipRoundness={0.28}
      onStampTuningChange={vi.fn()}
      onSelectBrush={vi.fn()}
      onToggleCatalog={vi.fn()}
      onToggleFavoriteBrush={vi.fn()}
    />
  );
}

describe("StudioUnifiedBrushPicker", () => {
  it("is a mobile-only controlled projection of the shared built-in preset session", () => {
    const html = renderPicker();

    expect(html).toContain('data-studio-unified-brush-picker="mobile"');
    expect(html).toContain('aria-label="기본 프리셋"');
    expect(html).toContain("앱 제공 · 내 브러시와 별도");
    expect(html).toContain("현재 브러시");
    expect(html).toContain("매끈한 펜");
    expect(html).toContain("12px");
    expect(html).toContain("농도 75%");
    expect(html).toContain("잉크 · 원형 촉");
    expect(html).toContain("속도 적응 6");
    expect(html).toContain('data-studio-active-brush-summary="true"');
    expect(html).toContain('data-studio-brush-tray="true"');
    expect(html).toContain('data-studio-open-brush-library="true"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="매끈한 펜 즐겨찾기 해제"');
    expect(html).toContain("size-11");
  });

  it("keeps the thumb shelf and stamp controls at a 44px touch density", () => {
    const html = renderPicker();

    expect(html).toContain('aria-label="기본 프리셋 빠른 선택 — 즐겨찾기, 최근 사용, 추천"');
    expect(html).toContain('data-studio-quick-source="favorite"');
    expect(html).toContain('data-studio-quick-source="recent"');
    expect(html).toContain('data-studio-quick-source="starter"');
    expect(html).toContain('aria-label="스탬프 브러시 세부 조절"');
    expect(html).toContain('aria-label="스탬프 흐름"');
    expect(html).toContain('aria-label="스탬프 경도"');
    expect(html).toContain('aria-label="스탬프 최소 굵기"');
    expect(html.match(/class="h-11 w-full cursor-pointer accent-accent"/g)).toHaveLength(3);
  });

  it("keeps a procedural catalogue identity visible and selectable on mobile", () => {
    const html = renderToStaticMarkup(
      <StudioUnifiedBrushPicker
        activeBrushId="ink-particle"
        activeCatalogBrushId="heart-stamp"
        activeCatalogBrushName="하트 도장"
        brushOpacity={0.94}
        brushCatalogItems={[{
          id: "heart-stamp",
          name: "하트 도장",
          shortName: "하트",
          hint: "간격이 있는 하트 도장",
          defaultWidth: 26,
          defaultOpacity: 0.94,
          operation: "paint",
          category: "expressive",
          mediaGroup: "fx",
          previewWeight: 0.8,
          previewStyle: "glitter",
        }]}
        catalogOpen
        color="#7c5cfc"
        proDrawPrefs={{
          ...DEFAULT_STUDIO_PRO_DRAW_PREFS,
          sizeLocked: false,
          opacityLocked: false,
          favoriteBrushIds: ["heart-stamp"],
          recentBrushIds: ["heart-stamp"],
        }}
        stabilizer={3}
        stabilizerMode="precision"
        strokeWidth={26}
        tipAngle={0}
        tipRoundness={1}
        onSelectBrush={vi.fn()}
        onSelectBrushId={vi.fn()}
        onToggleCatalog={vi.fn()}
        onToggleFavoriteBrush={vi.fn()}
      />
    );

    expect(html).toContain("하트 도장");
    expect(html).toContain('aria-label="하트 도장 즐겨찾기 해제"');
    expect(html).toContain('data-studio-brush-icon-for="heart-stamp"');
    expect(html).toContain('aria-selected="true"');
    expect(pickerSource).toContain("onSelectBrushId(brushId)");
  });

  it("does not own independent dialog or favorite persistence state", () => {
    expect(pickerSource).not.toContain("createPortal");
    expect(pickerSource).not.toContain("StudioBrushLibrarySheet");
    expect(pickerSource).not.toContain("setLibraryOpen");
    expect(pickerSource).not.toContain("setProDrawPrefs");
    expect(pickerSource).toContain("onToggleCatalog");
    expect(pickerSource).toContain("onToggleFavoriteBrush");
  });

  it("keeps one shared catalogue portal while the desktop sub-tool palette can open it", () => {
    expect(studioPageSource).not.toContain("<StudioUnifiedBrushPicker");
    expect(mobileDockSource.match(/<StudioUnifiedBrushPicker/g)).toHaveLength(1);
    expect(inspectorSource).not.toContain("<StudioUnifiedBrushPicker");
    expect(inspectorUtilitySource).toContain('data-studio-inspector-brush-summary="true"');
    expect(inspectorUtilitySource).toContain("하단 빠른 바와 같은 브러시 목록을 사용합니다");
    expect(inspectorUtilitySource).toContain("onOpenBrushCatalog");
    expect(inspectorUtilitySource).toContain("기본 브러시");
    expect(studioPageSource).toContain("brushCatalogSession");
    expect(studioPageSource.match(/<StudioBrushCatalogPortal/g)).toHaveLength(1);
  });

  it("keeps extracted inspector colour controls explicit and touch friendly", () => {
    const html = renderToStaticMarkup(
      <>
        <StudioInspectorBrushCatalogButton onOpen={vi.fn()} />
        <StudioInspectorDrawColorControls
          color="#16100c"
          eyedropperActive={false}
          onColorChange={vi.fn()}
          onEyedropperToggle={vi.fn()}
        />
      </>,
    );

    expect(html).toContain("브러시 목록");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="스포이드로 캔버스 색상 선택"');
    expect(html).toContain('aria-label="#16100c 색상 선택"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="사용자 정의 색상 선택"');
    expect(html.match(/size-11/g)?.length).toBeGreaterThan(10);
  });

  it("keeps the mobile catalogue open while settings inspect a non-drawing tool", () => {
    expect(studioPageSource).toContain(
      'brushCatalogSession.placement === "mobile-sheet"',
    );
    expect(studioPageSource).toContain(
      '? !isMobile || mobileSheet !== "draw"',
    );
    expect(studioPageSource).toContain(
      ': isMobile || tool !== "draw"',
    );
    expect(studioPageSource).not.toContain(
      'drawMode !== "pen" ||\n      tool !== "draw" ||',
    );
  });
});
