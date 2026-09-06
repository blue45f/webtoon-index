import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  createStudioBg3dContactShadowAlphaTexture,
  STUDIO_BG3D_CONTACT_SHADOW_TEXTURE_SIZE,
} from "./studio-bg3d-contact-shadow-texture";

function channelAt(data: Uint8Array, x: number, y: number, channel: number): number {
  return data[(y * STUDIO_BG3D_CONTACT_SHADOW_TEXTURE_SIZE + x) * 4 + channel]!;
}

describe("createStudioBg3dContactShadowAlphaTexture", () => {
  it("builds a deterministic RGBA feather whose green channel is safe for alphaMap", () => {
    const first = createStudioBg3dContactShadowAlphaTexture();
    const second = createStudioBg3dContactShadowAlphaTexture();
    const firstData = first.image.data as Uint8Array;
    const secondData = second.image.data as Uint8Array;
    const center = STUDIO_BG3D_CONTACT_SHADOW_TEXTURE_SIZE / 2;

    expect(first.image).toMatchObject({
      width: STUDIO_BG3D_CONTACT_SHADOW_TEXTURE_SIZE,
      height: STUDIO_BG3D_CONTACT_SHADOW_TEXTURE_SIZE,
    });
    expect(firstData).toEqual(secondData);
    expect(channelAt(firstData, center, center, 1)).toBeGreaterThan(250);
    expect(channelAt(firstData, center, center / 2, 1)).toBeGreaterThan(0);
    expect(channelAt(firstData, 0, 0, 1)).toBe(0);
    expect(channelAt(firstData, center, center, 0)).toBe(
      channelAt(firstData, center, center, 1),
    );
    expect(channelAt(firstData, center, center, 2)).toBe(
      channelAt(firstData, center, center, 1),
    );
    expect(channelAt(firstData, center, center, 3)).toBe(255);

    first.dispose();
    second.dispose();
  });

  it("uses linear filtering without mipmaps or color-space conversion", () => {
    const texture = createStudioBg3dContactShadowAlphaTexture();
    const dispose = vi.spyOn(texture, "dispose");

    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.type).toBe(THREE.UnsignedByteType);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(texture.minFilter).toBe(THREE.LinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);

    texture.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
