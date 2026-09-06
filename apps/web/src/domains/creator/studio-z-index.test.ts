import { describe, expect, it } from "vitest";

import { STUDIO_Z, STUDIO_Z_CLASS } from "./studio-z-index";

describe("studio z-index scale", () => {
  it("orders chrome so menubar outranks options, and portaled menus beat chrome", () => {
    expect(STUDIO_Z.canvasHud).toBeLessThan(STUDIO_Z.toolRail);
    expect(STUDIO_Z.toolRail).toBeLessThan(STUDIO_Z.toolBelt);
    expect(STUDIO_Z.toolBelt).toBeLessThan(STUDIO_Z.optionsStrip);
    expect(STUDIO_Z.optionsStrip).toBeLessThan(STUDIO_Z.menubar);
    // Portaled File/Edit/export panels must clear menubar + tool popovers (overflow clips absolute).
    expect(STUDIO_Z.menubar).toBeLessThan(STUDIO_Z.menubarMenu);
    expect(STUDIO_Z.toolPopover).toBeLessThan(STUDIO_Z.menubarMenu);
    expect(STUDIO_Z.toolPopover).toBeLessThan(STUDIO_Z.modal);
    expect(STUDIO_Z.modal).toBeLessThan(STUDIO_Z.confirm);
    expect(STUDIO_Z.menubarMenu).toBe(STUDIO_Z.workspace);
    expect(STUDIO_Z.workspace).toBeLessThan(STUDIO_Z.help);
    expect(STUDIO_Z.help).toBeLessThan(STUDIO_Z.legal);
    // 파괴 승인 창은 자기를 띄운 어떤 모달보다도 위여야 한다(레이어 리프트 140, 손실 미리보기 130).
    expect(STUDIO_Z.legal).toBeLessThan(STUDIO_Z.destructiveConfirm);
    expect(STUDIO_Z.destructiveConfirm).toBeGreaterThan(140);
  });

  it("exposes matching Tailwind arbitrary class tokens", () => {
    expect(STUDIO_Z_CLASS.menubar).toBe("z-[50]");
    expect(STUDIO_Z_CLASS.menubarMenu).toBe("z-[100]");
    expect(STUDIO_Z_CLASS.toolPopover).toBe("z-[70]");
    expect(STUDIO_Z_CLASS.modal).toBe("z-[80]");
    expect(STUDIO_Z_CLASS.workspace).toBe("z-[100]");
  });
});
