/**
 * Node/Vitest-only OpenCascade WASM loader (node:fs + vm).
 * Never imported on the browser product path — browser uses fetch in the facade.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createContext, runInContext } from "node:vm";

import type { StudioOcctModule } from "./studio-occt-wasm-facade";

type OcctFactory = (cfg: {
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (path: string, prefix?: string) => string;
}) => Promise<StudioOcctModule>;

function isCallable(value: unknown): boolean {
  return Object.prototype.toString.call(value) === "[object Function]"
    || Object.prototype.toString.call(value) === "[object AsyncFunction]";
}

export async function loadStudioOcctModuleFromNode(): Promise<{
  readonly module: StudioOcctModule;
  readonly loadPath: "node";
}> {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve("opencascade.js/dist/opencascade.wasm.wasm");
  const jsPath = require.resolve("opencascade.js/dist/opencascade.wasm.js");
  const wasmBinary = new Uint8Array(fs.readFileSync(wasmPath));
  const code = fs
    .readFileSync(jsPath, "utf8")
    .replace(/export\s+default\s+opencascade\s*;?\s*$/mu, "module.exports = opencascade;");
  const moduleBag = { exports: {} as { default?: OcctFactory } };
  const dirname = path.dirname(jsPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sandbox: Record<string, any> = {
    module: moduleBag,
    exports: moduleBag.exports,
    require,
    __dirname: dirname,
    __filename: jsPath,
    console,
    process,
    Buffer,
    WebAssembly,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  sandbox.self = sandbox;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(code, sandbox, { filename: jsPath });
  const factory =
    moduleBag.exports.default
    ?? (moduleBag.exports as unknown as OcctFactory);
  if (!isCallable(factory)) {
    throw new Error("opencascade node factory missing");
  }
  const oc = await factory({
    wasmBinary,
    locateFile: (p: string) => (p.endsWith(".wasm") ? wasmPath : p),
  });
  if (!oc?.BRepPrimAPI_MakeBox_1) {
    throw new Error("opencascade module missing BRepPrimAPI_MakeBox_1");
  }
  return { module: oc, loadPath: "node" };
}
