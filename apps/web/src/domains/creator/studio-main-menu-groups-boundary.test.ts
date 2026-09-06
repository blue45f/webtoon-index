import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

/**
 * The whole main-menu catalogue, module by module.
 *
 * Before the V5 §15.3 regroup this was one 1,121-line file held under a single
 * 1,130-line cap. Growing that cap for 17 groups would have defeated the point
 * of the cap, so the catalogue was split by §15.3 group family instead. The
 * invariant the old budget protected — *no single catalogue module becomes the
 * place everything lands* — is now expressed as a per-module cap, and it applies
 * to any module added later because the list is asserted to be complete.
 */
const CATALOGUE_MODULE_LINE_BUDGETS = {
  // Assembler: group order and localization wiring only.
  "./studio-main-menu-groups.ts": 140,
  // Host contract types (state + injected actions).
  "./studio-main-menu-contract.ts": 200,
  // Editor-half host binding: contract name ↔ host handler name, nothing else.
  // Wave D moved it out of the page because pure delegation is not composition —
  // that is what paid for Mask/Clipping without touching the page budget below.
  "./studio-main-menu-editor-bindings.ts": 140,
  // §15.3 coverage table. Its size is set by the spec (17 groups × ~8 rows, one
  // declaration line each), not by how much logic we let pile up. When Wave E
  // pushed it past the cap, the row constructors, the coverage queries and the
  // Help group's own declaration moved out rather than the number moving up —
  // raising it would have retired the invariant it exists for.
  "./studio-main-menu-group-spec.ts": 640,
  // Row constructors and the spec types the table is written in.
  "./studio-main-menu-group-spec-model.ts": 120,
  // Readers over the table: order, lookup, coverage summary, shortfall list.
  "./studio-main-menu-group-spec-coverage.ts": 120,
  // Help's §15.3 rows. Its notes carry what each surface actually measures.
  "./studio-main-menu-group-spec-help.ts": 120,
  // Wave E: which module answers for which §15.3 group. Imports + one table.
  "./studio-main-menu-item-routing.ts": 160,
  // Host contract for the "open a surface that already ships" rows, and its
  // name-for-name binding to the page's handler bundle.
  "./studio-main-menu-surface-contract.ts": 160,
  "./studio-main-menu-surface-bindings.ts": 160,
  "./studio-main-menu-items-document.ts": 530,
  "./studio-main-menu-items-artwork.ts": 500,
  "./studio-main-menu-items-filter.ts": 500,
  "./studio-main-menu-items-story.ts": 500,
  "./studio-main-menu-items-workspace.ts": 500,
  "./studio-main-menu-items-selection.ts": 500,
  "./studio-main-menu-items-animation.ts": 500,
  "./studio-main-menu-items-collaboration.ts": 500,
  "./studio-main-menu-items-production.ts": 500,
  "./studio-main-menu-items-project.ts": 500,
  "./studio-main-menu-items-authoring.ts": 500,
  // Brush left the artwork module when its §15.3 rows landed; a group whose
  // whole product is the brush should not share a cap with three others.
  "./studio-main-menu-items-brush.ts": 300,
  "./studio-main-menu-localization.ts": 200,
  "./studio-main-menu-unavailable.ts": 200,
} as const;

const CATALOGUE_MODULES = Object.keys(
  CATALOGUE_MODULE_LINE_BUDGETS,
) as (keyof typeof CATALOGUE_MODULE_LINE_BUDGETS)[];

/**
 * Browser-global checks must look at code, not at data. Catalog command ids like
 * `window.app-settings` are strings, so strip literals before asserting.
 */
