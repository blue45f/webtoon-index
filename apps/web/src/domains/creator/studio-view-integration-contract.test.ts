import { readFileSync } from "node:fs";


import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";
import { readStudioInspectorAsideSurface } from "./read-studio-inspector-aside-source";
import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const source = readStudioPageCompositionSource();
// 의도된 변경(2026-08, B-06): 전역 keydown 디스패처(보기 리졸버·flip 화음 분기 포함)가
// studio-page-shortcut-dispatcher.ts 로 추출되어, 단축키 분기 검증은 그 파일을 읽는다.
const shortcutDispatcherSource = readFileSync(
  new URL("./studio-page-shortcut-dispatcher.ts", import.meta.url),
  "utf8",
);
const viewControllerSource = readFileSync(
  new URL("./canvas/studio-page-view-controller.ts", import.meta.url),
  "utf8",
);
const viewportSource = readStudioCanvasViewportStack(import.meta.url, "./canvas/");
const canvasControlsSource = ["StudioCanvasControls.tsx", "StudioCanvasStageHud.tsx"]
  .map((name) => readFileSync(new URL(`./canvas/${name}`, import.meta.url), "utf8"))
  .join("\n");
// 의도된 변경(2026-08-21): 캔버스 스크롤 뷰포트 위에 떠 있던 sticky 배너들(에셋 드롭 힌트·프레즌스
// 독·보기 도구 HUD 호스트·댓글 핀 배너·하이드레이션 플레이스홀더)이 StudioCanvasViewport.tsx 에서
// 그대로 잘려 나와 자체 리프 모듈이 됐다. 보기 HUD 계약은 그 파일을 읽는다.
const stickyBannersSource = readFileSync(
  new URL("./canvas/StudioCanvasStickyBanners.tsx", import.meta.url),
  "utf8",
);
const inspectorSource = readStudioInspectorAsideSurface();
// The minimap scroll-window box moved out of the inspector into its own leaf so a
// pan frame re-renders one element instead of the whole aside. The invariant this
// file pins is *which projection helper* the minimap uses, not which file holds it.
const minimapViewportBoxSource = readFileSync(
  new URL("./StudioMinimapViewportBox.tsx", import.meta.url),
  "utf8",
);
const leftToolRailSource = [
  new URL("./StudioLeftToolRail.tsx", import.meta.url),
  new URL("./StudioLeftToolRailViewToolsCluster.tsx", import.meta.url),
]
  .map((url) => readFileSync(url, "utf8"))
  .join("\n");
const viewHudLoaderSource = readFileSync(
  new URL("./studio-view-tools-hud-loader.ts", import.meta.url),
  "utf8",
);
// 줌 정착(앵커 보존) 투영은 휠·핀치 제스처 엔진과 함께 추출됐다 — 헬퍼 사용 계약은 그 파일에서 본다.
const zoomEngineSource = readFileSync(
  new URL("./canvas/studio-zoom-gesture-engine.ts", import.meta.url),
  "utf8",
);

