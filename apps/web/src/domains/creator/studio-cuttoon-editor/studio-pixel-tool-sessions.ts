import type { Tool } from "../studio-editor-tool-model";
import type { ImageEl } from "../studio-element-model";
import type { StudioInspectorRoute } from "../studio-inspector-layout";
import type { StudioMobileSheet } from "../StudioMobileEditingDock";

/**
 * Raster retouch brush a session toggle can arm. Crop shares the raster-preparation
 * seam but keeps its own entry point on StudioPage.
 */
export type StudioPixelToolSessionToolId = "smudge" | "dodge-burn" | "wet-mix" | "liquify";

/**
 * Editor surface the pixel-tool session toggles operate on. Values are captured per
 * render (the hook is invoked in the StudioPage body). `disarmAllPixelTools` stays on
 * StudioPage as the single mutual-exclusion block — every armed tool's teardown lives
 * there, and these toggles only invoke it.
 */
export interface StudioPixelToolSessionsContext {
  readonly smudgeBusy: boolean;
  readonly smudgeActive: boolean;
  readonly setSmudgeActive: (active: boolean) => void;
  readonly liquifyBusy: boolean;
  readonly liquifyActive: boolean;
  readonly setLiquifyActive: (active: boolean) => void;
  readonly dodgeBurnBusy: boolean;
  readonly dodgeBurnActive: boolean;
  readonly setDodgeBurnActive: (active: boolean) => void;
  readonly wetMixBusy: boolean;
  readonly wetMixActive: boolean;
  readonly setWetMixActive: (active: boolean) => void;
  readonly isMobile: boolean;
  readonly disarmAllPixelTools: () => void;
  readonly ensureOrPrepareRasterRetouchTarget: (
    toolId: "crop" | StudioPixelToolSessionToolId,
    toolLabel: string,
  ) => ImageEl | null;
  readonly setTool: (tool: Tool) => void;
  readonly openInspectorRoute: (
    route: StudioInspectorRoute,
    mobileSheetTarget: StudioMobileSheet | null,
  ) => void;
  readonly announceDrawingShortcut: (message: string) => void;
}

export interface StudioPixelToolSessions {
  readonly toggleSmudgeTool: () => void;
  readonly toggleLiquifyTool: () => void;
  readonly toggleDodgeBurnTool: () => void;
  readonly toggleWetMixTool: () => void;
}

/**
 * Pixel retouch session begin/end wiring extracted from StudioPage. Behavior-identical
 * move: each toggle keeps the exact contract — busy guard first, an active tool exits
 * through the full `disarmAllPixelTools` block, target acquisition/auto-preparation
 * runs before any state is armed, and arming always goes through disarm-then-arm so
 * the mutual-exclusion invariant can never be skipped.
 */
export function useStudioPixelToolSessions(
  ctx: StudioPixelToolSessionsContext,
): StudioPixelToolSessions {
  const {
    smudgeBusy,
    smudgeActive,
    setSmudgeActive,
    liquifyBusy,
    liquifyActive,
    setLiquifyActive,
    dodgeBurnBusy,
    dodgeBurnActive,
    setDodgeBurnActive,
    wetMixBusy,
    wetMixActive,
    setWetMixActive,
    isMobile,
    disarmAllPixelTools,
    ensureOrPrepareRasterRetouchTarget,
    setTool,
    openInspectorRoute,
    announceDrawingShortcut,
  } = ctx;

  function toggleSmudgeTool() {
    if (smudgeBusy) return;
    if (smudgeActive) {
      disarmAllPixelTools();
      return;
    }
    if (!ensureOrPrepareRasterRetouchTarget("smudge", "혼합(스머지)")) return;
    disarmAllPixelTools();
    setTool("select");
    setSmudgeActive(true);
    openInspectorRoute(
      { primary: "properties", image: "retouch" },
      isMobile ? "props" : null,
    );
    announceDrawingShortcut("혼합(스머지) · 이미지 위를 드래그하세요");
  }

  function toggleLiquifyTool() {
    if (liquifyBusy) return;
    if (liquifyActive) {
      disarmAllPixelTools();
      return;
    }
    if (!ensureOrPrepareRasterRetouchTarget("liquify", "리퀴파이")) return;
    disarmAllPixelTools();
    setTool("select");
    setLiquifyActive(true);
    openInspectorRoute(
      { primary: "properties", image: "retouch" },
      isMobile ? "props" : null,
    );
    announceDrawingShortcut("리퀴파이 · 이미지 위를 밀어 보세요");
  }

  function toggleDodgeBurnTool() {
    if (dodgeBurnBusy) return;
    if (dodgeBurnActive) {
      disarmAllPixelTools();
      return;
    }
    if (!ensureOrPrepareRasterRetouchTarget("dodge-burn", "닷지/번")) return;
    disarmAllPixelTools();
    setTool("select");
    setDodgeBurnActive(true);
    openInspectorRoute(
      { primary: "properties", image: "retouch" },
      isMobile ? "props" : null,
    );
    announceDrawingShortcut("닷지/번 · 이미지 위를 드래그하세요");
  }

  function toggleWetMixTool() {
    if (wetMixBusy) return;
    if (wetMixActive) {
      disarmAllPixelTools();
      return;
    }
    if (!ensureOrPrepareRasterRetouchTarget("wet-mix", "혼색 브러시")) return;
    disarmAllPixelTools();
    setTool("select");
    setWetMixActive(true);
    openInspectorRoute(
      { primary: "properties", image: "retouch" },
      isMobile ? "props" : null,
    );
    announceDrawingShortcut("혼색 브러시 · 바닥색을 섞어가며 칠해 보세요");
  }

  return {
    toggleSmudgeTool,
    toggleLiquifyTool,
    toggleDodgeBurnTool,
    toggleWetMixTool,
  };
}
