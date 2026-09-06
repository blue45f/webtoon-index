// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioBg3dProSuiteRuntimeContext,
  type StudioBg3dProductionBatchRuntime,
  type StudioBg3dProSuiteRuntimeValue,
} from "./studio-bg3d-pro-suite-runtime-context";
import { StudioBg3dProductionIntentPanel } from "./StudioBg3dProductionIntentPanel";

function createBatch(
  overrides: Partial<StudioBg3dProductionBatchRuntime> = {},
): StudioBg3dProductionBatchRuntime {
  return {
    selectedShotIds: ["shot-a"],
    availablePasses: [
      "beauty",
      "lt-composite",
      "color",
      "tone",
      "texture-line",
      "main-line",
      "depth",
    ],
    selectedPasses: ["beauty", "lt-composite"],
    passLabels: {
      beauty: "원본 렌더",
      "lt-composite": "LT 합성",
      color: "컬러",
      tone: "톤",
      "texture-line": "질감선",
      "main-line": "주선",
      depth: "깊이",
    },
    look: {
      lineEnabled: true,
      lineStrength: 0.8,
      textureLineEnabled: true,
      textureLineStrength: 0.5,
      toneMode: "flat",
      toneType: "color",
      toneOpacity: 1,
    },
    exportHeight: "per-shot",
    exportHeightOptions: [640, 1080, 1440, 2160, 4096],
    includeLayeredPsd: false,
    includeContactSheet: true,
    recoveryReady: true,
    blockedReason: null,
    isRendering: false,
    progress: null,
    recoverySummary: null,
    selectAllShots: vi.fn(),
    clearShotSelection: vi.fn(),
    setShotSelected: vi.fn(),
    setSelectedPasses: vi.fn(),
    setPassSelected: vi.fn(),
    setExportHeight: vi.fn(),
    setIncludeLayeredPsd: vi.fn(),
    setIncludeContactSheet: vi.fn(),
    startExport: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createRuntime(
  batch: StudioBg3dProductionBatchRuntime,
  overrides: Partial<StudioBg3dProSuiteRuntimeValue> = {},
): StudioBg3dProSuiteRuntimeValue {
  return {
    disabled: false,
    baseCamera: {
      position: [0, 1.6, 6],
      target: [0, 1.4, 0],
      fovDegrees: 45,
      projection: "perspective",
      nearClip: 0.01,
    },
    productionShots: [{ id: "shot-a", name: "첫 컷" }],
    productionBatch: batch,
    sceneSummary: {
      nodeCount: 3,
      visibleNodeCount: 3,
      lockedNodeCount: 0,
      primitiveNodeCount: 2,
      modelNodeCount: 1,
      attachmentCount: 1,
      selectedNodeCount: 1,
      posedModelCount: 1,
      animatedModelCount: 0,
      constrainedModelCount: 0,
      activeShotId: "shot-a",
      lineOutputEnabled: true,
      lineArtPreview: false,
      toneMode: "flat",
      transparentBackground: false,
    },
    onSetLineArtPreview: vi.fn(),
    onSetTransparentBackground: vi.fn(),
    onApplyCameraView: vi.fn(),
    onCaptureCurrentShot: vi.fn(),
    onApplyProductionShot: vi.fn(),
    onMoveProductionShot: vi.fn(),
    onRemoveProductionShot: vi.fn(),
    onUseCurrentFrameAsAiReference: vi.fn(),
    aiReferenceBusy: false,
    aiReferenceDisabled: false,
    ...overrides,
  };
}

function renderPanel(runtime: StudioBg3dProSuiteRuntimeValue) {
  return render(
    <StudioBg3dProSuiteRuntimeContext.Provider value={runtime}>
      <StudioBg3dProductionIntentPanel />
    </StudioBg3dProSuiteRuntimeContext.Provider>,
  );
}

describe("StudioBg3dProductionIntentPanel", () => {
  afterEach(() => cleanup());

  it("applies the manuscript intent across shots, configured passes, package and look state", () => {
    const batch = createBatch();
    const runtime = createRuntime(batch);
    renderPanel(runtime);

    fireEvent.click(screen.getByRole("button", { name: /웹툰 원고/ }));

    expect(batch.selectAllShots).toHaveBeenCalledTimes(1);
    expect(batch.setSelectedPasses).toHaveBeenCalledWith([
      "lt-composite",
      "color",
      "texture-line",
      "main-line",
    ]);
    expect(batch.setIncludeLayeredPsd).toHaveBeenCalledWith(true);
    expect(batch.setIncludeContactSheet).toHaveBeenCalledWith(true);
    expect(runtime.onSetLineArtPreview).toHaveBeenCalledWith(true);
    expect(runtime.onSetTransparentBackground).toHaveBeenCalledWith(false);
    expect(screen.getByText(/웹툰 원고 프리셋을 적용했습니다/)).toBeDefined();
  });

  it("makes transparent compositing an explicit user-selected intent", () => {
    const batch = createBatch();
    const runtime = createRuntime(batch);
    renderPanel(runtime);

    fireEvent.click(screen.getByRole("button", { name: /2D 합성/ }));

    expect(batch.setIncludeContactSheet).toHaveBeenCalledWith(false);
    expect(runtime.onSetLineArtPreview).toHaveBeenCalledWith(true);
    expect(runtime.onSetTransparentBackground).toHaveBeenCalledWith(true);
  });

  it("restores the exact shot, pass, package and look state from before a preset", () => {
    const batch = createBatch();
    const runtime = createRuntime(batch);
    renderPanel(runtime);

    fireEvent.click(screen.getByRole("button", { name: /웹툰 원고/ }));
    fireEvent.click(screen.getByRole("button", { name: "이전 설정 복원" }));

    expect(batch.clearShotSelection).toHaveBeenCalledTimes(1);
    expect(batch.setShotSelected).toHaveBeenCalledWith("shot-a", true);
    expect(batch.setSelectedPasses).toHaveBeenLastCalledWith(["beauty", "lt-composite"]);
    expect(batch.setIncludeLayeredPsd).toHaveBeenLastCalledWith(false);
    expect(batch.setIncludeContactSheet).toHaveBeenLastCalledWith(true);
    expect(runtime.onSetLineArtPreview).toHaveBeenLastCalledWith(false);
    expect(runtime.onSetTransparentBackground).toHaveBeenLastCalledWith(false);
    expect(screen.getByText("이전 제작 설정을 복원했습니다.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "이전 설정 복원" })).toBeNull();
  });

  it("marks only an exact current intent as selected", () => {
    const batch = createBatch({
      selectedPasses: ["beauty", "main-line", "depth"],
      includeLayeredPsd: false,
      includeContactSheet: false,
    });
    const runtime = createRuntime(batch, {
      sceneSummary: {
        ...createRuntime(batch).sceneSummary!,
        lineArtPreview: true,
        transparentBackground: false,
      },
    });
    renderPanel(runtime);

    expect(screen.getByRole("button", { name: /AI 참조/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /웹툰 원고/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("inherits the canonical editor lock", () => {
    const batch = createBatch();
    renderPanel(createRuntime(batch, { disabled: true }));

    for (const button of screen.getAllByRole("button")) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });
});
