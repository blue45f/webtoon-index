// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STUDIO_HYBRID_DCC_VIEWPORT_PREFERENCES_KEY } from "./studio-hybrid-dcc-viewport-interaction";
import { createStudioHybridDccWorkspace, workspaceAddUnitCube, workspaceCommitObjectTransform, workspaceSetAssetVisibility } from "./studio-hybrid-dcc-workspace";
import { StudioHybridDccViewport } from "./StudioHybridDccViewport";
import { loadHybridDccViewportPreferences } from "./viewport-preferences-store";

import type { ReactNode } from "react";

const db = vi.hoisted(() => ({ rows: new Map<string, string>(), get: vi.fn(), set: vi.fn(), acquire: vi.fn(), asAsyncKeyValueStore: vi.fn() }));
vi.mock("../studio-local-database-runtime", () => ({ acquireStudioLocalDatabase: db.acquire }));
vi.mock("@react-three/fiber", () => ({
  Canvas: (_props: { children?: ReactNode }) => <div role="application" aria-label="test-3d-canvas"><button type="button" aria-label="canvas keyboard target" /></div>,
  useThree: vi.fn(),
}));
vi.mock("@react-three/drei/core/ContactShadows.js", () => ({ ContactShadows: () => null }));
vi.mock("@react-three/drei/core/OrbitControls.js", () => ({ OrbitControls: () => null }));
vi.mock("@react-three/drei/core/OrthographicCamera.js", () => ({ OrthographicCamera: () => null }));
vi.mock("@react-three/drei/core/PerformanceMonitor.js", () => ({ PerformanceMonitor: () => null }));
vi.mock("@react-three/drei/core/PerspectiveCamera.js", () => ({ PerspectiveCamera: () => null }));
vi.mock("@react-three/drei/core/TransformControls.js", () => ({ TransformControls: () => null }));

beforeEach(() => {
  db.rows.clear();
  db.get.mockReset().mockImplementation(async (key: string) => db.rows.get(key) ?? null);
  db.set.mockReset().mockImplementation(async (key: string, value: string) => { db.rows.set(key, value); });
  db.asAsyncKeyValueStore.mockReset().mockReturnValue(db);
  db.acquire.mockReset().mockResolvedValue(db);
});
afterEach(async () => {
  cleanup();
  // Drain the real adapter's ordered writes before replacing the next test's database.
  await loadHybridDccViewportPreferences();
  vi.restoreAllMocks();
});
const workspace = () => workspaceAddUnitCube(workspaceAddUnitCube(createStudioHybridDccWorkspace("interaction-ui"), "cube-a"), "cube-b");
const root = () => screen.getByLabelText("Hybrid DCC 3D 작업 뷰포트");
function setup() {
  const ws = workspace();
  const props = { workspace: ws, onSelectAsset: vi.fn(), onCommitAssetTransform: vi.fn(), onDeleteSelected: vi.fn(), onDuplicateSelected: vi.fn(), webglAvailable: true };
  return { ...render(<StudioHybridDccViewport {...props} />), props, ws };
}

