/**
 * §15.3 Brush — the group the regroup audit scored 0 of 10.
 *
 * That score was never about missing features. The preset browser
 * (`StudioBrushLibrarySheet`), the dynamics editor (`StudioBrushStudio`), the
 * saved library (`StudioBrushLibraryPanel`) and the ABR/MYB/KPP importers all
 * ship — every one of them reachable only by hunting through the right
 * inspector, in a product whose whole point is the brush. The rows here are
 * doors onto those surfaces; nothing new is invented, and the §15.3 rows the
 * product genuinely lacks (Particle/Physics, Fidelity Lab, Team Preset
 * Versioning) stay recorded as gaps in `studio-main-menu-group-spec.ts` rather
 * than faked with an entry that leads nowhere.
 *
 * It lives in its own module (not in `studio-main-menu-items-artwork.ts` with
 * Select/Layer/Transform) so the drawing group's rows can grow without pushing
 * three unrelated §15.3 groups toward a shared line budget.
 *
 * Pure catalogue — no React, no browser, no page state.
 */

import {
  BookMarked,
  Droplets,
  Eraser,
  Grid2x2,
  LibraryBig,
  Mountain,
  PaintBucket,
  Palette,
  Pencil,
  Shapes,
  SlidersHorizontal,
  Upload,
  Wind,
} from "lucide-react";

import type { StudioMainMenuItemContext } from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";

/**
 * The former product-only `그리기` group. The group id became `brush` to match
 * §15.3 while the Korean label and its locale key stayed put (the spec table's
 * `labelKey`), so 75 shipped translations keep resolving.
 */
export function buildStudioBrushMenuItems({
  editor,
  state,
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "pen",
      commandId: "tool.pen",
      legacyPath: "draw/pen",
      label: "펜",
      icon: Pencil,
      shortcut: "B",
      onSelect: () => {
        ui.selectDrawMode("pen");
      },
    },
    {
      id: "eraser",
      commandId: "tool.eraser",
      legacyPath: "draw/eraser",
      label: "지우개",
      icon: Eraser,
      shortcut: "E",
      onSelect: () => {
        ui.selectDrawMode("eraser");
      },
    },
    {
      id: "fill",
      commandId: "tool.fill",
      legacyPath: "draw/fill",
      label: "채우기",
      icon: PaintBucket,
      shortcut: "G",
      onSelect: () => {
        editor.toggleAdvancedFill();
      },
    },
    {
      id: "smart-shape",
      commandId: "tool.smart-shape",
      legacyPath: "draw/smart-shape",
      label: "스마트 도형",
      icon: Shapes,
      separatorAfter: true,
      onSelect: () => {
        ui.enableSmartShape();
      },
    },
    {
      id: "preset-browser",
      commandId: "brush.preset-browser",
      label: "브러시 프리셋 목록…",
      icon: LibraryBig,
      onSelect: () => {
        ui.openBrushPresetBrowser();
      },
    },
    {
      id: "brush-studio",
      commandId: "brush.studio",
      label: "브러시 스튜디오…",
      icon: SlidersHorizontal,
      onSelect: () => {
        ui.openBrushStudio();
      },
    },
    {
      id: "natural-media",
      commandId: "brush.natural-media",
      label: "자연 매체 · 안료…",
      icon: Droplets,
      onSelect: () => {
        ui.openNaturalMediaBrushes();
      },
    },
    {
      id: "my-brushes",
      commandId: "brush.saved-library",
      label: "내 브러시…",
      icon: BookMarked,
      onSelect: () => {
        ui.openBrushLibrary();
      },
    },
    {
      id: "import-pack",
      commandId: "brush.import-pack",
      label: "브러시 가져오기 (ABR · MYB · KPP)…",
      icon: Upload,
      separatorAfter: true,
      onSelect: () => {
        ui.requestBrushPackImport();
      },
    },
    {
      id: "bg",
      commandId: "brush.background-tone",
      legacyPath: "draw/bg",
      label: "배경 · 톤",
      icon: Mountain,
      onSelect: () => {
        ui.openStudioMenu("bgFill");
      },
    },
    {
      id: "style",
      commandId: "brush.palette-brand",
      legacyPath: "draw/style",
      label: "팔레트 · 브랜드",
      icon: Palette,
      separatorAfter: true,
      onSelect: () => {
        ui.openStudioMenu("palette");
      },
    },
    {
      id: "pixel-art",
      commandId: "brush.pixel-art",
      label: state.pixelArtEnabled ? "픽셀 아트 끄기" : "픽셀 아트",
      icon: Grid2x2,
      checked: state.pixelArtEnabled,
      selectionRole: "checkbox",
      onSelect: () => {
        ui.togglePixelArtMode();
      },
    },
    {
      id: "silk-flow",
      commandId: "brush.silk-flow",
      label: "실크 대칭",
      icon: Wind,
      onSelect: () => {
        ui.enableSilkSymmetry();
      },
    },
  ];
}
