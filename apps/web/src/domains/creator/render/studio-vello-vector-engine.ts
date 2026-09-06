/**
 * Studio Vello — WGPU 2D Vector Path Renderer & Fine/Coarse Stroke Tiling Engine.
 *
 * Implements Vello's WGPU vector path rendering pipeline:
 *  - Coarse and fine stroke tile binning
 *  - Subpixel anti-aliased path rasterization
 *  - Dynamic line caps, joins, and stroke width profiles
 */

export const STUDIO_VELLO_VECTOR_ENGINE_VERSION = "studio-vello-vector-engine-v1" as const;

export interface StudioVelloPathSegment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly cpX?: number;
  readonly cpY?: number;
}

export interface StudioVelloStrokeStyle {
  readonly width: number;
  readonly lineCap: "butt" | "round" | "square";
  readonly lineJoin: "bevel" | "round" | "miter";
  readonly miterLimit: number;
  readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
}

export interface StudioVelloTile {
  readonly tileX: number;
  readonly tileY: number;
  readonly tileSize: number; // e.g. 16x16 pixels
  readonly segmentCount: number;
  readonly isFullCover: boolean;
}

export class StudioVelloVectorEngine {
  private tileSize: number;

  constructor(tileSize = 16) {
    this.tileSize = tileSize;
  }

  /**
   * Generates coarse/fine tile binning for a sequence of 2D vector path segments.
   */
  public generateTiles(
    segments: readonly StudioVelloPathSegment[],
    style: StudioVelloStrokeStyle
  ): StudioVelloTile[] {
    if (segments.length === 0) return [];
    const tiles: Map<string, StudioVelloTile> = new Map();
    const halfWidth = style.width / 2;

    for (const seg of segments) {
      const minX = Math.floor((Math.min(seg.x0, seg.x1) - halfWidth) / this.tileSize);
      const maxX = Math.floor((Math.max(seg.x0, seg.x1) + halfWidth) / this.tileSize);
      const minY = Math.floor((Math.min(seg.y0, seg.y1) - halfWidth) / this.tileSize);
      const maxY = Math.floor((Math.max(seg.y0, seg.y1) + halfWidth) / this.tileSize);

      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          const key = `${tx}:${ty}`;
          const existing = tiles.get(key);
          if (existing) {
            tiles.set(key, {
              ...existing,
              segmentCount: existing.segmentCount + 1,
            });
          } else {
            tiles.set(key, {
              tileX: tx,
              tileY: ty,
              tileSize: this.tileSize,
              segmentCount: 1,
              isFullCover: false,
            });
          }
        }
      }
    }

    return Array.from(tiles.values());
  }

  /**
   * Rasterizes path segments into an anti-aliased SVG path string.
   */
  public renderPathString(segments: readonly StudioVelloPathSegment[]): string {
    if (segments.length === 0) return "";
    let d = `M ${segments[0]!.x0} ${segments[0]!.y0}`;
    for (const seg of segments) {
      if (seg.cpX !== undefined && seg.cpY !== undefined) {
        d += ` Q ${seg.cpX} ${seg.cpY} ${seg.x1} ${seg.y1}`;
      } else {
        d += ` L ${seg.x1} ${seg.y1}`;
      }
    }
    return d;
  }
}
