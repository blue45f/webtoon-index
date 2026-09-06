import { describe, it, expect } from "vitest";

import {
  applyStudioLayerBorderEffect,
  applyStudioLayerBorderEffectInPlace,
  DEFAULT_STUDIO_LAYER_BORDER_EFFECT,
  isIdentityStudioLayerBorderEffect,
  normalizeStudioLayerBorderEffect,
  STUDIO_LAYER_BORDER_EFFECT_THICKNESS_RANGE,
  studioLayerBorderEffectCachePad,
  type StudioLayerBorderEffectSettings,
} from "./studio-layer-border-effect";

if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  } as any;
}

describe('StudioLayerBorderEffect', () => {
  it('returns identity if disabled or thickness 0', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    const img = new ImageData(data, 4, 4);
    const settings: StudioLayerBorderEffectSettings = {
      enabled: false,
      thickness: 2,
      color: '#ff0000',
      type: 'outer'
    };
    const res = applyStudioLayerBorderEffect(img, settings);
    expect(res.data).toEqual(img.data);
    expect(res).not.toBe(img);
  });

  it('applies outer border', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    // 1 pixel in center
    data[(1 * 4 + 1) * 4 + 3] = 255; 
    
    const img = new ImageData(data, 4, 4);
    const settings: StudioLayerBorderEffectSettings = {
      enabled: true,
      thickness: 1,
      color: '#ff0000',
      type: 'outer'
    };
    
    const res = applyStudioLayerBorderEffect(img, settings);
    // The pixel to the right should be red
    const rightPixel = (1 * 4 + 2) * 4;
    expect(res.data[rightPixel]).toBe(255);
    expect(res.data[rightPixel + 1]).toBe(0);
    expect(res.data[rightPixel + 2]).toBe(0);
    expect(res.data[rightPixel + 3]).toBe(255);
  });

  it('applies inner border', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    // Fill 2x2 block in the center (x=1..2, y=1..2)
    for (let y = 1; y < 3; y++) {
      for (let x = 1; x < 3; x++) {
        const idx = (y * 4 + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = 255;
      }
    }
    const img = new ImageData(data, 4, 4);
    const settings: StudioLayerBorderEffectSettings = {
      enabled: true,
      thickness: 1,
      color: '#00ff00',
      type: 'inner'
    };
    
    const res = applyStudioLayerBorderEffect(img, settings);
    // Corner of the block (1,1) should be green (since it touches outside)
    const blockCornerIdx = (1 * 4 + 1) * 4;
    expect(res.data[blockCornerIdx]).toBe(0);
    expect(res.data[blockCornerIdx + 1]).toBe(255);
    expect(res.data[blockCornerIdx + 2]).toBe(0);
    expect(res.data[blockCornerIdx + 3]).toBe(255);
  });

  it("in-place variant matches the copying variant byte-for-byte", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    data[(1 * 4 + 1) * 4 + 3] = 255;
    const settings: StudioLayerBorderEffectSettings = {
      enabled: true,
      thickness: 1,
      color: '#ff0000',
      type: 'outer'
    };

    const copied = applyStudioLayerBorderEffect(new ImageData(new Uint8ClampedArray(data), 4, 4), settings);
    const surface = { width: 4, height: 4, data: new Uint8ClampedArray(data) };
    applyStudioLayerBorderEffectInPlace(surface, settings);
    expect(surface.data).toEqual(copied.data);
  });

  it("in-place variant is a no-op for disabled settings", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    data[(1 * 4 + 1) * 4 + 3] = 255;
    const surface = { width: 4, height: 4, data: new Uint8ClampedArray(data) };
    applyStudioLayerBorderEffectInPlace(surface, { ...DEFAULT_STUDIO_LAYER_BORDER_EFFECT });
    expect(surface.data).toEqual(data);
  });
});

describe('StudioLayerBorderEffect — normalize/identity/cachePad', () => {
  it('normalizes thickness into the UI range and keeps invalid thickness as identity 0', () => {
    expect(normalizeStudioLayerBorderEffect({ enabled: true, thickness: 500 }).thickness)
      .toBe(STUDIO_LAYER_BORDER_EFFECT_THICKNESS_RANGE.max);
    expect(normalizeStudioLayerBorderEffect({ enabled: true, thickness: 0.2 }).thickness)
      .toBe(STUDIO_LAYER_BORDER_EFFECT_THICKNESS_RANGE.min);
    for (const thickness of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(normalizeStudioLayerBorderEffect({ enabled: true, thickness }).thickness).toBe(0);
    }
  });

  it('falls back to safe color/type without inventing an enabled state', () => {
    const normalized = normalizeStudioLayerBorderEffect({ color: ' ', type: 'diagonal' as never });
    expect(normalized).toEqual({
      enabled: false,
      thickness: 0,
      color: '#000000',
      type: 'outer',
      antiAliased: true,
      respectTransparency: true,
    });
    expect(normalizeStudioLayerBorderEffect({ color: '' }).color).toBe('#000000');
    expect(normalizeStudioLayerBorderEffect(null).enabled).toBe(false);
  });

  it('respects semi-transparent pixels on soft brush edges (CSP v5.1)', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    // Center pixel with semi-transparent alpha (100)
    const centerIdx = (1 * 4 + 1) * 4;
    data[centerIdx] = 0;
    data[centerIdx + 1] = 0;
    data[centerIdx + 2] = 255;
    data[centerIdx + 3] = 100; // Semi-transparent blue

    const img = new ImageData(data, 4, 4);
    const settings: StudioLayerBorderEffectSettings = {
      enabled: true,
      thickness: 1,
      color: '#ff0000',
      type: 'outer',
      respectTransparency: true,
    };

    const res = applyStudioLayerBorderEffect(img, settings);
    // Outer border should blend around the semi-transparent pixel without crushing it
    expect(res.data[centerIdx + 3]).toBeGreaterThanOrEqual(100);
    // Right adjacent pixel has border stroke
    const rightPixel = (1 * 4 + 2) * 4;
    expect(res.data[rightPixel]).toBe(255); // Red
    expect(res.data[rightPixel + 3]).toBeGreaterThan(0);
  });

  it('identity — disabled or no effective thickness', () => {
    expect(isIdentityStudioLayerBorderEffect(undefined)).toBe(true);
    expect(isIdentityStudioLayerBorderEffect(DEFAULT_STUDIO_LAYER_BORDER_EFFECT)).toBe(true);
    expect(isIdentityStudioLayerBorderEffect({ enabled: true, thickness: 0 })).toBe(true);
    expect(isIdentityStudioLayerBorderEffect({ enabled: true, thickness: 2 })).toBe(false);
  });

  it('cachePad pads silhouette-growing types only', () => {
    expect(studioLayerBorderEffectCachePad({ enabled: true, thickness: 2.4, type: 'outer' })).toBe(4);
    expect(studioLayerBorderEffectCachePad({ enabled: true, thickness: 2, type: 'center' })).toBe(3);
    expect(studioLayerBorderEffectCachePad({ enabled: true, thickness: 2, type: 'inner' })).toBe(0);
    expect(studioLayerBorderEffectCachePad({ enabled: false, thickness: 2, type: 'outer' })).toBe(0);
  });
});