describe("StudioPage view integration contract", () => {
  it("wires the quarter-turn Stage and transformed collaboration overlay together", () => {
    expect(viewportSource).toContain("width={stageViewLayout.width}");
    expect(viewportSource).toContain("rotation={stageViewLayout.rotation}");
    expect(viewportSource).toMatch(
      /<StudioRemoteCursorOverlay[\s\S]*?rotation=\{canvasRotation\}/u,
    );
  });

  it("fails GPU raster surfaces closed while a quarter-turn view is active", () => {
    expect(source).toMatch(
      /const webGpuViewportSurface = useMemo\(\s*\(\) => canvasRotation === 0[\s\S]*?\? planStudioWebGpuViewportSurface/u
    );
  });

  it("uses the common transform helpers for every DOM-to-document coordinate path", () => {
    const viewCombinedSource = [source, viewControllerSource].join("\n");
    expect(viewCombinedSource).toContain("planStudioViewRotationTransition({");
    expect(viewCombinedSource).toContain("planStudioViewScrollToDocumentPoint({");
    expect(viewCombinedSource).toContain("projectStudioViewPointToDocument({");
    expect(zoomEngineSource).toContain("projectStudioViewPointToDocument({");
    expect(zoomEngineSource).toContain("projectStudioDocumentPointToView({");
    expect(minimapViewportBoxSource).toContain("projectStudioViewRectToDocumentRect({");
    // and the inspector must not have grown a second, hand-rolled projection.
    expect(inspectorSource).not.toMatch(/scrollPos\.(?:left|top)\s*\/\s*effScale/u);
  });

  it("keeps rotation out of automatic ResizeObserver fitting", () => {
    expect(source).toContain("w / studioViewDocumentWidthRef.current");
    expect(source).toContain(
      "[canvasOnlyMode, isFullscreen, maximized, mobileImmersive]"
    );
  });

  it("shows effective magnification and exposes an accessible rail-to-toolbar relationship", () => {
    expect(stickyBannersSource).toContain("magnification={effScale}");
    expect(leftToolRailSource).toContain('aria-controls="studio-view-tools-hud-zoom"');
    expect(leftToolRailSource).toContain('data-studio-view-tool-trigger="rotate"');
  });

  it("keeps the legacy canvas zoom cluster out of the full editor dock", () => {
    expect(canvasControlsSource).toContain(
      '"absolute bottom-3 left-3 z-30 hidden items-center gap-0.5 rounded-full',
    );
    expect(canvasControlsSource).toContain('canvasOnlyMode && "lg:flex"');
    expect(viewportSource).not.toContain('"absolute bottom-3 left-3 z-30 hidden lg:flex');
  });

  it("keeps localized actual-pixel and input-mode controls in the canvas-only cluster", () => {
    expect(canvasControlsSource).toContain("<StudioViewInputModeControls");
    expect(canvasControlsSource).toContain('"studio.canvas.actualPixelAria"');
  });

  it("loads the optional view HUD only after a zoom or rotate intent", () => {
    expect(stickyBannersSource).toContain(
      'import { StudioViewToolsHud } from "../studio-view-tools-hud-loader";',
    );
    expect(stickyBannersSource).not.toContain(
      'import { StudioViewToolsHud } from "../StudioViewToolsHud";',
    );
    expect(viewportSource).not.toContain(
      'import { StudioViewToolsHud } from "../StudioViewToolsHud";',
    );
    expect(viewHudLoaderSource).toContain('import("./StudioViewToolsHud")');
    expect(stickyBannersSource).toMatch(
      /\{viewTool \? \([\s\S]*?<Suspense fallback=\{null\}>[\s\S]*?<StudioViewToolsHud/u,
    );
  });

  it("restores focus when shortcut or capture state closes a focused view HUD", () => {
    expect(source).toContain("lastNonViewHudFocusRef");
    expect(source).toContain('target.closest("[data-studio-view-tools-hud]")');
    expect(source).toContain("if (!focusOwnedByHud || !restoreTarget) return;");
    expect(source).toContain("restoreTarget.focus({ preventScroll: true })");
    expect(source).toContain("closeViewToolWithFocusRef.current({ preferCanvas: true })");
    expect(shortcutDispatcherSource).toContain('if (viewTool === "zoom") closeViewToolWithFocus();');
    expect(shortcutDispatcherSource).toContain('if (viewTool === "rotate") closeViewToolWithFocus();');
    expect(stickyBannersSource).toContain("onClose={closeViewToolWithFocus}");
  });

  it("keeps configurable flip dispatch before the hard-coded view resolver", () => {
    const configuredFlip = shortcutDispatcherSource.indexOf('matchStudioShortcut(sc["flip-canvas"], e)');
    const hardCodedViewResolver = shortcutDispatcherSource.indexOf("resolveStudioViewShortcut(e)");
    expect(configuredFlip).toBeGreaterThan(-1);
    expect(hardCodedViewResolver).toBeGreaterThan(configuredFlip);
  });

  it("preserves the visible document center around capture-only Stage normalization", () => {
    const viewCombinedSource = [source, viewControllerSource].join("\n");
    expect(viewCombinedSource).toContain("captureSuppressedViewRef.current = captureStudioView({");
    expect(source).toContain("const viewTransformSuppressed = isExporting || saving || timelapseCapturing");
    expect(source).toContain("wrap.scrollLeft = restored.scrollLeft");
    expect(source).toContain("wrap.scrollTop = restored.scrollTop");

    // 의도된 변경(2026-08, B-09): handleSave 의 캡처 시작점(setSaving/setIsExporting)이
    // studio-page-save-pipeline.ts 로 추출돼, view 보존 계약은 두 파일을 함께 스캔한다.
    const savePipelineSource = readFileSync(
      new URL("./studio-page-save-pipeline.ts", import.meta.url),
      "utf8",
    );
    for (const captureSource of [source, savePipelineSource, viewControllerSource]) {
      const captureStarts = [
        ...captureSource.matchAll(/set(?:IsExporting|Saving|TimelapseCapturing)\(true\)/gu),
      ];
      if (captureStarts.length === 0) continue;
      for (const captureStart of captureStarts) {
        const index = captureStart.index ?? 0;
        expect(captureSource.slice(Math.max(0, index - 180), index)).toContain(
          "preserveStudioViewBeforeCapture()"
        );
      }
    }
  });
});
