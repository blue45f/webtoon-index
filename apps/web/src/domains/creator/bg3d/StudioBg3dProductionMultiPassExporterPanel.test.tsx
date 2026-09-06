// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioBg3dProductionMultiPassExporterPanel } from "./StudioBg3dProductionMultiPassExporterPanel";

import type { StudioBg3dProductionBatchRuntime } from "./studio-bg3d-pro-suite-runtime-context";
import type { StudioBg3dShot } from "./studio-bg3d-scene-document";

const SHOTS: readonly StudioBg3dShot[] = [
  {
    id: "shot-wide",
    name: "오프닝 와이드",
    camera: { position: [0, 2, 8], target: [0, 1, 0], fovDegrees: 55 },
  },
  {
    id: "shot-close",
    name: "표정 클로즈업",
    camera: { position: [0, 1.6, 2], target: [0, 1.5, 0], fovDegrees: 24 },
  },
];

function createBatch(
  overrides: Partial<StudioBg3dProductionBatchRuntime> = {},
): StudioBg3dProductionBatchRuntime {
  return {
    selectedShotIds: ["shot-wide"],
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
    exportHeight: "per-shot",
    exportHeightOptions: [640, 1080, 1440, 2160, 4096],
    includeLayeredPsd: false,
    includeContactSheet: false,
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

describe("StudioBg3dProductionMultiPassExporterPanel", () => {
  afterEach(() => cleanup());

  it("routes shot, preset, pass and export actions to the canonical batch runtime", () => {
    const batch = createBatch();
    render(
      <StudioBg3dProductionMultiPassExporterPanel
        shots={SHOTS}
        batch={batch}
      />,
    );

    expect(screen.getByText("프로덕션 컷 멀티패스")).toBeDefined();
    expect(screen.getByText("장면 연동")).toBeDefined();
    expect(screen.getByText("배치 컷 1/2")).toBeDefined();
    expect(screen.getByLabelText("멀티패스 패키지 계획").textContent).toContain("PNG2");

    fireEvent.click(screen.getByRole("button", { name: "원고" }));
    expect(batch.setSelectedPasses).toHaveBeenCalledWith([
      "lt-composite",
      "color",
      "tone",
      "texture-line",
      "main-line",
    ]);

    fireEvent.click(screen.getByRole("checkbox", { name: /표정 클로즈업/ }));
    expect(batch.setShotSelected).toHaveBeenCalledWith("shot-close", true);

    fireEvent.click(screen.getByRole("checkbox", { name: "깊이" }));
    expect(batch.setPassSelected).toHaveBeenCalledWith("depth", true);

    fireEvent.click(screen.getByRole("button", { name: /선택 1컷 · 2패스 ZIP/ }));
    expect(batch.startExport).toHaveBeenCalledTimes(1);
  });

  it("updates output, PSD and contact-sheet settings without duplicating editor state", () => {
    const batch = createBatch();
    render(
      <StudioBg3dProductionMultiPassExporterPanel
        shots={SHOTS}
        batch={batch}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "최대 출력 높이" }), {
      target: { value: "2160" },
    });
    expect(batch.setExportHeight).toHaveBeenCalledWith(2160);

    fireEvent.click(screen.getByRole("checkbox", { name: /컷별 레이어 PSD/ }));
    expect(batch.setIncludeLayeredPsd).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /컷 검수 콘택트 시트/ }));
    expect(batch.setIncludeContactSheet).toHaveBeenCalledWith(true);
  });

  it("shows progress and recovery evidence while blocking unsafe exports", () => {
    const blockedReason = "불러오기에 실패한 3D 모델이 있어 출력을 막았습니다.";
    const batch = createBatch({
      blockedReason,
      progress: {
        stage: "render",
        completed: 1,
        total: 2,
        label: "표정 클로즈업",
      },
      recoverySummary: {
        completedShots: 1,
        totalShots: 2,
        mode: "durable",
        downloadRequested: true,
      },
    });
    render(
      <StudioBg3dProductionMultiPassExporterPanel
        shots={SHOTS}
        batch={batch}
      />,
    );

    expect(screen.getByText(blockedReason)).toBeDefined();
    expect(screen.getByText(/렌더 · 표정 클로즈업/)).toBeDefined();
    expect(screen.getByText(/완료 1\/2컷 · 복구 저장소 · 다운로드 이력 보존/)).toBeDefined();
    expect(
      (screen.getByRole("button", { name: /선택 1컷 · 2패스 ZIP/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("lists deferred capture-v2 artifacts without presenting them as production checkboxes", () => {
    const batch = createBatch();
    render(
      <StudioBg3dProductionMultiPassExporterPanel
        shots={SHOTS}
        batch={batch}
      />,
    );

    fireEvent.click(screen.getByText("Capture v2 고급 패스 연결 현황"));
    expect(screen.getByText("법선 맵")).toBeDefined();
    expect(screen.getByText("오브젝트 ID")).toBeDefined();
    expect(screen.getByText("모션 벡터")).toBeDefined();
    expect(screen.queryByRole("checkbox", { name: "법선 맵" })).toBeNull();
  });
});
