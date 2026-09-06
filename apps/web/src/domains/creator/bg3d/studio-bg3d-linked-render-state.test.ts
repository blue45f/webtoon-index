import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_BG3D_LINKED_RENDER_GRAPH,
  STUDIO_BG3D_LINKED_RENDER_DOMAINS,
  STUDIO_BG3D_LINKED_RENDER_PASSES,
  createStudioBg3dLinkedRenderPlan,
  type CreateStudioBg3dLinkedRenderPlanInput,
  type StudioBg3dLinkedRenderCachedArtifact,
  type StudioBg3dLinkedRenderPass,
} from "./studio-bg3d-linked-render-state";

function revision(canonical: string) {
  return { canonical, expectedSignature: null };
}

function baseInput(
  overrides: Partial<CreateStudioBg3dLinkedRenderPlanInput> = {},
): CreateStudioBg3dLinkedRenderPlanInput {
  return {
    linkId: "scene-link-1",
    actorId: "actor-1",
    baseRevision: 7,
    lamportBase: 100,
    pipelineRevision: "webgpu-linked-v1",
    scene: revision('{"scene":7}'),
    source: revision('{"asset":"room.glb","version":3}'),
    options: revision('{"width":2048,"height":4096}'),
    projections: STUDIO_BG3D_LINKED_RENDER_DOMAINS.map((domain) => ({
      domain,
      ...revision(JSON.stringify({ domain, revision: 1 })),
    })),
    requestedPasses: ["combined"],
    supportedPasses: [...STUDIO_BG3D_LINKED_RENDER_PASSES],
    dependencyGraph: null,
    previousArtifacts: [],
    ...overrides,
  };
}

function artifactsFrom(
  plan: Awaited<ReturnType<typeof createStudioBg3dLinkedRenderPlan>>,
  renderedRevision = 7,
): StudioBg3dLinkedRenderCachedArtifact[] {
  if (!plan.ok) throw new Error(plan.message);
  return plan.plan.passes.map((pass) => ({
    pass: pass.pass,
    renderSignature: pass.renderSignature,
    renderedRevision,
    dependencies: pass.dependencies,
  }));
}

function passActions(
  result: Awaited<ReturnType<typeof createStudioBg3dLinkedRenderPlan>>,
): Record<StudioBg3dLinkedRenderPass, "refresh" | "reuse"> {
  if (!result.ok) throw new Error(result.message);
  return Object.fromEntries(
    result.plan.passes.map((pass) => [pass.pass, pass.action]),
  ) as Record<StudioBg3dLinkedRenderPass, "refresh" | "reuse">;
}

