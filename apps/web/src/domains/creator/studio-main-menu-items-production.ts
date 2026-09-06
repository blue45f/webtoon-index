/**
 * §15.3 Comic & Story — the story room, measured rather than assumed.
 *
 * The coverage table read six of this group's eight rows as absent. Every one of
 * the six is implemented: Writer Room (script), the storyboard grid with its
 * shot/camera tags, the continuity checker, the vertical scroll-rhythm preview,
 * the production bible (with the promise/payoff ledger inside it) and the
 * animatic timeline. Their single door was the desktop-only 프로젝트 센터 sheet,
 * which the menubar reaches through File ▸ 프로젝트 도구 — 3 actions for commands
 * §15 rule 4 caps at 2, and 0 actions on a narrow viewport.
 *
 * 톤 is the same story from the other direction: `openStudioMenu("tone")` has
 * always been a valid destination, but no menu item used it, so the tone library
 * was reachable only by opening 배경·톤 and finding the 톤 subtab.
 */

import {
  BookOpenCheck,
  Clapperboard,
  NotebookPen,
  PlaySquare,
  ScanEye,
  ScrollText,
  Sparkles,
  Wallpaper,
} from "lucide-react";

import { requestStudioAiSuperSuiteOpen } from "./ai/studio-ai-super-suite-intent";

import type { StudioMainMenuItemContext } from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";

export function buildStudioProductionMenuItems({
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "tone",
      commandId: "comic.tone",
      label: "톤 · 스크린톤",
      icon: Wallpaper,
      separatorAfter: true,
      onSelect: () => {
        ui.openStudioMenu("tone");
      },
    },
    {
      id: "writer-room",
      commandId: "comic.writer-room",
      label: "Writer Room · 대본…",
      icon: NotebookPen,
      onSelect: () => {
        ui.openWriterRoom();
      },
    },
    {
      id: "storyboard",
      commandId: "comic.storyboard",
      label: "스토리보드 그리드…",
      icon: Clapperboard,
      onSelect: () => {
        ui.openStoryboardGrid();
      },
    },
    {
      id: "story-bible",
      commandId: "comic.story-bible",
      label: "제작 바이블…",
      icon: BookOpenCheck,
      separatorAfter: true,
      onSelect: () => {
        ui.openProductionBible();
      },
    },
    {
      id: "continuity",
      commandId: "comic.continuity",
      label: "마감·품질 검사…",
      icon: ScanEye,
      onSelect: () => {
        ui.openContinuityCheck();
      },
    },
    {
      id: "scroll-preview",
      commandId: "comic.scroll-preview",
      label: "세로 스크롤 미리보기…",
      icon: ScrollText,
      onSelect: () => {
        ui.openScrollPreview();
      },
    },
    {
      id: "animatic",
      commandId: "comic.animatic",
      label: "애니매틱 타임라인…",
      icon: PlaySquare,
      onSelect: () => {
        ui.openAnimaticTimeline();
      },
    },
    {
      id: "webtoon-assistant",
      commandId: "comic.webtoon-assistant",
      label: "웹툰 창작 보조 센터…",
      icon: Sparkles,
      onSelect: () => {
        ui.openWebtoonAssistant?.();
      },
    },
    {
      id: "ai-super-suite",
      commandId: "comic.ai-super-suite",
      label: "AI 웹툰 생성 슈퍼 스위트…",
      icon: Sparkles,
      onSelect: () => {
        if (ui.openAiSuperSuite) {
          ui.openAiSuperSuite();
          return;
        }
        ui.openStudioMenu("aiAssist");
        requestStudioAiSuperSuiteOpen();
      },
    },
  ];
}
