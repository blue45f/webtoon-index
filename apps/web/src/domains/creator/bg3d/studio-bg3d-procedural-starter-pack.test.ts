import { describe, expect, it } from "vitest";

import { makeGeometry } from "../studio-background-3d-primitives";

import {
  STUDIO_BG3D_PRIMITIVE_TRIANGLE_COUNTS,
  STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS,
  STUDIO_BG3D_PROCEDURAL_STARTER_CATEGORY_LABELS,
  STUDIO_BG3D_PROCEDURAL_STARTER_PACK,
  estimateStudioBg3dProceduralParts,
  getStudioBg3dProceduralStarterAsset,
  planStudioBg3dProceduralStarterInsertion,
  resolveStudioBg3dProceduralInstanceId,
  type StudioBg3dProceduralBudgetUsage,
} from "./studio-bg3d-procedural-starter-pack";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  STUDIO_BG3D_PRIMITIVE_KINDS,
} from "./studio-bg3d-scene-document";
import { adaptStudioBg3dRuntimeToDocument } from "./studio-bg3d-scene-runtime";

import type { BgPrimitive } from "../studio-background-3d-metadata";

const EMPTY_USAGE: StudioBg3dProceduralBudgetUsage = {
  nodes: 0,
  triangles: 0,
  drawCalls: 0,
  materials: 0,
  textures: 0,
};
const DEFAULT_LIMITS = DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity;

