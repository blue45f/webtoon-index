/**
 * Help group entries: search, current-tool help, learning and troubleshooting.
 * The public manual opens separately; it must not navigate away from an unsaved editor.
 */
import { BookOpen, Bug, Command, HelpCircle, LifeBuoy, Scale, Search, Stethoscope } from "lucide-react";

import {
  openStudioHelpCenter,
  requestStudioCommandSearch,
} from "./studio-help-center-channel";
import { buildStudioHelpMenuItems } from "./studio-main-menu-items-workspace";

import type { StudioHelpMenuItemsInput } from "./studio-main-menu-items-workspace";
import type { StudioMainMenuItem } from "./studio-main-menu-model";

const LABELS = {
  ko: {
    "command-search": "명령 · 속성 통합 검색",
    "terminology-search": "CSP · Photoshop 용어 찾기",
    "current-tool": "현재 도구 도움말",
    "user-manual": "사용자 매뉴얼 (새 탭)",
    diagnostics: "기기 · 브라우저 진단…",
    recovery: "복구 가이드…",
    licenses: "라이선스 · 서드파티 고지…",
    "bug-report": "버그 리포트 패키지…",
  },
  en: {
    "command-search": "Command search",
    "terminology-search": "CSP · Photoshop terminology",
    "current-tool": "Current tool help",
    "user-manual": "User manual · Korean (new tab)",
    diagnostics: "Device and browser diagnosis…",
    recovery: "Recovery guide…",
    licenses: "Licenses and third-party notices…",
    "bug-report": "Bug report package…",
  },
} as const;

export function buildStudioHelpGroupItems(
  input: StudioHelpMenuItemsInput,
): StudioMainMenuItem[] {
  const learning = buildStudioHelpMenuItems(input);
  const activeToolCommandId = input.state.activeToolCommandId;
  const label = LABELS[input.helpGroupLabel === "도움말" ? "ko" : "en"];

  const finding: StudioMainMenuItem[] = [
    {
      id: "command-search",
      commandId: "help.command-search",
      label: label["command-search"],
      icon: Search,
      shortcut: "F1",
      onSelect: () => {
        requestStudioCommandSearch();
      },
    },
    {
      id: "terminology-search",
      commandId: "help.terminology-search",
      label: label["terminology-search"],
      icon: Command,
      onSelect: () => {
        openStudioHelpCenter({ section: "terminology" });
      },
    },
    {
      id: "current-tool",
      commandId: "help.current-tool",
      label: label["current-tool"],
      icon: HelpCircle,
      separatorAfter: true,
      onSelect: () => {
        openStudioHelpCenter({
          section: "current-tool",
          ...(activeToolCommandId === null
            ? {}
            : { toolCommandId: activeToolCommandId }),
        });
      },
    },
  ];

  const troubleshooting: StudioMainMenuItem[] = [
    {
      id: "diagnostics",
      commandId: "help.diagnostics",
      label: label["diagnostics"],
      icon: Stethoscope,
      onSelect: () => {
        openStudioHelpCenter({ section: "diagnostics" });
      },
    },
    {
      id: "recovery",
      commandId: "help.recovery",
      label: label["recovery"],
      icon: LifeBuoy,
      separatorAfter: true,
      onSelect: () => {
        openStudioHelpCenter({ section: "recovery" });
      },
    },
    {
      id: "licenses",
      commandId: "help.licenses",
      label: label["licenses"],
      icon: Scale,
      onSelect: () => {
        openStudioHelpCenter({ section: "license" });
      },
    },
    {
      id: "bug-report",
      commandId: "help.bug-report",
      label: label["bug-report"],
      icon: Bug,
      onSelect: () => {
        openStudioHelpCenter({ section: "bug-report" });
      },
    },
  ];

  const manual: StudioMainMenuItem = {
    id: "user-manual",
    commandId: "help.user-manual",
    label: label["user-manual"],
    icon: BookOpen,
    // Reuse this same non-mutating action from the command search.
    searchActivation: "execute",
    onSelect: () => { window.open("/studio/manual", "_blank", "noopener,noreferrer"); },
  };
  const learningWithSeparator = [manual, ...learning].map((item, index, items) =>
    index === items.length - 1 ? { ...item, separatorAfter: true } : item,
  );

  return [...finding, ...learningWithSeparator, ...troubleshooting];
}
