import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_LINEAR_UNPREMULTIPLY_SHADER_CHUNK,
  createStudioBg3dStraightAlphaOutputPass,
} from "./studio-bg3d-straight-alpha-output-pass";

describe("Studio BG3D straight-alpha output pass", () => {
  it("unpremultiplies linear RGB before tone mapping and the sRGB transfer", () => {
    const pass = createStudioBg3dStraightAlphaOutputPass();
    const shader = pass.material.fragmentShader;
    const sampleIndex = shader.indexOf("gl_FragColor = texture2D( tDiffuse, vUv );");
    const unpremultiplyIndex = shader.indexOf("gl_FragColor.rgb /= gl_FragColor.a;");
    const toneMappingIndex = shader.indexOf("// tone mapping");
    const colorSpaceIndex = shader.indexOf("// color space");

    expect(pass.material.name).toBe("Studio straight-alpha output");
    expect(shader).toContain(STUDIO_BG3D_LINEAR_UNPREMULTIPLY_SHADER_CHUNK);
    expect(sampleIndex).toBeGreaterThanOrEqual(0);
    expect(unpremultiplyIndex).toBeGreaterThan(sampleIndex);
    expect(toneMappingIndex).toBeGreaterThan(unpremultiplyIndex);
    expect(colorSpaceIndex).toBeGreaterThan(toneMappingIndex);
    expect(shader).toContain("gl_FragColor.rgb = vec3( 0.0 );");
    pass.material.dispose();
  });

  it("owns a disposable per-capture material without disposing Three's shared fullscreen geometry", () => {
    const pass = createStudioBg3dStraightAlphaOutputPass();
    const disposeMaterial = vi.spyOn(pass.material, "dispose");

    pass.material.dispose();

    expect(disposeMaterial).toHaveBeenCalledOnce();
  });
});
