/**
 * Node/Vitest-only rhino3dm loader.
 *
 * This boundary keeps node:module/path and filesystem WASM resolution out of the
 * Vite browser graph. The product browser path uses Vite-managed ESM + `?url`.
 */

import { createRequire } from "node:module";
import path from "node:path";

// rhino3dm's CommonJS factory and generated module have a wider surface than its d.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RhinoModule = any;

export async function loadStudioRhino3dmFromNode(): Promise<RhinoModule> {
  const require = createRequire(import.meta.url);
  const factory = require("rhino3dm") as (config: {
    locateFile: (file: string) => string;
  }) => Promise<RhinoModule>;
  const wasmDir = path.dirname(require.resolve("rhino3dm"));
  return factory({
    locateFile: (file: string) => (
      file.endsWith(".wasm") ? path.join(wasmDir, file) : file
    ),
  });
}
