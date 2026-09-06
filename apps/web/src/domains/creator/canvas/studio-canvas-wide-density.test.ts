import { describe, expect, it } from "vitest";

import {
  resolveStudioCanvasWideDensityMode,
  isStudioCanvasWideWorkspace,
} from "./studio-canvas-wide-density";

describe("studio canvas-wide workspace density policy", () => {
  it("uses focus mode for desktop canvas-first workspaces", () => {
    expect(resolveStudioCanvasWideDensityMode({
      isMobile: false,
      uiDensityMode: "full",
      activeWorkspaceId: "lineart",
    })).toBe("focus");

    expect(resolveStudioCanvasWideDensityMode({
      isMobile: false,
      uiDensityMode: "full",
      activeWorkspaceId: "storyboard",
    })).toBe("focus");
  });

  it("does not force focus mode for non canvas-first workspaces", () => {
    expect(resolveStudioCanvasWideDensityMode({
      isMobile: false,
      uiDensityMode: "simple",
      activeWorkspaceId: "review",
    })).toBe("simple");

    expect(resolveStudioCanvasWideDensityMode({
      isMobile: false,
      uiDensityMode: "full",
      activeWorkspaceId: "publish",
    })).toBe("full");
  });

  it("keeps mobile density exactly as-is", () => {
    expect(resolveStudioCanvasWideDensityMode({
      isMobile: true,
      uiDensityMode: "full",
      activeWorkspaceId: "lineart",
    })).toBe("full");

    expect(resolveStudioCanvasWideDensityMode({
      isMobile: true,
      uiDensityMode: "focus",
      activeWorkspaceId: "review",
    })).toBe("focus");
  });

  it("classifies known workspace ids as canvas-first", () => {
    expect(isStudioCanvasWideWorkspace("vector-design")).toBe(true);
    expect(isStudioCanvasWideWorkspace("pose-3d")).toBe(true);
    expect(isStudioCanvasWideWorkspace("review")).toBe(false);
  });
});

