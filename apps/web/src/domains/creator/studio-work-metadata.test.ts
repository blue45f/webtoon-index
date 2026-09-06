import { describe, expect, it } from "vitest";

import {
  STUDIO_WORK_TITLE_REQUIRED_ERROR,
  clearStudioWorkMetadataValidationError,
  parseStudioWorkTagTokens,
  validateStudioWorkMetadata,
} from "./studio-work-metadata";

describe("Studio work metadata", () => {
  it("normalizes comma, whitespace, and hash-separated tag input without truncating it", () => {
    expect(parseStudioWorkTagTokens(" #로맨스, 일상\n#학원 ")).toEqual([
      "로맨스",
      "일상",
      "학원",
    ]);
  });

  it("clears every local metadata validation error without hiding runtime failures", () => {
    expect(validateStudioWorkMetadata({
      title: "   ",
      description: "",
      tagsText: "",
    })).toBe(STUDIO_WORK_TITLE_REQUIRED_ERROR);
    const localErrors = [
      validateStudioWorkMetadata({ title: "   ", description: "", tagsText: "" }),
      validateStudioWorkMetadata({ title: "a".repeat(121), description: "", tagsText: "" }),
      validateStudioWorkMetadata({ title: "작품", description: "a".repeat(2_001), tagsText: "" }),
      validateStudioWorkMetadata({ title: "작품", description: "", tagsText: "1 2 3 4 5 6 7 8 9" }),
      validateStudioWorkMetadata({ title: "작품", description: "", tagsText: "a".repeat(25) }),
    ];
    expect(localErrors.every((error) => error !== null)).toBe(true);
    expect(localErrors.map(clearStudioWorkMetadataValidationError)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(clearStudioWorkMetadataValidationError("네트워크 연결을 확인해 주세요.")).toBe(
      "네트워크 연결을 확인해 주세요.",
    );
  });

  it("rejects API-over-limit metadata before capture instead of silently dropping tags", () => {
    expect(validateStudioWorkMetadata({
      title: "a".repeat(121),
      description: "",
      tagsText: "",
    })).toContain("120자 이하");
    expect(validateStudioWorkMetadata({
      title: "작품",
      description: "a".repeat(2_001),
      tagsText: "",
    })).toContain("2,000자 이하");
    expect(validateStudioWorkMetadata({
      title: "작품",
      description: "",
      tagsText: "1 2 3 4 5 6 7 8 9",
    })).toContain("최대 8개");
    expect(validateStudioWorkMetadata({
      title: "작품",
      description: "",
      tagsText: "a".repeat(25),
    })).toContain("24자 이하");
  });
});
