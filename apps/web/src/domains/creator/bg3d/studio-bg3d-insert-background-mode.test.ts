import { describe, expect, it } from "vitest";

import {
  resolveStudioBg3dInsertBackgroundFromDocument,
  resolveStudioBg3dInsertBackgroundMode,
  toStudioBg3dInsertCaptureBackground,
} from "./studio-bg3d-insert-background-mode";

describe("resolveStudioBg3dInsertBackgroundMode", () => {
  it("admits subject-only transparent insert with capture alpha 0", () => {
    const result = resolveStudioBg3dInsertBackgroundMode({ transparent: true });
    expect(result).toEqual({
      ok: true,
      plan: {
        transparent: true,
        documentBackgroundMode: "transparent",
        captureAlpha: 0,
        suppressSceneBackground: true,
        clearColor: null,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.plan)).toBe(true);
  });

  it("admits opaque sky insert with capture alpha 1", () => {
    const result = resolveStudioBg3dInsertBackgroundMode({
      transparent: false,
      clearColor: "#AbCdEf",
    });
    expect(result).toEqual({
      ok: true,
      plan: {
        transparent: false,
        documentBackgroundMode: "sky-preset",
        captureAlpha: 1,
        suppressSceneBackground: false,
        clearColor: "#abcdef",
      },
    });
  });

  it("fails closed on non-boolean transparent and invalid clear colors with Korean reasons", () => {
    expect(resolveStudioBg3dInsertBackgroundMode({ transparent: 1 })).toMatchObject({
      ok: false,
      code: "invalid-transparent",
      reason: "3D 삽입 투명 배경 설정이 올바르지 않습니다.",
    });
    expect(resolveStudioBg3dInsertBackgroundMode({ transparent: "true" })).toMatchObject({
      ok: false,
      code: "invalid-transparent",
    });
    expect(
      resolveStudioBg3dInsertBackgroundMode({ transparent: true, clearColor: "red" }),
    ).toMatchObject({
      ok: false,
      code: "invalid-clear-color",
      reason: "3D 삽입 배경 색상이 올바르지 않습니다.",
    });
    expect(resolveStudioBg3dInsertBackgroundMode(null as never)).toMatchObject({
      ok: false,
      code: "invalid-transparent",
    });
  });
});

describe("resolveStudioBg3dInsertBackgroundFromDocument", () => {
  it("enables cutout when either document field requests transparency", () => {
    expect(
      resolveStudioBg3dInsertBackgroundFromDocument({
        transparentBackground: true,
        backgroundMode: "sky-preset",
      }),
    ).toMatchObject({ ok: true, plan: { transparent: true, captureAlpha: 0 } });

    expect(
      resolveStudioBg3dInsertBackgroundFromDocument({
        transparentBackground: false,
        backgroundMode: "transparent",
      }),
    ).toMatchObject({ ok: true, plan: { transparent: true, captureAlpha: 0 } });
  });

  it("defaults to opaque sky when fields are absent", () => {
    expect(resolveStudioBg3dInsertBackgroundFromDocument({})).toMatchObject({
      ok: true,
      plan: {
        transparent: false,
        documentBackgroundMode: "sky-preset",
        captureAlpha: 1,
        suppressSceneBackground: false,
      },
    });
  });

  it("fails closed on malformed document fields", () => {
    expect(
      resolveStudioBg3dInsertBackgroundFromDocument({ transparentBackground: "yes" }),
    ).toMatchObject({ ok: false, code: "invalid-transparent" });
    expect(
      resolveStudioBg3dInsertBackgroundFromDocument({ backgroundMode: "hdr" }),
    ).toMatchObject({
      ok: false,
      code: "invalid-background-mode",
      reason: "3D 삽입 배경 모드가 올바르지 않습니다.",
    });
  });
});

describe("toStudioBg3dInsertCaptureBackground", () => {
  it("projects an admitted plan into a capture request fragment", () => {
    const result = resolveStudioBg3dInsertBackgroundMode({ transparent: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStudioBg3dInsertCaptureBackground(result.plan, "#f2b183")).toEqual({
      color: "#f2b183",
      alpha: 0,
    });
  });

  it("prefers the plan clear color when present", () => {
    const result = resolveStudioBg3dInsertBackgroundMode({
      transparent: false,
      clearColor: "#112233",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toStudioBg3dInsertCaptureBackground(result.plan, "#ffffff")).toEqual({
      color: "#112233",
      alpha: 1,
    });
  });

  it("throws on invalid clear colors (engine boundary)", () => {
    const result = resolveStudioBg3dInsertBackgroundMode({ transparent: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => toStudioBg3dInsertCaptureBackground(result.plan, "not-hex")).toThrow(TypeError);
  });
});