describe("studio-bg3d-linked-render-state", () => {
  it("closes combined dependencies in stable topological order and emits CRDT-friendly operations", async () => {
    const first = await createStudioBg3dLinkedRenderPlan(baseInput());
    const second = await createStudioBg3dLinkedRenderPlan(baseInput());

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.plan.passes.map((pass) => pass.pass)).toEqual([
      "line",
      "depth",
      "object-id",
      "normal",
      "combined",
    ]);
    expect(first.plan.passes.every((pass) => pass.action === "refresh")).toBe(true);
    expect(first.plan.operations).toHaveLength(5);
    expect(first.plan.operations.map((operation) => operation.lamport)).toEqual([
      101,
      102,
      103,
      104,
      105,
    ]);
    expect(first.plan.operations.at(-1)?.dependsOn).toEqual(
      first.plan.operations.slice(0, 4).map((operation) => operation.operationId),
    );
    expect(first.plan.sceneSignature).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.plan.operations[0]?.operationId).not.toContain("actor-1");
  });

  it("reuses exact pass artifacts without emitting refresh operations", async () => {
    const initial = await createStudioBg3dLinkedRenderPlan(baseInput());
    const result = await createStudioBg3dLinkedRenderPlan(baseInput({
      previousArtifacts: artifactsFrom(initial),
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.passes.every((pass) => pass.action === "reuse")).toBe(true);
    expect(result.plan.passes.every((pass) => pass.dirtyReasons.length === 0)).toBe(true);
    expect(result.plan.operations).toEqual([]);
  });

  it("invalidates only a changed line projection and its combined dependent", async () => {
    const initial = await createStudioBg3dLinkedRenderPlan(baseInput());
    const previousArtifacts = artifactsFrom(initial);
    const changed = baseInput({
      baseRevision: 8,
      scene: revision('{"scene":8}'),
      projections: baseInput().projections.map((projection) =>
        projection.domain === "line-options"
          ? { ...projection, canonical: '{"lineWidth":2}' }
          : projection
      ),
      previousArtifacts,
    });
    const result = await createStudioBg3dLinkedRenderPlan(changed);

    expect(passActions(result)).toEqual({
      line: "refresh",
      depth: "reuse",
      "object-id": "reuse",
      normal: "reuse",
      combined: "refresh",
    });
    if (!result.ok) return;
    expect(result.plan.passes.find((pass) => pass.pass === "line")?.dirtyReasons)
      .toEqual(["dependency-changed:line-options"]);
    expect(result.plan.passes.find((pass) => pass.pass === "combined")?.dirtyReasons)
      .toEqual(["upstream-changed:line"]);
    expect(result.plan.operations.at(-1)?.dependsOn).toEqual([
      result.plan.operations[0]?.operationId,
    ]);
  });

  it("propagates a camera change through every requested render pass", async () => {
    const initial = await createStudioBg3dLinkedRenderPlan(baseInput());
    const result = await createStudioBg3dLinkedRenderPlan(baseInput({
      baseRevision: 8,
      projections: baseInput().projections.map((projection) =>
        projection.domain === "camera"
          ? { ...projection, canonical: '{"camera":"close-up"}' }
          : projection
      ),
      previousArtifacts: artifactsFrom(initial),
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.passes.every((pass) => pass.action === "refresh")).toBe(true);
    expect(result.plan.passes.slice(0, 4).every((pass) =>
      pass.dirtyReasons.includes("dependency-changed:camera")
    )).toBe(true);
    expect(result.plan.passes.at(-1)?.dirtyReasons).toEqual([
      "upstream-changed:line",
      "upstream-changed:depth",
      "upstream-changed:object-id",
      "upstream-changed:normal",
    ]);
  });

  it("fails closed when an asserted canonical hash is stale", async () => {
    const result = await createStudioBg3dLinkedRenderPlan(baseInput({
      scene: {
        canonical: '{"scene":7}',
        expectedSignature: `sha256:${"0".repeat(64)}`,
      },
    }));

    expect(result).toMatchObject({ ok: false, code: "signature-mismatch" });
  });

  it("fails closed for unsupported dependency passes", async () => {
    const result = await createStudioBg3dLinkedRenderPlan(baseInput({
      supportedPasses: ["combined"],
    }));

    expect(result).toMatchObject({ ok: false, code: "unsupported-pass" });
  });

  it("detects a custom dependency cycle before hashing or operations", async () => {
    const result = await createStudioBg3dLinkedRenderPlan(baseInput({
      dependencyGraph: {
        ...DEFAULT_STUDIO_BG3D_LINKED_RENDER_GRAPH,
        line: ["combined"],
      },
    }));

    expect(result).toMatchObject({ ok: false, code: "dependency-cycle" });
  });

  it("enforces the custom graph edge budget", async () => {
    const result = await createStudioBg3dLinkedRenderPlan(baseInput({
      dependencyGraph: {
        line: ["depth", "object-id", "normal", "combined"],
        depth: ["line", "object-id", "normal", "combined"],
        "object-id": ["line", "depth", "normal", "combined"],
        normal: ["line"],
        combined: [],
      },
    }));

    expect(result).toMatchObject({ ok: false, code: "graph-budget-exceeded" });
  });

  it("rejects future cache revisions and Lamport overflow", async () => {
    const initial = await createStudioBg3dLinkedRenderPlan(baseInput());
    const stale = await createStudioBg3dLinkedRenderPlan(baseInput({
      previousArtifacts: artifactsFrom(initial, 8),
    }));
    expect(stale).toMatchObject({ ok: false, code: "stale-render" });

    const overflow = await createStudioBg3dLinkedRenderPlan(baseInput({
      lamportBase: Number.MAX_SAFE_INTEGER - 2,
    }));
    expect(overflow).toMatchObject({
      ok: false,
      code: "operation-budget-exceeded",
    });
  });

  it("rejects primitive cache entries without throwing", async () => {
    const result = await createStudioBg3dLinkedRenderPlan({
      ...baseInput(),
      previousArtifacts: [null],
    });

    expect(result).toMatchObject({ ok: false, code: "invalid-cache" });
  });

  it("rejects duplicate or incomplete projection manifests", async () => {
    const incomplete = await createStudioBg3dLinkedRenderPlan(baseInput({
      projections: baseInput().projections.slice(1),
    }));
    expect(incomplete).toMatchObject({ ok: false, code: "invalid-dependency" });

    const projections = [...baseInput().projections];
    projections[1] = projections[0]!;
    const duplicate = await createStudioBg3dLinkedRenderPlan(baseInput({
      projections,
    }));
    expect(duplicate).toMatchObject({ ok: false, code: "invalid-dependency" });
  });
});
