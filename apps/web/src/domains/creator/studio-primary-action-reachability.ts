/**
 * Always-reachable primary studio actions.
 *
 * Draw, undo/redo, pages, and export must not live only in overflow menus or
 * locale-dependent labels. Chrome hosts pin `data-studio-primary-action`;
 * command search still finds the same commands via catalog ids.
 */
import { STUDIO_COMMAND_CATALOG, STUDIO_MENU_ITEM_INVENTORY } from "./studio-command-catalog";

export const STUDIO_PRIMARY_ACTION_IDS = ["draw", "undo", "redo", "pages", "export"] as const;

export type StudioPrimaryActionId = (typeof STUDIO_PRIMARY_ACTION_IDS)[number];

export const STUDIO_PRIMARY_ACTION_COMMAND_IDS = {
  draw: "tool.pen",
  undo: "edit.undo",
  redo: "edit.redo",
  pages: "window.page-sequence",
  export: "file.export",
} as const satisfies Record<StudioPrimaryActionId, string>;

export const STUDIO_PRIMARY_ACTION_MENU_ITEM_IDS = {
  draw: "brush/pen",
  undo: "edit/undo",
  redo: "edit/redo",
  pages: "comic/page-sequence",
  export: "file/export",
} as const satisfies Record<StudioPrimaryActionId, string>;

export const STUDIO_PRIMARY_ACTION_SELECTORS = {
  draw: '[data-studio-primary-action="draw"]',
  undo: '[data-studio-primary-action="undo"], [data-studio-command-bar-command="undo"]',
  redo: '[data-studio-primary-action="redo"], [data-studio-command-bar-command="redo"]',
  pages: '[data-studio-primary-action="pages"]',
  export: '[data-studio-primary-action="export"]',
} as const satisfies Record<StudioPrimaryActionId, string>;

export interface StudioPrimaryActionReachability {
  readonly action: StudioPrimaryActionId;
  readonly commandId: string;
  readonly menuItemId: string;
  readonly selector: string;
}

export function listStudioPrimaryActionReachability(): readonly StudioPrimaryActionReachability[] {
  return STUDIO_PRIMARY_ACTION_IDS.map((action) => ({
    action,
    commandId: STUDIO_PRIMARY_ACTION_COMMAND_IDS[action],
    menuItemId: STUDIO_PRIMARY_ACTION_MENU_ITEM_IDS[action],
    selector: STUDIO_PRIMARY_ACTION_SELECTORS[action],
  }));
}

export function studioPrimaryActionsPresentInCommandCatalog(): readonly string[] {
  const catalogIds = new Set(STUDIO_COMMAND_CATALOG.map((entry) => entry.id));
  return listStudioPrimaryActionReachability()
    .map((entry) => entry.commandId)
    .filter((commandId) => catalogIds.has(commandId));
}

export function studioPrimaryActionsPresentInMenuInventory(): readonly string[] {
  const menuIds = new Set(STUDIO_MENU_ITEM_INVENTORY);
  return listStudioPrimaryActionReachability()
    .map((entry) => entry.menuItemId)
    .filter((menuItemId) => menuIds.has(menuItemId));
}
