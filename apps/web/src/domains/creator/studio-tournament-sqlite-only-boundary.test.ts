import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("Studio tournament product boundary", () => {
  it("has no automatic localStorage or IndexedDB persistence path", () => {
    const runtime = source("./studio-renderer-tournament-runtime.ts");
    const sqlite = source("./studio-tournament-sqlite-persistence.ts");
    const bootstrap = source("./studio-tournament-persistence-bootstrap.ts");
    const combined = `${runtime}\n${sqlite}\n${bootstrap}`;

    expect(combined).not.toMatch(/createLocalStorageTournamentPersistence/u);
    expect(combined).not.toMatch(/resolveDefaultTournamentStorage/u);
    expect(combined).not.toMatch(/globalThis\.localStorage|window\.localStorage/u);
    expect(combined).not.toMatch(/globalThis\.indexedDB|window\.indexedDB/u);
    expect(sqlite).not.toMatch(/\bfallback\s*:/u);
    expect(sqlite).toContain('mode: "memory-only"');
    expect(sqlite).toContain("StudioTournamentPersistenceUnavailableError");
  });

  it("wires accepted non-test GPU and Worker completions into the bounded tournament", () => {
    const timing = source("./filter/studio-filter-render-tournament.ts");

    expect(timing).toContain("runtime.recordRenderSample(");
    expect(timing).toContain("runtime.evaluateMeasuredTournament({");
    expect(timing).toContain("void runtime.persist()");
  });

  it("connects the runtime sample port to the real SQLite cost-sample sink", () => {
    const runtime = source("./studio-renderer-tournament-runtime.ts");
    const sqlite = source("./studio-tournament-sqlite-persistence.ts");

    expect(runtime).toContain("this.persistence?.recordSample?.(sample)");
    expect(sqlite).toContain("sampleSink = createCostSampleSink(opened");
    expect(sqlite).toContain("await sink(sample)");
  });

  it("keeps challenger rendering/readback behind an injected idle scheduler", () => {
    const timing = source("./filter/studio-filter-render-tournament.ts");
    const schedulerIndex = timing.indexOf("scheduler(() => {");
    const challengerIndex = timing.indexOf("input.challenger.render(controller.signal)");
    const persistIndex = timing.indexOf("void runtime.persist()");
    expect(schedulerIndex).toBeGreaterThan(0);
    expect(challengerIndex).toBeGreaterThan(schedulerIndex);
    expect(persistIndex).toBeGreaterThan(challengerIndex);
  });
});