function code(fileName: string): string {
  return source(fileName)
    .replace(/"(?:[^"\\]|\\.)*"/gu, '""')
    .replace(/'(?:[^'\\]|\\.)*'/gu, "''")
    .replace(/`(?:[^`\\]|\\.)*`/gu, "``");
}

describe("studio main-menu catalogue ownership boundary", () => {
  it.each(CATALOGUE_MODULES)("keeps %s React-, browser-, and page-state-free", (moduleName) => {
    const module = code(moduleName);

    expect(source(moduleName)).not.toMatch(/from\s+["']react["']/u);
    expect(module).not.toMatch(/\b(?:document|window|globalThis)\s*\./u);
    expect(module).not.toContain("StudioPage");
    expect(module).not.toMatch(/\buse(?:Memo|Callback|Effect|State|Ref)\b/u);
  });

  it.each(CATALOGUE_MODULES)("keeps %s under its declared line budget", (moduleName) => {
    expect(source(moduleName).split("\n").length).toBeLessThanOrEqual(
      CATALOGUE_MODULE_LINE_BUDGETS[moduleName],
    );
  });

  it("keeps the assembler an assembler — order and localization, no item literals", () => {
    const assembler = source("./studio-main-menu-groups.ts");

    expect(assembler).toContain('from "./studio-main-menu-localization"');
    expect(assembler).toContain('from "./studio-main-menu-group-spec"');
    expect(assembler).not.toContain("function localizeText(");
    expect(assembler).not.toContain("translateItemUnavailableReason");
    // Item objects (and therefore labels, icons, shortcuts) live in the item modules.
    expect(assembler).not.toMatch(/^\s*label: "/mu);
    expect(assembler).not.toMatch(/^\s*onSelect:/mu);
    expect(assembler.split("\n").length).toBeLessThanOrEqual(
      CATALOGUE_MODULE_LINE_BUDGETS["./studio-main-menu-groups.ts"],
    );
  });

  it("routes every §15.3 group through a declared item module", () => {
    const routing = source("./studio-main-menu-item-routing.ts");
    const assembler = source("./studio-main-menu-groups.ts");
    const itemModules = CATALOGUE_MODULES.filter((name) =>
      name.startsWith("./studio-main-menu-items-"),
    );

    for (const moduleName of itemModules) {
      expect(routing, `${moduleName} must be wired into the routing table`).toContain(
        `from "${moduleName.replace(/\.ts$/u, "")}"`,
      );
    }
    // Nothing may import the item builders behind the routing table's back and
    // then re-declare a group; the assembler owns group identity and reaches the
    // builders only through `studioMainMenuItemsFor`.
    expect(routing.match(/buildStudio[A-Za-z0-9]*MenuItems/gu)?.length ?? 0).toBeGreaterThan(10);
    expect(assembler).toContain('from "./studio-main-menu-item-routing"');
    expect(assembler).not.toMatch(/from "\.\/studio-main-menu-items-/u);
  });

  it("leaves only state projection and browser command composition in StudioPage", () => {
    const page = source("./StudioCuttoonEditorHost.tsx");
    const companion = source("./studio-tools-companion.ts");
    const companionRuntime = source("./studio-tools-companion-runtime.ts");
    const start = page.indexOf("const studioMainMenuGroups = useMemo(");
    const end = page.indexOf("// 모바일 하단 보조 막대 버튼", start);
    const composition = page.slice(start, end);

    expect(page).toContain('from "./studio-main-menu-groups"');
    expect(composition).toContain("buildStudioMainMenuGroups({");
    // Root import inputs: null-guard then click (optional chaining removed for explicit UX).
    expect(composition).toContain("projectImportInputRef.current.click()");
    expect(composition).toContain("if (!projectImportInputRef.current)");
    expect(companionRuntime).toContain(
      'window.open("", "_blank", STUDIO_TOOLS_COMPANION_RESERVATION_FEATURES)',
    );
    expect(companionRuntime).toContain(
      "ready.protocol.openReadyStudioToolsCompanionForMenu({",
    );
    expect(companionRuntime).toContain(
      "runtime.protocol.completeReservedStudioToolsCompanionWindow({",
    );
    expect(companionRuntime).toContain("}, 8_000)");
    expect(companion).toContain("openStudioToolsCompanionWindow(");
    expect(companion).toContain("isStudioToolsCompanionWindowReusable(");
    expect(companion).toContain('const surface = input.surface ?? "workspace"');
    expect(companion).toContain("input.binding.release(surface)");
    expect(companion).toContain("도구 창을 복구해 다시 연결합니다");
    expect(composition).toContain("openStudioToolsCompanionForMenu({");
    expect(composition).toContain("windowRef: companionWindowRef");
    expect(composition).not.toContain("items: [");
    expect(composition).not.toContain("STUDIO_EDIT_MENU_COMMANDS");
    expect(composition).not.toContain('id: "quick-access-palette"');
    // The editor half is name-for-name delegation, so it is bound in the pure layer.
    // The page keeps the half that genuinely composes browser state.
    expect(composition).toContain("bindStudioMainMenuEditorActions(studioMainMenuActions)");
    expect(composition).not.toContain("copyImageToClipboard:");
    // Null-guarded root import clicks add a few lines vs optional-chaining form. Menu item
    // definitions, including Quick Access, remain owned by the pure catalogue. The ceiling
    // is the pre-Wave-D one: new wiring has to come out of the slack the split created,
    // not out of a bigger budget.
    expect(composition.split("\n").length).toBeLessThanOrEqual(212);
  });
});
