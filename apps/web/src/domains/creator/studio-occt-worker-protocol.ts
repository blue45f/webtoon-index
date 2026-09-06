import type {
  StudioOcctFail,
  StudioOcctSolidResult,
} from "./studio-occt-wasm-facade";

export type StudioOcctWorkerOperation =
  | {
      readonly kind: "box";
      readonly size: readonly [number, number, number];
    }
  | {
      readonly kind: "sphere";
      readonly radius: number;
    }
  | {
      readonly kind: "torus";
      readonly majorRadius: number;
      readonly minorRadius: number;
    }
  | {
      readonly kind: "pipe";
      readonly length: number;
      readonly radius: number;
    }
  | {
      readonly kind: "mirror-box";
      readonly size: readonly [number, number, number];
    }
  | {
      readonly kind: "thick-shell-box";
      readonly size: readonly [number, number, number];
      readonly thickness: number;
    }
  | {
      readonly kind: "wedge";
      readonly size: readonly [number, number, number];
      readonly ltx: number;
    }
  | {
      readonly kind: "offset-shape-box";
      readonly size: readonly [number, number, number];
      readonly offset: number;
    }
  | {
      readonly kind: "fillet2d-extrude";
      readonly width: number;
      readonly height: number;
      readonly depth: number;
      readonly filletRadius: number;
    }
  | {
      readonly kind: "pipe-shell";
      readonly length: number;
      readonly radius: number;
    }
  | {
      readonly kind: "section-box";
      readonly size: readonly [number, number, number];
    }
  | {
      readonly kind: "draft-prism";
      readonly baseSize: number;
      readonly profileInset: number;
      readonly height: number;
      readonly angle: number;
    }
  | {
      readonly kind: "linear-pattern-box";
      readonly size: readonly [number, number, number];
      readonly offsetX: number;
      readonly count: number;
    }
  | {
      readonly kind: "circular-pattern-box";
      readonly size: readonly [number, number, number];
      readonly radius: number;
      readonly count: number;
    }
  | {
      readonly kind: "step-roundtrip-box";
      readonly size: readonly [number, number, number];
    }
  | {
      readonly kind: "revolve";
      readonly radius: number;
      readonly height: number;
    }
  | {
      readonly kind: "fillet-box";
      readonly size: readonly [number, number, number];
      readonly radius: number;
    }
  | {
      readonly kind: "loft";
      readonly levels: readonly {
        readonly dx: number;
        readonly dy: number;
        readonly z: number;
      }[];
    }
  | {
      readonly kind: "cut-boxes";
      readonly a: { readonly dx: number; readonly dy: number; readonly dz: number };
      readonly b: {
        readonly dx: number;
        readonly dy: number;
        readonly dz: number;
        readonly ox?: number;
        readonly oy?: number;
        readonly oz?: number;
      };
    };

export type StudioOcctWorkerRequest = {
  readonly id: number;
  readonly operation: StudioOcctWorkerOperation;
};

export type StudioOcctWorkerResponse = {
  readonly id: number;
  readonly result: StudioOcctSolidResult | StudioOcctFail;
};
