import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleShape {
  readonly allImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly exportedDeclarations: ReadonlySet<string>;
  readonly file: ts.SourceFile;
  readonly source: string;
  readonly topLevelDeclarations: ReadonlySet<string>;
  readonly valueImports: readonly string[];
}

function declarationIsExported(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function moduleShape(relativePath: string): ModuleShape {
  const fileUrl = new URL(relativePath, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const allImports: string[] = [];
  const dynamicImports: string[] = [];
  const exportedDeclarations = new Set<string>();
  const topLevelDeclarations = new Set<string>();
  const valueImports: string[] = [];

  function rememberDeclaration(name: string, node: ts.Node): void {
    topLevelDeclarations.add(name);
    if (declarationIsExported(node)) exportedDeclarations.add(name);
  }

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      allImports.push(statement.moduleSpecifier.text);
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      const hasRuntimeValue = !clause || (
        !clause.isTypeOnly
        && (
          Boolean(clause.name)
          || Boolean(bindings && ts.isNamespaceImport(bindings))
          || Boolean(
            bindings
            && ts.isNamedImports(bindings)
            && bindings.elements.some((specifier) => !specifier.isTypeOnly)
          )
        )
      );
      if (hasRuntimeValue) valueImports.push(statement.moduleSpecifier.text);
    }
    if (
      ts.isFunctionDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
    ) {
      if (statement.name) rememberDeclaration(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          rememberDeclaration(declaration.name.text, statement);
        }
      }
    }
  }

  function visit(node: ts.Node): void {
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

  return {
    allImports,
    dynamicImports,
    exportedDeclarations,
    file,
    source,
    topLevelDeclarations,
    valueImports,
  };
}

function findInterface(shape: ModuleShape, name: string): ts.InterfaceDeclaration {
  const declaration = shape.file.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name
  );
  if (!declaration) throw new Error(`Missing interface ${name}`);
  return declaration;
}

function propertyNames(members: ts.NodeArray<ts.TypeElement>): string[] {
  return members.flatMap((member) => {
    if (!ts.isPropertySignature(member) || !member.name) return [];
    return [member.name.getText()];
  });
}

