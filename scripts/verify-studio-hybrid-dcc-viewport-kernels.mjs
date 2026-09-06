/** Reproducible renderer-free verification. Does not replace React/Three/WebGL or repository CI. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "apps/web/src/domains/creator/hybrid-dcc");
const temporary = mkdtempSync(join(tmpdir(), "studio-dcc-viewport-"));
const kernels = ["studio-hybrid-dcc-object-transform", "studio-hybrid-dcc-transform-gesture",
  "studio-hybrid-dcc-transform-utilities", "studio-hybrid-dcc-viewport-interaction",
  "studio-hybrid-dcc-transform-runtime", "studio-hybrid-dcc-selection-gate"];
try {
  const config = join(temporary, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    compilerOptions: { strict: true, noUncheckedIndexedAccess: true, noEmitOnError: true,
      target: "ES2022", module: "CommonJS", types: [], lib: ["ES2022"], outDir: temporary },
    files: kernels.map((name) => join(source, `${name}.ts`)),
  }));
  const compiled = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", config],
    { stdio: "inherit", timeout: 60_000 });
  if (compiled.error || compiled.status !== 0) throw new Error("Strict kernel typecheck failed", { cause: compiled.error });
  const testPaths = ["studio-hybrid-dcc-viewport-interaction", "studio-hybrid-dcc-transform-runtime"].map((name) => {
    const test = readFileSync(join(source, `${name}.test.ts`), "utf8");
    const output = ts.transpileModule(test, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      reportDiagnostics: true,
    });
    if (output.diagnostics?.length) throw new Error("Kernel test syntax check failed");
    const registrar = 'require("vitest")';
    if (output.outputText.split(registrar).length !== 2) throw new Error("Unexpected test registrar shape");
    // The same native assertions and compiled production kernels run under Node's test registrar.
    const testPath = join(temporary, `${name}.node-test.cjs`);
    writeFileSync(testPath, output.outputText.replace(registrar, 'require("node:test")'));
    return testPath;
  });
  console.log("Renderer-free kernel checks only. React/Three/WebGL and full repository CI are separate.");
  const tested = spawnSync(process.execPath, ["--test", ...testPaths], { stdio: "inherit", timeout: 60_000 });
  if (tested.error || tested.status !== 0) throw new Error("Kernel regression tests failed", { cause: tested.error });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
