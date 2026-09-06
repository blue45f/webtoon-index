import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  new URL("./StudioProductionInsightsPanel.tsx", import.meta.url),
  "utf8",
);
const linterSource = readFileSync(
  new URL("./studio-project-health-linter.ts", import.meta.url),
  "utf8",
);

describe("Studio project health integration boundary", () => {
  it("mounts the health summary in the existing local production-insights surface", () => {
    expect(panelSource).toContain(
      'import { StudioProjectHealthSummary } from "./StudioProjectHealthSummary";',
    );
    expect(panelSource).toContain(
      "<StudioProjectHealthSummary insights={insights} />",
    );
  });

  it("keeps the rules deterministic, local-only, and free of a second document source", () => {
    expect(linterSource).toContain(
      'basis: "studio-production-insights"',
    );
    expect(linterSource).toMatch(
      /import type \{\s+StudioProductionInsights,/u,
    );
    expect(linterSource).not.toMatch(
      /\b(?:fetch|WebSocket|EventSource)\s*\(/u,
    );
    expect(linterSource).not.toMatch(
      /\b(?:localStorage|sessionStorage|indexedDB)\b/u,
    );
    expect(linterSource).not.toMatch(
      /\b(?:Date\.now|Math\.random|crypto\.randomUUID)\s*\(/u,
    );
  });
});