describe("viewport interaction integration", () => {
  it("isolates and restores one visible asset without altering document visibility or state hash", () => {
    const { ws } = setup();
    const hash = ws.session.state.stateHash;
    const objects = JSON.stringify(ws.bridge.set.objects);
    fireEvent.click(screen.getByRole("button", { name: "선택 오브젝트 격리" }));
    expect(root().getAttribute("data-isolated-asset")).toBe("cube-b");
    expect(root().getAttribute("data-visible-assets")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "격리 해제 · 전체 복원" }));
    expect(root().getAttribute("data-visible-assets")).toBe("2");
    expect(ws.session.state.stateHash).toBe(hash);
    expect(JSON.stringify(ws.bridge.set.objects)).toBe(objects);
  });
  it("leaves isolation if its asset is hidden outside the viewport", () => {
    const { rerender, props, ws } = setup();
    fireEvent.click(screen.getByRole("button", { name: "선택 오브젝트 격리" }));
    rerender(<StudioHybridDccViewport {...props} workspace={workspaceSetAssetVisibility(ws, "cube-b", false)} />);
    expect(root().getAttribute("data-isolated-asset")).toBe("");
    expect(root().getAttribute("data-visible-assets")).toBe("1");
  });
  it("does not issue a frame intent when an object is edited", () => {
    const { rerender, props, ws } = setup();
    fireEvent.click(screen.getByRole("button", { name: "선택 오브젝트 화면 맞춤 (마침표)" }));
    const before = root().getAttribute("data-frame-revision");
    const moved = workspaceCommitObjectTransform(ws, "cube-b", { ...ws.session.state.objectTransforms["cube-b"]!, position: [10, 2, -5] });
    rerender(<StudioHybridDccViewport {...props} workspace={moved} />);
    expect(root().getAttribute("data-frame-revision")).toBe(before);
  });
  it("supports opposite views, projection toggle, isolation and focus-selected keys", () => {
    setup();
    const canvas = screen.getByRole("button", { name: "canvas keyboard target" });
    fireEvent.keyDown(canvas, { key: "1", code: "Numpad1", ctrlKey: true });
    expect(root().getAttribute("data-view-preset")).toBe("back");
    fireEvent.keyDown(canvas, { key: "5", code: "Numpad5" });
    expect(root().getAttribute("data-projection")).toBe("perspective");
    fireEvent.keyDown(canvas, { key: "/", code: "NumpadDivide" });
    expect(root().getAttribute("data-isolated-asset")).toBe("cube-b");
    fireEvent.keyDown(canvas, { key: "f", code: "KeyF" });
    expect(root().getAttribute("data-frame-target")).toBe("selection");
  });
  it("never intercepts IME, repeated deletion, contenteditable or outside events", () => {
    const { props } = setup();
    const canvas = screen.getByRole("button", { name: "canvas keyboard target" });
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "Delete", repeat: true });
    fireEvent.keyDown(canvas, { key: "Delete", isComposing: true });
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    root().append(editor);
    fireEvent.keyDown(editor, { key: "Delete" });
    editor.remove();
    fireEvent.keyDown(window, { key: "Delete" });
    expect(props.onDeleteSelected).not.toHaveBeenCalled();
    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(props.onDeleteSelected).toHaveBeenCalledTimes(1);
  });
  it("keeps Shift+Tab focus traversal on toolbar controls but toggles snap on canvas", () => {
    setup();
    const button = screen.getByRole("button", { name: "등각 보기" });
    expect(fireEvent.keyDown(button, { key: "Tab", shiftKey: true, cancelable: true })).toBe(true);
    expect(root().getAttribute("data-snapping")).toBe("true");
    fireEvent.keyDown(screen.getByRole("button", { name: "canvas keyboard target" }), { key: "Tab", shiftKey: true });
    expect(root().getAttribute("data-snapping")).toBe("false");
  });
  it("validates snap inputs and restores preferences after the shared SQLite write completes", async () => {
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    const { unmount, props } = setup();
    const input = screen.getByLabelText("이동 스냅 간격 (m)");
    fireEvent.change(input, { target: { value: "-2" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert").textContent).toContain("이동 스냅 간격");
    fireEvent.change(input, { target: { value: "0.25" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "그리드" }));
    await waitFor(() => expect(JSON.parse(db.rows.get(STUDIO_HYBRID_DCC_VIEWPORT_PREFERENCES_KEY) ?? "null"))
      .toMatchObject({ translationStep: 0.25, showGrid: false }));
    expect(db.asAsyncKeyValueStore).toHaveBeenCalledWith("studio-ui-preferences-v1");
    unmount();
    render(<StudioHybridDccViewport {...props} />);
    await waitFor(() => expect((screen.getByLabelText("이동 스냅 간격 (m)") as HTMLInputElement).value).toBe("0.25"));
    expect(screen.getByRole("button", { name: "그리드" }).getAttribute("aria-pressed")).toBe("false");
    expect(localWrite).not.toHaveBeenCalled();
  });
  it("copies transforms between selections and submits one existing transform callback", () => {
    const { props, rerender, ws } = setup();
    fireEvent.click(screen.getByRole("button", { name: "변환 복사 · 초기화 · 반전 · 오브젝트 정렬" }));
    fireEvent.click(screen.getByRole("button", { name: "변환 복사" }));
    const changed = workspaceCommitObjectTransform(ws, "cube-a", { ...ws.session.state.objectTransforms["cube-a"]!, position: [12, 0, 0] });
    rerender(<StudioHybridDccViewport {...props} workspace={{ ...changed, activeAssetId: "cube-a" }} />);
    fireEvent.click(screen.getByRole("button", { name: "변환 붙여넣기" }));
    expect(props.onCommitAssetTransform).toHaveBeenCalledTimes(1);
    expect(props.onCommitAssetTransform).toHaveBeenCalledWith("cube-a", ws.session.state.objectTransforms["cube-b"]);
  });
});
