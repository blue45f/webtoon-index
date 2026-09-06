import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { acquireStudioVrmBroadcastRenderLease } from "./studio-vrm-broadcast-render-lease";

function createRenderer(initialColor: string, initialAlpha: number) {
  let color = new THREE.Color(initialColor);
  let alpha = initialAlpha;
  return {
    getClearAlpha: () => alpha,
    getClearColor: (target: THREE.Color) => target.copy(color),
    setClearColor: vi.fn((next: THREE.ColorRepresentation, nextAlpha = 1) => {
      color = new THREE.Color(next);
      alpha = nextAlpha;
    }),
    read: () => ({ color: `#${color.getHexString()}`, alpha }),
  };
}

describe("studio VRM broadcast renderer lease", () => {
  it("applies an opaque fixed background and restores exact renderer and scene values", () => {
    const renderer = createRenderer("#123456", 0.35);
    const scene = new THREE.Scene();
    const originalBackground = new THREE.Texture();
    scene.background = originalBackground;
    const environment = { visible: true };
    const ground = { visible: false };
    const invalidate = vi.fn();

    const result = acquireStudioVrmBroadcastRenderLease({
      renderer,
      scene,
      environment,
      ground,
      backgroundHex: "#00b140",
      invalidate,
    });

    expect(result.ok).toBe(true);
    expect(renderer.read()).toEqual({ color: "#00b140", alpha: 1 });
    expect(scene.background).toBeNull();
    expect(environment.visible).toBe(false);
    expect(ground.visible).toBe(false);
    if (!result.ok) return;

    result.lease.release();
    expect(renderer.read()).toEqual({ color: "#123456", alpha: 0.35 });
    expect(scene.background).toBe(originalBackground);
    expect(environment.visible).toBe(true);
    expect(ground.visible).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(2);

    result.lease.release();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("fails closed before renderer mutation when scene helpers are unavailable", () => {
    const renderer = createRenderer("#000000", 0);
    const scene = new THREE.Scene();

    const result = acquireStudioVrmBroadcastRenderLease({
      renderer,
      scene,
      environment: null,
      ground: { visible: true },
      backgroundHex: "#0047bb",
    });

    expect(result).toMatchObject({ ok: false });
    expect(renderer.setClearColor).not.toHaveBeenCalled();
  });

  it("rolls every prior value back when applying the renderer color fails", () => {
    const currentColor = new THREE.Color("#6a5139");
    let setCalls = 0;
    const renderer = {
      getClearAlpha: () => 0.2,
      getClearColor: (target: THREE.Color) => target.copy(currentColor),
      setClearColor: vi.fn(() => {
        setCalls += 1;
        if (setCalls === 1) throw new Error("context lost");
      }),
    };
    const scene = new THREE.Scene();
    const originalBackground = new THREE.Color("#abcdef");
    scene.background = originalBackground;
    const environment = { visible: false };
    const ground = { visible: true };

    const result = acquireStudioVrmBroadcastRenderLease({
      renderer,
      scene,
      environment,
      ground,
      backgroundHex: "#000000",
    });

    expect(result).toMatchObject({ ok: false });
    expect(scene.background).toBe(originalBackground);
    expect(environment.visible).toBe(false);
    expect(ground.visible).toBe(true);
    expect(renderer.setClearColor).toHaveBeenCalledTimes(2);
  });
});
