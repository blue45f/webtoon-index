import { describe, expect, it } from "vitest";

import { compareStudioValidationStrings } from "./studio-validation-string-order";

describe("Studio validation string order", () => {
  it("preserves JavaScript's default UTF-16 code-unit order", () => {
    const values = ["z", "A", "a", "é", "e\u0301", "10", "2", "😀"];

    expect([...values].sort(compareStudioValidationStrings)).toEqual([
      "10",
      "2",
      "A",
      "a",
      "e\u0301",
      "z",
      "é",
      "😀",
    ]);
    expect([...values].sort(compareStudioValidationStrings)).toEqual([...values].sort());
  });

  it("returns zero only for identical strings", () => {
    expect(compareStudioValidationStrings("same", "same")).toBe(0);
    expect(compareStudioValidationStrings("é", "e\u0301")).not.toBe(0);
  });
});
