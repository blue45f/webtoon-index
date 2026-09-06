// @vitest-environment jsdom

import { strict as assert } from "node:assert";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, test, vi } from "vitest";

import { SPATIAL_STORYBOARD_DEFAULTS } from "./studio-bg3d-spatial-storyboard";
import SpatialStoryboardPanel from "./StudioBg3dSpatialStoryboardPanel";

const commands = vi.hoisted(() => ({
  disabled: false,
  shots: [{ id: "a", name: "첫 장면" }, { id: "b", name: "다음 장면" }],
  apply: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("./studio-bg3d-pro-suite-runtime-context", () => ({
  useStudioBg3dProSuiteRuntime: () => ({
    disabled: commands.disabled, productionShots: commands.shots,
    onApplyProductionShot: commands.apply, onCaptureCurrentShot: commands.capture,
  }),
}));
afterEach(cleanup);
beforeEach(() => {
  commands.disabled = false;
  commands.shots = [{ id: "a", name: "첫 장면" }, { id: "b", name: "다음 장면" }];
  commands.apply.mockReset(); commands.capture.mockReset();
});

test("selection never applies a camera; explicit Apply does", () => {
  render(<SpatialStoryboardPanel />);
  assert.equal(commands.apply.mock.calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "다음 컷 선택" }));
  assert.equal(commands.apply.mock.calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "선택 컷을 편집기에 적용" }));
  assert.deepEqual(commands.apply.mock.calls, [["b"]]);
});
test("capture uses only the canonical command", () => {
  render(<SpatialStoryboardPanel />);
  fireEvent.click(screen.getByRole("button", { name: "현재 구도 컷 저장" }));
  assert.equal(commands.capture.mock.calls.length, 1);
  assert.equal(commands.apply.mock.calls.length, 0);
});
test("all commands respect a live editor lock", () => {
  const view = render(<SpatialStoryboardPanel />);
  commands.disabled = true; view.rerender(<SpatialStoryboardPanel />);
  for (const name of ["현재 구도 컷 저장", "선택 컷을 편집기에 적용", "계획 JSON 내보내기", "계획 설정 가져오기"]) {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    assert.equal(button.disabled, true); fireEvent.click(button);
  }
  assert.equal(commands.capture.mock.calls.length, 0);
  assert.equal(commands.apply.mock.calls.length, 0);
});
test("empty scene can capture but cannot apply or export", () => {
  commands.shots = []; render(<SpatialStoryboardPanel />);
  assert.equal((screen.getByRole("button", { name: "현재 구도 컷 저장" }) as HTMLButtonElement).disabled, false);
  assert.equal((screen.getByRole("button", { name: "선택 컷을 편집기에 적용" }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole("button", { name: "계획 JSON 내보내기" }) as HTMLButtonElement).disabled, true);
});
test("shot labels are text, not executable HTML", () => {
  commands.shots = [{ id: "a", name: '<img src=x onerror="alert(1)">' }];
  const view = render(<SpatialStoryboardPanel />);
  assert.equal(view.container.querySelectorAll("img").length, 0);
  assert.ok(view.container.textContent?.includes("<img"));
});
test("settings imports ignore external shot commands", async () => {
  render(<SpatialStoryboardPanel />);
  const text = JSON.stringify({ kind: "toonstudio.spatial-storyboard-plan", version: 1, settings: { ...SPATIAL_STORYBOARD_DEFAULTS, layout: "focus" }, panels: [{ shotId: "unauthorized" }] });
  fireEvent.change(screen.getByLabelText("공간 콘티 계획 파일"), { target: { files: [{ size: text.length, text: () => Promise.resolve(text) }] } });
  await waitFor(() => assert.ok(screen.getByRole("status").textContent?.includes("배치 설정만")));
  assert.equal(commands.apply.mock.calls.length, 0);
  assert.equal(commands.capture.mock.calls.length, 0);
});
test("pending import cannot write after an editor lock", async () => {
  let resolveText: (value: string) => void = () => undefined;
  const pending = new Promise<string>((resolve) => { resolveText = resolve; });
  const view = render(<SpatialStoryboardPanel />);
  fireEvent.change(screen.getByLabelText("공간 콘티 계획 파일"), { target: { files: [{ size: 100, text: () => pending }] } });
  commands.disabled = true; view.rerender(<SpatialStoryboardPanel />);
  resolveText(JSON.stringify({ kind: "toonstudio.spatial-storyboard-plan", version: 1, settings: { ...SPATIAL_STORYBOARD_DEFAULTS, layout: "focus" } }));
  await pending;
  await waitFor(() => assert.equal((screen.getByRole("combobox", { name: "배치 방식" }) as HTMLSelectElement).value, "arc"));
  assert.equal(commands.apply.mock.calls.length, 0);
});
test("invalid files give an error rather than silently changing settings", async () => {
  render(<SpatialStoryboardPanel />);
  fireEvent.change(screen.getByLabelText("공간 콘티 계획 파일"), { target: { files: [{ size: 1, text: () => Promise.resolve("{") }] } });
  await waitFor(() => assert.ok(screen.getByRole("alert").textContent?.includes("올바른 공간 콘티")));
  assert.equal(commands.apply.mock.calls.length, 0);
});
