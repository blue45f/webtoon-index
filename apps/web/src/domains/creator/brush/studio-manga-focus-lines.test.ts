import { describe, it, expect, vi } from "vitest";

import {
  generateStudioMangaLinesPathData,
  renderStudioMangaLinesToCanvas,
  applyStudioMangaFocusLinesFilter,
  type StudioMangaFocusLinesSettings,
} from "./studio-manga-focus-lines";

describe('StudioMangaFocusLines', () => {
  const baseSettings: StudioMangaFocusLinesSettings = {
    kind: 'radial-focus',
    centerX: 0.5,
    centerY: 0.5,
    innerRadius: 0.2,
    outerRadius: 0.9,
    density: 0.5,
    lineWidth: 5,
    irregularity: 0.5,
    angle: Math.PI / 4,
    color: '#000000',
    seed: 12345,
  };

  it('generates deterministic path data', () => {
    const path1 = generateStudioMangaLinesPathData(1000, 1000, baseSettings);
    const path2 = generateStudioMangaLinesPathData(1000, 1000, baseSettings);
    
    expect(path1).toBe(path2);
    expect(path1.length).toBeGreaterThan(0);
  });

  it('generates different paths for different seeds', () => {
    const path1 = generateStudioMangaLinesPathData(1000, 1000, baseSettings);
    const path2 = generateStudioMangaLinesPathData(1000, 1000, { ...baseSettings, seed: 99999 });
    
    expect(path1).not.toBe(path2);
  });

  it('supports radial-focus kind', () => {
    const path = generateStudioMangaLinesPathData(800, 600, { ...baseSettings, kind: 'radial-focus' });
    expect(path).toContain('M');
    expect(path).toContain('L');
    expect(path).toContain('Z');
  });

  it('supports parallel-speed kind', () => {
    const path = generateStudioMangaLinesPathData(800, 600, { ...baseSettings, kind: 'parallel-speed' });
    expect(path).toContain('M');
  });

  it('supports burst-flash kind', () => {
    const path = generateStudioMangaLinesPathData(800, 600, { ...baseSettings, kind: 'burst-flash' });
    expect(path).toContain('M');
  });

  it('bounds output coordinates within reasonable ranges', () => {
    const path = generateStudioMangaLinesPathData(100, 100, baseSettings);
    // Extract numbers from the SVG path
    const numbers = [...path.matchAll(/-?\d+(\.\d+)?/g)].map(m => parseFloat(m[0]));
    
    for (const num of numbers) {
      expect(Number.isFinite(num)).toBe(true);
      expect(Math.abs(num)).toBeLessThan(10000); 
    }
  });

  it('filter pixel modification preserves alpha or runs correctly', () => {
    const width = 10;
    const height = 10;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 4 === 3 ? 255 : 0; // Solid alpha
    }
    
    // Create ImageData mock if not available in vitest environment
    let ImageDataCtor;
    if (typeof ImageData !== 'undefined') {
      ImageDataCtor = ImageData;
    } else {
      ImageDataCtor = class ImageDataMock {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      } as any;
      (global as any).ImageData = ImageDataCtor;
    }

    const source = new ImageDataCtor(data, width, height) as ImageData;

    // We can mock OffscreenCanvas or let the fallback run
    if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') {
       (global as any).document = {
         createElement: vi.fn().mockReturnValue({
           width: 10,
           height: 10,
           getContext: vi.fn().mockReturnValue({
             putImageData: vi.fn(),
             fill: vi.fn(),
             getImageData: vi.fn().mockReturnValue(new ImageDataCtor(data, width, height))
           })
         })
       };
    } else if (typeof document !== 'undefined') {
        // Mock for happy-dom/jsdom if canvas lacks full features
        const originalCreateElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
          if (tag === 'canvas') {
            return {
              width: 10,
              height: 10,
              getContext: () => ({
                save: vi.fn(),
                restore: vi.fn(),
                putImageData: vi.fn(),
                fill: vi.fn(),
                getImageData: vi.fn().mockReturnValue(new ImageDataCtor(data, width, height))
              })
            } as unknown as HTMLCanvasElement;
          }
          return originalCreateElement(tag);
        });
     }

    // We also mock Path2D to prevent errors in purely nodish environments without canvas polyfills
    if (typeof Path2D === 'undefined') {
      (global as unknown as Record<string, unknown>).Path2D = class Path2DMock {
        constructor(_path?: string) {}
      };
    }

    const result = applyStudioMangaFocusLinesFilter(source, baseSettings);
    expect(result).toBeDefined();
    expect(result.width).toBe(width);
    expect(result.height).toBe(height);
  });

  it('renders onto canvas context cleanly', () => {
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    expect(() => renderStudioMangaLinesToCanvas(mockCtx, 800, 600, baseSettings)).not.toThrow();
    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
  });
});