function findImageNodeJsx(shape: ModuleShape): ts.JsxSelfClosingElement {
  let match: ts.JsxSelfClosingElement | null = null;
  function visit(node: ts.Node): void {
    if (
      ts.isJsxSelfClosingElement(node)
      && ts.isIdentifier(node.tagName)
      && node.tagName.text === "StudioKonvaImageNode"
    ) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(shape.file);
  if (!match) throw new Error("Missing StudioKonvaImageNode JSX call site");
  return match;
}

function jsxAttributes(node: ts.JsxSelfClosingElement): Map<string, string | null> {
  return new Map(node.attributes.properties.flatMap((property) => {
    if (!ts.isJsxAttribute(property)) return [];
    return [[property.name.getText(), property.initializer?.getText() ?? null] as const];
  }));
}

const IMAGE_NODE_CALL_PROPS = [
  "el",
  "draggable",
  "innerRef",
  "onSelect",
  "onChange",
  "dragBoundFunc",
  "autoFitFrames",
  "onInteractionBegin",
  "onInteractionEnd",
  "liveStrokeRef",
  "onHokusaiCanonicalImageReady",
  "onLivingInkCanonicalImageReady",
  "rasterPresentationEligible",
] as const;

const IMAGE_NODE_CONTRACT_PROPS = [
  ...IMAGE_NODE_CALL_PROPS.slice(0, 10),
  "onAnimatedImageFilterStatus",
  "onHokusaiCanonicalImageReady",
  "onLivingInkCanonicalImageReady",
  "rasterPresentationEligible",
] as const;

const MOVED_DECLARATIONS = [
  "IMAGE_FILTER_BUILD_CACHE_LIMIT",
  "StudioKonvaFiltersModule",
  "StudioImageFilterWorkerClientModule",
  "ImageFilterBuild",
  "EMPTY_IMAGE_FILTER_BUILD",
  "imageFilterBuildCache",
  "studioKonvaFiltersPromise",
  "loadStudioKonvaFilters",
  "cachedBuildImageFilters",
  "StudioKonvaImageNode",
] as const;

describe("Studio Konva image node boundary", () => {
  it("moves the image renderer and its cache ownership out of StudioPage", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx");
    const viewport = moduleShape("../canvas/StudioCanvasViewportDocumentLayer.tsx");
    const imageNode = moduleShape("../StudioKonvaImageNode.tsx");

    expect(
      viewport.valueImports.filter((specifier) => specifier === "../StudioKonvaImageNode")
    ).toEqual(["../StudioKonvaImageNode"]);
    expect(viewport.source.match(/<StudioKonvaImageNode\b/gu)).toHaveLength(1);
    expect(imageNode.allImports).not.toContain("../StudioPage");
    for (const declaration of MOVED_DECLARATIONS) {
      expect(imageNode.topLevelDeclarations.has(declaration)).toBe(true);
      expect(page.topLevelDeclarations.has(declaration)).toBe(false);
    }
    expect(imageNode.exportedDeclarations.has("StudioKonvaImageNode")).toBe(true);
    expect(imageNode.exportedDeclarations.has("StudioKonvaImageNodeProps")).toBe(true);
    expect(page.source).not.toMatch(/\bUrlImage\b/u);
  });

  it("preserves the effective image call contract and its optional status observer", () => {
    const viewport = moduleShape("../canvas/StudioCanvasViewportDocumentLayer.tsx");
    const imageNode = moduleShape("../StudioKonvaImageNode.tsx");
    const contract = propertyNames(
      findInterface(imageNode, "StudioKonvaImageNodeProps").members
    );
    const attributes = jsxAttributes(findImageNodeJsx(viewport));

    expect(contract).toEqual(IMAGE_NODE_CONTRACT_PROPS);
    expect([...attributes.keys()]).toEqual(IMAGE_NODE_CALL_PROPS);
    expect(attributes.get("el")).toBe("{effectiveEl}");
    expect(attributes.get("draggable")).toBe("{draggable}");
    expect(attributes.get("innerRef")).toBe("{setRef}");
    expect(attributes.get("onSelect")).toBe("{onSelect}");
    expect(attributes.get("onChange")).toContain("patchElementAfterDragRestore(el.id, patch)");
    expect(attributes.get("dragBoundFunc")).toBe("{snapBoundFunc}");
    expect(attributes.get("autoFitFrames")).toBe("{autoFitFrames}");
    expect(attributes.get("onInteractionBegin")).toContain("nodeInteractionBegin(el.id)");
    expect(attributes.get("onInteractionEnd")).toBe("{endLiveResourceEdit}");
    expect(attributes.get("liveStrokeRef")).toBe("{drawingRef}");
    expect(attributes.get("onHokusaiCanonicalImageReady"))
      .toBe("{onHokusaiCanonicalImageReady}");
    expect(attributes.get("onLivingInkCanonicalImageReady"))
      .toBe("{onLivingInkCanonicalImageReady}");
    expect(attributes.get("rasterPresentationEligible"))
      .toBe("{!isNonInteractiveRender}");
  });

  it("keeps filters and the worker behind literal image-node intent boundaries", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx");
    const imageNode = moduleShape("../StudioKonvaImageNode.tsx");

    expect(imageNode.dynamicImports).toEqual([
      "./render/studio-konva-filters",
      "./render/studio-raster-source-lease",
      "./studio-image-filter-worker-client",
      // M1 GPU 필터 경로 — Worker 디스패치 앞에서 시도하는 지연 청크(폴백은 기존 Worker).
      "./render/studio-gpu-filter-apply",
    ]);
    expect(
      page.dynamicImports.filter((specifier) =>
        specifier === "./render/studio-konva-filters"
        || specifier === "./studio-image-filter-worker-client"
      )
    ).toEqual([]);
    expect(imageNode.valueImports).toContain("./render/studio-konva-runtime");
    expect(imageNode.valueImports).toContain("react-konva/lib/ReactKonvaCore");
    expect(imageNode.valueImports).not.toContain("konva/lib/Core");
    expect(
      imageNode.valueImports.some((specifier) => specifier.startsWith("konva/lib/shapes/"))
    ).toBe(false);
  });

  it("retains cache, worker abort, GIF, retained-source flip, and auto-fit mechanics", () => {
    const source = moduleShape("../StudioKonvaImageNode.tsx").source;

    expect(source).toContain("const IMAGE_FILTER_BUILD_CACHE_LIMIT = 200;");
    expect(source).toContain("const imageFilterBuildCache = new Map<string, ImageFilterBuild>();");
    expect(source).toContain("mod.registerStudioKonvaFilters(KonvaRuntime);");
    expect(source).toContain("controller.abort();");
    expect(source).toContain(
      "const filterRequestAtRef = useRef(Number.NEGATIVE_INFINITY);"
    );
    expect(source).toContain("cancelFrame: (id) => globalThis.cancelAnimationFrame(id)");
    expect(source).toContain("if (el.frames && el.frames.length > 1) return;");
    expect(source).toContain("isPenDown: () => !!liveStrokeRef?.current");
    expect(source).toContain("function createStudioRasterFlippedDisplaySource(");
    expect(source).toContain(
      'context.translate(scaleX === -1 ? width : 0, scaleY === -1 ? height : 0);'
    );
    expect(source).toContain("context.scale(scaleX, scaleY);");
    expect(source).toContain("context.drawImage(source, 0, 0);");
    expect(source).toContain(
      "commitDisplayImage(createStudioRasterFlippedDisplaySource(img, flipped, flippedY));"
    );
    expect(source).toContain("?? currentGpuFilteredCanvas");
    expect(source).toContain(
      "? (showComputedCanvas ? visibleComputedCanvas! : displayImg)"
    );
    expect(source).toContain('layer.on("draw.studioRasterPresentation", acknowledgeAfterDraw);');
    expect(source).toContain("node.image() !== rasterPresentationSource");
    expect(source).toContain(
      "setLoadedImage((current) => current?.src === src ? undefined : current);"
    );
    expect(source).toContain('im.removeAttribute("src");');
    expect(source.indexOf('im.removeAttribute("src");')).toBeLessThan(
      source.indexOf("releaseResolvedSource?.();"),
    );
    expect(source).toContain(
      "node.cache(cachePad > 0 ? { offset: cachePad } : { pixelRatio: filterDensity });"
    );
    expect(source).toContain("computePanelAutoFitPatch(");
    expect(source).toContain("onInteractionEnd?.();");
  });

  it("keeps the HiDPI supersample density gated by the explicit invariant-attr allowlist", () => {
    const imageNode = moduleShape("../StudioKonvaImageNode.tsx");

    // 밀도 결정은 default-deny 화이트리스트 + 순수 함수로만 이뤄지고, 둘 다 export 되어
    // 단위 테스트(studio-konva-image-node-density.test.ts)가 실제 buildImageFilters 출력과
    // 대조한다. Worker 스냅샷과 Konva 캐시가 같은 filterDensity 를 공유해야 룩이 일치한다.
    expect(imageNode.exportedDeclarations.has("STUDIO_DENSITY_INVARIANT_FILTER_ATTRS")).toBe(true);
    expect(imageNode.exportedDeclarations.has("studioImageFilterSupersampleDensity")).toBe(true);
    expect(imageNode.source).toContain("const IMAGE_FILTER_SUPERSAMPLE_MAX = 2;");
    expect(imageNode.source).toContain("devicePixelRatio: globalThis.devicePixelRatio || 1,");
    // 슈퍼샘플 크기도 기존 인터랙티브 픽셀 예산을 그대로 지킨다(넘으면 1×로 폴백).
    expect(imageNode.source).toContain(
      "&& densifiedWidth * densifiedHeight <= IMAGE_FILTER_INTERACTIVE_MAX_PIXELS"
    );
  });
});
