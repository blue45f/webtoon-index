import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const helpCenterSource = readFileSync(
  new URL("./StudioHelpCenterDialog.tsx", import.meta.url),
  "utf8",
);
const runtimeSource = readFileSync(
  new URL("./studio-local-database-runtime.ts", import.meta.url),
  "utf8",
);

describe("Help Center SQLite product-runtime boundary", () => {
  it("probes the DedicatedWorker runtime instead of Window-side low-level OPFS APIs", () => {
    expect(helpCenterSource).toContain('import("./studio-local-database-runtime")');
    expect(helpCenterSource).toContain("probeStudioLocalDatabaseRuntime()");
    expect(helpCenterSource).not.toContain('import("./studio-local-database")');
    expect(helpCenterSource).not.toContain("probeSqliteSupport()");
  });

  it("uses a successful shared product database open as the readiness proof", () => {
    expect(runtimeSource).toContain("await acquireStudioLocalDatabase();");
    expect(runtimeSource).toContain("return { wasm: true, opfs: true };");
    expect(runtimeSource).not.toContain("probeSqliteSupport(");
  });
});
