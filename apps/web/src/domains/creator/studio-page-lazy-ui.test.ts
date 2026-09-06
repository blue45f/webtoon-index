import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

interface ModuleEdges {
  readonly dynamicImports: readonly string[];
  readonly source: string;
  readonly valueImports: readonly string[];
}

function moduleEdges(relativePath: string): ModuleEdges {
  const fileUrl = new URL(relativePath, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const dynamicImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && !node.importClause?.isTypeOnly
    ) {
      valueImports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      dynamicImports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return { dynamicImports, source, valueImports };
}

const REPRESENTATIVE_OPTIONAL_SURFACES = [
  "./ai/StudioAiAssistHub",
  "./StudioAppSettingsPanel",
  "./brush/StudioBrushStudio",
  "./StudioHokusaiNaturalMediaInspectorSection",
  "./StudioProceduralArtisticBrushController",
  "./StudioColorPalettePanel",
  "./StudioCommentsPanelSession",
  "./brush/StudioDrawingPaletteStack",
  "./filter/StudioFilterDialog",
  "./StudioFloodFillPanel",
  "./StudioFrameAnimationPanel",
  "./StudioImageAdjustmentsPanel",
  "./layer/StudioLayerNavigator",
  "./StudioPanelSplitTool",
  "./StudioPageThumbnails",
  "./StudioQuickStartPanel",
  "./StudioTeamPanel",
  "./lettering/StudioTextEditOverlay",
  "./StudioWebGpuCanvas",
] as const;

const USER_TRIGGERED_STUDIO_RUNTIMES = [
  "./studio-capture-readiness",
  "./studio-save-payload",
] as const;

describe("StudioPage optional UI registry", () => {
  it("keeps StudioPage orchestration separate from the optional loader catalog", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx");

    expect(page.valueImports).toContain("./studio-page-lazy-ui");
    for (const specifier of REPRESENTATIVE_OPTIONAL_SURFACES) {
      expect(page.valueImports).not.toContain(specifier);
      expect(page.dynamicImports).not.toContain(specifier);
    }
  });

  it("retains literal, statically analyzable lazy boundaries in the registry", () => {
    const registry = moduleEdges("./studio-page-lazy-ui.ts");

    expect(registry.source).not.toContain("import.meta.glob");
    expect(registry.source).toContain("lazyRetry(");
    expect(registry.dynamicImports.length).toBeGreaterThanOrEqual(70);
    for (const specifier of REPRESENTATIVE_OPTIONAL_SURFACES) {
      expect(registry.valueImports).not.toContain(specifier);
      expect(registry.dynamicImports.filter((candidate) => candidate === specifier)).toEqual([
        specifier,
      ]);
    }
  });

  it("defers capture readiness and save projection until user intent", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx");
    // Intentional change (2026-08, B-09): the save orchestration that consumes the
    // save-payload runtime moved to studio-page-save-pipeline.ts — the lazy-chunk
    // contract now covers both the page and the extracted pipeline.
    const savePipeline = moduleEdges("./studio-page-save-pipeline.ts");
    const registry = moduleEdges("./studio-page-lazy-ui.ts");

    for (const specifier of USER_TRIGGERED_STUDIO_RUNTIMES) {
      expect(page.valueImports, `${specifier} must leave the StudioPage static graph`).not.toContain(
        specifier
      );
      expect(page.dynamicImports, `${specifier} must keep one registry-owned loader`).not.toContain(
        specifier
      );
      expect(
        savePipeline.valueImports,
        `${specifier} must leave the save-pipeline static graph`
      ).not.toContain(specifier);
      expect(
        savePipeline.dynamicImports,
        `${specifier} must keep one registry-owned loader`
      ).not.toContain(specifier);
      expect(
        registry.dynamicImports.filter((candidate) => candidate === specifier),
        `${specifier} must retain one literal Vite boundary`
      ).toEqual([specifier]);
    }

    expect(registry.source).toContain("studioCaptureReadinessRuntimeLoader.preload()");
    expect(registry.source).toContain("studioSavePayloadRuntimeLoader.preload()");
    expect(registry.source).toMatch(
      /function preloadStudioExportMenuPanel\(\): void \{[\s\S]*?preloadStudioCaptureReadinessRuntime\(\);[\s\S]*?\}/u
    );
    expect(page.source).toContain("await loadStudioCaptureReadinessRuntime()");
    expect(savePipeline.source).toContain("await loadStudioSavePayloadRuntime()");
    expect(page.source).toContain("preloadStudioCaptureReadinessRuntime();");
    expect(page.source).toContain("preloadStudioSavePayloadRuntime();");
    expect(savePipeline.source).toContain("preloadStudioSavePayloadRuntime();");
  });

  it("keeps shared preload promises in the registry instead of recreating them per render", () => {
    const registry = moduleEdges("./studio-page-lazy-ui.ts").source;

    expect(registry).toContain("studioAssetMenuPanelPromise ??=");
    expect(registry).toContain("studioStockImagePanelPromise ??=");
    expect(registry).toContain("studioIntegrationsSettingsPanelPromise ??=");
    expect(registry).toContain("studioExportMenuPanelPromise ??=");
    expect(registry).toContain("studioColorPopoverPromise ??=");
  });

  it("keeps the mobile Inspector modal boundary active while its lazy chunk loads", () => {
    const page = readStudioCuttoonEditorSource();
    const presets = moduleEdges("./studio-mobile-dock-presets.tsx").source;
    const fallbackStart = presets.indexOf("export function StudioInspectorAsideFallback");
    const fallbackEnd = presets.length;
    const fallback = presets.slice(fallbackStart, fallbackEnd);
    const usageStart = page.indexOf("<StudioInspectorAsideFallback");
    const usageEnd = page.indexOf("/>", usageStart);
    const usage = page.slice(usageStart, usageEnd);

    expect(fallbackStart).toBeGreaterThanOrEqual(0);
    expect(fallbackEnd).toBeGreaterThan(fallbackStart);
    expect(usageStart).toBeGreaterThanOrEqual(0);
    expect(usageEnd).toBeGreaterThan(usageStart);
    expect(fallback).toContain('propsSheetRef: import("react").RefObject<HTMLElement | null>');
    expect(fallback).toContain("ref={propsSheetRef}");
    expect(fallback).toContain('role={isMobile ? "dialog" : undefined}');
    expect(fallback).toContain("aria-modal={isMobile ? true : undefined}");
    expect(fallback).toContain("tabIndex={isMobile ? -1 : undefined}");
    expect(fallback).toContain("studioMobileSheetSizeStyle(snap, safeKeyboardInset)");
    expect(fallback).not.toContain('height: "min(62dvh, 32rem)"');
    expect(usage).toContain("propsSheetRef={propsSheetRef}");
    expect(usage).toContain("snap={mobileInspectorSnap}");
  });

  it("exposes an intent-preloadable drawing palette stack through one registry-owned lazyRetry boundary", () => {
    const registry = moduleEdges("./studio-page-lazy-ui.ts");

    expect(
      registry.dynamicImports.filter(
        (specifier) => specifier === "./brush/StudioDrawingPaletteStack"
      )
    ).toEqual(["./brush/StudioDrawingPaletteStack"]);
    expect(registry.valueImports).not.toContain("./brush/StudioDrawingPaletteStack");
    expect(registry.source).toMatch(
      /const studioDrawingPaletteStackLoader = createStudioIntentLazyLoader\(\(\) =>[\s\S]*?import\("\.\/brush\/StudioDrawingPaletteStack"\)[\s\S]*?default: mod\.StudioDrawingPaletteStack/u
    );
    expect(registry.source).toMatch(
      /const StudioDrawingPaletteStack = lazyRetry\(\s*studioDrawingPaletteStackLoader\.load,\s*"StudioDrawingPaletteStack"\s*\)/u
    );
    expect(registry.source).toMatch(
      /function preloadStudioDrawingPaletteStack\(\): void \{\s*studioDrawingPaletteStackLoader\.preload\(\);\s*\}/u
    );
    expect(registry.source).toMatch(
      /export \{[\s\S]*?\bStudioDrawingPaletteStack,[\s\S]*?\}/u
    );
    expect(registry.source).toMatch(
      /export \{[\s\S]*?\bpreloadStudioDrawingPaletteStack,[\s\S]*?\}/u
    );
  });

  it("loads one comments session boundary without a nested panel waterfall", () => {
    const registry = moduleEdges("./studio-page-lazy-ui.ts");
    const session = moduleEdges("./StudioCommentsPanelSession.tsx");

    expect(
      registry.dynamicImports.filter(
        (specifier) => specifier === "./StudioCommentsPanelSession"
      )
    ).toEqual(["./StudioCommentsPanelSession"]);
    expect(registry.dynamicImports).not.toContain("./StudioCommentsPanel");
    expect(registry.valueImports).not.toContain("./StudioCommentsPanelSession");
    expect(
      session.valueImports.filter((specifier) => specifier === "./StudioCommentsPanel")
    ).toEqual(["./StudioCommentsPanel"]);
    expect(session.dynamicImports).toEqual([]);
    expect(session.valueImports).not.toContain("./studio-page-lazy-ui");
    expect(registry.source).toContain("studioCommentsPanelSessionLoader.load");
    expect(registry.source).toContain("studioCommentsPanelSessionLoader.preload()");
    expect(registry.source).toContain("preloadStudioCommentsPanelSession");
    expect(moduleEdges("./StudioCuttoonEditorHost.tsx").source).toContain(
      "preloadStudioCommentsPanelSession();"
    );
  });
});
