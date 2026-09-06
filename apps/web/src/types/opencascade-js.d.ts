/**
 * Ambient module shims for opencascade.js Embind factory + wasm asset URL.
 * Package ships without TypeScript types.
 */
declare module "opencascade.js/dist/opencascade.wasm.js" {
  type OcctFactory = (config?: {
    wasmBinary?: ArrayBuffer | Uint8Array;
    locateFile?: (path: string, prefix?: string) => string;
  }) => Promise<Record<string, unknown>>;
  const factory: OcctFactory;
  export default factory;
}

declare module "opencascade.js/dist/opencascade.wasm.wasm?url" {
  const url: string;
  export default url;
}

declare module "opencascade.js/dist/opencascade.wasm.wasm" {
  const url: string;
  export default url;
}

declare module "rhino3dm" {
  const factory: (config?: object) => Promise<Record<string, unknown>>;
  export default factory;
}

declare module "rhino3dm/rhino3dm.module.js" {
  const factory: (config?: object) => Promise<Record<string, unknown>>;
  export default factory;
}

declare module "rhino3dm/rhino3dm.wasm?url" {
  const url: string;
  export default url;
}

declare module "web-ifc" {
  export class IfcAPI {
    SetWasmPath(path: string, absolute?: boolean): void;
    Init(): Promise<void>;
    OpenModel(data: Uint8Array): number;
    CloseModel(modelID: number): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    StreamAllMeshes(modelID: number, cb: (mesh: any) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    GetGeometry(modelID: number, geometryExpressID: number): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    GetVertexArray(ptr: number, size: number): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    GetIndexArray(ptr: number, size: number): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    GetLineIDsWithType(modelID: number, type: number): { size(): number };
  }
  export const IFCWALL: number;
  export const IFCWALLSTANDARDCASE: number;
  export const IFCSLAB: number;
  export const IFCSPACE: number;
  export const IFCBUILDINGSTOREY: number;
  export const IFCBUILDING: number;
}

declare module "web-ifc/web-ifc.wasm?url" {
  const url: string;
  export default url;
}
