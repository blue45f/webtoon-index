import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  saveStudioMobileImmersivePreference,
  shouldStartStudioMobileImmersive,
  STUDIO_MOBILE_IMMERSIVE_SESSION_KEY,
} from "./studio-mobile-immersive";


const studioPageSource = readStudioCuttoonEditorSource();
const studioCanvasViewportSource = readStudioCanvasViewportStack(import.meta.url, "./canvas/");
// 2026-08-21 intentional: the desktop stage HUD (the status bar this test's desktop-lane guard
// reads) moved verbatim out of StudioCanvasViewport.tsx into its own leaf module.
const studioCanvasStageHudSource = readFileSync(
  new URL("./canvas/StudioCanvasStageHud.tsx", import.meta.url),
  "utf8",
);
const studioMobileEditingDockSource = readFileSync(
  new URL("./StudioMobileEditingDock.tsx", import.meta.url),
  "utf8",
);
const studioChromeSource = readFileSync(new URL("./studio-chrome-ui.tsx", import.meta.url), "utf8");
const studioGlobalsSource = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(STUDIO_MOBILE_IMMERSIVE_SESSION_KEY, initial);
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("Studio mobile immersive preference", () => {
  it("starts in the dedicated drawing shell by default", () => {
    expect(shouldStartStudioMobileImmersive(memoryStorage())).toBe(true);
    expect(shouldStartStudioMobileImmersive(null)).toBe(true);
  });

  it("remembers an explicit exit for the current browser session", () => {
    const storage = memoryStorage();
    saveStudioMobileImmersivePreference(storage, false);
    expect(shouldStartStudioMobileImmersive(storage)).toBe(false);

    saveStudioMobileImmersivePreference(storage, true);
    expect(shouldStartStudioMobileImmersive(storage)).toBe(true);
  });

  it("fails open when session storage is unavailable", () => {
    const blocked = {
      getItem(): string | null {
        throw new Error("blocked");
      },
      setItem(): void {
        throw new Error("blocked");
      },
    };

    expect(shouldStartStudioMobileImmersive(blocked)).toBe(true);
    expect(() => saveStudioMobileImmersivePreference(blocked, false)).not.toThrow();
  });

  it("uses one adaptive canvas lane instead of stacking duplicate mobile chrome", () => {
    expect(studioPageSource).toContain('mobileImmersive && "max-lg:hidden"');
    expect(studioPageSource).toContain('"lg:hidden"');
    expect(studioPageSource).not.toContain("lg:h-0 lg:w-0 lg:overflow-visible");
    expect(studioCanvasStageHudSource).toContain("!canvasOnlyMode && !isMobile");
    expect(studioPageSource).toContain("<StudioMobileEditingDock");
    expect(studioMobileEditingDockSource).toContain('data-studio-mobile-editing-dock="true"');
    expect(studioMobileEditingDockSource).toContain('data-studio-canvas-transient="coach"');
    expect(studioPageSource).toContain("!hasAutosave &&");
    expect(studioPageSource).toContain("drawingShortcutNotice === null");
    expect(studioPageSource).toContain('data-studio-mobile-canvas-workspace={isMobile ? "true" : undefined}');
    expect(studioCanvasViewportSource).toContain(
      'data-studio-mobile-dock-safe-area={isMobile ? "true" : undefined}',
    );
    expect(studioGlobalsSource).toContain("--studio-canvas-bottom-inset");
  });

  it("keeps compact desktop HUD actions named and at least 24px tall", () => {
    expect(studioCanvasStageHudSource).toContain(
      'className="inline-flex min-h-6 min-w-0 items-center gap-1 rounded-full px-1.5',
    );
    expect(studioCanvasStageHudSource).toContain(
      'localizeText(t, "` · 캔버스만 보기", "studio.canvas.canvasOnlyModeShowCanvasOnly")',
    );
    expect(studioCanvasStageHudSource).toContain(
      'className="min-h-6 min-w-6 rounded-full px-1.5 py-0.5',
    );
  });

  it("clears a temporary inspector override when entering the super-simple layout", () => {
    const preferencesSource = readFileSync(
      new URL(
        "./studio-cuttoon-editor/runtime/useStudioPreferencesRuntime.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const densitySetter = preferencesSource.slice(
      preferencesSource.indexOf("const setStudioUiDensity ="),
      preferencesSource.indexOf("const commitAppSettings ="),
    );
    expect(densitySetter).toContain('if (mode === "focus") closeRightPanelForFocusModeRef.current();');
    // The host owns the panel state the runtime hook closes over.
    const hostCloser = studioPageSource.slice(
      studioPageSource.indexOf("const closeStudioRightPanelForFocusMode ="),
    );
    expect(hostCloser.slice(0, 200)).toContain("setForceRightPanelOpen(false);");
  });

  it("keeps every 320px dock target at 44px and scrolls only the two tool rows", () => {
    expect(studioChromeSource).toContain(
      '"flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center',
    );
    expect(studioMobileEditingDockSource).toContain('data-studio-mobile-dock-scroll="primary"');
    expect(studioMobileEditingDockSource).toContain('data-studio-mobile-dock-scroll="secondary"');
    expect(studioMobileEditingDockSource).toContain(
      'data-studio-mobile-dock-expanded={workspaceDockExpanded ? "true" : "false"}',
    );
    expect(studioMobileEditingDockSource).toContain("hidden={!workspaceDockExpanded}");
    expect(studioMobileEditingDockSource).toContain('data-studio-mobile-workspace-toggle="true"');
    expect(studioMobileEditingDockSource).toContain(
      'data-studio-mobile-control-side={mobileControlSide}',
    );
    expect(studioMobileEditingDockSource).toContain(
      'data-studio-mobile-quick-actions-slot="left"',
    );
    expect(studioMobileEditingDockSource).toContain(
      'data-studio-mobile-quick-actions-slot="right"',
    );
    expect(studioMobileEditingDockSource).toContain(
      'workspaceState.mobileControlSide === "left" ? "left" : "right"',
    );
    expect(studioMobileEditingDockSource).toContain("min-h-11 min-w-11");
    expect(studioMobileEditingDockSource.match(/touch-pan-x/g)).toHaveLength(2);
    expect(studioMobileEditingDockSource).toContain("gap-0.5 overflow-x-auto");
    expect(studioMobileEditingDockSource).toContain("gap-0 overflow-x-auto");
    expect(studioGlobalsSource).toContain("[data-studio-mobile-dock-scroll] :focus-visible");
    expect(studioGlobalsSource).toContain("outline-offset: -2px");
  });

  it("overlays one dock row by default and keeps its final canvas pixels scroll-reachable", () => {
    expect(studioGlobalsSource).toContain("--studio-mobile-dock-compact-height: calc(3.5rem");
    expect(studioGlobalsSource).toContain("--studio-mobile-dock-expanded-height: calc(7rem");
    expect(studioGlobalsSource).toContain('data-studio-mobile-dock-expanded="false"');
    expect(studioGlobalsSource).toContain('[data-studio-mobile-canvas-workspace="true"]');
    expect(studioGlobalsSource).toContain("padding-bottom: 0 !important");
    expect(studioGlobalsSource).toContain(
      '[data-studio-canvas-viewport][data-studio-mobile-dock-safe-area="true"]',
    );
    expect(studioGlobalsSource).toContain(
      "padding-bottom: var(--studio-canvas-bottom-inset)",
    );
    expect(studioGlobalsSource).toContain(
      "scroll-padding-bottom: calc(var(--studio-canvas-bottom-inset) + 0.75rem)",
    );
    expect(studioGlobalsSource).toContain("min-height: 100svh");
    expect(studioGlobalsSource).toContain("height: 100dvh");
    expect(studioGlobalsSource).toContain(
      '[data-studio-editor="true"][data-studio-mobile-immersive="true"]',
    );
    expect(studioGlobalsSource).toContain('[data-studio-app-menubar="true"]');
    expect(studioGlobalsSource).toContain("position: absolute");
    // 의도적 변경(2026-07-24): 고정 14rem 캡이 게시하기 버튼을 클립해 콘텐츠 기반 폭으로 교체.
    expect(studioGlobalsSource).toContain("width: fit-content");
    // 의도적 변경(2026-07-24): 몰입 필은 셸 safe-area 패딩 위 둥근 칩 — 이중 top inset 제거,
    // overflow visible + 실간격으로 종료/임시저장/게시 겹침 방지.
    expect(studioGlobalsSource).toContain("border-radius: 9999px");
    expect(studioGlobalsSource).toContain("overflow: visible");
    expect(studioGlobalsSource).toContain("padding-top: 2.75rem");
  });
});
