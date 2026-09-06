// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioBg3dProSuiteRuntimeContext,
  type StudioBg3dProductionBatchRuntime,
  type StudioBg3dProSuiteRuntimeValue,
} from "./studio-bg3d-pro-suite-runtime-context";
import { StudioBg3dProductionWorkflowPanel } from "./StudioBg3dProductionWorkflowPanel";

function createBatch(
  overrides: Partial<StudioBg3dProductionBatchRuntime> = {},
): StudioBg3dProductionBatchRuntime {
  return {
    selectedShotIds: [],
    availablePasses: [
      "beauty",
      "lt-composite",
      "color",
      "tone",
      "texture-line",
      "main-line",
      "depth",
    ],
    selectedPasses: [],
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
    productionShots: [
      { id: "shot-a", name: "첫 컷" },
      { id: "shot-b", name: "두 번째 컷" },
    ],
    productionBatch: batch,
    sceneSummary: {
      nodeCount: 5,
      visibleNodeCount: 4,
      lockedNodeCount: 1,
      primitiveNodeCount: 3,
      modelNodeCount: 2,
      attachmentCount: 2,
      selectedNodeCount: 1,
      posedModelCount: 1,
      animatedModelCount: 1,
      constrainedModelCount: 1,
      activeShotId: "shot-a",
      lineOutputEnabled: true,
      lineArtPreview: true,
      toneMode: "cel",
      transparentBackground: true,
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

function renderWorkflow(runtime: StudioBg3dProSuiteRuntimeValue) {
  return render(
    <StudioBg3dProSuiteRuntimeContext.Provider value={runtime}>
      <StudioBg3dProductionWorkflowPanel />
    </StudioBg3dProSuiteRuntimeContext.Provider>,
  );
}

describe("StudioBg3dProductionWorkflowPanel", () => {
  afterEach(() => cleanup());

  it("connects the next-action CTA to canonical shot selection", () => {
    const batch = createBatch();
    renderWorkflow(createRuntime(batch));

    expect(screen.getByText("3D 제작 흐름")).toBeDefined();
    expect(screen.getByText("1. 장면")).toBeDefined();
    expect(screen.getByText("5. 출력·전달")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "저장된 컷 전체 선택" }));
    expect(batch.selectAllShots).toHaveBeenCalledTimes(1);
  });

  it("applies only production-proven and LT-configured manuscript passes", () => {
    const batch = createBatch({
      selectedShotIds: ["shot-a", "shot-b"],
    });
    renderWorkflow(createRuntime(batch));

    fireEvent.click(screen.getByRole("button", { name: "웹툰 원고 패스 자동 선택" }));
    expect(batch.setSelectedPasses).toHaveBeenCalledWith([
      "lt-composite",
      "color",
      "texture-line",
      "main-line",
    ]);
  });

  it("starts the recoverable production export when every gate is ready", async () => {
    const batch = createBatch({
      selectedShotIds: ["shot-a", "shot-b"],
      selectedPasses: ["lt-composite", "color", "texture-line", "main-line"],
    });
    renderWorkflow(createRuntime(batch));

    fireEvent.click(screen.getByRole("button", { name: "2컷 · 4패스 출력 시작" }));
    await waitFor(() => expect(batch.startExport).toHaveBeenCalledTimes(1));
  });

  it("routes look toggles and AI preparation without bypassing editor commands", () => {
    const batch = createBatch({
      selectedShotIds: ["shot-a", "shot-b"],
      selectedPasses: ["beauty"],
    });
    const runtime = createRuntime(batch);
    renderWorkflow(runtime);

    fireEvent.click(screen.getByLabelText("선화 미리보기"));
    expect(runtime.onSetLineArtPreview).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByLabelText("2D 합성용 투명 배경"));
    expect(runtime.onSetTransparentBackground).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "현재 컷 AI 참조 준비" }));
    expect(runtime.onUseCurrentFrameAsAiReference).toHaveBeenCalledTimes(1);
  });

  it("keeps the export surface compact and avoids a duplicate start button", () => {
    const batch = createBatch({
      selectedShotIds: ["shot-a", "shot-b"],
      selectedPasses: ["beauty"],
    });
    const runtime = createRuntime(batch);
    render(
      <StudioBg3dProSuiteRuntimeContext.Provider value={runtime}>
        <StudioBg3dProductionWorkflowPanel variant="export" defaultExpanded={false} />
      </StudioBg3dProSuiteRuntimeContext.Provider>,
    );

    expect(screen.getByText("출력 준비 완료 · 아래에서 패키지 확인")).toBeDefined();
    expect(screen.queryByRole("button", { name: "2컷 · 1패스 출력 시작" })).toBeNull();
    expect(screen.queryByText("1. 장면")).toBeNull();
  });
});
