import { describe, expect, it } from "vitest";

import {
  STUDIO_ADJUSTMENT_LAYER_LIMITS,
  StudioAdjustmentLayerError,
  buildStudioAdjustmentLayerCompositorPlan,
  createStudioAdjustmentLayerDocument,
  findStudioAdjustmentPassesAffectingLayer,
  hashStudioAdjustmentLayerDocument,
  serializeStudioAdjustmentLayerDocument,
  type StudioAdjustmentContentLayer,
  type StudioAdjustmentEffectLayer,
  type StudioAdjustmentLayer,
  type StudioAdjustmentLayerDocument,
  type StudioAdjustmentLayerGroup,
  type StudioAdjustmentLayerRenderKind,
} from "./studio-adjustment-layer-plan";

import type {
  StudioAdjustmentEngineId,
  StudioAdjustmentStack,
} from "./studio-adjustment-stack";

function stack(
  entries: readonly {
    id: string;
    engine: StudioAdjustmentEngineId;
    enabled?: boolean;
    params?: Record<string, number | string | boolean>;
  }[],
): StudioAdjustmentStack {
  return {
    version: 1,
    entries: entries.map((entry) => ({
      id: entry.id,
      engine: entry.engine,
      enabled: entry.enabled ?? true,
      params: entry.params ?? {},
    })),
  };
}

function content(
  id: string,
  paintOrder: number,
  renderKind: StudioAdjustmentLayerRenderKind,
  input: Partial<StudioAdjustmentContentLayer> = {},
): StudioAdjustmentContentLayer {
  return {
    id,
    kind: "content",
    parentGroupId: null,
    paintOrder,
    visible: true,
    renderKind,
    ...input,
  };
}

function adjustment(
  id: string,
  paintOrder: number,
  input: Partial<StudioAdjustmentEffectLayer> = {},
): StudioAdjustmentEffectLayer {
  return {
    id,
    kind: "adjustment",
    parentGroupId: null,
    paintOrder,
    visible: true,
    scope: "composite-below",
    opacity: 1,
    blendMode: "normal",
    stack: stack([{ id: "edge", engine: "edge-detect" }]),
    ...input,
  };
}

function group(
  id: string,
  parentGroupId: string | null = null,
  visible = true,
): StudioAdjustmentLayerGroup {
  return { id, parentGroupId, visible };
}

function documentWith(
  layers: readonly StudioAdjustmentLayer[],
  groups: readonly StudioAdjustmentLayerGroup[] = [],
): StudioAdjustmentLayerDocument {
  return createStudioAdjustmentLayerDocument({
    version: 1,
    groups,
    layers,
  });
}

function expectLayerError(
  action: () => unknown,
  code: StudioAdjustmentLayerError["code"],
): StudioAdjustmentLayerError {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StudioAdjustmentLayerError);
    expect((error as StudioAdjustmentLayerError).code).toBe(code);
    return error as StudioAdjustmentLayerError;
  }
}

