import { describe, expect, it } from "vitest";

import { resolveStudioBrushRenderFamily } from "../studio-brush";

import {
  resolveStudioBrushBehaviorKind,
  resolveStudioBrushBehaviorPresentation,
} from "./studio-brush-behavior-ui";

describe("studio brush behavior presentation", () => {
  it("maps wash / air / line families for pack and core ids", () => {
    expect(resolveStudioBrushBehaviorKind("pen")).toBe("line");
    expect(resolveStudioBrushBehaviorKind("watercolor")).toBe("wash");
    expect(resolveStudioBrushBehaviorKind("ink-wash")).toBe("wash");
    expect(resolveStudioBrushBehaviorKind("watercolor-wet-wash")).toBe("wash");
    expect(resolveStudioBrushBehaviorKind("inkwash-bleed-wash")).toBe("wash");
    expect(resolveStudioBrushBehaviorKind("airbrush")).toBe("air");
    expect(resolveStudioBrushBehaviorKind("pencil")).toBe("dry");
  });

  it("keeps wash presentation coaching consistent with shared size/opacity controls", () => {
    const wash = resolveStudioBrushBehaviorPresentation("watercolor");
    expect(wash.labelKo).toBe("번짐·수채");
    expect(wash.hintKo).toMatch(/크기·농도·색/);
    expect(resolveStudioBrushRenderFamily("watercolor-flat-wash")).toBe("watercolor");
  });
});
