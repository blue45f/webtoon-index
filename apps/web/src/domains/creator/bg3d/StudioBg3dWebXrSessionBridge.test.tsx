import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_PATH = fileURLToPath(
  new URL("./StudioBg3dWebXrSessionBridge.tsx", import.meta.url),
);

describe("StudioBg3dWebXrSessionBridge boundary", () => {
  it("reuses the existing R3F WebXRManager and lazily loads only the session authority", async () => {
    const source = await readFile(SOURCE_PATH, "utf8");

    expect(source).toContain("state.gl.xr");
    expect(source).toContain('import("../studio-webxr-session")');
    expect(source).not.toMatch(/new\s+THREE\.WebGLRenderer/);
    expect(source).not.toMatch(/@babylonjs|new\s+Engine\s*\(/);
    expect(source).not.toMatch(/requestAnimationFrame/);
  });

  it("disposes device sessions and publishes null ownership on unmount", async () => {
    const source = await readFile(SOURCE_PATH, "utf8");

    expect(source).toContain("publishController(null)");
    expect(source).toContain("void controller.dispose()");
    expect(source).toContain("if (!disposed) publishState(state)");
  });

  it("renders the stable portal scene into XR without retaining the monitor scissor", async () => {
    const source = await readFile(SOURCE_PATH, "utf8");

    expect(source).toContain("export function StudioBg3dImmersiveRenderBridge");
    expect(source).toContain("state.gl.setScissorTest(false)");
    expect(source).toContain("state.gl.render(state.scene, state.camera)");
    expect(source).toContain("state.gl.setScissorTest(scissorTest)");
    expect(source).toContain("}, 2)");
  });
});
