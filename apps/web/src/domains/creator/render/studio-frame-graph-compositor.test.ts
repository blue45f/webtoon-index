import { describe, expect, it, vi } from "vitest";

import { lowerStudioElementsToRenderScene } from "./studio-document-scene-lower";
import { StudioFrameGraphCompositor } from "./studio-frame-graph-compositor";
import { STUDIO_VELLO_CLASSIC_BACKEND_ID } from "./studio-vello-hub";

import type { El } from "../studio-element-model";
import type { StudioVelloHub, StudioVelloHubRenderReceipt } from "./studio-vello-hub";

function receipt(): StudioVelloHubRenderReceipt {
  return {
    requestId: 1,
    primarySurfaceOwner: "vello-hub",
    islandScope: "document-vector-hybrid",
    backendId: STUDIO_VELLO_CLASSIC_BACKEND_ID,
    decision: "gpu-first",
    expectedGainPct: null,
    referenceOnly: false,
    admissionMode: "selected-gpu-provider",
    productWidePromoted: false,
  };
}

describe("StudioFrameGraphCompositor", () => {
  it("plans Classic path islands and never requests interactive CPU readback", async () => {
    const document = lowerStudioElementsToRenderScene(
      [{
        id: "panel",
        type: "frame",
        x: 0,
        y: 0,
        width: 80,
        height: 40,
        stroke: "#111111",
        strokeWidth: 3,
      } as El],
      { width: 120, height: 40 },
    );
    const compositor = new StudioFrameGraphCompositor();
    const graph = compositor.compile({ document });
    expect(graph.version).toBe(13);
    expect(graph.passes.some((pass) => pass.kind === "vello-classic")).toBe(true);
    expect(graph.passes.at(-1)?.kind).toBe("present");
    expect(graph.islands.every((island) => island.transport !== "cpu-readback")).toBe(true);
    expect(graph.islands.every((island) => !("fallbackChain" in island))).toBe(true);

    const hub = {
      render: vi.fn(async () => receipt()),
    } as unknown as StudioVelloHub;
    const executed = await compositor.execute(hub, {
      document,
      presentScene: {
        version: 11,
        width: document.width,
        height: document.height,
        background: { r: 0, g: 0, b: 0, a: 0 },
        nodes: document.nodes.filter((node) =>
          node.kind === "fill-path" || node.kind === "stroke-path",
        ),
      },
      ownedDocumentIds: ["panel"],
    });
    expect(executed.visibleCanvasCount).toBe(1);
    expect(executed.ownedDocumentIds).toEqual(["panel"]);
    expect(executed.interactiveCpuReadback).toBe(0);
    expect(executed.providerHints).toContain("vello-classic");
    expect(hub.render).toHaveBeenCalled();
    compositor.dispose();
  });

  it("parks an explicit empty present scene instead of submitting document islands", async () => {
    const document = lowerStudioElementsToRenderScene(
      [{
        id: "panel",
        type: "frame",
        x: 0,
        y: 0,
        width: 80,
        height: 40,
        stroke: "#111111",
        strokeWidth: 3,
      } as El],
      { width: 120, height: 40 },
    );
    const compositor = new StudioFrameGraphCompositor();
    const hub = {
      render: vi.fn(async () => receipt()),
    } as unknown as StudioVelloHub;
    const executed = await compositor.execute(hub, {
      document,
      presentScene: {
        version: 11,
        width: 400,
        height: 320,
        background: { r: 0, g: 0, b: 0, a: 0 },
        nodes: [],
      },
      ownedDocumentIds: [],
    });
    expect(executed.visibleCanvasCount).toBe(0);
    expect(hub.render).not.toHaveBeenCalled();
    compositor.dispose();
  });
});
