import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

describe("Studio ABR import bundle boundary", () => {
  it("loads the ABR client only after file intent instead of adding ag-psd to the brush panel", () => {
    const panel = source("./brush/StudioBrushLibraryPanel.tsx");
    expect(panel).toContain('await import("../studio-abr-import-client")');
    expect(panel).toContain('executionBackend: "worker"');
    expect(panel).not.toMatch(/from\s+["']\.\.?\/studio-abr-import-client["']/u);
    expect(panel).not.toContain('from "ag-psd"');
  });

  it("keeps the parser in a module worker and dynamically loads ag-psd inside that boundary", () => {
    const client = source("./studio-abr-import-client.ts");
    const parser = source("./studio-abr-import.ts");
    const worker = source("./studio-abr-import.worker.ts");
    expect(client).toContain('new URL("./studio-abr-import.worker.ts", import.meta.url)');
    expect(client).toContain('{ type: "module" }');
    expect(client).toContain('options.executionBackend ?? "worker"');
    expect(client).toContain('if (executionBackend === "direct")');
    expect(client).not.toContain("mainThreadFallback");
    expect(client).not.toContain("return fallback");
    expect(parser).toContain('await import("ag-psd")');
    expect(parser).not.toMatch(/^import\s+\{[^}]*readAbr[^}]*\}\s+from\s+["']ag-psd["']/mu);
    expect(worker).toContain("parseStudioAbrBuffer(request.bytes)");
  });
});
