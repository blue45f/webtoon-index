/**
 * Public command catalog. The existing declarations are preserved byte-for-byte in
 * studio-command-catalog-base.ts. Small, independently shipped reference surfaces
 * extend the catalog here without rewriting existing command identities or conflicts.
 * Like the base, this module is declaration data only: no React, renderer, or actions.
 */
import {
  catalogNativeIds as baseNativeIds,
  findCatalogEntriesBySource as findBaseEntries,
  STUDIO_COMMAND_CATALOG as BASE_CATALOG,
  STUDIO_COMMAND_SOURCES as BASE_SOURCES,
  STUDIO_MENU_ITEM_INVENTORY as BASE_MENU_INVENTORY,
} from "./studio-command-catalog-base";

import type { StudioCommandCatalogEntry, StudioCommandSource } from "./studio-command-catalog-base";

export {
  catalogShortcutIndex,
  COMMAND_CONFLICTS,
  STUDIO_COMMAND_CATALOG_UNCOVERED,
  STUDIO_HELP_ROW_INVENTORY,
} from "./studio-command-catalog-base";
export type {
  StudioCommandCatalogEntry,
  StudioCommandConflict,
  StudioCommandConflictKind,
  StudioCommandOrigin,
  StudioCommandOriginStatus,
  StudioCommandSource,
  StudioCommandSourceInfo,
} from "./studio-command-catalog-base";

const MANUAL_MENU_ID = "help/user-manual";
const MANUAL_COMMAND: StudioCommandCatalogEntry = {
  id: "help.user-manual",
  category: "help",
  labels: [
    { locale: "ko", label: "사용자 매뉴얼", description: "편집 중인 원고를 유지한 채 기능별 사용자 매뉴얼을 새 탭으로 엽니다." },
    { locale: "en", label: "User manual · Korean", description: "Open the Korean reference manual in a new tab without leaving the editor." },
  ],
  aliases: [
    { vendor: "toonstudio", locale: "ko", term: "매뉴얼" },
    { vendor: "toonstudio", locale: "ko", term: "사용 설명서" },
    { vendor: "toonstudio", locale: "en", term: "user guide" },
  ],
  helpNodeId: "help/help/user-manual",
  origins: [{ source: "menu", nativeId: MANUAL_MENU_ID, status: "wired" }],
};

// No default chord is assigned, so the base shortcut index remains unchanged.
export const STUDIO_COMMAND_CATALOG: readonly StudioCommandCatalogEntry[] =
  Object.freeze([...BASE_CATALOG, MANUAL_COMMAND]);

export const STUDIO_MENU_ITEM_INVENTORY: readonly string[] = Object.freeze(
  BASE_MENU_INVENTORY.flatMap((id) => id === "help/current-tool" ? [id, MANUAL_MENU_ID] : [id]),
);

export const STUDIO_COMMAND_SOURCES = Object.freeze({
  ...BASE_SOURCES,
  menu: {
    ...BASE_SOURCES.menu,
    measuredCount: BASE_SOURCES.menu.measuredCount + 1,
  },
});

export function findCatalogEntriesBySource(
  source: StudioCommandSource,
  nativeId: string,
): StudioCommandCatalogEntry[] {
  const entries = findBaseEntries(source, nativeId);
  return source === "menu" && nativeId === MANUAL_MENU_ID ? [...entries, MANUAL_COMMAND] : entries;
}

export function catalogNativeIds(source: StudioCommandSource): string[] {
  const ids = baseNativeIds(source);
  return source === "menu" ? [...ids, MANUAL_MENU_ID] : ids;
}
