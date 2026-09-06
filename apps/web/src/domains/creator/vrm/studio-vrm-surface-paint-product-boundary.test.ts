import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";

const poserSource = readStudioVrmPoserImplementationSource();
const pageSource = readStudioPageCompositionSource();
const toolSource = readFileSync(
  new URL("./studio-vrm-surface-paint-tool.ts", import.meta.url),
  "utf8",
);
const adapterSource = readFileSync(
  new URL("./studio-vrm-surface-brush-provider.ts", import.meta.url),
  "utf8",
);
const panelSource = readFileSync(
  new URL("./StudioVrmTexturePaintPanel.tsx", import.meta.url),
  "utf8",
);

function between(source: string, startToken: string, endToken: string): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("VRM V12 surface-paint product boundary", () => {
  it("wires the admitted round surface tool into the strict product pointer path", () => {
    const begin = between(
      poserSource,
      "const beginTexturePaint =",
      "const moveTexturePaint =",
    );

    expect(poserSource).toContain('from "./studio-vrm-surface-paint-tool"');
    expect(poserSource).toContain("createStudioVrmSurfacePaintTool({");
    expect(begin).toContain("isStudioVrmTexturePaintBrushProductBlocked(settings.tool)");
    expect(begin).toContain('settings.tool !== "surface-brush"');
    expect(begin).toContain("texturePaintSurfaceTool.begin({");
    expect(begin).not.toContain("runtime.beginStroke({");
    expect(begin).toContain("sizeCssPixels: settings.sizeTexels");
    expect(begin).toContain("flow: settings.tuning.flow");
    expect(begin).toContain('studioVrmSurfacePaintPointerSample(');
    expect(begin).toContain("texturePaintSurfacePointerIdRef.current = event.pointerId");
    expect(begin).toContain("captureTarget.setPointerCapture(event.pointerId)");
    expect(poserSource).toContain("onPointerDown={beginTexturePaint}");
    expect(poserSource).toContain("onPointerMove={moveTexturePaint}");
    expect(poserSource).toContain("onPointerUp={finishTexturePaint}");
    expect(panelSource).toContain('onSettingsChange({ tool: "surface-brush" })');
    expect(panelSource).not.toContain('onSettingsChange({ tool: "brush" })');
    expect(pageSource).not.toContain("studio-vrm-surface-paint-tool");
  });

  it("keeps lifecycle exits abortable and the atlas commit canonical-once", () => {
    for (const reason of [
      "pointer-leave",
      "pointer-cancel",
      "lost-capture",
      "window-blur",
      "device-failure",
      "disabled",
      "tool-change",
      "unmount",
    ]) {
      expect(poserSource).toContain(`"${reason}"`);
    }
    expect(poserSource).toContain('addEventListener("webglcontextlost"');
    expect(toolSource.match(/await this\.executeStroke\(\{/gu)).toHaveLength(1);
    expect(toolSource).toContain("maxOperations: this.maxOperations");
    expect(adapterSource).toContain("commit: true");
    expect(adapterSource).toContain("commitSurfaceBrushSession(this.session");
  });

  it("fails closed without selecting an alternate brush for the same operation", () => {
    expect(toolSource).not.toContain('fallback: "round-tip"');
    expect(toolSource).not.toContain('route: "round-tip-fallback"');
    expect(toolSource).not.toContain("호환 라운드 브러시로 처리합니다");
    expect(toolSource).toContain("automaticAlternateBrushSelectionAllowed: false");
    expect(toolSource).toContain('sourceState: "preserved"');
    expect(toolSource).toContain('lastCommit: "preserved"');
    expect(toolSource).toContain('nextOperation: "select-provider-or-tool"');
    expect(toolSource).toContain('status: "unavailable"');
    expect(toolSource).toContain('status: "rejected"');
  });

  it("preserves pressure and tilt IR while retaining seam-safe measured projection", () => {
    expect(toolSource).toContain("modelRawInput(");
    expect(toolSource).toContain("pressure: sample.pressure");
    expect(toolSource).toContain("tiltXDeg: sample.tiltX");
    expect(toolSource).toContain("tiltYDeg: sample.tiltY");
    expect(toolSource).toContain("brushProgram: built.brushProgram");
    expect(toolSource).toContain("stroke: built.stroke");
    expect(adapterSource).toContain("projection.islandId");
    expect(adapterSource).toContain("seamBefore: true");
    expect(adapterSource).toContain("worldUnitsPerCssPixelBySample");
    expect(poserSource).toContain("studioVrmSurfacePaintWorldUnitsPerCssPixel(");
  });

  it("publishes an honest capability note without interactive readback", () => {
    expect(panelSource).toContain("직접 그리기 지원 범위");
    expect(panelSource).toContain("surfaceBrushUnavailableReason");
    expect(panelSource).toContain('data-testid="vrm-surface-brush-controls"');
    expect(poserSource).toContain("검증된 round 촉 기반 3D 표면 브러시입니다");
    expect(poserSource).toContain("stamp/image 촉과 wet/smudge 혼색은 아직 지원하지 않습니다");
    expect(poserSource).toContain('return tool === "brush"');
    expect(panelSource).not.toContain('onSettingsChange({ tool: "brush" })');
    expect(toolSource).toContain('code: "memory"');
    expect(toolSource).toContain('code: "upload"');
    expect(toolSource).toContain('deviceFailure ? "device-failure" : null');
    expect(`${poserSource}
${toolSource}
${adapterSource}`).not.toMatch(
      /\breadPixels\s*\(|\bgetImageData\s*\(/u,
    );
  });
});
