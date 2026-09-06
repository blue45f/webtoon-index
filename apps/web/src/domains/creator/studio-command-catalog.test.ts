/**
 * Catalog contract tests.
 *
 * The point of this file is that the catalog cannot silently drift away from the
 * five hand-maintained lists it is supposed to absorb. Four of the five are
 * imported live and compared both ways; the two that are not importable (the
 * menu builder needs the whole StudioPage state, and `StudioShortcutsHelp` does
 * not export its rows) are pinned by a snapshot plus a source-file drift guard.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { CommandRegistry } from "@toonspectrum/studio-command-registry";
import { describe, expect, it } from "vitest";

import {
  STUDIO_FILTER_ALL_KINDS,
  STUDIO_FILTER_ALL_LABELS,
  STUDIO_FILTER_PACK_KINDS,
} from "./filter/studio-filter-pack-registry";
import { STUDIO_SHORTCUT_ACTIONS } from "./studio-app-settings";
import {
  catalogNativeIds,
  catalogShortcutIndex,
  COMMAND_CONFLICTS,
  findCatalogEntriesBySource,
  STUDIO_COMMAND_CATALOG,
  STUDIO_COMMAND_CATALOG_UNCOVERED,
  STUDIO_COMMAND_SOURCES,
  STUDIO_HELP_ROW_INVENTORY,
  STUDIO_MENU_ITEM_INVENTORY,
} from "./studio-command-catalog";
import { STUDIO_EDIT_MENU_COMMAND_ORDER } from "./studio-edit-controls";
import { STUDIO_QUICK_ACCESS_COMMAND_IDS } from "./studio-quick-access-integration";
import { QUICK_ACTION_IDS } from "./studio-quick-actions";

import type {
  StudioCommandCatalogEntry,
  StudioCommandSource,
} from "./studio-command-catalog";
import type { StudioCommand } from "@toonspectrum/studio-command-registry";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");

function readSource(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf-8");
}

/** Fold `Mod+Shift+Z` and `⌘⇧Z` onto the same key so lists can be compared. */
function normalizeChord(chord: string): string {
  return chord
    .replace(/\bMod\+/gu, "⌘")
    .replace(/\bCmd\+/gu, "⌘")
    .replace(/\bShift\+/gu, "⇧")
    .replace(/\bAlt\+/gu, "⌥")
    .replace(/\bOption\+/gu, "⌥")
    .replace(/\bCtrl\+/gu, "⌃")
    .replace(/\s+/gu, "");
}

function uncoveredFor(source: StudioCommandSource): Set<string> {
  return new Set(
    STUDIO_COMMAND_CATALOG_UNCOVERED.filter((row) => row.source === source).map(
      (row) => row.nativeId,
    ),
  );
}

/**
 * Coverage in both directions: every row of the live list is claimed by the
 * catalog (or explicitly listed as uncovered), and the catalog never claims a
 * row the list does not have.
 */
function expectSourceCoverage(
  source: StudioCommandSource,
  liveIds: readonly string[],
): void {
  const uncovered = uncoveredFor(source);
  const claimed = new Set(catalogNativeIds(source));
  const missing = liveIds.filter((id) => !claimed.has(id) && !uncovered.has(id));
  const phantom = [...claimed].filter((id) => !liveIds.includes(id));

  expect({ source, missing }).toEqual({ source, missing: [] });
  expect({ source, phantom }).toEqual({ source, phantom: [] });
  expect(liveIds).toHaveLength(STUDIO_COMMAND_SOURCES[source].measuredCount);
}

/** Turn a declaration-only entry into a runnable command so the real registry validates it. */
function toStudioCommand(entry: StudioCommandCatalogEntry): StudioCommand {
  return {
    id: entry.id,
    labels: entry.labels,
    aliases: entry.aliases,
    availability: () => ({ state: "enabled" }),
    execute: async () => ({ status: "noop", message: "catalog stub" }),
    helpNodeId: entry.helpNodeId,
    category: entry.category,
    ...(entry.shortcut === undefined ? {} : { shortcut: entry.shortcut }),
  };
}

