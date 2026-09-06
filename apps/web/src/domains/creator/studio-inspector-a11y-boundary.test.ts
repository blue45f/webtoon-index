import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { STUDIO_INSPECTOR_ASIDE_SURFACE_FILES } from "./read-studio-inspector-aside-source";

const inspectorSources = [
  ...STUDIO_INSPECTOR_ASIDE_SURFACE_FILES.map((file) => ({
    file,
    source: readFileSync(new URL(`./${file}`, import.meta.url), "utf8"),
  })),
  {
    file: "StudioInspectorFocusSpeedFrameControls.tsx",
    source: readFileSync(
      new URL("./StudioInspectorFocusSpeedFrameControls.tsx", import.meta.url),
      "utf8"
    ),
  },
  {
    file: "StudioInspectorCanvasControls.tsx",
    source: readFileSync(
      new URL("./StudioInspectorCanvasControls.tsx", import.meta.url),
      "utf8"
    ),
  },
  {
    file: "StudioPercentGuideControls.tsx",
    source: readFileSync(
      new URL("./StudioPercentGuideControls.tsx", import.meta.url),
      "utf8"
    ),
  },
  {
    file: "StudioInspectorBubbleAppearanceControls.tsx",
    source: readFileSync(
      new URL("./StudioInspectorBubbleAppearanceControls.tsx", import.meta.url),
      "utf8"
    ),
  },
  {
    file: "StudioInspectorSelectionStrokeControls.tsx",
    source: readFileSync(
      new URL("./StudioInspectorSelectionStrokeControls.tsx", import.meta.url),
      "utf8"
    ),
  },
  {
    file: "StudioFigmaDesignPanel.tsx",
    source: readFileSync(new URL("./StudioFigmaDesignPanel.tsx", import.meta.url), "utf8"),
  },
] as const;
const inspectorSource = inspectorSources.map(({ source }) => source).join("\n");

describe("Studio inspector accessibility boundary", () => {
  it("keeps inspector-only form controls explicitly named", () => {
    expect(inspectorSource).toContain('t("studio.canvas.guideLabel")');
    expect(inspectorSource).toContain('t("studio.canvas.guidesPosition")');
    expect(inspectorSource).toContain("#${index + 1}");
    expect(inspectorSource).toContain('aria-label="선 색상"');
    expect(inspectorSource).toContain('aria-label="채우기 색상"');
    expect(inspectorSource).toContain('aria-label="말풍선 배경 투명"');
    expect(inspectorSource).toContain('aria-label="말풍선 테두리 커스텀"');
    expect(inspectorSource).toContain('aria-label="말풍선 그림자 사용"');
    expect(inspectorSource).toContain('aria-label="글자 외곽선 사용"');
    expect(inspectorSource).toContain('aria-label="글자 그림자 사용"');
    expect(inspectorSource).toContain('aria-label="패널 테두리 커스텀"');
  });

  it("exposes exclusive text alignment and text fill choices as pressed-state buttons", () => {
    const selectionSource = inspectorSources.find(
      ({ file }) => file === "StudioInspectorSelectionSection.tsx",
    )?.source;
    const shapeSource = inspectorSources.find(
      ({ file }) => file === "StudioInspectorShapeSection.tsx",
    )?.source;

    expect(selectionSource).toContain(
      'aria-pressed={(selected.align ?? "center") === a.v}',
    );
    expect(shapeSource).toContain(
      'aria-pressed={(selected.fillType ?? "solid") === mode.v}',
    );
  });

  it("never removes the native outline without a focus-visible replacement", () => {
    const violations = inspectorSources.flatMap(({ file, source }) =>
      source
        .split("\n")
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(
          ({ line }) => line.includes("outline-none") && !line.includes("focus-visible:outline")
        )
        .map(({ number }) => `${file}:${number}`)
    );

    expect(violations).toEqual([]);
    expect(inspectorSource.match(/focus-visible:outline-accent/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
  });
});
