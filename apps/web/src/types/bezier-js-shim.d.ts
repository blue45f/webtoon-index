declare module "bezier-js" {
  export interface BezierPoint {
    readonly x: number;
    readonly y: number;
    readonly t?: number;
    readonly d?: number;
  }

  export interface BezierDimensionBounds {
    readonly min: number;
    readonly mid: number;
    readonly max: number;
    readonly size: number;
  }

  export interface BezierBounds {
    readonly x: BezierDimensionBounds;
    readonly y: BezierDimensionBounds;
  }

  export interface BezierSplit {
    readonly left: Bezier;
    readonly right: Bezier;
    readonly span: readonly BezierPoint[];
  }

  export class Bezier {
    constructor(points: readonly BezierPoint[]);
    readonly points: readonly BezierPoint[];
    length(): number;
    bbox(): BezierBounds;
    get(t: number): BezierPoint;
    getLUT(steps?: number): readonly (BezierPoint & { readonly t: number })[];
    project(point: BezierPoint): BezierPoint & { readonly t: number; readonly d: number };
    split(t: number): BezierSplit;
    split(t1: number, t2: number): Bezier;
  }
}