describe("studio command catalog — identity", () => {
  it("every id is unique and registers in a real CommandRegistry", () => {
    const registry = new CommandRegistry();
    for (const entry of STUDIO_COMMAND_CATALOG) {
      // register() rejects both non-namespaced ids and duplicates.
      registry.register(toStudioCommand(entry));
    }
    expect(registry.size).toBe(STUDIO_COMMAND_CATALOG.length);
  });

  it("every entry carries a Korean label and a unique help node", () => {
    const helpNodes = new Set<string>();
    for (const entry of STUDIO_COMMAND_CATALOG) {
      expect(
        entry.labels.some((label) => label.locale === "ko" && label.label !== ""),
        `${entry.id} is missing a Korean label`,
      ).toBe(true);
      expect(helpNodes.has(entry.helpNodeId), `duplicate helpNodeId: ${entry.helpNodeId}`).toBe(
        false,
      );
      helpNodes.add(entry.helpNodeId);
    }
  });

  it("every entry names at least one source list it came from ", () => {
    const orphans = STUDIO_COMMAND_CATALOG.filter(
      (entry) => entry.origins.length === 0,
    ).map((entry) => entry.id);
    expect(orphans).toEqual([]);
  });

  it("category is the id namespace", () => {
    for (const entry of STUDIO_COMMAND_CATALOG) {
      expect(entry.category).toBe(entry.id.split(".")[0]);
    }
  });
});

describe("studio command catalog — shortcut conflicts", () => {
  it("no canonical chord is claimed by two commands unless COMMAND_CONFLICTS declares it", () => {
    const undeclared: { chord: string; commandIds: string[] }[] = [];
    for (const [chord, commandIds] of catalogShortcutIndex()) {
      if (commandIds.length < 2) continue;
      const declared = COMMAND_CONFLICTS.some((conflict) =>
        commandIds.every((id) => conflict.commandIds.includes(id)),
      );
      if (!declared) undeclared.push({ chord, commandIds });
    }
    expect(undeclared).toEqual([]);
  });

  it("no chord advertised by any source list is claimed by two commands unless declared", () => {
    const byChord = new Map<string, Set<string>>();
    for (const entry of STUDIO_COMMAND_CATALOG) {
      const chords = [
        ...(entry.shortcut === undefined ? [] : [entry.shortcut]),
        ...entry.origins.flatMap((origin) =>
          origin.shortcut === undefined ? [] : [origin.shortcut],
        ),
      ];
      for (const chord of chords) {
        const key = normalizeChord(chord);
        const bucket = byChord.get(key) ?? new Set<string>();
        bucket.add(entry.id);
        byChord.set(key, bucket);
      }
    }

    const undeclared: { chord: string; commandIds: string[] }[] = [];
    for (const [chord, ids] of byChord) {
      if (ids.size < 2) continue;
      const commandIds = [...ids];
      const declared = COMMAND_CONFLICTS.some((conflict) =>
        commandIds.every((id) => conflict.commandIds.includes(id)),
      );
      if (!declared) undeclared.push({ chord, commandIds });
    }
    expect(undeclared).toEqual([]);
  });

  it("every declared conflict points at commands that exist and carries evidence", () => {
    const ids = new Set(STUDIO_COMMAND_CATALOG.map((entry) => entry.id));
    const conflictIds = new Set<string>();
    for (const conflict of COMMAND_CONFLICTS) {
      expect(conflictIds.has(conflict.id), `duplicate conflict id: ${conflict.id}`).toBe(
        false,
      );
      conflictIds.add(conflict.id);
      expect(conflict.commandIds.length).toBeGreaterThan(0);
      for (const id of conflict.commandIds) {
        expect(ids.has(id), `${conflict.id} references unknown command ${id}`).toBe(true);
      }
      expect(conflict.evidence.length).toBeGreaterThan(0);
      expect(conflict.resolution).not.toBe("");
    }
  });

  it("keeps the measured conflict inventory visible", () => {
    // Guard against a conflict quietly disappearing without a resolution commit.
    expect(COMMAND_CONFLICTS.map((conflict) => conflict.id).sort()).toEqual(
      [
        "balloon-id-divergence",
        "c-crop-vs-transparent",
        "cmd-d-duplicate-vs-deselect",
        "cmd-j-duplicate-layer-vs-edit",
        "cmd-s-unbound",
        "dead-keymap-entries",
        "delete-clear-vs-remove",
        "eyedropper-toggle-divergence",
        "fill-id-divergence",
        "help-row-multiplexing",
        // `layer-order-chord-inversion` 은 2026-08-09 에 해소돼 목록에서 빠졌다:
        // ⌘[ = 한 칸 뒤로(send-backward), ⌘⇧[ = 맨 뒤로(send-back) 로 정정해
        // Photoshop·CSP·Illustrator 및 바로 옆 `]` 쌍과 대칭을 맞췄다
        // (studio-edit-controls.ts). 회귀 감시는 studio-edit-controls.test.ts 가 맡는다.
        // `q-quickmask-vs-grayscale` 는 2026-08-08 에 해소돼 목록에서 빠졌다:
        // 단독 `Q` = select.quick-mask, 색각 검수 흑백 명암 = `⌥Q`
        // (studio-view-controls.ts / studio-main-menu-items-document.ts).
        // 회귀 감시는 studio-main-menu-items-selection.test.ts 가 맡는다.
        "shift-s-saveview-vs-sizelock",
        "transform-tool-vs-pixel",
        "zoom-chord-divergence",
      ].sort(),
    );
  });
});

