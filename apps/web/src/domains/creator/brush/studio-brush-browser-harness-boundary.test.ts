import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS } from "../studio-brush";

import { STUDIO_ALL_BRUSH_CATALOG_ITEMS } from "./studio-brush-catalog";

const root = resolve(import.meta.dirname, "../../../../../../");
const harness = readFileSync(resolve(root, "scripts/verify-studio-brushes.mts"), "utf8");

describe("Studio brush browser harness catalogue boundary", () => {
  it("keeps the full product catalogue unique and its core partition identical to BRUSH_PRESETS", () => {
    const presetIds = BRUSH_PRESETS.map((preset) => preset.id);
    const catalogIds = STUDIO_ALL_BRUSH_CATALOG_ITEMS.map((item) => item.id);
    const catalogNames = STUDIO_ALL_BRUSH_CATALOG_ITEMS.map((item) => item.name);
    const coreIds = STUDIO_ALL_BRUSH_CATALOG_ITEMS
      .filter((item) => item.source === "core")
      .map((item) => item.id);
    const proIds = STUDIO_ALL_BRUSH_CATALOG_ITEMS
      .filter((item) => item.source === "pro")
      .map((item) => item.id);

    expect(BRUSH_PRESETS.length).toBeGreaterThan(0);
    expect(STUDIO_ALL_BRUSH_CATALOG_ITEMS.length).toBeGreaterThan(0);
    expect(new Set(presetIds).size).toBe(presetIds.length);
    expect(new Set(catalogIds).size).toBe(catalogIds.length);
    expect(new Set(catalogNames).size).toBe(catalogNames.length);
    expect(coreIds).toHaveLength(presetIds.length);
    expect(new Set(coreIds)).toEqual(new Set(presetIds));
    for (const item of STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter(
      (candidate) => candidate.source === "core",
    )) {
      const preset = BRUSH_PRESETS.find((candidate) => candidate.id === item.id);
      expect(preset, `${item.id}: core catalogue item has no renderer preset`).toMatchObject({
        id: item.id,
        name: item.name,
        defaultWidth: item.defaultWidth,
        defaultOpacity: item.defaultOpacity,
      });
    }
    expect(catalogIds).toEqual([...coreIds, ...proIds]);
  });

  it("derives browser expectations from catalogue sources and audits the exact UI selection list", () => {
    expect(harness).toContain("const BUILT_IN_BRUSH_PRESET_COUNT = BRUSH_PRESETS.length;");
    expect(harness).toContain(
      "const PRODUCT_BRUSH_CATALOG_COUNT = STUDIO_ALL_BRUSH_CATALOG_ITEMS.length;",
    );
    expect(harness).toContain("assertProductBrushCatalogContract()");
    // 2026-08-14: the UI matrices audit the LISTED (quarantine-aware) catalogue — quarantined ids
    // stay registered for persisted replay but are never selectable choices in the shipped UI.
    expect(harness).toContain(
      "assertUiBrushCatalogMatchesProductCatalog(\n        firstCatalog,\n        STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS,\n        \"paint\",\n      )",
    );
    expect(harness).toContain(
      "assertUiEraserQuickPickerMatchesProductCatalog(eraserCatalog)",
    );
    expect(harness).toContain(
      "closeDesktopCatalog(page, firstCatalog)",
    );
    expect(harness).toContain(
      'drawSheet.locator(\'[data-studio-open-brush-library="true"]\')',
    );
    expect(harness).not.toContain('name: "앱 브러시 닫기"');
    expect(harness).not.toContain('name: "기본 프리셋 전체 보기"');
    expect(harness).toContain(
      'JSON.stringify(actualSelections) === JSON.stringify(expectedSelections)',
    );
    expect(harness).toContain(
      "coreCatalogIds.every((id) => presetById.has(id))",
    );
    expect(harness).toContain(
      "for (const [index, preset] of DESKTOP_STABILITY_CASES.entries())",
    );
    expect(harness).toContain(
      "evidence.length === DESKTOP_STABILITY_CASES.length",
    );
    expect(harness).toContain(
      "post-redo cleanup left perceptible stroke pixels behind",
    );
    expect(harness).toContain(
      "waitForPersistedSingleCatalogStroke(page, expectedSelection)",
    );
    expect(harness).toContain(
      "persisted dynamics do not match the selected catalogue profile",
    );
    expect(harness).toContain(
      'preset.source === "core" || expectedSelection.brushDynamics',
    );
    expect(harness).toContain(
      "draw?.brushCatalogId === expected.catalogId",
    );
    expect(harness).toContain(
      "draw.brush === expected.runtimeBrushId",
    );
    expect(harness).toContain(
      "serializeStudioBrushDynamicsSettingsCanonical(persistedProStroke.brushDynamics)",
    );
    expect(harness).toContain(
      "expectedPersistedDynamicsForDefaultSelection(expectedSelection)",
    );
    expect(harness).toContain(
      "captureStudioDrawPointerPressureContract({",
    );
    expect(harness).toContain(
      "pressureMinSize: DEFAULT_STUDIO_BRUSH_SNAPSHOT.pressureMinSize",
    );
    expect(harness).toContain(
      "strokeWidth: selection.defaultWidth",
    );
    expect(harness).toContain(
      "serializeStudioBrushDynamicsSettingsCanonical(expectedPersistedDynamics)",
    );
    expect(harness).not.toContain(
      "serializeStudioBrushDynamicsSettingsCanonical(expectedSelection.brushDynamics)",
    );
    // The grid no longer HAS a row count to get wrong. A preset's cell and its gesture are a pure
    // function of a hash of its own id, so no catalogue count — and no delisting — can move another
    // brush's stroke. That coupling was not hypothetical: the earlier `index % 3` direction and
    // `floor(index / 7)` row meant quarantining three ids reshuffled the matrix, and it also meant
    // a focused TOONSPECTRUM_BRUSH_VERIFY_IDS run put every preset at index 0, which is why
    // presets could "pass in isolation" and fail in the full run.
    expect(harness).toContain('strokeIdentityUnit(preset.id, "row")');
    expect(harness).not.toContain("BRUSH_MATRIX_CATALOG_COUNT / 7");
    expect(harness).not.toContain(
      "Math.ceil(BRUSH_PRESETS.length / 7)",
    );
    expect(harness).not.toContain("BRUSH_PRESETS.length === 37");
    expect(harness).not.toContain("evidence.length === 37");
    expect(harness).not.toContain("/37 long strokes");
  });

  it("uses the shipped floating library and closes it only after the selected profile is active", () => {
    expect(harness).toContain('[role="dialog"][data-studio-brush-floating]');
    expect(harness).toContain('await catalog.getAttribute("role") === "region"');
    expect(harness).toContain("await closeDesktopCatalog(page, catalog)");
    expect(harness).toContain(":not([data-studio-primary-action])");
    expect(harness).toContain("TOONSPECTRUM_BRUSH_STABILITY_ROUNDS");
    expect(harness).toContain("captureBrushStageFailure(page, \"durability\", error, errors)");
    expect(harness).not.toContain('catalog.waitFor({ state: "detached" }).catch(() => {})');
  });

  it("treats named erasers as destructive operations with a real paint baseline", () => {
    expect(harness).toContain("resolveStudioBrushRuntimeContract(selection.catalogId)");
    expect(harness).toContain('selection.drawMode === "eraser" ? "erase" : "paint"');
    expect(harness).toContain("contractOperation === selectionOperation");
    expect(harness).toContain("data-studio-active-draw-mode");
    expect(harness).toContain("prepareVisibleEraserBaseline");
    expect(harness).toContain("pointer-down gesture lost eraser operation authority");
    expect(harness).toContain("eraser gesture had no live retained-layer preview");
    expect(harness).toContain("live low-density gesture retained");
    expect(harness).toContain("live retained-layer eraser");
    expect(harness).not.toContain("release-visible destination-out over retained paint");
    expect(harness).toContain("waitForPersistedSelectedOperation(");
    expect(harness).toContain(
      "persistedErase.stroke.brush === expectedSelection.runtimeBrushId",
    );
    expect(harness).toContain('data-studio-active-tool-summary="eraser"');
    expect(harness).toContain("measureEraserLiftRatio(");
    expect(harness).toContain("expected a bounded partial lift");
    expect(harness).toContain("paint+erase cleanup left");
    expect(harness).toContain("long paint+erase cleanup left");
    expect(harness).toContain("TOONSPECTRUM_BRUSH_VERIFY_IDS");
    expect(harness).not.toContain('preset.id === "kneaded-eraser"');
  });

  it("isolates every sparse long route and offers an exhaustive long-only catalogue audit", () => {
    expect(harness).toContain(
      "const desktop = runDesktop ? await runDesktopBrushMatrix(browser, studioUrl) : null;",
    );
    expect(harness).toContain(
      "const longBrushes = runLong ? await runLongBrushMatrix(browser, studioUrl) : null;",
    );
    expect(harness).toContain(
      "const smartShapes = runShapes ? await runSmartShapeMatrix(browser, studioUrl) : null;",
    );
    expect(harness).toContain("const y = safeTop + (safeBottom - safeTop) / 2;");
    expect(harness).toContain("const ALL_BRUSH_LONG_MATRIX =");
    expect(harness).toContain(
      'process.env.TOONSPECTRUM_ALL_BRUSH_LONG_MATRIX === "1"',
    );
    expect(harness).toContain(
      "? STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS",
    );
    expect(harness).toContain(
      ': STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.filter((item) => item.source === "core")',
    );
    expect(harness).toContain(
      'const longOnly = process.env.TOONSPECTRUM_BRUSH_LONG_ONLY === "1";',
    );
    expect(harness).toContain(
      "for (const [index, preset] of LONG_BRUSH_CATALOG_ITEMS.entries())",
    );
    expect(harness).toContain(
      "materializeStudioBrushCatalogSelection(preset.id)",
    );
    expect(harness).toContain(
      "saved.brush === expectedSelection.runtimeBrushId",
    );
    expect(harness).toContain(
      "entry.persistedBrushId === entry.expectedRuntimeBrushId",
    );
    expect(harness).toContain(
      "entry.persistedCatalogId === entry.id",
    );
    expect(harness).toContain(
      "entry.persistedDynamicsMatched === true",
    );
    expect(harness).toContain("persistedPathDistance >= 300");
    expect(harness).toContain('await page.keyboard.press("Meta+z")');
    expect(harness).not.toContain(
      "((safeBottom - safeTop) * (index + 0.5)) / BRUSH_PRESETS.length",
    );
  });

  it("allows only the exact current local-preview Socket.IO shutdown and no obsolete visit ping", () => {
    expect(harness).toContain('previewUrl.hostname !== "127.0.0.1"');
    expect(harness).toContain("previewUrl.port.length === 0");
    expect(harness).toContain(
      "`ws://127.0.0.1:${previewUrl.port}/socket.io/?EIO=4&transport=websocket`",
    );
    expect(harness).toContain(
      "Connection closed before receiving a handshake response",
    );
    expect(harness).toContain(
      "Error during WebSocket handshake: Unexpected response code: 400",
    );
    expect(harness).toContain("expectedMessages.includes(message)");
    expect(harness).toContain("sourceUrl.origin === previewUrl.origin");
    expect(harness).toContain(
      "/^\\/assets\\/[A-Za-z0-9._-]+\\.js$/u.test(sourceUrl.pathname)",
    );
    expect(harness).not.toContain(
      `message.includes("WebSocket connection to 'ws://127.0.0.1:")`,
    );
    expect(harness).not.toContain("/api/v1/apps/toonspectrum/visits/ping");
  });
});
