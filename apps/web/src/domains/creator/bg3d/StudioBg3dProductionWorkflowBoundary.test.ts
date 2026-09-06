import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

const boundary = source("StudioBg3dProductionWorkflowBoundary.tsx");

describe("production workflow activation boundary", () => {
  it("loads the workflow and intent presentations through analyzable dynamic imports", () => {
    expect(boundary).toContain('import("./StudioBg3dProductionIntentPanel")');
    expect(boundary).toContain('import("./StudioBg3dProductionWorkflowPanel")');
    expect(boundary.match(/= lazy\(\(\) =>/g)).toHaveLength(2);
    expect(boundary.match(/if \(!runtime\?\.sceneSummary\) return null;/g)).toHaveLength(2);
    expect(boundary).toContain("<Suspense fallback=");
  });

  it("keeps specialist hosts from eagerly importing the new presentation modules", () => {
    for (const name of ["StudioBg3dCinematicDirectorPanel.tsx", "StudioBg3dMultiPassExporterPanel.tsx"]) {
      const host = source(name);
      expect(host).toContain('from "./StudioBg3dProductionWorkflowBoundary"');
      expect(host).not.toMatch(/from "\.\/StudioBg3dProduction(?:Workflow|Intent)Panel"/);
    }
  });

  it("retains synchronous preflight and the canonical editor export gate", () => {
    const view = source("StudioBg3dViewPanel.tsx");
    const exporter = source("StudioBg3dMultiPassExporterPanel.tsx");
    expect(view).toContain("evaluateStudioBg3dProductionPassReadiness(");
    expect(view).toContain("blockedReason: productionBlockedReason");
    expect(exporter).toContain("evaluateStudioBg3dProductionPassReadiness(");
    expect(exporter).toContain("<StudioBg3dProductionPassPreflightPanel />");
    expect(exporter).toContain("batch={displayBatch}");
  });
});