describe("studio command catalog — coverage of the five live lists", () => {
  it("covers STUDIO_SHORTCUT_ACTIONS (keymap, 34)", () => {
    expectSourceCoverage(
      "keymap",
      STUDIO_SHORTCUT_ACTIONS.map((action) => action.id),
    );
  });

  it("covers QUICK_ACTION_IDS (radial, 16)", () => {
    expectSourceCoverage("radial", QUICK_ACTION_IDS);
  });

  it("covers STUDIO_QUICK_ACCESS_COMMAND_IDS (quick access, 18)", () => {
    expectSourceCoverage("quick-access", STUDIO_QUICK_ACCESS_COMMAND_IDS);
  });

  it("covers STUDIO_EDIT_MENU_COMMAND_ORDER (edit menu, 20)", () => {
    expectSourceCoverage("edit-menu", STUDIO_EDIT_MENU_COMMAND_ORDER);
  });

  it("covers the menu inventory (191) and the help inventory (37)", () => {
    expectSourceCoverage("menu", STUDIO_MENU_ITEM_INVENTORY);
    expectSourceCoverage("help", STUDIO_HELP_ROW_INVENTORY);
  });

  it("reports 100% coverage, or lists every uncovered row with a reason", () => {
    for (const row of STUDIO_COMMAND_CATALOG_UNCOVERED) {
      expect(row.reason).not.toBe("");
    }
    // 2026-08-08: all five lists are fully covered.
    expect(STUDIO_COMMAND_CATALOG_UNCOVERED).toEqual([]);
  });

  it("keymap dead entries stay marked rather than quietly promoted to wired", () => {
    const dead = STUDIO_COMMAND_CATALOG.flatMap((entry) =>
      entry.origins
        .filter((origin) => origin.source === "keymap" && origin.status === "dead")
        .map((origin) => origin.nativeId),
    ).sort();
    expect(dead).toEqual(["redo", "tool-hand", "undo"]);
  });

  it("⌘S is still recorded as advertised-only on both surfaces that show it", () => {
    const save = findCatalogEntriesBySource("quick-access", "save");
    expect(save.map((entry) => entry.id)).toEqual(["file.save-draft"]);
    const statuses = save[0]?.origins.map((origin) => origin.status) ?? [];
    expect(statuses.every((status) => status === "advertised-only")).toBe(true);
  });
});

