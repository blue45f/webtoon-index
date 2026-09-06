
import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const source = readStudioBg3dEditorSource();

describe("Studio BG3D transform-space integration boundary", () => {
  it("preserves the established mode defaults until the user explicitly chooses an axis space", () => {
    expect(source).toContain(
      'transformSpaceOverride ?? (transformMode === "rotate" ? "local" : "world")',
    );
    expect(source).toContain('space={transformSpace}');
    expect(source).not.toContain(
      'space={transformMode === "rotate" ? "local" : "world"}',
    );
  });

  it("keeps one explicit local/global preference stable across transform-tool changes", () => {
    expect(source).toContain(
      "const [transformSpaceOverride, setTransformSpaceOverride]",
    );
    expect(source).toContain('data-testid="bg3d-transform-space-toggle"');
    expect(source).toContain(
      'return effective === "local" ? "world" : "local";',
    );
    expect(source).not.toContain("setTransformSpaceOverride(null);");
  });

  it("exposes the current axis mode accessibly without writing scene history", () => {
    expect(source).toContain(
      'aria-pressed={transformSpace === "local"}',
    );
    expect(source).toContain(
      '{transformSpace === "local" ? "로컬 축" : "글로벌 축"}',
    );

    const toggleStart = source.indexOf('data-testid="bg3d-transform-space-toggle"');
    const toggleEnd = source.indexOf("</StudioToolHintTarget>", toggleStart);
    const toggleSource = source.slice(toggleStart, toggleEnd);
    expect(toggleSource).not.toContain("commitScene");
    expect(toggleSource).not.toContain("historyRef");
    expect(toggleSource).not.toContain("setSceneBaseDocument");
  });
});
