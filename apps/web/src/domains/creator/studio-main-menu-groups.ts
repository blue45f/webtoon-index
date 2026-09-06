/**
 * Main-menu assembler — V5 §15.3 group order.
 *
 * Wave C regrouped the catalogue from 8 product-invented groups into §15.3's 17
 * (plus the declared AI extension). This file only orders and assembles; which
 * modules answer for a group lives in `studio-main-menu-item-routing.ts`, the
 * items themselves in `studio-main-menu-items-*.ts`, and which §15.3 rows we do
 * and do not cover in `studio-main-menu-group-spec.ts`.
 *
 * Groups that have no shippable command are declared in the spec table but are
 * **not rendered** — an empty menu is worse than an honest gap list.
 */

import { buildStudioHelpGroupItems } from "./studio-help-menu-items";
import {
  STUDIO_MENU_GROUP_SPEC,
  type StudioMenuGroupSpec,
} from "./studio-main-menu-group-spec";
import { studioMainMenuItemsFor } from "./studio-main-menu-item-routing";
import { localizeStudioMainMenuGroups } from "./studio-main-menu-localization";
import { withDisabledMainMenuReasons } from "./studio-main-menu-unavailable";

import type {
  BuildStudioMainMenuGroupsInput,
  StudioMainMenuItemContext,
} from "./studio-main-menu-contract";
import type { StudioMainMenuGroup, StudioMainMenuItem } from "./studio-main-menu-model";

export type {
  BuildStudioMainMenuGroupsInput,
  StudioMainMenuBuilderState,
  StudioMainMenuEditAvailability,
  StudioMainMenuEditorActions,
  StudioMainMenuItemContext,
  StudioMainMenuUiActions,
} from "./studio-main-menu-contract";

function groupShell(
  spec: StudioMenuGroupSpec,
  items: StudioMainMenuItem[],
  korean: boolean,
): StudioMainMenuGroup {
  return {
    id: spec.id,
    label: korean ? spec.labelKo : spec.labelEn ?? spec.labelKo,
    ...(spec.labelKey === undefined ? {} : { labelKey: spec.labelKey }),
    items,
  };
}

/** Builds the render-safe product catalogue; browser/React mutations stay at the page boundary. */
export function buildStudioMainMenuGroups({
  state,
  editor,
  ui,
  t,
}: BuildStudioMainMenuGroupsInput): StudioMainMenuGroup[] {
  const context: StudioMainMenuItemContext = { state, editor, ui };
  // Reuse the former View labels while the dedicated Help group locale packs catch up.
  const localizedFeatureTutorialLabel = t("studio.mainMenu.item.view.feature-tutorials");
  const korean = localizedFeatureTutorialLabel === "기능 튜토리얼";
  const helpGroupLabel = korean ? "도움말" : "Help";

  const groups: StudioMainMenuGroup[] = [];
  for (const spec of STUDIO_MENU_GROUP_SPEC) {
    if (spec.id === "help") {
      groups.push({
        id: "help",
        label: helpGroupLabel,
        items: buildStudioHelpGroupItems({ ...context, helpGroupLabel }),
      });
      continue;
    }
    const items = studioMainMenuItemsFor(spec.id, context);
    if (items.length > 0) groups.push(groupShell(spec, items, korean));
  }

  return localizeStudioMainMenuGroups(withDisabledMainMenuReasons(groups, state), state, t);
}
