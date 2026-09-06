// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioBg3dProSuiteRuntimeContext,
  type StudioBg3dProductionBatchRuntime,
  type StudioBg3dProSuiteRuntimeValue,
} from "./studio-bg3d-pro-suite-runtime-context";
import { StudioBg3dProductionPassPreflightPanel } from "./StudioBg3dProductionPassPreflightPanel";

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
    selectedPasses: ["beauty", "color", "tone", "main-line"],
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
      lineEnabled: false,
      lineStrength: 0.8,
      textureLineEnabled: true,
      textureLineStrength: 0.5,
      toneMode: "flat",
      toneType: "color",
      toneOpacity: 1,
    },
    exportHeight: "per-shot",
    exportHeightOptions: [640, 1080, 1440, 2160, 4096],
    includeLayeredPsd: true,
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
      nodeCount: 2,
      visibleNodeCount: 2,
      lockedNodeCount: 0,
      primitiveNodeCount: 1,
      modelNodeCount: 1,
      attachmentCount: 1,
      selectedNodeCount: 1,
      posedModelCount: 1,
      animatedModelCount: 0,
      constrainedModelCount: 0,
      activeShotId: "shot-a",
      lineOutputEnabled: false,
      lineArtPreview: false,
      toneMode: "flat",
      transparentBackground: false,
    },
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

function renderPreflight(runtime: StudioBg3dProSuiteRuntimeValue) {
  return render(
    <StudioBg3dProSuiteRuntimeContext.Provider value={runtime}>
      <StudioBg3dProductionPassPreflightPanel />
    </StudioBg3dProSuiteRuntimeContext.Provider>,
  );
}

describe("StudioBg3dProductionPassPreflightPanel", () => {
  afterEach(() => cleanup());

  it("explains invalid selected layers and keeps only files the current LT look can create", () => {
    const batch = createBatch();
    renderPreflight(createRuntime(batch));

    expect(screen.getByRole("heading", { name: "출력 전 LT 패스 확인" })).toBeDefined();
    expect(screen.getByText("주선")).toBeDefined();
    expect(screen.getByText("톤")).toBeDefined();
    expect(screen.getByText(/현재 톤 출력 형식이 컬러/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "유효 2개 패스만 유지" }));
    expect(batch.setSelectedPasses).toHaveBeenCalledWith(["beauty", "color"]);
  });

  it("falls back to a proven safe pass when every selected LT layer is unavailable", () => {
    const batch = createBatch({
      selectedPasses: ["main-line"],
      look: {
        lineEnabled: false,
        lineStrength: 0,
        textureLineEnabled: false,
        textureLineStrength: 0,
        toneMode: "none",
        toneType: "color",
        toneOpacity: 0,
      },
    });
    renderPreflight(createRuntime(batch));

    fireEvent.click(screen.getByRole("button", { name: "안전 패스로 전환" }));
    expect(batch.setSelectedPasses).toHaveBeenCalledWith(["beauty"]);
  });

  it("stays hidden when every selected pass is renderable", () => {
    const batch = createBatch({
      selectedPasses: ["beauty", "color"],
      look: {
        lineEnabled: true,
        lineStrength: 0.8,
        textureLineEnabled: true,
        textureLineStrength: 0.5,
        toneMode: "flat",
        toneType: "color",
        toneOpacity: 1,
      },
    });
    renderPreflight(createRuntime(batch));

    expect(screen.queryByText("출력 전 LT 패스 확인")).toBeNull();
  });

  it("inherits the canonical editor lock", () => {
    const batch = createBatch();
    renderPreflight(createRuntime(batch, { disabled: true }));

    expect(
      screen.getByRole("button", { name: "유효 2개 패스만 유지" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
