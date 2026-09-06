import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioInspectorAsideSurface } from "../read-studio-inspector-aside-source";

const inspectorSource = readStudioInspectorAsideSurface();
const utilitySource = readFileSync(
  new URL("../StudioInspectorUtilityPanels.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(
  source: string,
  startToken: string,
  endToken: string,
): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end <= start) {
    throw new Error(`Missing source boundary: ${startToken} -> ${endToken}`);
  }
  return source.slice(start, end);
}

describe("Studio drawing palette mobile accessibility boundary", () => {
  it("keeps drawing actions finger-sized without inflating desktop controls", () => {
    const shapeControls = sourceBetween(
      inspectorSource,
      '{drawMode === "shape" && (',
      "<StudioInspectorDrawColorControls",
    );
    const colorControls = sourceBetween(
      utilitySource,
      "export function StudioInspectorDrawColorControls",
      "export function StudioInspectorMutationLockNotice",
    );

    expect(inspectorSource).toContain("<StudioInspectorDrawColorControls");
    expect(shapeControls).toContain(
      "size-11 place-items-center rounded-lg",
    );
    expect(shapeControls).toContain("lg:size-9");
    expect(colorControls).toContain(
      "size-11 place-items-center rounded-lg",
    );
    expect(colorControls).toContain("lg:size-5");
  });

  it("announces the active swatch instead of relying on its visual ring", () => {
    const colorControls = sourceBetween(
      utilitySource,
      "export function StudioInspectorDrawColorControls",
      "export function StudioInspectorMutationLockNotice",
    );

    expect(colorControls).toContain("aria-pressed={");
    expect(colorControls).toContain(
      'aria-label={`${swatch} 색상 선택`}',
    );
    expect(colorControls).toContain(
      'aria-label="사용자 정의 색상 선택"',
    );
    expect(colorControls).toContain("aria-label={");
    expect(colorControls).toContain("eyedropperActive");
    expect(colorControls).toContain('"스포이드로 캔버스 색상 선택"');
  });
});
