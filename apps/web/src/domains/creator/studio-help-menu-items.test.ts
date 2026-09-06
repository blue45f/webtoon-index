/** Help wiring contracts: every advertised entry must reach its intended surface. */
import { describe, expect, it, vi } from "vitest";

import { findCatalogEntriesBySource } from "./studio-command-catalog";
import {
  subscribeStudioCommandSearchRequests,
  subscribeStudioHelpCenter,
} from "./studio-help-center-channel";
import { buildStudioHelpGroupItems } from "./studio-help-menu-items";
import { STUDIO_MENU_GROUP_SPEC } from "./studio-main-menu-group-spec";

import type { StudioHelpCenterRequest } from "./studio-help-center-channel";
import type {
  StudioMainMenuBuilderState,
  StudioMainMenuEditorActions,
  StudioMainMenuUiActions,
} from "./studio-main-menu-contract";

function helpItems(activeToolCommandId: string | null = "tool.pen") {
  const editor = new Proxy({} as StudioMainMenuEditorActions, { get: () => vi.fn() });
  const ui = new Proxy({} as StudioMainMenuUiActions, { get: () => vi.fn() });
  const state = { activeToolCommandId } as unknown as StudioMainMenuBuilderState;
  return buildStudioHelpGroupItems({ state, editor, ui, helpGroupLabel: "도움말" });
}

describe("§15.3 Help 그룹", () => {
  it("keeps every existing entry and adds the independent manual before learning", () => {
    const ids = helpItems().map((item) => item.id);
    expect(ids).toEqual([
      "command-search", "terminology-search", "current-tool", "user-manual",
      "feature-tutorials", "shortcuts", "diagnostics", "recovery", "licenses", "bug-report",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("한국어가 아닌 로케일에서는 영어 라벨을 낸다", () => {
    const editor = new Proxy({} as StudioMainMenuEditorActions, { get: () => vi.fn() });
    const ui = new Proxy({} as StudioMainMenuUiActions, { get: () => vi.fn() });
    const english = buildStudioHelpGroupItems({
      state: { activeToolCommandId: "tool.pen" } as unknown as StudioMainMenuBuilderState,
      editor, ui, helpGroupLabel: "Help",
    });
    expect(english.find((item) => item.id === "bug-report")?.label).toBe("Bug report package…");
    expect(helpItems().find((item) => item.id === "bug-report")?.label).toBe("버그 리포트 패키지…");
    expect(english.find((item) => item.id === "user-manual")?.label).toContain("Korean");
  });

  it("모든 줄이 카탈로그 명령 id 를 참조한다", () => {
    for (const item of helpItems()) {
      expect(item.commandId, item.id).toMatch(/^help\./u);
      expect(findCatalogEntriesBySource("menu", `help/${item.id}`).some((entry) => entry.id === item.commandId)).toBe(true);
    }
  });

  it("opens the manual without replacing the editing tab or sharing its opener", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    try {
      const manual = helpItems().find((item) => item.id === "user-manual");
      expect(manual?.searchActivation).toBe("execute");
      manual?.onSelect();
      expect(open).toHaveBeenCalledExactlyOnceWith("/studio/manual", "_blank", "noopener,noreferrer");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("통합 검색 줄은 F1 을 광고하고 실제로 검색을 연다", () => {
    const search = helpItems().find((item) => item.id === "command-search");
    expect(search?.shortcut).toBe("F1");
    let opened = 0;
    const unsubscribe = subscribeStudioCommandSearchRequests(() => { opened += 1; });
    search?.onSelect();
    unsubscribe();
    expect(opened).toBe(1);
  });

  it("나머지 다섯 줄은 각자의 도움말 구역을 연다", () => {
    const seen: StudioHelpCenterRequest[] = [];
    const unsubscribe = subscribeStudioHelpCenter((request) => seen.push(request));
    for (const item of helpItems()) {
      if (["command-search", "user-manual", "feature-tutorials", "shortcuts"].includes(item.id)) continue;
      item.onSelect();
    }
    unsubscribe();
    expect(seen.map((request) => request.section)).toEqual([
      "terminology", "current-tool", "diagnostics", "recovery", "license", "bug-report",
    ]);
  });

  it("현재 도구 줄은 메뉴를 연 순간의 도구를 실어 보낸다", () => {
    const seen: StudioHelpCenterRequest[] = [];
    const unsubscribe = subscribeStudioHelpCenter((request) => seen.push(request));
    helpItems("tool.wet-mix").find((item) => item.id === "current-tool")?.onSelect();
    helpItems(null).find((item) => item.id === "current-tool")?.onSelect();
    unsubscribe();
    expect(seen).toEqual([
      { section: "current-tool", toolCommandId: "tool.wet-mix" },
      { section: "current-tool" },
    ]);
  });

  it("커버리지 표가 Help 8행을 전부 어떤 항목엔가 연결한다", () => {
    const help = STUDIO_MENU_GROUP_SPEC.find((group) => group.id === "help");
    expect(help?.rows).toHaveLength(8);
    expect(help?.rows.filter((row) => row.coverage === "absent")).toEqual([]);
    const partial = help?.rows.filter((row) => row.coverage === "partial") ?? [];
    expect(partial.map((row) => row.spec)).toEqual(["Current Tool Help", "Tutorial Project"]);
    expect(partial.every((row) => (row.note ?? "").trim().length > 0)).toBe(true);
  });
});
