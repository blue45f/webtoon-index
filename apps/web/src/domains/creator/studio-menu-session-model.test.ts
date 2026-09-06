import { describe, expect, it } from "vitest";

import {
  EMPTY_STUDIO_MENU_SESSION,
  STUDIO_COMPANION_TOOL_BY_MENU,
  STUDIO_TOOLBAR_GROUP_BY_MENU,
  reduceStudioAppMenuOpenUpdate,
  reduceStudioMenuSession,
  resolveStudioCompanionTool,
  resolveStudioToolbarGroup,
  type StudioMenuSessionEvent,
  type StudioMenuSessionState,
  type StudioWorkspaceLayoutSource,
} from "./studio-menu-session-model";

const ALL_STUDIO_MENUS = [
  "template",
  "collage",
  "bubble",
  "sticker",
  "elements",
  "char",
  "bgScene",
  "bgFill",
  "asset",
  "emeres",
  "tone",
  "scene",
  "clip",
  "palette",
  "brandKit",
  "stockImage",
  "aiAssist",
  "integrations",
] as const;

describe("studio menu classification", () => {
  it("classifies every StudioMenu into an explicit toolbar group or standalone menu", () => {
    expect(Object.keys(STUDIO_TOOLBAR_GROUP_BY_MENU)).toEqual(ALL_STUDIO_MENUS);
    expect(STUDIO_TOOLBAR_GROUP_BY_MENU).toEqual({
      template: "assetGroup",
      collage: "assetGroup",
      bubble: null,
      sticker: "assetGroup",
      elements: "assetGroup",
      char: null,
      bgScene: "bgGroup",
      bgFill: "bgGroup",
      asset: "assetGroup",
      emeres: "assetGroup",
      tone: "bgGroup",
      scene: "assetGroup",
      clip: "assetGroup",
      palette: "styleGroup",
      brandKit: "styleGroup",
      stockImage: "aiGroup",
      aiAssist: "aiGroup",
      integrations: "aiGroup",
    });
    for (const menu of ALL_STUDIO_MENUS) {
      expect(resolveStudioToolbarGroup(menu)).toBe(STUDIO_TOOLBAR_GROUP_BY_MENU[menu]);
    }
    expect(resolveStudioToolbarGroup(null)).toBeNull();
  });

  it("classifies every StudioMenu for companion mirroring", () => {
    expect(Object.keys(STUDIO_COMPANION_TOOL_BY_MENU)).toEqual(ALL_STUDIO_MENUS);
    expect(STUDIO_COMPANION_TOOL_BY_MENU).toEqual({
      template: "template",
      collage: null,
      bubble: "bubble",
      sticker: null,
      elements: "template",
      char: null,
      bgScene: null,
      bgFill: null,
      asset: "template",
      emeres: null,
      tone: null,
      scene: null,
      clip: null,
      palette: null,
      brandKit: null,
      stockImage: null,
      aiAssist: "ai",
      integrations: null,
    });
  });

  it("preserves drawing priority before projecting the open menu", () => {
    expect(resolveStudioCompanionTool({ tool: "draw", drawMode: "eraser", menu: "aiAssist" })).toBe("eraser");
    expect(resolveStudioCompanionTool({ tool: "draw", drawMode: "shape", menu: "bubble" })).toBe("pen");
    expect(resolveStudioCompanionTool({ tool: "select", drawMode: "pen", menu: "bubble" })).toBe("bubble");
    expect(resolveStudioCompanionTool({ tool: "hand", drawMode: "pen", menu: "elements" })).toBe("template");
    expect(resolveStudioCompanionTool({ tool: "select", drawMode: "pen", menu: "aiAssist" })).toBe("ai");
    expect(resolveStudioCompanionTool({ tool: "select", drawMode: "pen", menu: "palette" })).toBe("select");
    expect(resolveStudioCompanionTool({ tool: "select", drawMode: "pen", menu: null })).toBe("select");
  });
});

