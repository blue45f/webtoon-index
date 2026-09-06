import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

interface ModuleEdges {
  readonly allImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly source: string;
  readonly typeImports: readonly string[];
  readonly valueImports: readonly string[];
}

function moduleEdges(relativePath: string): ModuleEdges {
  const fileUrl = new URL(relativePath, import.meta.url);
  const rawSource = readFileSync(fileUrl, "utf8");
  const source = relativePath.endsWith("StudioPage.tsx") || relativePath.endsWith("StudioCuttoonEditorHost.tsx")
    ? readStudioCuttoonEditorSource()
    : rawSource;
  const file = ts.createSourceFile(
    fileUrl.pathname,
    rawSource,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const allImports: string[] = [];
  const dynamicImports: string[] = [];
  const typeImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      allImports.push(specifier);
      const clause = node.importClause;
      if (clause?.isTypeOnly) typeImports.push(specifier);
      const namedBindings = clause?.namedBindings;
      const hasRuntimeValue = !clause || (
        !clause.isTypeOnly
        && (
          Boolean(clause.name)
          || Boolean(namedBindings && ts.isNamespaceImport(namedBindings))
          || Boolean(
            namedBindings
            && ts.isNamedImports(namedBindings)
            && namedBindings.elements.some((item) => !item.isTypeOnly)
          )
        )
      );
      if (hasRuntimeValue) valueImports.push(specifier);
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
  return { allImports, dynamicImports, source, typeImports, valueImports };
}

function namedFunctionSource(relativePath: string, functionName: string): string {
  const fileUrl = new URL(relativePath, import.meta.url);
  const rawSource = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    rawSource,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let source: string | null = null;

  function visit(node: ts.Node): void {
    if (source !== null) return;
    if (
      ts.isFunctionDeclaration(node)
      && node.name?.text === functionName
    ) {
      source = node.getText(file);
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  if (source === null) {
    throw new Error(`Missing function ${functionName} in ${relativePath}`);
  }
  return source;
}

const EXTRACTED_FUNCTIONS = [
  "drawBounds",
  "getSymmetricPoints",
  "drawFreehandPenSegments",
  "drawStudioCausalInkDabs",
  "isDirectLiveDraftEl",
  "isDirectLiveStampDraftEl",
  "drawLiveFreehandDraftToContext",
] as const;

describe("studio draw rendering ownership boundary", () => {
  it("keeps one-way ownership from StudioPage to the pure Canvas2D helper module", () => {
    const page = moduleEdges("../StudioCuttoonEditorHost.tsx");
    const rendering = moduleEdges("./studio-draw-rendering.ts");

    expect(
      page.valueImports.filter((specifier) => specifier === "./brush/studio-draw-rendering"),
    ).toEqual(["./brush/studio-draw-rendering"]);
    expect(rendering.allImports).not.toContain("../StudioPage");
    expect(rendering.dynamicImports).toEqual([]);

    for (const functionName of EXTRACTED_FUNCTIONS) {
      expect(rendering.source).toMatch(new RegExp(`export function ${functionName}\\b`));
      expect(page.source).not.toMatch(new RegExp(`function ${functionName}\\b`));
    }
  });

  it("keeps DrawEl and Konva as whole-clause type-only dependencies", () => {
    const rendering = moduleEdges("./studio-draw-rendering.ts");

    expect(rendering.typeImports).toContain("../studio-element-model");
    expect(rendering.typeImports).toContain("konva");
    expect(rendering.valueImports).not.toContain("../studio-element-model");
    expect(rendering.valueImports).not.toContain("konva");
    expect(rendering.source).toContain('import type { DrawEl } from "../studio-element-model";');
    expect(rendering.source).toContain('import type Konva from "konva";');
  });

  it("does not pull editor lifecycle, UI, collaboration, or GPU responsibilities into the helper", () => {
    const rendering = moduleEdges("./studio-draw-rendering.ts");
    const forbiddenSpecifier = /(?:^|\/)(?:react|react-dom|react-router|auth|studio-crdt|studio-webgpu|StudioPage)(?:\/|$)/;

    for (const specifier of rendering.allImports) {
      expect(specifier).not.toMatch(forbiddenSpecifier);
    }
    expect(rendering.source).not.toMatch(/\b(?:useEffect|useLayoutEffect|useRef|useState|useSyncExternalStore)\b/);
    expect(rendering.source).not.toMatch(/\b(?:navigator|document|window)\s*\./);
    expect(rendering.source).not.toMatch(/\bGPUDevice\b/);
  });

  it("keeps the React-Konva node and draft preview runtime in one-way modules", () => {
    const page = moduleEdges("../StudioCuttoonEditorHost.tsx");
    const viewport = moduleEdges("../canvas/StudioCanvasViewport.tsx");
    const documentLayer = moduleEdges("../canvas/StudioCanvasViewportDocumentLayer.tsx");
    const toolLayers = moduleEdges("../canvas/StudioCanvasViewportToolLayers.tsx");
    const stageHost = moduleEdges("../canvas/StudioCanvasViewportStageHost.tsx");
    const viewportTypes = moduleEdges("../canvas/StudioCanvasViewportTypes.ts");
    const drawNode = moduleEdges("./StudioDrawNode.tsx");
    const previewLayers = moduleEdges("../StudioDraftPreviewLayers.tsx");
    const previewStore = moduleEdges("../studio-draft-preview-store.ts");
    const rendering = moduleEdges("./studio-draw-rendering.ts");

    expect(
      documentLayer.valueImports.filter((specifier) => specifier === "../brush/StudioDrawNode"),
    ).toEqual(["../brush/StudioDrawNode"]);
    expect(page.source).not.toContain("const StudioDrawNode = memo(function StudioDrawNode(");
    expect(viewport.source).not.toContain("const StudioDrawNode = memo(function StudioDrawNode(");
    expect(drawNode.source).toContain(
      "export const StudioDrawNode = memo(function StudioDrawNode(",
    );
    expect(drawNode.allImports).not.toContain("../StudioPage");
    expect(drawNode.dynamicImports).toEqual([]);
    expect(drawNode.valueImports).toContain("../StudioStampDrawShape");
    expect(drawNode.typeImports).toContain("../studio-element-model");
    expect(drawNode.valueImports).not.toContain("../studio-element-model");
    expect(drawNode.valueImports).toContain("./studio-draw-rendering");
    expect(drawNode.valueImports).toContain("react-konva/lib/ReactKonvaCore");

    expect(page.valueImports.filter((specifier) => specifier === "./studio-draft-preview-store"))
      .toEqual(["./studio-draft-preview-store"]);
    expect(toolLayers.valueImports.filter((specifier) => specifier === "../StudioDraftPreviewLayers"))
      .toEqual(["../StudioDraftPreviewLayers"]);
    expect(page.source).not.toMatch(/\b(?:const|function|class)\s+StudioDraftPreviewStore\b/);
    expect(page.source).not.toMatch(/\b(?:const|function|class)\s+StudioDraftPreviewLayers\b/);
    expect(viewport.source).not.toMatch(/\b(?:const|function|class)\s+StudioDraftPreviewStore\b/);
    expect(viewport.source).not.toMatch(/\b(?:const|function|class)\s+StudioDraftPreviewLayers\b/);
    expect(viewportTypes.typeImports).toContain("../studio-draft-preview-store");
    expect(viewportTypes.valueImports).not.toContain("../studio-draft-preview-store");

    expect(previewStore.source).toContain("export class StudioDraftPreviewStore");
    expect(previewStore.typeImports).toContain("./studio-element-model");
    expect(previewStore.valueImports).not.toContain("./studio-element-model");
    expect(previewStore.allImports).not.toContain("../StudioPage");
    expect(previewStore.allImports.some((specifier) => specifier.startsWith("react"))).toBe(false);

    expect(previewLayers.source).toContain(
      "export const StudioDraftPreviewLayers = memo(function StudioDraftPreviewLayers(",
    );
    expect(previewLayers.typeImports).toContain("./studio-draft-preview-store");
    expect(previewLayers.valueImports).not.toContain("./studio-draft-preview-store");
    expect(previewLayers.valueImports).toContain("./brush/StudioDrawNode");
    expect(previewLayers.valueImports).toContain("react-konva/lib/ReactKonvaCore");
    expect(previewLayers.allImports).not.toContain("../StudioPage");
    expect(previewLayers.source).toContain('canvas.style.mixBlendMode = mode === "backdrop-multiply"');
    expect(previewLayers.source).toContain("getNativeCanvasElement()");
    expect(previewLayers.source).not.toContain("._canvas");
    expect(stageHost.source).toContain('isolation: "isolate"');

    expect(rendering.source).not.toMatch(/\b(?:const|function|class)\s+StudioDrawNode\b/);
    expect(rendering.source).not.toMatch(/\b(?:const|function|class)\s+StudioDraftPreviewStore\b/);
    expect(rendering.source).not.toMatch(/\b(?:const|function|class)\s+StudioDraftPreviewLayers\b/);
    expect(rendering.allImports.some((specifier) => specifier.startsWith("react-konva"))).toBe(false);
  });

  it("synchronizes retained DOM ink before admitting the next backdrop sample and bounds canvases", () => {
    const page = moduleEdges("../StudioCuttoonEditorHost.tsx");
    const viewport = moduleEdges("../canvas/StudioCanvasViewport.tsx");
    const stageHost = moduleEdges("../canvas/StudioCanvasViewportStageHost.tsx");
    const previewLayers = moduleEdges("../StudioDraftPreviewLayers.tsx");
    const onStageDownStart = page.source.indexOf("function onStageDown(");
    const drawBranchStart = page.source.indexOf('if (tool === "draw")', onStageDownStart);
    const drawBranchEnd = page.source.indexOf("// 선택 모드:", drawBranchStart);
    const drawBranch = page.source.slice(drawBranchStart, drawBranchEnd);

    const boundaryPlanIndex = drawBranch.indexOf("planStudioDraftPreviewBackdropBoundary({");
    const boundaryExecutionIndex = drawBranch.indexOf("executeStudioDraftPreviewBackdropBoundary({");
    const pointerSessionIndex = drawBranch.indexOf("beginStudioStrokePointerSession(pointerSample)");
    const firstPositionIndex = drawBranch.indexOf("stageRef.current?.getRelativePointerPosition()");
    const crdtBeginIndex = drawBranch.indexOf("drawingCrdtPublisherRef.current.begin(");

    expect(boundaryPlanIndex).toBeGreaterThanOrEqual(0);
    expect(boundaryExecutionIndex).toBeGreaterThan(boundaryPlanIndex);
    expect(drawBranch).toContain("flushSynchronously: flushSync");
    expect(drawBranch).toContain(
      "restorePointerPosition: () => stageRef.current?.setPointersPositions(pointerSample)",
    );
    expect(pointerSessionIndex).toBeGreaterThan(boundaryExecutionIndex);
    expect(firstPositionIndex).toBeGreaterThan(pointerSessionIndex);
    expect(crdtBeginIndex).toBeGreaterThan(firstPositionIndex);

    expect(previewLayers.source).toContain("const settledRun0 = settledRuns[0] ?? null;");
    expect(previewLayers.source).toContain("const settledRun1 = settledRuns[1] ?? null;");
    expect(previewLayers.source).not.toContain("settledRuns.map(");
    expect(previewLayers.source).toContain("STUDIO_DRAFT_PREVIEW_ACTIVE_CANVAS_Z");

    // Zoom host uses a callback ref (Pixi mount parent colocation); pin isolation on that host,
    // not on the Konva Stage (which only owns touch-action for the contact stream).
    const zoomHostStart = viewport.source.indexOf("zoomHostNodeRef.current = node");
    const stageStart = stageHost.source.indexOf("<Stage");
    const stageEnd = stageHost.source.indexOf(">", stageStart);
    expect(zoomHostStart).toBeGreaterThanOrEqual(0);
    expect(stageStart).toBeGreaterThan(-1);
    expect(stageHost.source).toContain('isolation: "isolate"');
    expect(stageHost.source.slice(stageStart, stageEnd)).not.toContain("isolation");
  });

  it("keeps editor lifecycle, collaboration, routing, and GPU ownership out of StudioDrawNode", () => {
    const drawNode = moduleEdges("./StudioDrawNode.tsx");
    const forbiddenSpecifier = /(?:^|\/)(?:react-router|auth|studio-crdt|studio-webgpu|StudioPage)(?:\/|$)/;

    for (const specifier of drawNode.allImports) {
      expect(specifier).not.toMatch(forbiddenSpecifier);
    }
    expect(drawNode.source).not.toMatch(/\b(?:navigator|document|window)\s*\./);
    expect(drawNode.source).not.toMatch(/\b(?:GPUDevice|PointerEvent|WebSocket)\b/);
  });

  it("locks the stamp, watercolor, pattern, and memo routing seams in the extracted node", () => {
    const drawNode = moduleEdges("./StudioDrawNode.tsx");
    const stampShape = moduleEdges("../StudioStampDrawShape.tsx");
    const cacheResolvedPatternTileImage = namedFunctionSource(
      "./StudioDrawNode.tsx",
      "cacheResolvedPatternTileImage",
    );
    const loadSharedPatternTileImage = namedFunctionSource(
      "./StudioDrawNode.tsx",
      "loadSharedPatternTileImage",
    );
    const usePatternFillImage = namedFunctionSource(
      "./StudioDrawNode.tsx",
      "usePatternFillImage",
    );

    expect(drawNode.source).toContain("const tileSrc = pattern ? patternDataUrl(pattern) : null;");
    expect(drawNode.source).toContain(
      "const resolvedPatternTileImages = new Map<string, HTMLImageElement>();",
    );
    expect(drawNode.source).toContain(
      "const pendingPatternTileImageLoads = new Map<string, Promise<HTMLImageElement>>();",
    );
    expect(cacheResolvedPatternTileImage).toContain(
      "while (resolvedPatternTileImages.size >= STUDIO_DRAW_PATTERN_IMAGE_CACHE_LIMIT)",
    );
    expect(cacheResolvedPatternTileImage).toContain(
      "resolvedPatternTileImages.delete(oldestTileSrc);",
    );
    expect(loadSharedPatternTileImage).toContain(
      "if (resolved) return Promise.resolve(resolved);",
    );
    expect(loadSharedPatternTileImage).toContain("if (pending) return pending;");
    expect(loadSharedPatternTileImage).toContain(
      "cacheResolvedPatternTileImage(tileSrc, image);",
    );
    expect(
      loadSharedPatternTileImage.match(
        /pendingPatternTileImageLoads\.delete\(tileSrc\)/gu,
      ),
    ).toHaveLength(2);
    expect(loadSharedPatternTileImage).toContain(
      "pendingPatternTileImageLoads.set(tileSrc, request);",
    );

    // A mounted hook owns the resolved image independently from the bounded shared cache. The
    // tile identity guard prevents a prior pattern's image from appearing after a prop change,
    // while the effect cleanup keeps stale or unmounted async completions from updating state.
    const localImageIndex = usePatternFillImage.indexOf(
      "loaded?.tileSrc === tileSrc ? loaded.image : null",
    );
    const resolvedCacheIndex = usePatternFillImage.indexOf(
      "resolvedPatternTileImages.get(tileSrc)",
    );
    expect(localImageIndex).toBeGreaterThanOrEqual(0);
    expect(resolvedCacheIndex).toBeGreaterThan(localImageIndex);
    expect(usePatternFillImage).toContain("setLoaded({ image: resolved, tileSrc });");
    expect(usePatternFillImage).toContain("let active = true;");
    expect(usePatternFillImage).toContain(
      "if (active) setLoaded({ image: img, tileSrc });",
    );
    expect(usePatternFillImage).toContain("active = false;");
    expect(usePatternFillImage).toContain("}, [loaded, tileSrc]);");
    expect(usePatternFillImage).toContain("return image;");
    expect(drawNode.source).toContain("const symmetricVariations = stampBrushKind");
    expect(drawNode.source).toContain("<StudioStampDrawShape");
    expect(drawNode.valueImports).toContain("../StudioStampDrawShape");
    expect(stampShape.source).toContain('el.stampPipeline === "causal-walker-v2"');
    expect(stampShape.source).toContain("resolveStudioFreehandRenderPath(el.points");
    expect(stampShape.source).toContain("const sourceAligned = causalStamp || stampPoints === el.points");
    expect(stampShape.source).toContain("drawStudioStampStrokeWithSymmetry(");
    expect(drawNode.source).toContain('el.watercolorPipeline === "causal-walker-v2"');
    // 활성 초안은 요소·대칭변형 키의 증분 파이프라인, 커밋 렌더는 배치 봉인 리플레이 —
    // 장획 게이트(wet-dabs) 이후의 워터컬러 라우팅 이음새.
    expect(drawNode.source).toContain(
      "planStudioWetWashLivePipeline(`${el.id}#${index}`, {",
    );
    expect(drawNode.source).toContain("planCausalWatercolorBrushDabs(watercolorInput, true)");
    expect(drawNode.source).toContain('globalCompositeOperation="multiply"');
    expect(drawNode.source).toContain(
      "globalCompositeOperation={STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION}",
    );
    expect(drawNode.source).not.toContain('globalCompositeOperation="lighter"');
  });

  it("keeps dynamic live drafts on the single-normalization bounded-compositor path", () => {
    const drawNode = moduleEdges("./StudioDrawNode.tsx");
    const renderPlan = moduleEdges("../studio-dynamic-brush-render-plan.ts");

    expect(drawNode.source).toContain("const symmetricVariations = stampBrushKind || dynamicBrushId");
    expect(drawNode.valueImports).toContain("../studio-dynamic-brush-render-plan");
    expect(drawNode.source).toContain("planStudioDynamicBrushRender(");
    expect(drawNode.source).not.toContain("planNormalizedStudioDynamicBrushDabs(");
    expect(drawNode.source).not.toContain("planStudioDynamicBrushDabs(");
    expect(drawNode.source).not.toContain("dynamicBrushSettingsBySnapshot.get(source)");
    expect(drawNode.source).not.toContain("dynamicBrushDefaultSettingsById.get(brushId)");
    expect(drawNode.source).not.toContain("studioDynamicBrushDabVariationsFromTransforms(");
    expect(renderPlan.source).toContain("planNormalizedStudioDynamicBrushDabs(");
    expect(renderPlan.source).toContain("dynamicsBySnapshot.get(source)");
    expect(renderPlan.source).toContain("defaultDynamicsByBrushId.get(brushId)");
    expect(renderPlan.source).toContain("studioDynamicBrushDabVariationsFromTransforms(");
    expect(drawNode.source).toContain("planStudioDynamicBrushCoverageAndLegacyMarks({");
    expect(drawNode.source).toContain("renderStudioDynamicBrushCoverage(");
    expect(drawNode.source).toContain("renderStudioDynamicBrushLegacyMarks(");
    expect(drawNode.source).not.toContain("planNormalizedStudioBrushTipComposition(");
  });
});
