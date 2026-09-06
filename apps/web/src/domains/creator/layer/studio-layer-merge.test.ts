import { describe, expect, it } from "vitest";

import {
  applyStudioLayerMergePlan,
  planStudioLayerFlattenVisible,
  planStudioLayerMergeDown,
  planStudioLayerMergeSelected,
} from "./studio-layer-merge";

import type { LayerItemLike } from "../studio-layers";

const items: LayerItemLike[] = [
  { id: "a" },
  { id: "b" },
  { id: "c", locked: true },
  { id: "d", hidden: true },
  { id: "e" },
];

describe("studio layer merge planners", () => {
  it("plans merge-down with the layer immediately below", () => {
    const result = planStudioLayerMergeDown({ items, selectedId: "b" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.removeIds).toEqual(["a", "b"]);
    expect(result.plan.insertIndex).toBe(0);
    expect(result.plan.sources.map((s) => s.zIndex)).toEqual([0, 1]);
  });

  it("rejects merge-down for bottom or locked layers", () => {
    expect(planStudioLayerMergeDown({ items, selectedId: "a" }).ok).toBe(false);
    expect(planStudioLayerMergeDown({ items, selectedId: "c" }).ok).toBe(false);
  });

  it("plans merge-selected for two unlocked visible layers", () => {
    const result = planStudioLayerMergeSelected({
      items,
      selectedIds: ["b", "e"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.removeIds).toEqual(["b", "e"]);
    expect(result.plan.insertIndex).toBe(1);
  });

  it("plans flatten-visible skipping hidden and failing on locked", () => {
    const unlocked = items.map((item) =>
      item.id === "c" ? { ...item, locked: false } : item
    );
    const flat = planStudioLayerFlattenVisible({ items: unlocked });
    expect(flat.ok).toBe(true);
    if (!flat.ok) return;
    // a,b,c,e visible (d hidden)
    expect(flat.plan.removeIds).toEqual(["a", "b", "c", "e"]);

    expect(planStudioLayerFlattenVisible({ items }).ok).toBe(false);
  });

  it("applies merge plan by removing sources and inserting composite", () => {
    const plan = planStudioLayerMergeDown({ items, selectedId: "b" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const next = applyStudioLayerMergePlan(items, plan.plan, { id: "merged" });
    expect(next.map((item) => item.id)).toEqual(["merged", "c", "d", "e"]);
  });

  it("never names the result after a raw element id", () => {
    // 측정된 결함(D9): 결과 행이 `병합 e6659cca` 로 보였다 — 사람이 읽는 행에 해시가 새어나온 것.
    const hashed: LayerItemLike[] = [
      { id: "e6659cca-2f41-4a0e-9d0e-6a7f0b2c1d33", type: "image" },
      { id: "0a1b2c3d-9e8f-4a7b-8c6d-5e4f3a2b1c00", type: "image", name: "선화" },
    ];
    const plan = planStudioLayerMergeDown({ items: hashed, selectedId: hashed[1]!.id });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.resultName).toBe("선화 병합");
    for (const item of hashed) {
      expect(plan.plan.resultName).not.toContain(item.id.slice(0, 8));
    }
  });

  it("falls back to the layer kind, not an id, when nothing was named", () => {
    const unnamed: LayerItemLike[] = [
      { id: "aaaaaaaa-1111", type: "image" },
      { id: "bbbbbbbb-2222", type: "image" },
    ];
    const plan = planStudioLayerMergeDown({ items: unnamed, selectedId: "bbbbbbbb-2222" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.resultName).toBe("이미지 병합");
  });

  it("marks a plan that cannot bake to one layer and names the result honestly", () => {
    // 벡터가 섞이면 호스트는 비파괴 그룹으로 폴백한다 — 행이 줄지 않고 오히려 늘어난다.
    const mixed: LayerItemLike[] = [
      { id: "back", type: "draw", name: "밑그림" },
      { id: "front", type: "image", name: "채색" },
    ];
    const mixedPlan = planStudioLayerMergeDown({ items: mixed, selectedId: "front" });
    expect(mixedPlan.ok).toBe(true);
    if (!mixedPlan.ok) return;
    expect(mixedPlan.plan.bakesToSingleLayer).toBe(false);
    expect(mixedPlan.plan.resultName).toBe("채색 묶음(병합 보류)");
    expect(mixedPlan.plan.resultName).not.toContain("병합 밑");

    const rasterOnly: LayerItemLike[] = [
      { id: "back", type: "image", name: "밑색" },
      { id: "front", type: "image", name: "채색" },
    ];
    const rasterPlan = planStudioLayerMergeDown({ items: rasterOnly, selectedId: "front" });
    expect(rasterPlan.ok).toBe(true);
    if (!rasterPlan.ok) return;
    expect(rasterPlan.plan.bakesToSingleLayer).toBe(true);
    expect(rasterPlan.plan.resultName).toBe("채색 병합");
  });
});