describe("studio command catalog — drift guards for the non-importable lists", () => {
  it("the menu sources still declare exactly the ids in the snapshot", () => {
    // Wave C split the menu builder into one module per §15.3 group family, so
    // the guard reads the union. Reading only one module would let an id hide in
    // a sibling.
    const source = [
      STUDIO_COMMAND_SOURCES.menu.file,
      ...(STUDIO_COMMAND_SOURCES.menu.extraFiles ?? []),
    ]
      .map(readSource)
      .join("\n");
    const literals = [...source.matchAll(/\bid: "([a-z0-9][a-z0-9-]*)"/gu)].map(
      (match) => match[1] as string,
    );

    // Items spread from STUDIO_EDIT_MENU_COMMANDS carry their id from that table,
    // so they never appear as literals here; the colour-vision items are literal
    // as bare ids and get their `color-vision-` prefix at map time. The Filter
    // group's pack rows are generated from STUDIO_FILTER_PACK_KINDS for the same
    // reason the edit rows are generated from their table — the registry is what
    // they must not drift from, so it stands in for their literals here.
    const fromEditCommandTable = new Set<string>(STUDIO_EDIT_MENU_COMMAND_ORDER);
    const fromFilterPackRegistry = [...STUDIO_FILTER_PACK_KINDS] as string[];
    const expected = new Set<string>();
    for (const qualified of STUDIO_MENU_ITEM_INVENTORY) {
      const [, item = ""] = qualified.split("/");
      if (fromEditCommandTable.has(item as never)) continue;
      expected.add(item.replace(/^color-vision-/u, ""));
    }

    const declared = [...literals, ...fromFilterPackRegistry];
    expect(new Set(declared)).toEqual(expected);
    expect(declared).toHaveLength(expected.size);
  });

  it("the help source still declares exactly the 37 rows in the snapshot", () => {
    const source = readSource(STUDIO_COMMAND_SOURCES.help.file);
    const rows = [
      ...source.matchAll(/labelKey: "studio\.shortcuts\.row\.([A-Za-z0-9.]+)"/gu),
    ].map((match) => match[1] as string);

    expect(rows).toEqual([...STUDIO_HELP_ROW_INVENTORY]);
  });

  it("the menu inventory has no duplicate ids, qualified or bare", () => {
    expect(new Set(STUDIO_MENU_ITEM_INVENTORY).size).toBe(
      STUDIO_MENU_ITEM_INVENTORY.length,
    );
    // Wave C made bare item ids globally unique too (conflict
    // `menu-item-id-collision`); origins stay qualified for the group provenance.
    const bare = STUDIO_MENU_ITEM_INVENTORY.map((id) => id.split("/")[1]);
    expect(new Set(bare).size).toBe(bare.length);
  });
});

describe("studio command catalog — filter vocabulary", () => {
  const registry = new CommandRegistry();
  for (const entry of STUDIO_COMMAND_CATALOG) {
    registry.register(toStudioCommand(entry));
  }
  const koLabel = (id: string): string | undefined =>
    STUDIO_COMMAND_CATALOG.find((entry) => entry.id === id)?.labels.find(
      (label) => label.locale === "ko",
    )?.label;

  it("names every filter row exactly as the menu row and the dialog gallery do", () => {
    // The Filter menu and STUDIO_FILTER_DIALOG_CATALOG both read STUDIO_FILTER_ALL_LABELS, so
    // a command-search hit must carry the same string or the same filter gets two names.
    for (const kind of STUDIO_FILTER_ALL_KINDS) {
      expect(koLabel(`filter.${kind}`), kind).toBe(STUDIO_FILTER_ALL_LABELS[kind]);
    }
    // #771 (c9ef0ff7) vocabulary — a hand-written copy here kept the pre-rename names.
    expect(koLabel("filter.jpeg-artifact-reduction")).toBe("JPEG 압축 깨짐 제거");
    expect(koLabel("filter.god-rays")).toBe("빛줄기");
  });

  it("keeps the pre-#771 filter names reachable as our legacy wording", () => {
    const context = { workspace: "comic", services: new Map() };
    for (const [former, id] of [
      ["필드 아이리스 블러", "filter.field-iris-blur"],
      ["타일러블 블러", "filter.tileable-blur"],
      ["한계값 (흑백 2값)", "filter.threshold"],
      ["먹선 임계값", "filter.threshold"],
      ["JPEG 아티팩트 감소", "filter.jpeg-artifact-reduction"],
      ["엣지 보존 노이즈 감소", "filter.edge-aware-denoise"],
      ["사인 웨이브", "filter.wave-warp"],
      ["원형 리플", "filter.ripple-warp"],
      ["트월 회전", "filter.twirl"],
      ["핀치 / 블로트", "filter.pinch-bloat"],
      ["포인틸리즘", "filter.pointillize"],
      ["고대비 포토카피", "filter.photocopy"],
      ["볼류메트릭 광선", "filter.god-rays"],
    ] as const) {
      expect(registry.resolveTerminology(former).map((c) => c.id), former).toEqual([id]);
      expect(registry.search(context, former).map((c) => c.id), former).toContain(id);
    }
  });
});

