// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioBg3dProSuiteRuntimeContext,
  type StudioBg3dProductionBatchRuntime,
  type StudioBg3dProSuiteRuntimeValue,
} from "./studio-bg3d-pro-suite-runtime-context";
import { StudioBg3dMultiPassExporterPanel } from "./StudioBg3dMultiPassExporterPanel";

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
  };
}

describe("StudioBg3dMultiPassExporterPanel production integration", () => {
  afterEach(() => cleanup());

  it("blocks export and hides LT passes the current SceneDocument cannot generate", () => {
    const batch = createBatch();
    render(
      <StudioBg3dProSuiteRuntimeContext.Provider value={createRuntime(batch)}>
        <StudioBg3dMultiPassExporterPanel />
      </StudioBg3dProSuiteRuntimeContext.Provider>,
    );

    expect(screen.getByText("출력 전 LT 패스 확인")).toBeDefined();
    expect(screen.getByRole("checkbox", { name: "컬러" })).toBeDefined();
    expect(screen.queryByRole("checkbox", { name: "톤" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "주선" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: /선택 1컷 · 4패스 \+ PSD \+ 콘택트 ZIP/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getAllByText(/2개 선택 패스가 현재 LT 설정과 맞지 않습니다/).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "유효 2개 패스만 유지" }));
    expect(batch.setSelectedPasses).toHaveBeenCalledWith(["beauty", "color"]);
  });

  it("keeps the production exporter on its proven recovery path when preflight passes", () => {
    const batch = createBatch({
      selectedPasses: ["beauty", "color"],
    });
    render(
      <StudioBg3dProSuiteRuntimeContext.Provider value={createRuntime(batch)}>
        <StudioBg3dMultiPassExporterPanel />
      </StudioBg3dProSuiteRuntimeContext.Provider>,
    );

    expect(screen.queryByText("출력 전 LT 패스 확인")).toBeNull();
    const startButton = screen.getByRole("button", {
      name: /선택 1컷 · 2패스 \+ PSD \+ 콘택트 ZIP/,
    });
    expect((startButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(startButton);
    expect(batch.startExport).toHaveBeenCalledTimes(1);
  });
});
