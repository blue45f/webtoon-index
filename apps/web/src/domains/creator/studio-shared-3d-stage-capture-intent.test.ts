import { describe, expect, it } from "vitest";

import { shouldCaptureStudioShared3dStageCharacters } from "./studio-shared-3d-stage-capture-intent";

describe("Studio Shared 3D Stage capture intent", () => {
  it.each([
    ["connect", false, true],
    ["connect", true, true],
    ["relink", false, true],
    ["relink", true, true],
    ["refresh", false, false],
    ["refresh", true, true],
    ["background-only", false, false],
    ["background-only", true, false],
    ["unlink", false, false],
    ["unlink", true, false],
  ] as const)(
    "%s · linked=%s → capture=%s",
    (mutationKind, targetHasLinkedCharacters, expected) => {
      expect(shouldCaptureStudioShared3dStageCharacters({
        mutationKind,
        targetHasLinkedCharacters,
      })).toBe(expected);
    },
  );
});
