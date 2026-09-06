import { describe, expect, it } from "vitest";

import {
  planStudioBg3dProductionWorkflow,
  type StudioBg3dProductionSceneSummary,
  type StudioBg3dProductionWorkflowBatchSnapshot,
} from "./studio-bg3d-production-workflow";

const READY_SCENE: StudioBg3dProductionSceneSummary = Object.freeze({
  nodeCount: 4,
  visibleNodeCount: 4,
  lockedNodeCount: 1,
  primitiveNodeCount: 3,
  modelNodeCount: 1,
  attachmentCount: 1,
  selectedNodeCount: 1,
  posedModelCount: 1,
  animatedModelCount: 0,
  constrainedModelCount: 1,
  activeShotId: "shot-a",
  lineOutputEnabled: true,
  lineArtPreview: true,
  toneMode: "cel",
  transparentBackground: true,
});

const READY_BATCH: StudioBg3dProductionWorkflowBatchSnapshot = Object.freeze({
  selectedShotCount: 2,
  availablePassCount: 7,
  selectedPassCount: 5,
  recoveryReady: true,
  blockedReason: null,
  isRendering: false,
});

describe("Studio BG3D production workflow planner", () => {
  it("blocks downstream work when the scene is empty", () => {
    const plan = planStudioBg3dProductionWorkflow({
      sceneSummary: {
        ...READY_SCENE,
        nodeCount: 0,
        visibleNodeCount: 0,
        primitiveNodeCount: 0,
        modelNodeCount: 0,
        attachmentCount: 0,
        selectedNodeCount: 0,
        posedModelCount: 0,
        constrainedModelCount: 0,
        activeShotId: null,
      },
      shotCount: 0,
      batch: {
        ...READY_BATCH,
        selectedShotCount: 0,
        selectedPassCount: 0,
      },
      canToggleLineArtPreview: true,
    });

    expect(plan.stages.find((stage) => stage.id === "scene")?.status).toBe("blocked");
    expect(plan.stages.find((stage) => stage.id === "shot")?.status).toBe("blocked");
    expect(plan.nextAction.kind).toBe("none");
    expect(plan.blockingReason).toContain("프리미티브");
  });

  it("guides the first production cut before export setup", () => {
    const plan = planStudioBg3dProductionWorkflow({
      sceneSummary: READY_SCENE,
      shotCount: 0,
      batch: {
        ...READY_BATCH,
        selectedShotCount: 0,
      },
      canToggleLineArtPreview: true,
    });

    expect(plan.nextAction.kind).toBe("capture-shot");
    expect(plan.nextAction.label).toContain("첫 컷");
  });

  it("selects shots and manuscript passes in deterministic order", () => {
    const selectShotsPlan = planStudioBg3dProductionWorkflow({
      sceneSummary: READY_SCENE,
      shotCount: 2,
      batch: {
        ...READY_BATCH,
        selectedShotCount: 0,
        selectedPassCount: 0,
      },
      canToggleLineArtPreview: true,
    });
    expect(selectShotsPlan.nextAction.kind).toBe("select-all-shots");

    const selectPassesPlan = planStudioBg3dProductionWorkflow({
      sceneSummary: READY_SCENE,
      shotCount: 2,
      batch: {
        ...READY_BATCH,
        selectedPassCount: 0,
      },
      canToggleLineArtPreview: true,
    });
    expect(selectPassesPlan.nextAction.kind).toBe("apply-manuscript-preset");
  });

  it("requests a line-art check only after the batch is otherwise ready", () => {
    const plan = planStudioBg3dProductionWorkflow({
      sceneSummary: {
        ...READY_SCENE,
        lineOutputEnabled: false,
        lineArtPreview: false,
        toneMode: "none",
      },
      shotCount: 2,
      batch: READY_BATCH,
      canToggleLineArtPreview: true,
    });

    expect(plan.stages.find((stage) => stage.id === "look")?.status).toBe("attention");
    expect(plan.nextAction.kind).toBe("enable-line-preview");
  });

  it("starts the canonical export only when every required gate is ready", () => {
    const plan = planStudioBg3dProductionWorkflow({
      sceneSummary: READY_SCENE,
      shotCount: 2,
      batch: READY_BATCH,
      canToggleLineArtPreview: true,
    });

    expect(plan.exportReady).toBe(true);
    expect(plan.nextAction.kind).toBe("start-export");
    expect(plan.nextAction.label).toContain("2컷 · 5패스");
    expect(plan.progressPercent).toBe(100);
  });

  it("locks orchestration while a recoverable batch is running", () => {
    const plan = planStudioBg3dProductionWorkflow({
      sceneSummary: READY_SCENE,
      shotCount: 2,
      batch: {
        ...READY_BATCH,
        isRendering: true,
      },
      canToggleLineArtPreview: true,
    });

    expect(plan.stages.find((stage) => stage.id === "output")?.status).toBe("working");
    expect(plan.nextAction.kind).toBe("none");
    expect(plan.nextAction.label).toContain("진행 중");
  });
});
