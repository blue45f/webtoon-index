// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioEditableMeshFromPolygons } from "../studio-editable-half-edge-mesh";

import {
  createStudioHybridDccComponentSelection,
  mutateStudioHybridDccComponentSelection,
  type StudioHybridDccComponentSelection,
  type StudioHybridDccMeshSelectionSource,
} from "./studio-hybrid-dcc-component-selection";
import { hybridDccRegisterAsset } from "./studio-hybrid-dcc-document";
import { createStudioHybridDccWorkspace, workspaceAddUnitCube, type StudioHybridDccWorkspace } from "./studio-hybrid-dcc-workspace";
import { StudioHybridDccMeshSelectionTools } from "./StudioHybridDccMeshSelectionTools";

vi.mock("./StudioHybridDccViewportCore", () => ({
  deriveStudioHybridDccViewportSnapshot: (workspace: StudioHybridDccWorkspace) => ({
    assets: Object.keys(workspace.session.state.geometry.records).map((assetId) => ({ assetId })),
  }),
}));
afterEach(cleanup);
function source(workspace: StudioHybridDccWorkspace): StudioHybridDccMeshSelectionSource {
  const assetId = workspace.activeAssetId!;
  const record = workspace.session.state.geometry.records[assetId]!;
  return { assetId, mesh: record.mesh, meshRevision: record.revision, sourceHash: record.meshHash };
}
function value(result: ReturnType<typeof mutateStudioHybridDccComponentSelection>): StudioHybridDccComponentSelection {
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join(", "));
  return result.value;
}
const create = () => workspaceAddUnitCube(createStudioHybridDccWorkspace("mesh-selection-tools"), "cube");
function Harness({ workspace, editingDisabled = false, contextLost = false, mutation = vi.fn() }: {
  workspace: StudioHybridDccWorkspace; editingDisabled?: boolean; contextLost?: boolean; mutation?: (operation: string, elementId?: number) => void;
}) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState(() => value(mutateStudioHybridDccComponentSelection(
    createStudioHybridDccComponentSelection(), { mode: "face", operation: "replace", ids: [], source: source(workspace) },
  )));
  return (
    <div ref={scopeRef}>
      <div data-studio-hybrid-dcc-viewport="true" data-context-lost={contextLost ? "true" : "false"}>
        <div role="application" aria-label="selection-test-canvas"><input aria-label="canvas text entry" /></div>
      </div>
      <output aria-label="selected stable ids">{selection.elementIds.join(",")}</output>
      <StudioHybridDccMeshSelectionTools workspace={workspace} componentSelection={selection} scopeRef={scopeRef}
        editingDisabled={editingDisabled} onSelectAsset={vi.fn()}
        onClearComponentSelection={() => {
          mutation("clear");
          setSelection((current) => value(mutateStudioHybridDccComponentSelection(current, {
            mode: "face", operation: "replace", ids: [], source: source(workspace),
          })));
        }}
        onSelectComponent={(_assetId, mode, elementId, operation) => {
          mutation(operation, elementId);
          setSelection((current) => value(mutateStudioHybridDccComponentSelection(current, {
            mode, operation, ids: [elementId], source: source(workspace),
            activeId: operation === "add" || operation === "replace" ? elementId : undefined,
          })));
        }} />
    </div>
  );
}
const open = () => fireEvent.click(screen.getByRole("button", { name: "메시 선택 · 연결 영역 · 경계 · 최단 경로" }));
const selected = () => screen.getByLabelText("selected stable ids").textContent;

