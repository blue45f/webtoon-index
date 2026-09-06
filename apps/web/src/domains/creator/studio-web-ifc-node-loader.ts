/**
 * Node/Vitest-only web-ifc loader.
 *
 * The browser product module imports this file through a Vite-ignored, Node-only
 * dynamic boundary so node:module/path and web-ifc-node.wasm never enter the
 * browser dependency graph.
 */

import { createRequire } from "node:module";
import path from "node:path";

// web-ifc's CommonJS node export intentionally has no complete public TS shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebIfcNodeModule = any;

export async function loadStudioWebIfcRuntimeFromNode(): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly api: any;
  readonly module: Record<string, unknown>;
  readonly loadPath: "node";
}> {
  const require = createRequire(import.meta.url);
  const webIfc = require("web-ifc") as WebIfcNodeModule;
  const api = new webIfc.IfcAPI();
  const wasmDir = path.dirname(require.resolve("web-ifc"));
  api.SetWasmPath(`${wasmDir}${path.sep}`, true);
  await api.Init();
  return {
    api,
    module: webIfc as Record<string, unknown>,
    loadPath: "node",
  };
}
