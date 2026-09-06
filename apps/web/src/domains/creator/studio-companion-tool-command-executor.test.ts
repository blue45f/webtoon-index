import { describe, expect, it, vi } from "vitest";

import {
  executeStudioCompanionToolCommand,
  type StudioCompanionToolCommandActions,
} from "./studio-companion-tool-command-executor";

import type { DrawMode } from "./studio-editor-tool-model";
import type { StudioCompanionCommandName } from "./studio-tools-companion";

interface ActionHarness {
  actions: StudioCompanionToolCommandActions;
  activatePrimaryCanvasTool: ReturnType<
    typeof vi.fn<(tool: "select" | "draw", drawMode?: DrawMode) => void>
  >;
  calls: string[];
}

function createActionHarness(): ActionHarness {
  const calls: string[] = [];
  const activatePrimaryCanvasTool = vi.fn(
    (tool: "select" | "draw", drawMode?: DrawMode) => {
      calls.push(drawMode === undefined ? `tool:${tool}` : `tool:${tool}:${drawMode}`);
    },
  );

  return {
    actions: { activatePrimaryCanvasTool },
    activatePrimaryCanvasTool,
    calls,
  };
}

describe("executeStudioCompanionToolCommand", () => {
  // 계약 변경(2026-08): 컴패니언도 로컬 레일·툴벨트·키보드와 같은 정본 전이를 쓴다.
  // disarm/setTool/setDrawMode를 따로 주입하면 진행 중인 획 취소가 이 경로에만 빠져서
  // "같은 명령, 다른 부수효과"가 다시 생긴다.
  it.each([
    ["select", ["tool:select"]],
    ["pen", ["tool:draw:pen"]],
    ["eraser", ["tool:draw:eraser"]],
  ] as const)("routes %s through the stroke-safe primary transition", (command, expectedCalls) => {
    const harness = createActionHarness();

    const result = executeStudioCompanionToolCommand(command, harness.actions);

    expect(result).toEqual({ handled: true });
    expect(harness.calls).toEqual(expectedCalls);
    expect(harness.activatePrimaryCanvasTool).toHaveBeenCalledTimes(1);
  });

  it("does not change draw mode for select", () => {
    const harness = createActionHarness();

    executeStudioCompanionToolCommand("select", harness.actions);

    expect(harness.activatePrimaryCanvasTool).toHaveBeenCalledExactlyOnceWith("select");
  });

  it.each([
    "template",
    "bubble",
    "text",
    "layers",
    "ai",
    "3d-character",
    "3d-bg",
    "focus-primary",
    "toggle-canvas-only",
    "enter-canvas-only",
    "exit-canvas-only",
  ] satisfies readonly StudioCompanionCommandName[])(
    "leaves non-tool command %s to the caller",
    (command) => {
      const harness = createActionHarness();

      const result = executeStudioCompanionToolCommand(command, harness.actions);

      expect(result).toEqual({ handled: false });
      expect(harness.calls).toEqual([]);
      expect(harness.activatePrimaryCanvasTool).not.toHaveBeenCalled();
    }
  );
});
