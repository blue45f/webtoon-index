import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PAGE_GRADE } from "../studio-page-grade";

import {
  StudioPageGradeBakeUnavailableError,
  bakeStudioPageGradeIntoCanvas,
} from "./studio-raster-export-orchestration-runtime";

describe("bakeStudioPageGradeIntoCanvas exact grade authority", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the source only when the operation selected the explicit default-grade no-op", () => {
    const source = { width: 320, height: 180 } as HTMLCanvasElement;
    vi.stubGlobal("document", {
      createElement: vi.fn(() => {
        throw new Error("default grade must not allocate a surface");
      }),
    });

    expect(bakeStudioPageGradeIntoCanvas(source, DEFAULT_PAGE_GRADE)).toBe(source);
  });

  it("does not export the ungraded source when the selected grade surface is unavailable", () => {
    const source = { width: 320, height: 180 } as HTMLCanvasElement;
    const output = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal("document", { createElement: vi.fn(() => output) });

    expect(() => bakeStudioPageGradeIntoCanvas(source, {
      ...DEFAULT_PAGE_GRADE,
      brightness: 1.1,
    })).toThrow(StudioPageGradeBakeUnavailableError);
  });
});