describe("studio-bg3d-procedural-starter-pack catalog", () => {
  it("publishes only original procedural CC0-safe, file-free assets", () => {
    expect(STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS.length).toBeGreaterThanOrEqual(12);
    expect(STUDIO_BG3D_PROCEDURAL_STARTER_PACK.provenance).toMatchObject({
      origin: "original-procedural",
      sourceMethod: "authored-mathematical-primitives",
      derivativeSource: false,
      externalFiles: false,
      externalTextures: false,
      license: {
        spdx: "CC0-1.0",
        attributionRequired: false,
        commercialUse: true,
        modificationAllowed: true,
        redistributionAllowed: true,
      },
    });
    for (const asset of STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS) {
      expect(asset.provenance).toBe(STUDIO_BG3D_PROCEDURAL_STARTER_PACK.provenance);
      expect(asset.compatibility).toMatchObject({
        renderBackends: ["webgl2", "webgpu"],
        textures: 0,
        externalResources: 0,
        requiresExtensions: false,
        requiresCompute: false,
      });
    }

    const serialized = JSON.stringify(STUDIO_BG3D_PROCEDURAL_STARTER_PACK);
    expect(serialized).not.toMatch(/https?:|blob:|data:|file:|thumbnail|download|price/iu);
  });

  it("uses stable unique asset/part ids, known categories, useful tags, and supported kinds", () => {
    const assetIds = new Set<string>();
    const supportedKinds = new Set<string>(STUDIO_BG3D_PRIMITIVE_KINDS);
    const categories = new Set(Object.keys(STUDIO_BG3D_PROCEDURAL_STARTER_CATEGORY_LABELS));

    for (const asset of STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS) {
      expect(assetIds.has(asset.id)).toBe(false);
      assetIds.add(asset.id);
      expect(asset.id).toMatch(/^[a-z0-9][a-z0-9-]+-v1$/u);
      expect(categories.has(asset.category)).toBe(true);
      expect(asset.tags.length).toBeGreaterThanOrEqual(4);
      expect(asset.bounds.width).toBeGreaterThan(0);
      expect(asset.bounds.height).toBeGreaterThan(0);
      expect(asset.bounds.depth).toBeGreaterThan(0);

      const partIds = new Set<string>();
      for (const part of asset.parts) {
        expect(partIds.has(part.id)).toBe(false);
        partIds.add(part.id);
        expect(part.id).toMatch(/^[a-z0-9][a-z0-9-]+$/u);
        expect(supportedKinds.has(part.kind)).toBe(true);
        expect(part.rotation[0]).toBe(0);
        expect(part.rotation[2]).toBe(0);
        expect(part.offset.every(Number.isFinite)).toBe(true);
        expect(part.scale.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
        expect(part.color).toMatch(/^#[0-9a-f]{6}$/u);
      }
    }
  });

  it("keeps every declared budget exact and comfortably low-poly", () => {
    let totalNodes = 0;
    let totalTriangles = 0;
    let totalDrawCalls = 0;
    let totalMaterials = 0;

    for (const asset of STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS) {
      expect(asset.budget).toEqual(estimateStudioBg3dProceduralParts(asset.parts));
      expect(asset.budget.nodes).toBeLessThanOrEqual(16);
      expect(asset.budget.triangles).toBeLessThanOrEqual(1_000);
      expect(asset.budget.materials).toBe(asset.budget.nodes * 2);
      expect(asset.budget.drawCalls).toBe(asset.budget.nodes * 2);
      expect(asset.budget.textures).toBe(0);
      totalNodes += asset.budget.nodes;
      totalTriangles += asset.budget.triangles;
      totalDrawCalls += asset.budget.drawCalls;
      totalMaterials += asset.budget.materials;
    }

    expect(STUDIO_BG3D_PROCEDURAL_STARTER_PACK.budget).toEqual({
      nodes: totalNodes,
      triangles: totalTriangles,
      drawCalls: totalDrawCalls,
      materials: totalMaterials,
      textures: 0,
    });
  });

  it("matches triangle estimates to the actual shared Three.js primitive geometries", () => {
    for (const kind of STUDIO_BG3D_PRIMITIVE_KINDS) {
      const geometry = makeGeometry(kind);
      const actualTriangles = geometry.index
        ? geometry.index.count / 3
        : geometry.getAttribute("position").count / 3;
      expect(STUDIO_BG3D_PRIMITIVE_TRIANGLE_COUNTS[kind]).toBe(actualTriangles);
      geometry.dispose();
    }
  });
});

describe("studio-bg3d-procedural-starter-pack runtime leaf", () => {
  it("resolves deterministic collision-free instance ids", () => {
    const asset = STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS[0];
    const first = resolveStudioBg3dProceduralInstanceId(asset.id, []);
    expect(first).toBe(`${asset.id}-1`);
    const occupied = asset.parts.map((part) => `${first}.${part.id}`);
    expect(resolveStudioBg3dProceduralInstanceId(asset.id, occupied)).toBe(
      `${asset.id}-2`,
    );
    expect(resolveStudioBg3dProceduralInstanceId("missing", [])).toBeNull();
  });

  it("creates direct BgPrimitive runtime records with stable ids and rigid yaw placement", () => {
    const asset = getStudioBg3dProceduralStarterAsset("ts3d-writing-desk-v1");
    expect(asset).not.toBeNull();
    const result = planStudioBg3dProceduralStarterInsertion({
      assetId: asset!.id,
      instanceId: "episode-12.desk-a",
      occupiedNodeIds: [],
      currentUsage: EMPTY_USAGE,
      limits: DEFAULT_LIMITS,
      origin: [10, 2, 20],
      yawRadians: Math.PI / 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.primitives).toHaveLength(asset!.parts.length);
    expect(result.primitives[0]).toMatchObject({
      id: "episode-12.desk-a.top",
      kind: "box",
      name: "작업 책상 · 책상 상판",
      visible: true,
      locked: false,
    });
    expect(result.primitives[0].position).toEqual([10, 2.74, 20]);
    const localFrontLeft = asset!.parts.find((part) => part.id === "leg-front-left")!;
    const worldFrontLeft = result.primitives.find((part) =>
      part.id.endsWith(".leg-front-left"),
    )!;
    expect(worldFrontLeft.position[0]).toBeCloseTo(10 + localFrontLeft.offset[2], 10);
    expect(worldFrontLeft.position[2]).toBeCloseTo(20 - localFrontLeft.offset[0], 10);
    expect(worldFrontLeft.rotation[1]).toBeCloseTo(Math.PI / 2, 10);
    expect(result.nextUsage).toEqual(asset!.budget);
  });

  it("is deterministic and does not share mutable transform arrays", () => {
    const request = {
      assetId: "ts3d-basic-chair-v1",
      instanceId: "chair-a",
      occupiedNodeIds: [],
      currentUsage: EMPTY_USAGE,
      limits: DEFAULT_LIMITS,
    } as const;
    const first = planStudioBg3dProceduralStarterInsertion(request);
    const second = planStudioBg3dProceduralStarterInsertion(request);
    expect(first).toEqual(second);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.primitives[0].position).not.toBe(second.primitives[0].position);
    first.primitives[0].position[0] = 999;
    expect(second.primitives[0].position[0]).not.toBe(999);
  });

  it("round-trips the complete pack through the real scene runtime adapter", () => {
    let currentUsage = EMPTY_USAGE;
    let occupiedNodeIds: string[] = [];
    const primitives: BgPrimitive[] = [];

    for (const asset of STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS) {
      const plan = planStudioBg3dProceduralStarterInsertion({
        assetId: asset.id,
        occupiedNodeIds,
        currentUsage,
        limits: DEFAULT_LIMITS,
      });
      expect(plan.ok).toBe(true);
      if (!plan.ok) continue;
      primitives.push(...plan.primitives);
      occupiedNodeIds = primitives.map((primitive) => primitive.id);
      currentUsage = plan.nextUsage;
    }

    const adapted = adaptStudioBg3dRuntimeToDocument({
      primitives,
      customModels: [],
      attachmentByStorageModelId: new Map(),
    });
    expect(adapted.counts.droppedPrimitives).toBe(0);
    expect(adapted.counts.emittedPrimitives).toBe(primitives.length);
    expect(adapted.diagnostics).toEqual([]);
    expect(adapted.document.nodes).toHaveLength(primitives.length);
    expect(new Set(adapted.document.nodes.map((node) => node.id)).size).toBe(
      primitives.length,
    );
  });

  it("fails closed on unknown ids, collisions, invalid transforms, and malformed usage", () => {
    expect(
      planStudioBg3dProceduralStarterInsertion({
        assetId: "unknown",
        occupiedNodeIds: [],
        currentUsage: EMPTY_USAGE,
        limits: DEFAULT_LIMITS,
      }),
    ).toEqual({ ok: false, reason: "unknown-asset" });

    expect(
      planStudioBg3dProceduralStarterInsertion({
        assetId: "ts3d-door-module-v1",
        instanceId: "door-a",
        occupiedNodeIds: ["door-a.door"],
        currentUsage: EMPTY_USAGE,
        limits: DEFAULT_LIMITS,
      }),
    ).toEqual({ ok: false, reason: "node-id-collision" });

    expect(
      planStudioBg3dProceduralStarterInsertion({
        assetId: "ts3d-door-module-v1",
        instanceId: "bad id",
        occupiedNodeIds: [],
        currentUsage: EMPTY_USAGE,
        limits: DEFAULT_LIMITS,
      }),
    ).toEqual({ ok: false, reason: "invalid-instance-id" });

    expect(
      planStudioBg3dProceduralStarterInsertion({
        assetId: "ts3d-door-module-v1",
        occupiedNodeIds: [],
        currentUsage: EMPTY_USAGE,
        limits: DEFAULT_LIMITS,
        origin: [Number.NaN, 0, 0],
      }),
    ).toEqual({ ok: false, reason: "invalid-transform" });

    expect(
      planStudioBg3dProceduralStarterInsertion({
        assetId: "ts3d-door-module-v1",
        occupiedNodeIds: [],
        currentUsage: { ...EMPTY_USAGE, triangles: -1 },
        limits: DEFAULT_LIMITS,
      }),
    ).toEqual({ ok: false, reason: "invalid-budget" });
  });

  it.each([
    ["maxNodes", "node-budget-exceeded"],
    ["maxTriangles", "triangle-budget-exceeded"],
    ["maxDrawCalls", "draw-call-budget-exceeded"],
    ["maxMaterials", "material-budget-exceeded"],
  ] as const)("rejects a scene that would exceed %s", (limitKey, reason) => {
    const asset = STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS[0];
    const result = planStudioBg3dProceduralStarterInsertion({
      assetId: asset.id,
      occupiedNodeIds: [],
      currentUsage: EMPTY_USAGE,
      limits: {
        maxNodes: DEFAULT_LIMITS.maxNodes,
        maxTriangles: DEFAULT_LIMITS.maxTriangles,
        maxDrawCalls: DEFAULT_LIMITS.maxDrawCalls,
        maxMaterials: DEFAULT_LIMITS.maxMaterials,
        [limitKey]: asset.budget[
          limitKey === "maxNodes"
            ? "nodes"
            : limitKey === "maxTriangles"
              ? "triangles"
              : limitKey === "maxDrawCalls"
                ? "drawCalls"
                : "materials"
        ] - 1,
      },
    });
    expect(result).toEqual({ ok: false, reason });
  });
});
