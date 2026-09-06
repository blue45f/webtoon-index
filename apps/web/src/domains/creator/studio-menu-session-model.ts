/**
 * Pure Studio menu-session policy.
 *
 * The editor currently projects this state into independent UI setters. Keeping the
 * policy here makes companion mirroring, toolbar-group selection, app-menu exclusion,
 * and workspace transitions deterministic without depending on a renderer or browser.
 */

import type {
  DrawMode,
  StudioMenu,
  Tool,
} from "./studio-editor-tool-model";
import type { StudioToolbarGroupId } from "./studio-toolbar-groups";
import type { StudioCompanionToolId } from "./studio-tools-companion";

/** Every tool-menu value is explicit so newly added menus fail type-checking until classified. */
export const STUDIO_TOOLBAR_GROUP_BY_MENU = {
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
} as const satisfies Readonly<Record<StudioMenu, StudioToolbarGroupId | null>>;

/**
 * Menu-to-companion projection. `null` means the companion falls back to Select unless
 * the primary editor currently owns a drawing tool. Dedicated 3D dialogs are commands,
 * not `StudioMenu` sessions, so their menu entries intentionally remain unmapped here.
 */
export const STUDIO_COMPANION_TOOL_BY_MENU = {
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
} as const satisfies Readonly<Record<StudioMenu, StudioCompanionToolId | null>>;

export interface StudioCompanionToolSource {
  readonly tool: Tool;
  readonly drawMode: DrawMode;
  readonly menu: StudioMenu | null;
}

/** Mirrors the primary editor using the same priority as direct tool interaction. */
export function resolveStudioCompanionTool({
  tool,
  drawMode,
  menu,
}: StudioCompanionToolSource): StudioCompanionToolId {
  if (tool === "draw" && drawMode === "eraser") return "eraser";
  if (tool === "draw") return "pen";
  if (menu) return STUDIO_COMPANION_TOOL_BY_MENU[menu] ?? "select";
  return "select";
}

export function resolveStudioToolbarGroup(
  menu: StudioMenu | null
): StudioToolbarGroupId | null {
  return menu ? STUDIO_TOOLBAR_GROUP_BY_MENU[menu] : null;
}

/** Export and project are one app-menu slot, so both can never be open in valid state. */
export type StudioAppMenu = "export" | "project";

export interface StudioMenuSessionState {
  readonly toolMenu: StudioMenu | null;
  readonly appMenu: StudioAppMenu | null;
}

export const EMPTY_STUDIO_MENU_SESSION: Readonly<StudioMenuSessionState> = Object.freeze({
  toolMenu: null,
  appMenu: null,
});

export type StudioMenuDismissReason =
  | "escape"
  | "outside-pointer"
  | "command-complete"
  | "presentation-change";

/** All layout replacement paths share the same transient-menu closing contract. */
export type StudioWorkspaceLayoutSource =
  | "switch"
  | "reload"
  | "active-workspace-delete"
  | "owner-scope-change"
  | "external-sync";

export type StudioMenuSessionEvent =
  | { readonly type: "tool-menu.open"; readonly menu: StudioMenu }
  | { readonly type: "tool-menu.toggle"; readonly menu: StudioMenu }
  | { readonly type: "tool-menu.close" }
  | { readonly type: "app-menu.open"; readonly menu: StudioAppMenu }
  | { readonly type: "app-menu.toggle"; readonly menu: StudioAppMenu }
  | { readonly type: "app-menu.close" }
  | { readonly type: "menus.dismiss"; readonly reason: StudioMenuDismissReason }
  | {
      readonly type: "workspace.layout-applied";
      readonly source: StudioWorkspaceLayoutSource;
    };

function nextStudioMenuSession(
  current: StudioMenuSessionState,
  toolMenu: StudioMenu | null,
  appMenu: StudioAppMenu | null
): StudioMenuSessionState {
  if (current.toolMenu === toolMenu && current.appMenu === appMenu) return current;
  if (toolMenu === null && appMenu === null) return EMPTY_STUDIO_MENU_SESSION;
  return { toolMenu, appMenu };
}

/**
 * Reduces transient Studio menus while enforcing a single visible menu family.
 * Opening any tool menu closes the app menu; opening export/project closes the tool menu.
 */
export function reduceStudioMenuSession(
  state: StudioMenuSessionState,
  event: StudioMenuSessionEvent
): StudioMenuSessionState {
  switch (event.type) {
    case "tool-menu.open":
      return nextStudioMenuSession(state, event.menu, null);
    case "tool-menu.toggle":
      return nextStudioMenuSession(
        state,
        state.toolMenu === event.menu ? null : event.menu,
        null
      );
    case "tool-menu.close":
      return nextStudioMenuSession(state, null, state.appMenu);
    case "app-menu.open":
      return nextStudioMenuSession(state, null, event.menu);
    case "app-menu.toggle":
      return nextStudioMenuSession(
        state,
        null,
        state.appMenu === event.menu ? null : event.menu
      );
    case "app-menu.close":
      return nextStudioMenuSession(state, state.toolMenu, null);
    case "menus.dismiss":
    case "workspace.layout-applied":
      return nextStudioMenuSession(state, null, null);
  }
}

export type StudioBooleanStateUpdate = boolean | ((current: boolean) => boolean);

/** State-setter-compatible adapter that still delegates all menu policy to the pure reducer. */
export function reduceStudioAppMenuOpenUpdate(
  state: StudioMenuSessionState,
  target: StudioAppMenu,
  update: StudioBooleanStateUpdate
): StudioMenuSessionState {
  const wasOpen = state.appMenu === target;
  const nextOpen = typeof update === "function" ? update(wasOpen) : update;
  if (!nextOpen) {
    return wasOpen
      ? reduceStudioMenuSession(state, { type: "app-menu.close" })
      : state;
  }
  return reduceStudioMenuSession(state, { type: "app-menu.open", menu: target });
}
