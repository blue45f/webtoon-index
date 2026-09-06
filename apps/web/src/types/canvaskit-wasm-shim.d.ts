/**
 * Narrow CanvasKit types used by ToonSpectrum's quality-provider boundary.
 *
 * The upstream package references `@webgpu/types` from its global declaration file. Loading that
 * file changes lib.dom's HTMLCanvasElement overload order and in turn breaks unrelated Canvas2D
 * test mocks. The runtime still resolves the real npm package; this TypeScript-only path mapping
 * keeps the vendor's global declarations out of the application type universe.
 */

export interface CanvasKitInitOptions {
  locateFile?(file: string): string;
}

export interface CanvasKitEnumValue {
  readonly value?: number;
}

export interface CanvasKitPath {
  contains(x: number, y: number): boolean;
  delete(): void;
  getBounds(): Float32Array;
  makeAsWinding(): CanvasKitPath | null;
  makeDashed(on: number, off: number, phase: number): CanvasKitPath | null;
  makeStroked(options?: {
    width?: number;
    miter_limit?: number;
    precision?: number;
    join?: CanvasKitEnumValue;
    cap?: CanvasKitEnumValue;
  }): CanvasKitPath | null;
  toCmds(): Float32Array;
  toSVGString(): string;
}

export interface CanvasKit {
  readonly MOVE_VERB: number;
  readonly LINE_VERB: number;
  readonly QUAD_VERB: number;
  readonly CONIC_VERB: number;
  readonly CUBIC_VERB: number;
  readonly CLOSE_VERB: number;
  readonly Path: {
    new (): CanvasKitPath;
    MakeFromSVGString(pathData: string): CanvasKitPath | null;
    MakeFromOp(
      first: CanvasKitPath,
      second: CanvasKitPath,
      op: CanvasKitEnumValue,
    ): CanvasKitPath | null;
  };
  readonly PathOp: {
    Difference: CanvasKitEnumValue;
    Intersect: CanvasKitEnumValue;
    Union: CanvasKitEnumValue;
    XOR: CanvasKitEnumValue;
    ReverseDifference: CanvasKitEnumValue;
  };
  readonly StrokeCap: {
    Butt: CanvasKitEnumValue;
    Round: CanvasKitEnumValue;
    Square: CanvasKitEnumValue;
  };
  readonly StrokeJoin: {
    Bevel: CanvasKitEnumValue;
    Miter: CanvasKitEnumValue;
    Round: CanvasKitEnumValue;
  };
}

export type Path = CanvasKitPath;
export type PathOp = CanvasKitEnumValue;
export type StrokeCap = CanvasKitEnumValue;
export type StrokeJoin = CanvasKitEnumValue;

export default function initializeCanvasKit(
  options?: CanvasKitInitOptions,
): Promise<CanvasKit>;
