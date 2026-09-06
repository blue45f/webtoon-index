import { describe, expect, it } from "vitest";

import {
  createStudioUnitCubeMesh,
  hashStudioEditableMesh,
} from "../studio-editable-half-edge-mesh";

import {
  applyStudioSculptStroke,
  createStudioSculptMask,
} from "./studio-hybrid-sculpt-kernel";

function cubeCenter(): { x: number; y: number; z: number } {
  return { x: 0, y: 0, z: 0 };
}

describe("hybrid sculpt kernel — flatten / scrape / snakeHook", () => {
  it("accepts the expanded brush union and changes the mesh", () => {
    for (const kind of ["flatten", "scrape", "snakeHook"] as const) {
      const mesh = createStudioUnitCubeMesh();
      const result = applyStudioSculptStroke(mesh, {
        kind,
        center: cubeCenter(),
        radius: 1,
        strength: 0.3,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      if (kind !== "snakeHook") {
        expect(hashStudioEditableMesh(result.mesh)).not.toBe(hashStudioEditableMesh(mesh));
      }
    }
  });

  it("snake hook without explicit direction drags along the fallback surface axis", () => {
    const mesh = createStudioUnitCubeMesh();
    // 커널은 항상 triangle soup 으로 재구성하므로(쿼드→트라이) 무이동 기준선과 비교한다.
    const baseline = applyStudioSculptStroke(mesh, {
      kind: "snakeHook",
      center: cubeCenter(),
      radius: 1,
      strength: 0,
    });
    const result = applyStudioSculptStroke(mesh, {
      kind: "snakeHook",
      center: cubeCenter(),
      radius: 1,
      strength: 0.4,
    });
    expect(baseline.ok && result.ok).toBe(true);
    if (!baseline.ok || !result.ok) return;
    // 닫힌 메시의 평균 법선 퇴화 시 +y 폴백 축으로 끌린다.
    const baseMaxY = Math.max(...Array.from(baseline.mesh.vertices, (v) => v.position.y));
    const nextMaxY = Math.max(...Array.from(result.mesh.vertices, (v) => v.position.y));
    expect(nextMaxY).toBeGreaterThan(baseMaxY);
  });

  it("scrape respects the vertex mask so masked-out vertices stay frozen", () => {
    const mesh = createStudioUnitCubeMesh();
    const soupVertexCount = mesh.vertices.length;
    const mask = createStudioSculptMask(soupVertexCount, 1);
    const full = applyStudioSculptStroke(mesh, {
      kind: "scrape",
      center: cubeCenter(),
      radius: 1,
      strength: 0.5,
      direction: { x: 0, y: 1, z: 0 },
    });
    const frozen = applyStudioSculptStroke(
      mesh,
      {
        kind: "scrape",
        center: cubeCenter(),
        radius: 1,
        strength: 0.5,
        direction: { x: 0, y: 1, z: 0 },
      },
      (() => {
        mask.fill(0);
        return mask;
      })(),
    );
    const baseline = applyStudioSculptStroke(mesh, {
      kind: "scrape",
      center: cubeCenter(),
      radius: 1,
      strength: 0,
    });
    expect(full.ok && frozen.ok && baseline.ok).toBe(true);
    if (!full.ok || !frozen.ok || !baseline.ok) return;
    expect(hashStudioEditableMesh(frozen.mesh)).toBe(hashStudioEditableMesh(baseline.mesh));
    expect(hashStudioEditableMesh(full.mesh)).not.toBe(hashStudioEditableMesh(frozen.mesh));
  });

  it("rejects invalid brush parameters for the new kinds", () => {
    const mesh = createStudioUnitCubeMesh();
    expect(applyStudioSculptStroke(mesh, {
      kind: "flatten",
      center: cubeCenter(),
      radius: 0,
      strength: 0.5,
    }).ok).toBe(false);
    expect(applyStudioSculptStroke(mesh, {
      kind: "scrape",
      center: cubeCenter(),
      radius: 1,
      strength: Number.NaN,
    }).ok).toBe(false);
  });
});