describe("mesh selection workbench integration", () => {
  it("batches the shipping functional callback contract into the full stable face selection", () => {
    const workspace = create();
    const before = workspace.session.state.stateHash;
    render(<Harness workspace={workspace} />); open();
    fireEvent.click(screen.getByRole("button", { name: "전체 선택" }));
    expect(selected()).toBe(workspace.session.state.geometry.records.cube!.mesh.faces.map(({ id }) => id).sort((a, b) => a - b).join(","));
    expect(workspace.session.state.stateHash).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "선택 반전" }));
    expect(selected()).toBe("");
  });
  it("remembers and restores the selection in the same source revision", () => {
    render(<Harness workspace={create()} />); open();
    fireEvent.click(screen.getByRole("button", { name: "전체 선택" }));
    const before = selected();
    fireEvent.click(screen.getByRole("button", { name: "선택 기억" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 해제" }));
    expect(selected()).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "기억한 선택 복원" }));
    expect(selected()).toBe(before);
  });
  it("invalidates remembered selection when its source revision changes", () => {
    const workspace = create();
    const view = render(<Harness workspace={workspace} />); open();
    fireEvent.click(screen.getByRole("button", { name: "선택 기억" }));
    const changed = workspace;
    const record = changed.session.state.geometry.records.cube!;
    const next = { ...changed, session: { ...changed.session, state: { ...changed.session.state,
      geometry: { ...changed.session.state.geometry, records: { ...changed.session.state.geometry.records,
        cube: { ...record, revision: record.revision + 1 } } } } } };
    view.rerender(<Harness workspace={next} />);
    expect((screen.getByRole("button", { name: "기억한 선택 복원" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("accepts shortcuts only inside the canvas, excluding text entry and outside events", () => {
    const mutation = vi.fn();
    render(<Harness workspace={create()} mutation={mutation} />);
    fireEvent.keyDown(screen.getByLabelText("canvas text entry"), { key: "a" });
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(screen.getByRole("button", { name: "메시 선택 · 연결 영역 · 경계 · 최단 경로" }), { key: "a" });
    expect(mutation).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("application"), { key: "a" });
    expect(selected()?.split(",")).toHaveLength(6);
  });
  it("does not execute disabled or IME/repeated shortcuts", () => {
    const mutation = vi.fn();
    const view = render(<Harness workspace={create()} mutation={mutation} />);
    fireEvent.keyDown(screen.getByRole("application"), { key: "a", repeat: true });
    fireEvent.keyDown(screen.getByRole("application"), { key: "a", isComposing: true });
    view.rerender(<Harness workspace={create()} mutation={mutation} editingDisabled />);
    fireEvent.keyDown(screen.getByRole("application"), { key: "a" });
    expect(mutation).not.toHaveBeenCalled();
  });
  it("blocks both buttons and shortcuts while the graphics context is lost", () => {
    const mutation = vi.fn();
    render(<Harness workspace={create()} mutation={mutation} contextLost />); open();
    fireEvent.keyDown(screen.getByRole("application"), { key: "a" });
    fireEvent.click(screen.getByRole("button", { name: "전체 선택" }));
    expect(mutation).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("그래픽 중단");
  });
  it("rejects an oversized compatibility batch before the first selection callback", () => {
    const positions: { x: number; y: number; z: number }[] = [], polygons: number[][] = [];
    for (let i = 0; i < 513; i += 1) {
      const start = positions.length;
      positions.push({ x: i * 2, y: 0, z: 0 }, { x: i * 2 + 1, y: 0, z: 0 }, { x: i * 2, y: 1, z: 0 });
      polygons.push([start, start + 1, start + 2]);
    }
    const base = createStudioHybridDccWorkspace("selection-budget");
    const session = hybridDccRegisterAsset(base.session, "large", createStudioEditableMeshFromPolygons(positions, polygons), {
      source: "primitive", creator: "studio", license: "CC0-1.0", useScope: "commercial", derivative: "original",
    });
    const mutation = vi.fn();
    render(<Harness workspace={{ ...base, session, activeAssetId: "large" }} mutation={mutation} />); open();
    fireEvent.click(screen.getByRole("button", { name: "전체 선택" }));
    expect(mutation).not.toHaveBeenCalled();
    expect(selected()).toBe("");
    expect(screen.getByRole("alert").textContent).toContain("512");
  });
  it("keeps keyboard handlers independent when two workspaces coexist", () => {
    const first = vi.fn(), second = vi.fn();
    render(<><Harness workspace={create()} mutation={first} /><Harness workspace={create()} mutation={second} /></>);
    fireEvent.keyDown(screen.getAllByRole("application")[0]!, { key: "a" });
    expect(first).toHaveBeenCalledTimes(6);
    expect(second).not.toHaveBeenCalled();
  });
});
