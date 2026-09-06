import { describe, expect, it } from "vitest";

import {
  normalizeStudioRememberedPrimaryTool,
  resolveStudioInitialPrimaryTool,
} from "./studio-initial-primary-tool";

describe("studio initial primary tool", () => {
  it("opens an empty document straight on the draw tool", () => {
    // UX 감사 §2.1: 손님이 첫 획을 긋기까지 필요한 조작 수를 0으로 만드는 규칙.
    expect(
      resolveStudioInitialPrimaryTool({ rememberedTool: null, hasExistingContent: false }),
    ).toBe("draw");
  });

  it("keeps select for a document that already has content", () => {
    expect(
      resolveStudioInitialPrimaryTool({ rememberedTool: null, hasExistingContent: true }),
    ).toBe("select");
  });

  it("prefers the remembered tool over both defaults", () => {
    expect(
      resolveStudioInitialPrimaryTool({ rememberedTool: "select", hasExistingContent: false }),
    ).toBe("select");
    expect(
      resolveStudioInitialPrimaryTool({ rememberedTool: "draw", hasExistingContent: true }),
    ).toBe("draw");
  });

  it("normalizes only the two primary tools and never the hand tool", () => {
    expect(normalizeStudioRememberedPrimaryTool("select")).toBe("select");
    expect(normalizeStudioRememberedPrimaryTool("draw")).toBe("draw");
    for (const raw of ["hand", "", "pen", null, undefined, 0, {}, ["draw"]]) {
      expect(normalizeStudioRememberedPrimaryTool(raw)).toBeNull();
    }
  });
});
