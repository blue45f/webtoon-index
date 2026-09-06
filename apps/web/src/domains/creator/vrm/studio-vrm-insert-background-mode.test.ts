import { describe, expect, it } from "vitest";

import { resolveStudioVrmInsertBackgroundMode } from "./studio-vrm-insert-background-mode";

describe("resolveStudioVrmInsertBackgroundMode", () => {
  it("admits subject-only transparent character cutouts", () => {
    const result = resolveStudioVrmInsertBackgroundMode({ transparent: true });
    expect(result).toEqual({
      ok: true,
      plan: {
        transparent: true,
        subjectOnly: true,
        captureAlpha: 0,
        backgroundColor: "#ffffff",
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.plan)).toBe(true);
  });

  it("admits opaque inserts with validated background color", () => {
    const result = resolveStudioVrmInsertBackgroundMode({
      transparent: false,
      backgroundColor: "#A1B2C3",
    });
    expect(result).toEqual({
      ok: true,
      plan: {
        transparent: false,
        subjectOnly: false,
        captureAlpha: 1,
        backgroundColor: "#a1b2c3",
      },
    });
  });

  it("fails closed with Korean reasons for hostile inputs", () => {
    expect(resolveStudioVrmInsertBackgroundMode({ transparent: "yes" })).toMatchObject({
      ok: false,
      code: "invalid-transparent",
      reason: "3D 캐릭터 삽입 투명 배경 설정이 올바르지 않습니다.",
    });
    expect(
      resolveStudioVrmInsertBackgroundMode({
        transparent: true,
        backgroundColor: "white",
      }),
    ).toMatchObject({
      ok: false,
      code: "invalid-background-color",
      reason: "3D 캐릭터 삽입 배경 색상이 올바르지 않습니다.",
    });
    expect(resolveStudioVrmInsertBackgroundMode(null as never)).toMatchObject({
      ok: false,
      code: "invalid-transparent",
    });
  });
});
