// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioHybridDccComponentSelection } from "./studio-hybrid-dcc-component-selection";
import { createStudioHybridDccWorkspace, workspaceAddUnitCube, type StudioHybridDccWorkspace } from "./studio-hybrid-dcc-workspace";
import { StudioHybridDccPrecisionTools } from "./StudioHybridDccPrecisionTools";

vi.mock("./StudioHybridDccViewportCore", () => ({
  deriveStudioHybridDccViewportSnapshot: (workspace: StudioHybridDccWorkspace) => ({
    assets: workspace.activeAssetId ? [{
      assetId: workspace.activeAssetId,
      positions: new Float32Array([-1, -1, -1, 1, 1, 1]),
    }] : [],
  }),
}));
afterEach(cleanup);
const createWorkspace = () => workspaceAddUnitCube(createStudioHybridDccWorkspace("precision-ui"), "cube");
function setup(extra = {}) {
  const onCommitAssetTransform = vi.fn();
  const workspace = createWorkspace();
  const props = { workspace, onCommitAssetTransform, onSelectAsset: vi.fn(), ...extra };
  const view = render(<StudioHybridDccPrecisionTools {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "정밀 변환 · 피벗 · 치수 · 배치" }));
  return { ...view, props, onCommitAssetTransform, workspace };
}

describe("precision workbench UI", () => {
  it("keeps the advanced workbench collapsed until requested", () => {
    render(<StudioHybridDccPrecisionTools workspace={createWorkspace()} onSelectAsset={vi.fn()} />);
    expect(screen.queryByRole("form", { name: "정밀 오브젝트 변환" })).toBeNull();
    expect(screen.getByRole("button", { name: "정밀 변환 · 피벗 · 치수 · 배치" }).getAttribute("aria-expanded")).toBe("false");
  });
  it("previews expressions without committing and submits one canonical command", () => {
    const { onCommitAssetTransform, workspace } = setup();
    const before = workspace.session.state.objectTransforms.cube!.position[0];
    fireEvent.change(screen.getByLabelText("길이 수식"), { target: { value: "1m+25cm" } });
    expect(onCommitAssetTransform).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "정밀 변환 적용" }));
    expect(onCommitAssetTransform).toHaveBeenCalledTimes(1);
    expect(onCommitAssetTransform.mock.calls[0]![0]).toBe("cube");
    expect(onCommitAssetTransform.mock.calls[0]![1].position[0]).toBeCloseTo(before + 1.25, 12);
    expect(workspace.session.state.objectTransforms.cube!.position[0]).toBe(before);
  });
  it("rejects invalid input even when form submission is dispatched directly", () => {
    const { onCommitAssetTransform } = setup();
    fireEvent.change(screen.getByLabelText("길이 수식"), { target: { value: "globalThis.alert(1)" } });
    expect(screen.getByLabelText("길이 수식").getAttribute("aria-invalid")).toBe("true");
    fireEvent.submit(screen.getByRole("form", { name: "정밀 오브젝트 변환" }));
    expect(onCommitAssetTransform).not.toHaveBeenCalled();
  });
  it("blocks stale edits while the workspace is busy", () => {
    const { onCommitAssetTransform } = setup({ editingDisabled: true });
    fireEvent.submit(screen.getByRole("form", { name: "정밀 오브젝트 변환" }));
    expect(onCommitAssetTransform).not.toHaveBeenCalled();
    expect(screen.getByText("다른 편집이 완료된 뒤 적용하세요.")).toBeTruthy();
  });
  it("never turns component edits into whole-object transforms", () => {
    const { onCommitAssetTransform } = setup({ componentSelection: { ...createStudioHybridDccComponentSelection(), mode: "face" } });
    fireEvent.submit(screen.getByRole("form", { name: "정밀 오브젝트 변환" }));
    expect(onCommitAssetTransform).not.toHaveBeenCalled();
    expect(screen.getByText(/오브젝트 모드에서 사용하세요/u)).toBeTruthy();
  });
  it("applies vertex-based floor placement through the existing callback", () => {
    const { onCommitAssetTransform } = setup();
    fireEvent.click(screen.getByRole("button", { name: "바닥 Y=0에 놓기" }));
    expect(onCommitAssetTransform).toHaveBeenCalledTimes(1);
    expect(onCommitAssetTransform.mock.calls[0]![1].position[1]).toBeCloseTo(1, 12);
  });
  it("ignores an irrelevant invalid custom pivot when switching to translation", () => {
    const { onCommitAssetTransform } = setup();
    fireEvent.change(screen.getByLabelText("정밀 작업"), { target: { value: "rotate" } });
    fireEvent.change(screen.getByLabelText("변환 피벗"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("피벗 X"), { target: { value: "invalid" } });
    fireEvent.change(screen.getByLabelText("정밀 작업"), { target: { value: "translate" } });
    fireEvent.click(screen.getByRole("button", { name: "정밀 변환 적용" }));
    expect(onCommitAssetTransform).toHaveBeenCalledTimes(1);
  });
});