describe("studio command catalog — terminology dictionary", () => {
  const registry = new CommandRegistry();
  for (const entry of STUDIO_COMMAND_CATALOG) {
    registry.register(toStudioCommand(entry));
  }

  it("resolves CSP wording to our command", () => {
    expect(registry.resolveTerminology("스포이트").map((c) => c.id)).toEqual([
      "tool.eyedropper",
    ]);
    expect(registry.resolveTerminology("퍼스자").map((c) => c.id)).toEqual([
      "view.perspective-guide",
    ]);
    expect(registry.resolveTerminology("톤 커브").map((c) => c.id)).toEqual([
      "filter.color-curves",
    ]);
  });

  it("resolves Photoshop, Krita and Procreate wording too", () => {
    expect(registry.resolveTerminology("Paint Bucket").map((c) => c.id)).toEqual([
      "tool.fill",
    ]);
    expect(registry.resolveTerminology("Freehand Selection").map((c) => c.id)).toEqual([
      "tool.lasso",
    ]);
    expect(registry.resolveTerminology("ColorDrop").map((c) => c.id)).toEqual([
      "tool.fill",
    ]);
    expect(registry.resolveTerminology("QuickShape").map((c) => c.id)).toEqual([
      "tool.smart-shape",
    ]);
  });

  it("covers all four migration dictionaries at meaningful scale", () => {
    const byVendor = new Map<string, number>();
    for (const entry of STUDIO_COMMAND_CATALOG) {
      for (const alias of entry.aliases) {
        byVendor.set(alias.vendor, (byVendor.get(alias.vendor) ?? 0) + 1);
      }
    }
    for (const vendor of ["csp", "photoshop", "krita", "procreate"]) {
      expect(byVendor.get(vendor) ?? 0, `${vendor} aliases`).toBeGreaterThan(20);
    }
    const total = [...byVendor.values()].reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(250);
  });

  it("every command that appears in the tool rail or the menu is searchable", () => {
    const context = { workspace: "comic", services: new Map() };
    expect(registry.search(context, "펜").map((c) => c.id)).toContain("tool.pen");
    expect(registry.search(context, "Gaussian").map((c) => c.id)).toContain(
      "filter.gaussian-blur",
    );
    expect(registry.search(context, "Preferences").map((c) => c.id)).toContain(
      "window.app-settings",
    );
  });

  it("ambiguous aliases are visible instead of silently resolving to one command", () => {
    // Two commands both answer to "Flip Horizontal" (view flip vs selection flip);
    // the index must report that rather than pick a winner.
    const ambiguous = registry.ambiguousTerminology();
    const terms = ambiguous.map((row) => row.commandIds.sort().join("|"));
    expect(terms).toContain(
      ["transform.flip-selection-horizontal", "view.flip-horizontal"].sort().join("|"),
    );
  });
});
