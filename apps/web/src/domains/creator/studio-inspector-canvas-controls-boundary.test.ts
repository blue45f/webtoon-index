import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioInspectorAsideSurface } from "./read-studio-inspector-aside-source";

interface ModuleEdges {
  readonly imports: readonly string[];
  readonly source: string;
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
  const imports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return { imports, source };
}

describe("Studio inspector canvas-controls boundary", () => {
  it("keeps the inspector as the one-way static owner of the controlled canvas leaf", () => {
    const inspector = moduleEdges("./StudioInspectorAsideShell.tsx");
    const leaf = moduleEdges("./StudioInspectorCanvasControls.tsx");

    expect(
      inspector.imports.filter(
        (specifier) => specifier === "./StudioInspectorCanvasControls"
      )
    ).toEqual(["./StudioInspectorCanvasControls"]);
    expect(inspector.source).toContain("<StudioInspectorCanvasControls");
    expect(leaf.imports).not.toContain("./StudioInspectorAside");
    expect(leaf.imports).not.toContain("./StudioPage");
  });

  it("leaves document mutation, collaboration policy, ids, and shared notices in the parent", () => {
    const inspector = readStudioInspectorAsideSurface();
    const shell = moduleEdges("./StudioInspectorAsideShell.tsx").source;
    const leaf = moduleEdges("./StudioInspectorCanvasControls.tsx").source;

    for (const forbidden of [
      "collaborationDocumentLocked",
      "regenerateTemplate",
      "setSharedDocumentNotice",
      "commit(",
      "uid(",
    ]) {
      expect(leaf).not.toContain(forbidden);
    }
    expect(inspector).toContain("if (collaborationDocumentLocked) return;");
    expect(shell).toContain("resolveStudioTemplateGutterCapability(currentTemplate)");
    expect(inspector).toContain("regenerateTemplate(currentTemplate, nextGutter)");
    expect(inspector).toContain("commit(nextElements);");
    expect(inspector).toContain("setSharedDocumentNotice(null);");
    expect(inspector).toContain("id: uid(),");

    const handlerStart = shell.indexOf("onPanelGutterChange={withCanvasControlsGuard");
    const handler = shell.slice(handlerStart, handlerStart + 700);
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handler).toContain("if (!currentTemplate || !templateGutterCapability.supported) return;");
    expect(handler.indexOf("const nextElements = regenerateTemplate")).toBeLessThan(
      handler.indexOf("if (!nextElements) return;"),
    );
    expect(handler.indexOf("if (!nextElements) return;")).toBeLessThan(
      handler.indexOf("setPanelGutter(nextGutter);"),
    );
    expect(handler.indexOf("setPanelGutter(nextGutter);")).toBeLessThan(
      handler.indexOf("commit(nextElements);"),
    );
    expect(leaf).toContain("aria-describedby={panelGutterDisabledReason");
    expect(leaf).toContain("data-studio-panel-gutter-reason");
  });

  it("keeps authored frames when applying a template whose gutter topology is unsupported", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx").source;
    const templateController = moduleEdges(
      "./template/studio-template-layout-controller.ts"
    ).source;
    const combined = [page, templateController].join("\n");
    const applyTemplateStart = combined.indexOf("async function applyTemplate");
    const applyTemplate = combined.slice(applyTemplateStart, applyTemplateStart + 1_300);

    expect(applyTemplateStart).toBeGreaterThanOrEqual(0);
    expect(applyTemplate).toContain("regenerateTemplate(tpl, panelGutter, [])");
    expect(applyTemplate).toContain("?? instantiateTemplateFrames(tpl.frames, [])");
  });

  it("keeps the leaf bounded and compatible with the React Compiler", () => {
    const inspector = moduleEdges("./StudioInspectorAside.tsx").source;
    const leaf = moduleEdges("./StudioInspectorCanvasControls.tsx").source;

    // 의도적 확장(2026-08-12): paper surface / grain controls + async pixel-edit wiring.
    // 의도적 확장(2026-08-29): gutter 비활성 사유와 aria-describedby 연결.
    expect(leaf.split("\n").length).toBeLessThanOrEqual(580);
    // 의도적 변경(2026-07-24): 필터 마스크 페인팅 + 자동 채색 힌트 worker onRun 배선
    // (3_300 → 3_380 → 3_400).
    // 의도적 변경(2026-07-24): auto-color 새 채색 레이어 onApplyNewLayer + setSelectedId 배선
    // (3_400 → 3_480).
    // 의도적 변경(2026-07-25): live collaboration overlay & fallback glue (3_500 → 3_600).
    // 의도적 변경(2026-07-27): 공통 inspector interaction policy 배선(3_600 → 3_620).
    // 의도적 변경(2026-07-28): 선택 없는 래스터 도구 복구 경로와 패널 배선(3_620 → 3_960).
    // 의도적 변경(2026-07-29): Paper Worker 경로 정리·잠금 중 취소 배선(3_960 → 4_000).
    // 의도적 변경(2026-08-05): inspector context testid 배선(4_000 → 4_010).
    // 의도적 변경(2026-08-05): empty-state coach CTA 블록(4_010 → 4_050).
    // 의도적 변경(2026-08-07): 선택 디자인(X/Y/W/H·반전·선택 확대) 패널 배선(4_050 → 4_070).
    // 의도적 변경(2026-08-08): Wave D 점진적 노출 — Advanced 섹션 15개 래핑 + 통합 검색 호스트(4_070 → 4_130).
    // 의도적 변경(2026-08-10): V12 제품 SQLite quick-slot 권위 배선 7줄(4_130 → 4_137).
    // 의도적 변경(2026-08-11): linked-pass raster lease/read-only projection 배선 8줄.
    // 의도적 통합(2026-08-12): main의 raster preparation busy fail-closed 배선 5줄을
    // linked-pass projection과 함께 보존(4_145 → 4_150).
    // 의도적 확장(2026-08-12): paper surface catalog / async pixel-edit glue (4_150 → 4_180).
    // 의도적 확장(2026-08-14): Page가 소유한 brush repository factory 전달(4_180 → 4_190).
    // 의도적 확장(2026-08-20): CSP식 서브 도구 팔레트 배선 — subTools 슬롯 마운트 +
    // applyBuiltInBrushPreset 계약(4_190 → 4_240).
    // 의도적 확장(2026-08-20): CSP식 클릭 크기 프리셋 그리드 — StudioBrushSizePresetGrid +
    // 최근 크기 상태·슬라이더 커밋 배선(4_240 → 4_340).
    // 의도적 확장(2026-08-20): CSP 경계 효과 — 레이어 탭 StudioLayerBorderEffectPanel 마운트 +
    // 메뉴 열기 이벤트 수신 배선(4_340 → 4_370).
    expect(inspector.split("\n").length).toBeLessThanOrEqual(4_370);
    expect(leaf).not.toContain('"use no memo"');
    expect(leaf).not.toMatch(/\b(?:memo|useCallback|useMemo)\s*\(/u);
    expect(leaf).toContain("export function StudioInspectorCanvasControls(");
  });
});
