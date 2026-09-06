// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StudioRenderSurface,
  type StudioRenderSurfaceAuthority,
} from "./StudioRenderSurface";

import type { El } from "../studio-element-model";
import type { StudioVelloHub } from "./studio-vello-hub";
import type { StudioVelloHubCanvasTarget } from "./studio-vello-hub-canvas-target";

const mocks = vi.hoisted(() => ({
  createHub: vi.fn(),
  createTarget: vi.fn(),
}));

vi.mock("./studio-vello-hub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./studio-vello-hub")>();
  return { ...actual, createStudioVelloHub: mocks.createHub };
});

vi.mock("./studio-vello-hub-canvas-target", () => ({
  createStudioVelloHubCanvasTarget: mocks.createTarget,
}));

const cleanRect = {
  id: "clean-rect",
  type: "draw",
  kind: "rect",
  mode: "pen",
  points: [8, 8, 72, 48],
  stroke: "#112233",
  strokeWidth: 3,
  fill: "#ffffff",
} as El;

describe("StudioRenderSurface authority", () => {
  let renderHub: ReturnType<typeof vi.fn>;
  let destroyTarget: ReturnType<typeof vi.fn>;
  let concealTarget: ReturnType<typeof vi.fn>;
  let invalidateHub: ReturnType<typeof vi.fn>;
  let targetCanvas: HTMLCanvasElement;
  const sceneRevision = Object.freeze({ id: "scene-a" });

  beforeEach(() => {
    renderHub = vi.fn();
    destroyTarget = vi.fn();
    concealTarget = vi.fn(() => {
      targetCanvas.style.display = "none";
    });
    invalidateHub = vi.fn();
    targetCanvas = document.createElement("canvas");
    targetCanvas.style.display = "none";
    mocks.createTarget.mockReturnValue({
      canvas: targetCanvas,
      activeBackendId: null,
      setIsland: vi.fn(),
      park: vi.fn(),
      conceal: concealTarget,
      destroy: destroyTarget,
    } as unknown as StudioVelloHubCanvasTarget);
    mocks.createHub.mockReturnValue({
      render: renderHub,
      invalidatePendingProductRender: invalidateHub,
      dispose: vi.fn(),
    } as unknown as StudioVelloHub);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("keeps Vello ownership ids and reports unavailable when product rendering fails", async () => {
    renderHub.mockRejectedValue(new Error("GPUDevice lost"));
    const authorities: StudioRenderSurfaceAuthority[] = [];
    const mountParent = document.createElement("div");
    document.body.append(mountParent);

    render(
      <StudioRenderSurface
        enabled
        mountParent={mountParent}
        width={100}
        height={80}
        documentWidth={100}
        documentHeight={80}
        dpr={1}
        elements={[cleanRect]}
        sceneRevision={sceneRevision}
        onAuthorityChange={(authority) => authorities.push(authority)}
      />,
    );

    await waitFor(() => {
      expect(authorities.at(-1)).toMatchObject({
        status: "unavailable",
        reason: "GPUDevice lost",
        sceneRevision,
        ownedDocumentIds: ["clean-rect"],
        visibleCanvasCount: 0,
      });
    });
    expect(concealTarget).toHaveBeenCalled();
    expect(invalidateHub).toHaveBeenCalled();
    expect(destroyTarget).not.toHaveBeenCalled();
  });

  it("declares mixed pages as legacy before work instead of treating them as runtime failure", async () => {
    const authorities: StudioRenderSurfaceAuthority[] = [];
    const mountParent = document.createElement("div");
    document.body.append(mountParent);
    const text = {
      id: "lettering",
      type: "text",
      x: 8,
      y: 8,
      width: 40,
      height: 16,
      text: "대사",
      fontSize: 14,
      fill: "#000000",
      rotation: 0,
    } as El;

    render(
      <StudioRenderSurface
        enabled
        mountParent={mountParent}
        width={100}
        height={80}
        documentWidth={100}
        documentHeight={80}
        dpr={1}
        elements={[text]}
        sceneRevision={sceneRevision}
        onAuthorityChange={(authority) => authorities.push(authority)}
      />,
    );

    await waitFor(() => {
      expect(authorities.at(-1)).toMatchObject({
        status: "legacy",
        reason: "explicit-legacy-document-boundary",
        sceneRevision,
        ownedDocumentIds: [],
        visibleCanvasCount: 0,
      });
    });
    expect(renderHub).not.toHaveBeenCalled();
  });
});
