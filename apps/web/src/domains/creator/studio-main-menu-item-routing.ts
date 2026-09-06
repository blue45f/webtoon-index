/**
 * §15.3 group → item module routing table.
 *
 * Split out of `studio-main-menu-groups.ts` in Wave E. The assembler's budget was
 * measured when five item modules covered eight product groups; §15.3 has 17
 * groups and the catalogue now spans eleven modules, several of which feed a
 * group jointly (Select's tools and its Select All / Deselect rows; File's export
 * loop and its project surfaces). Raising the assembler's line budget to absorb
 * that would have retired the invariant the budget exists for, so the routing
 * table moved here and the assembler went back to being order + localization.
 *
 * This module is the one place that says *which* modules answer for a group, so
 * `studio-main-menu-groups-boundary.test.ts` asserts every declared item module
 * is wired here — nothing may declare a group behind the routing table's back.
 *
 * Pure composition only — no React, no browser, no page state.
 */

import { buildStudioAnimationMenuItems } from "./studio-main-menu-items-animation";
import {
  buildStudioLayerMenuItems,
  buildStudioSelectMenuItems,
  buildStudioTransformMenuItems,
} from "./studio-main-menu-items-artwork";
import {
  buildStudioCanvasSurfaceMenuItems,
  buildStudioDialogueMenuItems,
  buildStudioVectorEraserMenuItems,
  buildStudioViewSurfaceMenuItems,
} from "./studio-main-menu-items-authoring";
import { buildStudioBrushMenuItems } from "./studio-main-menu-items-brush";
import { buildStudioCollaborationMenuItems } from "./studio-main-menu-items-collaboration";
import {
  buildStudioCanvasMenuItems,
  buildStudioEditMenuItems,
  buildStudioFileMenuItems,
  buildStudioViewMenuItems,
} from "./studio-main-menu-items-document";
import { buildStudioFilterMenuItems } from "./studio-main-menu-items-filter";
import { buildStudioProductionMenuItems } from "./studio-main-menu-items-production";
import {
  buildStudioAutomationMenuItems,
  buildStudioProjectMenuItems,
} from "./studio-main-menu-items-project";
import { buildStudioSelectToolMenuItems } from "./studio-main-menu-items-selection";
import {
  buildStudio3dMenuItems,
  buildStudioAiMenuItems,
  buildStudioComicMenuItems,
  buildStudioTextMenuItems,
  buildStudioVectorMenuItems,
} from "./studio-main-menu-items-story";
import { buildStudioWindowMenuItems } from "./studio-main-menu-items-workspace";

import type { StudioMainMenuItemContext } from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";

export type StudioMainMenuItemBuilder = (
  context: StudioMainMenuItemContext,
) => StudioMainMenuItem[];

/** Several modules feeding one §15.3 group, concatenated in menubar order. */
const joined =
  (...builders: readonly StudioMainMenuItemBuilder[]): StudioMainMenuItemBuilder =>
  (context) =>
    builders.flatMap((build) => build(context));

/**
 * Every §15.3 group except Help routes through this table (Help builds its own
 * shell because its labels probe the active locale pack).
 *
 * Animation and Collaboration left the "declared but never rendered" list in
 * Wave E. Not because the features arrived — the keyframe timeline, frame/cel
 * animation, the team panel and the page-review flow all shipped long ago — but
 * because until now the menubar was the one surface that could not reach them.
 */
export const STUDIO_MENU_ITEM_BUILDERS: Readonly<
  Record<string, StudioMainMenuItemBuilder>
> = {
  file: joined(buildStudioFileMenuItems, buildStudioProjectMenuItems),
  edit: joined(buildStudioEditMenuItems, buildStudioAutomationMenuItems),
  view: joined(buildStudioViewMenuItems, buildStudioViewSurfaceMenuItems),
  canvas: joined(buildStudioCanvasMenuItems, buildStudioCanvasSurfaceMenuItems),
  layer: buildStudioLayerMenuItems,
  select: joined(buildStudioSelectToolMenuItems, buildStudioSelectMenuItems),
  transform: buildStudioTransformMenuItems,
  brush: buildStudioBrushMenuItems,
  filter: buildStudioFilterMenuItems,
  vector: joined(buildStudioVectorMenuItems, buildStudioVectorEraserMenuItems),
  text: joined(buildStudioTextMenuItems, buildStudioDialogueMenuItems),
  comic: joined(buildStudioComicMenuItems, buildStudioProductionMenuItems),
  animation: buildStudioAnimationMenuItems,
  "3d": buildStudio3dMenuItems,
  collaboration: buildStudioCollaborationMenuItems,
  window: buildStudioWindowMenuItems,
  ai: buildStudioAiMenuItems,
};

/** Items for `groupId`, or none when the spec declares a group we do not route. */
export function studioMainMenuItemsFor(
  groupId: string,
  context: StudioMainMenuItemContext,
): StudioMainMenuItem[] {
  const build = STUDIO_MENU_ITEM_BUILDERS[groupId];
  return build ? build(context) : [];
}
