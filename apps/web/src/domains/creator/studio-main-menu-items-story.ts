/**
 * §15.3 authoring groups — Vector, Text & Balloon, Comic & Story, 3D & Physics,
 * plus the product-only AI group §15.3 does not define.
 *
 * All of these items used to live in the product-only `삽입` group (plus the page
 * sequence toggle from `보기`). Handlers are unchanged; `legacyPath` keeps their
 * translation keys pointing at the shipped locale entries.
 */

import {
  Box,
  Boxes,
  Clapperboard,
  Grid2x2,
  Images,
  MessageCircle,
  PersonStanding,
  Plus,
  Settings2,
  Shapes,
  Sparkles,
  Type as TypeIcon,
  Wand2,
  WandSparkles,
} from "lucide-react";

import type { StudioMainMenuItemContext } from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";

/** Vector — §15.3 `Pen/Bezier/Shape`. Shape placement only; no bezier editing. */
export function buildStudioVectorMenuItems({
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "elements",
      commandId: "insert.elements",
      legacyPath: "insert/elements",
      label: "요소 · 도형",
      icon: Shapes,
      onSelect: () => {
        ui.openStudioMenu("elements");
      },
    },
  ];
}

export function buildStudioTextMenuItems({
  editor,
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "bubble",
      commandId: "insert.balloon",
      legacyPath: "insert/bubble",
      label: "말풍선",
      icon: MessageCircle,
      onSelect: () => {
        ui.openStudioMenu("bubble");
      },
    },
    {
      id: "text",
      commandId: "insert.text",
      legacyPath: "insert/text",
      label: "텍스트",
      icon: TypeIcon,
      onSelect: () => {
        editor.addText();
      },
    },
  ];
}

/** Comic & Story — §15.3 `Page Manager` collects both page commands. */
export function buildStudioComicMenuItems({
  state,
  editor,
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "page",
      commandId: "insert.page",
      legacyPath: "insert/page",
      label: "새 페이지",
      icon: Plus,
      disabled: state.collaborationDocumentLocked,
      onSelect: () => {
        editor.addPage();
      },
    },
    {
      id: "page-sequence",
      commandId: "window.page-sequence",
      legacyPath: "view/page-sequence",
      label: state.pageSequenceOpen ? "페이지 시퀀스 닫기" : "페이지 시퀀스 열기",
      icon: Clapperboard,
      checked: state.pageSequenceOpen,
      separatorAfter: true,
      onSelect: () => {
        ui.togglePageSequence();
      },
    },
    {
      id: "collage",
      commandId: "insert.collage",
      legacyPath: "insert/collage",
      label: "콜라주",
      icon: Grid2x2,
      onSelect: () => {
        ui.openStudioMenu("collage");
      },
    },
  ];
}

export function buildStudio3dMenuItems({
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "mannequin3d",
      commandId: "insert.mannequin-3d",
      legacyPath: "insert/mannequin3d",
      label: "3D 데생 인형",
      icon: PersonStanding,
      onSelect: () => {
        ui.openMannequinPoser();
      },
    },
    {
      id: "char",
      commandId: "insert.character-3d",
      legacyPath: "insert/char",
      label: "3D 캐릭터",
      icon: Sparkles,
      onSelect: () => {
        ui.openVrmPoser();
      },
    },
    {
      id: "character",
      commandId: "insert.character-shaper",
      label: "캐릭터 셰이퍼",
      icon: Wand2,
      onSelect: () => {
        ui.openCharacterShaper();
      },
    },
    {
      id: "bg3d",
      commandId: "insert.background-3d",
      legacyPath: "insert/bg3d",
      label: "3D 배경",
      icon: Boxes,
      separatorAfter: true,
      onSelect: () => {
        ui.openBackground3d();
      },
    },
    {
      id: "sculpt",
      commandId: "insert.sculpt-3d",
      label: "3D 스컬프트…",
      icon: Box,
      onSelect: () => {
        ui.openSculptWorkbench();
      },
    },
  ];
}

/** AI — no §15.3 group answers to it, so it stays a declared product extension. */
export function buildStudioAiMenuItems({
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "ai-assist",
      commandId: "ai.assist",
      label: "AI 어시스트",
      icon: WandSparkles,
      onSelect: () => {
        ui.openStudioMenu("aiAssist");
      },
    },
    {
      id: "stock",
      commandId: "ai.stock-images",
      label: "스톡 이미지",
      icon: Images,
      onSelect: () => {
        ui.openStudioMenu("stockImage");
      },
    },
    {
      id: "integrations",
      commandId: "ai.integrations",
      label: "연동 설정",
      icon: Settings2,
      onSelect: () => {
        ui.openStudioMenu("integrations");
      },
    },
  ];
}
