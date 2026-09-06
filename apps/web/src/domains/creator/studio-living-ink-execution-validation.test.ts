import { describe, expect, it } from "vitest";

import {
  parseStudioLivingInkExecutionApplyOptions,
  parseStudioLivingInkExecutionConfig,
  parseStudioLivingInkExecutionOperation,
  parseStudioLivingInkExecutionSelection,
} from "./studio-living-ink-execution-validation";
import { DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS } from "./studio-living-ink-gpu-protocol";

const config = {
  displayWidth: 256,
  displayHeight: 192,
  fieldWidth: 256,
  fieldHeight: 192,
  coarseBase: 128,
  seed: 17,
  material: DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS,
  displayMode: "composite",
} as const;

describe("Living Ink persisted execution parsers", () => {
  it("canonicalizes a reviewed config and rejects unknown fields or non-finite material", () => {
    const parsed = parseStudioLivingInkExecutionConfig(JSON.parse(JSON.stringify(config)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(Object.isFrozen(parsed.value)).toBe(true);
      expect(Object.isFrozen(parsed.value.material)).toBe(true);
    }
    expect(parseStudioLivingInkExecutionConfig({ ...config, surprise: true })).toMatchObject({
      ok: false,
      path: "$",
    });
    expect(parseStudioLivingInkExecutionConfig({
      ...config,
      material: { ...config.material, granulation: Number.NaN },
    })).toMatchObject({ ok: false, path: "$.material.granulation" });
  });

  it("fails closed on malformed selection coverage before any GPU mutation", () => {
    const selection = {
      kind: "studio-living-ink-selection-mask",
      version: 1,
      bounds: { x: 8, y: 9, width: 2, height: 2 },
      coverage: [1, 0.5, 0.25, 0],
    } as const;
    const parsed = parseStudioLivingInkExecutionSelection(selection, config);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.value) {
      expect(Object.isFrozen(parsed.value.coverage)).toBe(true);
    }
    expect(parseStudioLivingInkExecutionSelection({
      ...selection,
      coverage: [1, 0.5, Number.POSITIVE_INFINITY, 0],
    }, config)).toMatchObject({ ok: false, path: "$.selection.coverage[2]" });
    expect(parseStudioLivingInkExecutionSelection({
      ...selection,
      coverage: [1, 0.5],
    }, config)).toMatchObject({ ok: false, path: "$.selection.coverage" });
  });

  it("strictly parses operations, marks and apply presentation intent", () => {
    const operation = {
      kind: "ink",
      version: 1,
      sequence: 1,
      tool: "pigment-water-brush",
      marks: [{
        x: 32,
        y: 48,
        radius: 9,
        pressure: 0.72,
        speed: 140,
        waterMass: 0.4,
        pigmentMass: 0.3,
        color: [0.1, 0.2, 0.3, 1],
      }],
      selection: null,
    };
    const parsed = parseStudioLivingInkExecutionOperation(operation, config);
    expect(parsed.ok).toBe(true);
    expect(parseStudioLivingInkExecutionOperation({
      ...operation,
      marks: [{ ...operation.marks[0], radius: Number.NaN }],
    }, config)).toMatchObject({ ok: false, path: "$.operation.marks[0]" });
    expect(parseStudioLivingInkExecutionOperation({ ...operation, extra: "reject" }, config)).toMatchObject({
      ok: false,
      path: "$.operation",
    });
    expect(parseStudioLivingInkExecutionApplyOptions({ present: false, quality: "interactive" })).toEqual({
      ok: true,
      value: { present: false, quality: "interactive" },
    });
    expect(parseStudioLivingInkExecutionApplyOptions({ present: "no" })).toMatchObject({
      ok: false,
      path: "$.options",
    });
  });
});
