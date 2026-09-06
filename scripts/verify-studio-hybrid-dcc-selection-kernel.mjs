/** Same production selection kernel/assertions under Node; not a replacement for browser CI. */
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
const temporary = mkdtempSync(join(tmpdir(), "studio-dcc-selection-"));
try {
  const config = join(temporary, "tsconfig.json");
  writeFileSync(config, JSON.stringify({ compilerOptions: {
    strict: true, noUncheckedIndexedAccess: true, noEmitOnError: true,
    target: "ES2022", module: "CommonJS", lib: ["ES2022"], types: [], outDir: temporary,
  }, files: [join(source, "studio-hybrid-dcc-selection-commands.ts")] }));
  const compiled = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", config],
    { stdio: "inherit", timeout: 60_000 });
  if (compiled.error || compiled.status !== 0) throw new Error("Selection kernel strict typecheck failed", { cause: compiled.error });
  const file = join(source, "studio-hybrid-dcc-selection-commands.test.ts");
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    reportDiagnostics: true,
  });
  if (output.diagnostics?.length) throw new Error("Selection regression test syntax check failed");
  const registrar = 'require("vitest")';
  if (output.outputText.split(registrar).length !== 2) throw new Error("Unexpected test registrar shape");
  const testPath = join(temporary, "selection.node-test.cjs");
  writeFileSync(testPath, output.outputText.replace(registrar, 'require("node:test")'));
  console.log("Production selection kernel and native assertions. React/Three/WebGL are not tested here.");
  const tested = spawnSync(process.execPath, ["--test", testPath], { stdio: "inherit", timeout: 60_000 });
  if (tested.error || tested.status !== 0) throw new Error("Selection regression tests failed", { cause: tested.error });
} finally { rmSync(temporary, { recursive: true, force: true }); }
