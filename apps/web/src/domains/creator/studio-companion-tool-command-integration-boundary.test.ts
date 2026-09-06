import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";


const pageSource = readStudioPageCompositionSource();

function companionCommandHandlerSource(): string {
  const start = pageSource.indexOf("companionCommandHandlerRef.current = (command) => {");
  const end = pageSource.indexOf("return () => {", start);
  if (start < 0 || end < 0) throw new Error("Studio companion command handler is missing");
  return pageSource.slice(start, end);
}

describe("Studio companion tool-command integration boundary", () => {
  // 계약 변경(2026-08, docs/rewrite/ux-audit-v5.md §2.4): 컴패니언도 로컬 레일·툴벨트·키보드와
  // 똑같은 정본 전이를 쓴다. 예전처럼 disarm/setTool/setDrawMode 를 따로 주입하면 진행 중인
  // 획 취소가 이 경로에서만 빠져 "같은 명령, 다른 부수효과"가 다시 생긴다.
  it("delegates base tool transitions to the canonical stroke-safe transition", () => {
    const handler = companionCommandHandlerSource();

    expect(pageSource).toContain(
      'import { executeStudioCompanionToolCommand } from "./studio-companion-tool-command-executor";',
    );
    expect(handler).toContain("executeStudioCompanionToolCommand(command, {");
    expect(handler).toContain("activatePrimaryCanvasTool: (tool, drawMode) => {");
    expect(handler).toContain("activatePrimaryCanvasToolRef.current(tool, drawMode);");
    expect(handler).not.toContain("disarmAllPixelTools:");
    expect(handler).toContain("if (toolExecution.handled) return;");
    expect(pageSource).toContain(
      "activatePrimaryCanvasToolRef.current = activatePrimaryCanvasTool;",
    );
    expect(pageSource).toContain("disarmAllPixelToolsRef.current = disarmAllPixelTools;");
  });

  it("does not retain an inline select, pen, or eraser transition that can bypass disarming", () => {
    const handler = companionCommandHandlerSource();

    expect(handler).not.toContain('case "select":');
    expect(handler).not.toContain('case "pen":');
    expect(handler).not.toContain('case "eraser":');
  });
});
