/**
 * Launch-light entry smoke: public catalog exercise + core session/DRW APIs.
 */
import { describe, expect, it } from "vitest";

import { exerciseStudioDccCatalogFeature } from "./studio-dcc-catalog-feature-dispatch";
import {
  measureStudioBrushLatencyBudget,
  planStudioPressureBrushStroke,
} from "./studio-dcc-material-publish-draw-lite";
import { createStudioHybridDccSession } from "./studio-hybrid-dcc-document";

describe("§6 entry smoke (P0 public surface)", () => {
  it("DOC-001 catalog exercise + createStudioHybridDccSession", async () => {
    const r = await exerciseStudioDccCatalogFeature("DOC-001");
    expect(r.ok).toBe(true);
    expect(r.id).toBe("DOC-001");
    expect(
      typeof r.evidence.documentId === "string"
        || typeof r.evidence.commandCount === "number"
        || typeof r.evidence.format === "string",
    ).toBe(true);
    const s = createStudioHybridDccSession("entry-smoke");
    expect(s.state.documentId.length).toBeGreaterThan(0);
    expect(Number.isFinite(s.state.commandCount)).toBe(true);
  });

  it("DRW-001 catalog exercise + pressure plan numeric pathLength", async () => {
    const r = await exerciseStudioDccCatalogFeature("DRW-001");
    expect(r.ok).toBe(true);
    expect(Number(r.evidence.pathLength)).toBeGreaterThan(0);
    expect(Number(r.evidence.sampleCount)).toBeGreaterThan(0);
    const plan = planStudioPressureBrushStroke(
      [
        { x: 0, y: 0, pressure: 0.2, tMs: 0 },
        { x: 3, y: 1, pressure: 0.9, tMs: 5 },
        { x: 6, y: 2, pressure: 0.4, tMs: 10 },
      ],
      16,
    );
    expect(plan.pathLength).toBeGreaterThan(0);
    expect(plan.sampleCount).toBe(3);
    const lat = measureStudioBrushLatencyBudget(0, 12, 16);
    expect(lat.latencyMs).toBe(12);
    expect(lat.withinBudget).toBe(true);
  });
});
