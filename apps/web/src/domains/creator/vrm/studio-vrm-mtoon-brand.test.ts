import { describe, expect, it } from "vitest";

import { isStudioVrmMtoonMaterial } from "./studio-vrm-mtoon-brand";

describe("isStudioVrmMtoonMaterial", () => {
  it("accepts the WebGL ShaderMaterial implementation", () => {
    expect(isStudioVrmMtoonMaterial({ isMToonMaterial: true })).toBe(true);
  });

  it("accepts the WebGPU node-material implementation", () => {
    // The node port carries a different brand flag but the same uniform names, so a guard that
    // only knows the WebGL brand leaves every WebGPU character silently unstyled.
    expect(isStudioVrmMtoonMaterial({ isMToonNodeMaterial: true })).toBe(true);
  });

  it("rejects standard materials and absent values", () => {
    expect(isStudioVrmMtoonMaterial({})).toBe(false);
    expect(isStudioVrmMtoonMaterial({ isMToonMaterial: false })).toBe(false);
    expect(isStudioVrmMtoonMaterial(null)).toBe(false);
    expect(isStudioVrmMtoonMaterial(undefined)).toBe(false);
  });
});