describe("studio menu session reducer", () => {
  it("keeps tool and app menus mutually exclusive across every open/toggle path", () => {
    let state: StudioMenuSessionState = EMPTY_STUDIO_MENU_SESSION;

    state = reduceStudioMenuSession(state, { type: "tool-menu.open", menu: "template" });
    expect(state).toEqual({ toolMenu: "template", appMenu: null });

    state = reduceStudioMenuSession(state, { type: "app-menu.open", menu: "export" });
    expect(state).toEqual({ toolMenu: null, appMenu: "export" });

    state = reduceStudioMenuSession(state, { type: "app-menu.toggle", menu: "project" });
    expect(state).toEqual({ toolMenu: null, appMenu: "project" });

    state = reduceStudioMenuSession(state, { type: "tool-menu.toggle", menu: "aiAssist" });
    expect(state).toEqual({ toolMenu: "aiAssist", appMenu: null });

    state = reduceStudioMenuSession(state, { type: "tool-menu.toggle", menu: "aiAssist" });
    expect(state).toBe(EMPTY_STUDIO_MENU_SESSION);
  });

  it("closes only the addressed family for local close events", () => {
    const appState = { toolMenu: null, appMenu: "export" } as const;
    expect(reduceStudioMenuSession(appState, { type: "tool-menu.close" })).toBe(appState);
    expect(reduceStudioMenuSession(appState, { type: "app-menu.close" })).toBe(EMPTY_STUDIO_MENU_SESSION);

    const toolState = { toolMenu: "bubble", appMenu: null } as const;
    expect(reduceStudioMenuSession(toolState, { type: "app-menu.close" })).toBe(toolState);
    expect(reduceStudioMenuSession(toolState, { type: "tool-menu.close" })).toBe(EMPTY_STUDIO_MENU_SESSION);
  });

  it("makes repeated opens and closes referentially stable", () => {
    const toolState = { toolMenu: "template", appMenu: null } as const;
    expect(reduceStudioMenuSession(toolState, { type: "tool-menu.open", menu: "template" })).toBe(toolState);
    expect(reduceStudioMenuSession(EMPTY_STUDIO_MENU_SESSION, { type: "app-menu.close" })).toBe(EMPTY_STUDIO_MENU_SESSION);
    expect(
      reduceStudioMenuSession(EMPTY_STUDIO_MENU_SESSION, {
        type: "menus.dismiss",
        reason: "escape",
      })
    ).toBe(EMPTY_STUDIO_MENU_SESSION);
  });

  it("adapts boolean and functional app-menu setters without permitting overlap", () => {
    const exportOpen = reduceStudioAppMenuOpenUpdate(
      { toolMenu: "template", appMenu: null },
      "export",
      true
    );
    expect(exportOpen).toEqual({ toolMenu: null, appMenu: "export" });
    expect(
      reduceStudioAppMenuOpenUpdate(exportOpen, "project", (open) => !open)
    ).toEqual({ toolMenu: null, appMenu: "project" });
    expect(reduceStudioAppMenuOpenUpdate(exportOpen, "project", false)).toBe(
      exportOpen
    );
    expect(
      reduceStudioAppMenuOpenUpdate(exportOpen, "export", (open) => !open)
    ).toBe(EMPTY_STUDIO_MENU_SESSION);
  });

  it.each([
    "switch",
    "reload",
    "active-workspace-delete",
    "owner-scope-change",
    "external-sync",
  ] satisfies readonly StudioWorkspaceLayoutSource[])(
    "closes transient menus when a workspace layout is applied from %s",
    (source) => {
      const event: StudioMenuSessionEvent = {
        type: "workspace.layout-applied",
        source,
      };
      expect(
        reduceStudioMenuSession({ toolMenu: "palette", appMenu: null }, event)
      ).toBe(EMPTY_STUDIO_MENU_SESSION);
      expect(
        reduceStudioMenuSession({ toolMenu: null, appMenu: "project" }, event)
      ).toBe(EMPTY_STUDIO_MENU_SESSION);
    }
  );

  it.each([
    "escape",
    "outside-pointer",
    "command-complete",
    "presentation-change",
  ] as const)("dismisses the complete session for %s", (reason) => {
    expect(
      reduceStudioMenuSession(
        { toolMenu: null, appMenu: "export" },
        { type: "menus.dismiss", reason }
      )
    ).toBe(EMPTY_STUDIO_MENU_SESSION);
  });
});
