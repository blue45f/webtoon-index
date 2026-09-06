/**
 * §15.3 File and Edit — the rows the 프로젝트 센터 sheet was hiding.
 *
 * File ▸ 프로젝트 도구 opens a portal sheet that is the *only* door to named
 * version checkpoints, the publish package, the publish preflight report, the
 * asset-rights manifest and Auto Actions. The sheet is `max-sm:hidden`, so on a
 * phone those five features have no entry point at all, and on desktop each of
 * them costs 3 actions — the menu group, 프로젝트 도구, then the button.
 *
 * Quick Start is the same shape from the File side: the panel that offers a
 * template start and the webtoon wizard re-opens only from a floating canvas
 * button gated `hidden lg:grid`, or the mobile dock's 추가 tab.
 *
 * §15.3's 새 프로젝트 row stays *partial*, not present: Quick Start starts a new
 * piece of work without clearing the open one. Rows the product truly lacks —
 * 원본 파일 연결, 포맷 호환성 보고서 as a standalone report, 복구 센터, 명령 반복 —
 * stay recorded as gaps in `studio-main-menu-group-spec.ts`.
 */

import {
  FilePlus2,
  History,
  PackageCheck,
  ListChecks,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";

import type { StudioMainMenuItemContext } from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";

/** File rows that open project-scoped surfaces. Appended after the export loop. */
export function buildStudioProjectMenuItems({
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "quick-start",
      commandId: "file.quick-start",
      label: "빠른 시작 · 새 작업…",
      icon: FilePlus2,
      onSelect: () => {
        ui.openQuickStart();
      },
    },
    {
      id: "checkpoints",
      commandId: "file.checkpoints",
      label: "버전 체크포인트…",
      icon: History,
      separatorAfter: true,
      onSelect: () => {
        ui.openCheckpoints();
      },
    },
    {
      id: "publish-preflight",
      commandId: "file.publish-preflight",
      label: "게시 사전검사…",
      icon: ListChecks,
      onSelect: () => {
        ui.openPublishPreflight();
      },
    },
    {
      id: "publish-package",
      commandId: "file.publish-package",
      label: "게시 패키지…",
      icon: PackageCheck,
      onSelect: () => {
        ui.openPublishPackage();
      },
    },
    {
      id: "rights-manifest",
      commandId: "file.rights-manifest",
      label: "에셋 권리 감사…",
      icon: ShieldCheck,
      onSelect: () => {
        ui.openAssetRightsAudit();
      },
    },
  ];
}

/** Edit ▸ Automation Recipe. Auto Action sets plus the macro recorder inside them. */
export function buildStudioAutomationMenuItems({
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "auto-actions",
      commandId: "edit.auto-actions",
      label: "자동 액션 · 매크로…",
      icon: WandSparkles,
      onSelect: () => {
        ui.openAutoActions();
      },
    },
  ];
}
