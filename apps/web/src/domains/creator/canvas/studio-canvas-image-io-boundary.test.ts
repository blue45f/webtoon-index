import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleShape {
  readonly imports: readonly string[];
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly topLevelDeclarations: ReadonlySet<string>;
  readonly exportedDeclarations: ReadonlySet<string>;
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
  const sourceFile = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const imports: string[] = [];
  const topLevelDeclarations = new Set<string>();
  const exportedDeclarations = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      topLevelDeclarations.add(statement.name.text);
      if (declarationIsExported(statement)) exportedDeclarations.add(statement.name.text);
    }
  }

  return { imports, source, sourceFile, topLevelDeclarations, exportedDeclarations };
}

function callCount(sourceFile: ts.SourceFile, name: string): number {
  let count = 0;
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === name
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return count;
}

const MOVED_FUNCTIONS = [
  "studioCanvasDecodedPixelLimit",
  "assertStudioCanvasDecodedImageSize",
  "downscaleImageFile",
  "readGifFileAsDataUrl",
  "loadImageFileForCanvas",
  "downscaleDataUrl",
  "createPixelEditCanvas",
  "loadPixelEditImage",
] as const;

describe("Studio canvas image I/O module boundary", () => {
  it("owns the browser image and pixel helpers outside StudioPage", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx");
    const runtimeHelpers = moduleShape("../studio-legacy-editor-runtime-helpers.ts");
    const imageIo = moduleShape("./studio-canvas-image-io.ts");

    for (const name of MOVED_FUNCTIONS) {
      expect(imageIo.topLevelDeclarations.has(name)).toBe(true);
      expect(imageIo.exportedDeclarations.has(name)).toBe(true);
      expect(page.topLevelDeclarations.has(name)).toBe(false);
    }
    expect(page.imports).not.toContain("./studio-canvas-image-io");
    expect(runtimeHelpers.source.match(/import\(\s*"\.\/canvas\/studio-canvas-image-io"\s*\)/gu)).toHaveLength(1);
  });

  it("keeps the extracted module independent from React, Konva, and StudioPage", () => {
    const imageIo = moduleShape("./studio-canvas-image-io.ts");

    expect(imageIo.imports).toEqual([
      "../studio-gif-element",
      "../studio-upload-image-safety",
      "../render/studio-raster-interchange",
    ]);
    expect(imageIo.source.match(/import\(\s*"\.\.\/render\/studio-raster-interchange-worker-client"\s*\)/gu)).toHaveLength(1);
    expect(imageIo.source).not.toContain("const { decodeStudioRasterInterchange }");
    expect(imageIo.source).toMatch(
      /decodeStudioRasterInterchangeAsync\([\s\S]*?\{\s*executionMode:\s*"worker"\s*\}\s*,?\s*\)/u,
    );
    expect(imageIo.imports).not.toContain("../StudioPage");
    expect(imageIo.imports.some((specifier) => specifier === "react" || specifier.includes("konva"))).toBe(false);
  });

  it("preserves every StudioPage consumer call after extraction", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx");

    // 의도적 변경(2026-08-21, B-15): 에셋 업로드 핸들러(onUploadAsset)가
    // studio-cuttoon-editor/studio-asset-library-mutations.ts 로 추출되며 그 안의 load 1회가
    // 함께 이동 — StudioPage 4 → 3, 추출 모듈 1.
    // 의도적 변경(2026-09-01): 클립보드 이미지 페이스트 핸들러가
    // studio-page-clipboard-controller.ts 로 추출되며 그 안의 load 1회가
    // 함께 이동 — StudioPage 3 → 2, 클립보드 모듈 1.
    expect(callCount(page.sourceFile, "loadStudioCanvasImageFile")).toBe(2);
    const clipboardController = moduleShape("../studio-page-clipboard-controller.ts");
    expect(callCount(clipboardController.sourceFile, "loadStudioCanvasImageFile")).toBe(1);
    const assetLibraryMutations = moduleShape(
      "../studio-cuttoon-editor/studio-asset-library-mutations.ts"
    );
    expect(callCount(assetLibraryMutations.sourceFile, "loadStudioCanvasImageFile")).toBe(1);
    // 의도적 변경(2026-08, B-09): 저장 커버 축소(downscaleStudioCanvasDataUrl)는 handleSave
    // 오케스트레이션과 함께 studio-page-save-pipeline.ts 로 이동했다 — 호출 수는 1로 보존.
    const savePipeline = moduleShape("../studio-page-save-pipeline.ts");
    expect(callCount(page.sourceFile, "downscaleStudioCanvasDataUrl")).toBe(0);
    expect(callCount(savePipeline.sourceFile, "downscaleStudioCanvasDataUrl")).toBe(1);
    // 의도적 변경(2026-07-24): 필터 마스크 페인팅 툴 배선 — bake/add/invert 3개 액션이 레이어
    // 마스크와 대칭으로 이미지 로드·픽셀 캔버스를 재사용(loadStudioPixelEditImage 17 → 22,
    // createStudioPixelEditCanvas 20 → 23).
    // 의도적 변경(2026-07-24): 선택 픽셀 → 새 레이어 복사/오려내기 추가 —
    // loadStudioPixelEditImage 22 → 23, createStudioPixelEditCanvas 23 → 26(마스크·추출·삭제).
    // 의도적 변경(2026-07-24): 선택 → 레이어 마스크 만들기 추가 — 24 / 28.
    // 의도적 변경(2026-07-31): 3D Magic Layer의 공동 편집 필터 마스크 표면 게시가
    // 캡처된 PNG를 검증 가능한 픽셀 표면으로 변환한다 — 25 / 29.
    // 의도적 변경(2026-08-03): 선택 영역 안/밖 필터 적용이 원본 이미지 크기를 읽고
    // 선택 마스크 캔버스를 만들어 비파괴 transaction을 만든다 — load 25 → 26 / canvas 29 → 30.
    // 의도적 변경(2026-08-09): liquify/dodge/wet-mix/heal-clone은 취소 가능한 retouch loader로
    // 이동했다. 네 호출은 유지하되 일반 pixel-edit loader 소유권에서는 제외한다(26 → 22).
    // 의도적 변경(2026-08-12): liquify live warp preview caches the source via the same
    // retouch loader (4 → 5) and reuses createStudioPixelEditCanvas for live bakes
    // (30 → 32: frame downscale path + ROI full-res path) so drop-frame previews stay on
    // the shared pixel-edit factory.
    // 의도적 변경(2026-08-20): 확장 블렌드 병합이 layer/studio-layer-operations 로 추출되며
    // 그 안의 load 1회 / canvas 2회가 함께 이동 — load 20 → 19, canvas 30 → 28.
    expect(callCount(page.sourceFile, "loadStudioPixelEditImage")).toBe(19);
    expect(callCount(page.sourceFile, "loadStudioRetouchSourceImage")).toBe(5);
    expect(page.source.match(/\bcreateStudioPixelEditCanvas\b/gu)).toHaveLength(28);
    const layerOperations = moduleShape("../layer/studio-layer-operations.ts");
    expect(callCount(layerOperations.sourceFile, "loadStudioPixelEditImage")).toBe(1);
    expect(layerOperations.source.match(/\bcreateStudioPixelEditCanvas\b/gu)).toHaveLength(3);
    expect(page.source).not.toContain('from "../studio-gif-element"');
    expect(page.source).not.toContain('from "../studio-upload-image-safety"');
  });
});
