/**
 * §15.3 Help group coverage.
 *
 * Its own module because Help went from two rows to nine in one wave and because
 * three of its eight §15.3 rows describe surfaces that read live probes rather
 * than menu wiring — the notes here have to stay long enough to say what is
 * measured and what is still absent. Keeping that in the shared table pushed the
 * declaration file past the budget that protects it from exactly this.
 */

import { has, ours, part } from "./studio-main-menu-group-spec-model";

import type { StudioMenuGroupSpec } from "./studio-main-menu-group-spec-model";

export const STUDIO_MENU_HELP_GROUP_SPEC: StudioMenuGroupSpec = {
  id: "help",
  labelKo: "도움말",
  specName: "Help",
  inV5Spec: true,
  /**
   * Wave D shipped the unified search, the 506 vendor aliases and the F1
   * binding but cut no door in the menubar, so the audit's "7 of 8 missing"
   * stayed true for everything except the search box inside the inspector.
   * This wave opens the doors and builds the five surfaces behind them. Every
   * one of them reads a live probe or a live store — nothing here is a
   * hardcoded reassurance.
   */
  rows: [
    has("Command Search", "help/command-search"),
    part(
      "Current Tool Help",
      "카탈로그가 도구마다 `helpNodeId` 를 들고 있지만 그 노드를 채운 산문 문서는 아직 없다. 그래서 라벨·설명·단축키·타사 별칭과 검색 색인이 찾아 주는 관련 항목만 보여 주고, 산문 도움말이 없다는 사실을 화면에 적는다.",
      "help/current-tool",
    ),
    part("Tutorial Project", "기능 튜토리얼 32종 허브. 따라 하기용 예제 프로젝트 파일은 없다.", "help/feature-tutorials"),
    has("CSP/Photoshop terminology search", "help/terminology-search"),
    has("Device/Browser Diagnosis", "help/diagnostics"),
    has("Recovery Guide", "help/recovery"),
    has("License/Attribution", "help/licenses"),
    has("Bug Report Package", "help/bug-report"),
  ],
  extras: [
    ours("help/shortcuts", "단축키 · 기본 조작."),
    ours("help/user-manual", "별도 사용자 매뉴얼 · 새 탭에서 연다 (#794)."),
  ],
};