describe("studio adjustment-layer compositor plan", () => {
  it("filters a composite of vector and text layers without requiring an image attachment", () => {
    const document = documentWith([
      content("raster.above", 30, "raster"),
      adjustment("lens.edges", 20, {
        maskId: "selection.hero",
        opacity: 0.8,
        blendMode: "multiply",
        stack: stack([
          {
            id: "edge",
            engine: "edge-detect",
            params: { detail: 2, strength: 85 },
          },
          {
            id: "tone",
            engine: "color-halftone",
            params: { angle: 15, dotSize: 4, mode: "cmyk", strength: 70 },
          },
        ]),
      }),
      content("text.dialogue", 10, "text"),
      content("vector.lineart", 0, "vector"),
    ]);

    const plan = buildStudioAdjustmentLayerCompositorPlan(document);
    expect(plan.passes).toHaveLength(1);
    expect(plan.passes[0]).toMatchObject({
      adjustmentLayerId: "lens.edges",
      status: "active",
      sourceLayerIds: ["vector.lineart", "text.dialogue"],
      sourceRenderKinds: ["vector", "text"],
      upstreamAdjustmentLayerIds: [],
      compositeMode: "flatten-then-filter",
      acceptsNonRasterSources: true,
      maskId: "selection.hero",
      opacity: 0.8,
      blendMode: "multiply",
    });
    expect(plan.passes[0]?.operations.map((operation) => operation.engine)).toEqual([
      "edge-detect",
      "color-halftone",
    ]);
    expect(Object.isFrozen(plan.passes[0]?.operations)).toBe(true);
    expect(Object.isFrozen(plan.passes[0]?.operations[0]?.params)).toBe(true);
    expect(plan.passes[0]?.sourceLayerIds).not.toContain("raster.above");
    expect(findStudioAdjustmentPassesAffectingLayer(document, "vector.lineart"))
      .toHaveLength(1);
    expect(findStudioAdjustmentPassesAffectingLayer(document, "raster.above"))
      .toHaveLength(0);
  });

  it("clips to the nearest visible previous content and records overlapping upstream lenses", () => {
    const document = documentWith([
      content("base.vector", 0, "vector"),
      content("hidden.shape", 5, "shape", { visible: false }),
      adjustment("lens.first", 10, {
        stack: stack([{ id: "clarity", engine: "smart-sharpen" }]),
      }),
      adjustment("lens.clip", 20, {
        scope: "clip-previous",
        stack: stack([{ id: "invert", engine: "invert" }]),
      }),
      content("foreground.text", 30, "text"),
    ]);

    const plan = buildStudioAdjustmentLayerCompositorPlan(document);
    expect(plan.passes).toHaveLength(2);
    expect(plan.passes[0]).toMatchObject({
      adjustmentLayerId: "lens.first",
      sourceLayerIds: ["base.vector"],
      upstreamAdjustmentLayerIds: [],
      status: "active",
    });
    expect(plan.passes[1]).toMatchObject({
      adjustmentLayerId: "lens.clip",
      scope: "clip-previous",
      sourceLayerIds: ["base.vector"],
      upstreamAdjustmentLayerIds: ["lens.first"],
      status: "active",
    });
  });

  it("keeps nested groups isolated and respects hidden ancestors", () => {
    const groups = [
      group("sequence"),
      group("panel.visible", "sequence"),
      group("panel.hidden", "sequence", false),
    ];
    const document = documentWith([
      content("panel.proxy", 0, "group", { parentGroupId: "sequence" }),
      adjustment("sequence.lens", 10, { parentGroupId: "sequence" }),
      content("inner.vector", 0, "vector", { parentGroupId: "panel.visible" }),
      adjustment("inner.lens", 10, { parentGroupId: "panel.visible" }),
      content("hidden.vector", 0, "vector", { parentGroupId: "panel.hidden" }),
      adjustment("hidden.lens", 10, { parentGroupId: "panel.hidden" }),
    ], groups);

    const plan = buildStudioAdjustmentLayerCompositorPlan(document);
    expect(plan.passes.map((pass) => ({
      id: pass.adjustmentLayerId,
      path: pass.groupPath,
      sources: pass.sourceLayerIds,
      status: pass.status,
    }))).toEqual([
      {
        id: "hidden.lens",
        path: ["sequence", "panel.hidden"],
        sources: ["hidden.vector"],
        status: "hidden",
      },
      {
        id: "inner.lens",
        path: ["sequence", "panel.visible"],
        sources: ["inner.vector"],
        status: "active",
      },
      {
        id: "sequence.lens",
        path: ["sequence"],
        sources: ["panel.proxy"],
        status: "active",
      },
    ]);
  });

  it("distinguishes hidden, transparent, empty-stack, and empty-scope dormant states", () => {
    const document = documentWith([
      adjustment("lens.empty-scope", 0),
      content("lineart", 10, "vector"),
      adjustment("lens.empty-stack", 20, {
        stack: stack([{ id: "off", engine: "invert", enabled: false }]),
      }),
      adjustment("lens.transparent", 30, { opacity: 0 }),
      adjustment("lens.hidden", 40, { visible: false }),
    ]);

    expect(buildStudioAdjustmentLayerCompositorPlan(document).passes.map((pass) => [
      pass.adjustmentLayerId,
      pass.status,
    ])).toEqual([
      ["lens.empty-scope", "empty-scope"],
      ["lens.empty-stack", "empty-stack"],
      ["lens.transparent", "transparent"],
      ["lens.hidden", "hidden"],
    ]);
  });

  it("canonicalizes declaration and parameter-key order while preserving filter paint order", () => {
    const layerA = adjustment("lens", 10, {
      stack: stack([
        {
          id: "blur",
          engine: "motion-blur",
          params: { strength: 80, radius: 12, angle: 30 },
        },
        { id: "edge", engine: "edge-detect", params: { strength: 90, detail: 2 } },
      ]),
    });
    const layerB = adjustment("lens", 10, {
      stack: stack([
        {
          id: "blur",
          engine: "motion-blur",
          params: { angle: 30, radius: 12, strength: 80 },
        },
        { id: "edge", engine: "edge-detect", params: { detail: 2, strength: 90 } },
      ]),
    });
    const first = documentWith([
      layerA,
      content("lineart", 0, "vector"),
    ], [group("unused.b"), group("unused.a")]);
    const second = documentWith([
      content("lineart", 0, "vector"),
      layerB,
    ], [group("unused.a"), group("unused.b")]);

    expect(serializeStudioAdjustmentLayerDocument(first)).toBe(
      serializeStudioAdjustmentLayerDocument(second),
    );
    expect(hashStudioAdjustmentLayerDocument(first)).toBe(
      hashStudioAdjustmentLayerDocument(second),
    );
    expect(buildStudioAdjustmentLayerCompositorPlan(first).fingerprint).toBe(
      buildStudioAdjustmentLayerCompositorPlan(second).fingerprint,
    );
    expect(
      buildStudioAdjustmentLayerCompositorPlan(first).passes[0]?.operations
        .map((operation) => operation.id),
    ).toEqual(["blur", "edge"]);
    expect(Object.isFrozen(first.layers)).toBe(true);
    expect(Object.isFrozen(first.layers[1])).toBe(true);
  });

  it("fails closed for dangling groups, cycles, excessive depth, duplicate IDs, and paint order collisions", () => {
    expectLayerError(
      () => documentWith([
        content("orphan", 0, "vector", { parentGroupId: "missing" }),
      ]),
      "DANGLING_GROUP",
    );
    expectLayerError(
      () => documentWith([], [
        group("a", "b"),
        group("b", "a"),
      ]),
      "GROUP_CYCLE",
    );
    const deepGroups = Array.from(
      { length: STUDIO_ADJUSTMENT_LAYER_LIMITS.maxGroupDepth + 1 },
      (_, index) => group(
        `group.${index}`,
        index === 0 ? null : `group.${index - 1}`,
      ),
    );
    expectLayerError(() => documentWith([], deepGroups), "GROUP_TOO_DEEP");
    expectLayerError(
      () => documentWith([
        content("same", 0, "vector"),
        adjustment("same", 10),
      ]),
      "DUPLICATE_ID",
    );
    expectLayerError(
      () => documentWith([
        content("one", 10, "vector"),
        content("two", 10, "raster"),
      ]),
      "DUPLICATE_PAINT_ORDER",
    );
  });

  it("strictly rejects unknown engines, duplicate entry IDs, non-finite params, and stack overflow", () => {
    expectLayerError(
      () => createStudioAdjustmentLayerDocument({
        version: 1,
        groups: [],
        layers: [{
          ...adjustment("bad.engine", 0),
          stack: {
            version: 1,
            entries: [{
              id: "bad",
              engine: "proprietary-lens",
              enabled: true,
              params: {},
            }],
          },
        }],
      }),
      "INVALID_STACK",
    );
    expectLayerError(
      () => documentWith([
        adjustment("duplicate.entries", 0, {
          stack: stack([
            { id: "same", engine: "invert" },
            { id: "same", engine: "pixelate" },
          ]),
        }),
      ]),
      "DUPLICATE_ID",
    );
    expectLayerError(
      () => createStudioAdjustmentLayerDocument({
        version: 1,
        groups: [],
        layers: [{
          ...adjustment("bad.params", 0),
          stack: {
            version: 1,
            entries: [{
              id: "bad",
              engine: "pixelate",
              enabled: true,
              params: { size: Number.NaN },
            }],
          },
        }],
      }),
      "INVALID_STACK",
    );
    const many = documentWith([
      adjustment("many.entries", 0, {
        stack: stack(Array.from({ length: 101 }, (_, index) => ({
          id: `entry.${index}`,
          engine: "invert",
        }))),
      }),
    ]);
    expect((many.layers[0] as StudioAdjustmentEffectLayer).stack.entries).toHaveLength(101);
  });

  it("rejects accessors and oversized parameter maps instead of silently coercing them", () => {
    const hostileParams: Record<string, number> = {};
    Object.defineProperty(hostileParams, "size", {
      enumerable: true,
      get: () => 8,
    });
    expectLayerError(
      () => createStudioAdjustmentLayerDocument({
        version: 1,
        groups: [],
        layers: [{
          ...adjustment("accessor", 0),
          stack: {
            version: 1,
            entries: [{
              id: "pixel",
              engine: "pixelate",
              enabled: true,
              params: hostileParams,
            }],
          },
        }],
      }),
      "INVALID_STACK",
    );

    const heavyParams = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [
      `field.${index}`,
      "가".repeat(512),
    ]));
    expectLayerError(
      () => documentWith([
        adjustment("byte.budget", 0, {
          stack: stack(Array.from({ length: 20 }, (_, index) => ({
            id: `heavy.${index}`,
            engine: "curves",
            params: heavyParams,
          }))),
        }),
      ]),
      "LIMIT_EXCEEDED",
    );

    const tooManyParams = Object.fromEntries(Array.from(
      { length: STUDIO_ADJUSTMENT_LAYER_LIMITS.maxParamFields + 1 },
      (_, index) => [`p${index}`, index],
    ));
    expectLayerError(
      () => createStudioAdjustmentLayerDocument({
        version: 1,
        groups: [],
        layers: [{
          ...adjustment("param.budget", 0),
          stack: {
            version: 1,
            entries: [{
              id: "pixel",
              engine: "pixelate",
              enabled: true,
              params: tooManyParams,
            }],
          },
        }],
      }),
      "LIMIT_EXCEEDED",
    );
  });
});
