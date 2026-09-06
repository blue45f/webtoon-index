// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioBg3dEngineRecoveryActions } from "./StudioBg3dEngineRecoveryActions";

afterEach(cleanup);

describe("explicit blocked-viewport engine recovery", () => {
  it("does not launch or switch any renderer when the gate mounts", () => {
    const change = vi.fn();
    const view = render(<StudioBg3dEngineRecoveryActions preference="webgpu" onPreferenceChange={change} />);
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "사용할 3D 엔진 직접 선택" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    view.rerender(<StudioBg3dEngineRecoveryActions preference="webgl2" onPreferenceChange={change} />);
    expect(change).not.toHaveBeenCalled();
  });
  it("selects WebGL2 only after the artist explicitly activates its button", () => {
    const change = vi.fn();
    render(<StudioBg3dEngineRecoveryActions preference="webgpu" onPreferenceChange={change} />);
    fireEvent.click(screen.getByTestId("studio-bg3d-recovery-webgl2"));
    expect(change).toHaveBeenCalledExactlyOnceWith("webgl2");
  });
  it.each(["webgpu", "webgl2"] as const)("retries the chosen %s without changing engines", (preference) => {
    const change = vi.fn();
    render(<StudioBg3dEngineRecoveryActions preference={preference} onPreferenceChange={change} />);
    const button = screen.getByTestId(`studio-bg3d-recovery-${preference}`);
    expect(button.textContent).toContain("다시 시도");
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(change).toHaveBeenCalledExactlyOnceWith(preference);
  });
  it("wires the actual unavailable gate to the existing preference owner, not a substitute renderer", () => {
    const source = readFileSync("apps/web/src/domains/creator/bg3d/StudioBg3dEditorViewport.tsx", "utf8");
    const start = source.indexOf('engineRuntime.plan.status !== "available"');
    const gate = source.slice(start, source.indexOf("<Canvas", start));
    expect(gate).toContain("<StudioBg3dEngineRecoveryActions");
    expect(gate).toContain("onPreferenceChange={engineRuntime.setPreference}");
    expect(gate).toContain("자동으로 다른 엔진을 실행하지 않습니다");
  });
});
