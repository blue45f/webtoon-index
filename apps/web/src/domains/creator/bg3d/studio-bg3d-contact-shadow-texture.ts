import * as THREE from "three";

export const STUDIO_BG3D_CONTACT_SHADOW_TEXTURE_SIZE = 64;

/**
 * Creates a deterministic, color-space-neutral feather mask for one analytic contact lobe.
 * MeshBasicMaterial samples alphaMap's green channel, so every RGB channel intentionally carries
 * the same mask value. No canvas, network texture, or platform-dependent image decoder is used.
 */
export function createStudioBg3dContactShadowAlphaTexture(): THREE.DataTexture {
  const size = STUDIO_BG3D_CONTACT_SHADOW_TEXTURE_SIZE;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const normalizedY = ((y + 0.5) / size) * 2 - 1;
    for (let x = 0; x < size; x += 1) {
      const normalizedX = ((x + 0.5) / size) * 2 - 1;
      const radialFalloff = Math.max(
        0,
        1 - normalizedX * normalizedX - normalizedY * normalizedY,
      );
      const mask = Math.round(255 * radialFalloff * radialFalloff);
      const offset = (y * size + x) * 4;
      rgba[offset] = mask;
      rgba[offset + 1] = mask;
      rgba[offset + 2] = mask;
      rgba[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(
    rgba,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = "studio-bg3d-contact-shadow-alpha";
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
