import { describe, expect, it } from "vitest";

import {
  canBeginStudioLiveMutation,
  findConflictingStudioLiveLock,
  parseStudioLiveLayerLockResource,
  planStudioLiveHeldResourceClear,
  planStudioLiveHeldResourceReplace,
  selfHoldsStudioLiveLock,
  studioLiveElementResource,
  studioLiveLayerAwareLockResourcesConflict,
  studioLiveLayerResource,
  studioLiveMutationResources,
  studioLivePageResource,
} from "./studio-live-mutation-guard";
import { replaceStudioLiveMutationLocks } from "./studio-live-mutation-lock-coordinator";

import type { StudioLiveLockAcquireResult } from "./studio-live-collaboration-protocol";

import { studioLiveLockResourcesConflict } from "@/shared/lib/studio-live-lock-resource";


const now = 1_000_000;

function lock(
  resource: string,
  sessionId: string,
  leaseUntil = now + 10_000,
  displayName = "동료"
) {
  return {
    resource,
    claimId: `c-${resource}`,
    owner: { sessionId, displayName },
    leaseUntil,
  };
}

describe("studio live mutation guard", () => {
  it("builds hierarchical page and element resources", () => {
    expect(studioLivePageResource("p1")).toBe("page:p1");
    expect(studioLiveElementResource("p1", "e2")).toBe("element:p1:e2");
    expect(studioLiveMutationResources({ pageId: "p1", elementIds: ["e1", "e1", "e2"] })).toEqual([
      "element:p1:e1",
      "element:p1:e2",
    ]);
    expect(studioLiveMutationResources({ pageId: "p1", elementIds: [] })).toEqual(["page:p1"]);
  });

  it("ignores expired and self-owned locks", () => {
    const locks = [
      lock("page:p1", "self", now - 1),
      lock("element:p1:e1", "self", now + 5_000),
    ];
    expect(findConflictingStudioLiveLock(locks, "page:p1", "self", now)).toBeNull();
    expect(selfHoldsStudioLiveLock(locks, "element:p1:e1", "self", now)).toBe(true);
    expect(canBeginStudioLiveMutation({
      locks,
      pageId: "p1",
      elementIds: ["e1"],
      selfSessionId: "self",
      now,
    })).toEqual({ ok: true });
  });

  it("blocks when another editor holds page or element lock", () => {
    const pageLock = lock("page:p1", "other", now + 5_000, "민수");
    const deniedPage = canBeginStudioLiveMutation({
      locks: [pageLock],
      pageId: "p1",
      elementIds: ["e9"],
      selfSessionId: "self",
      now,
    });
    expect(deniedPage.ok).toBe(false);
    if (!deniedPage.ok) {
      expect(deniedPage.reason).toContain("민수");
      expect(deniedPage.lock.resource).toBe("page:p1");
    }

    const elementLock = lock("element:p1:e2", "other2", now + 5_000, "지영");
    const deniedElement = canBeginStudioLiveMutation({
      locks: [elementLock],
      pageId: "p1",
      elementIds: ["e2"],
      selfSessionId: "self",
      now,
    });
    expect(deniedElement.ok).toBe(false);
    if (!deniedElement.ok) expect(deniedElement.lock.resource).toBe("element:p1:e2");

    const deniedPageByChild = canBeginStudioLiveMutation({
      locks: [elementLock],
      pageId: "p1",
      elementIds: null,
      selfSessionId: "self",
      now,
    });
    expect(deniedPageByChild.ok).toBe(false);

    expect(canBeginStudioLiveMutation({
      locks: [elementLock],
      pageId: "p1",
      elementIds: ["sibling"],
      selfSessionId: "self",
      now,
    })).toEqual({ ok: true });
  });

  it("planStudioLiveHeldResourceReplace retains the intersection and changes only the delta", () => {
    const plan = planStudioLiveHeldResourceReplace(
      ["page:p1", "element:p1:a"],
      ["page:p1", "element:p1:b"]
    );
    expect(plan.toRelease).toEqual(["element:p1:a"]);
    expect(plan.toClaim).toEqual(["element:p1:b"]);
    expect(plan.held).toEqual(["page:p1", "element:p1:b"]);
  });

  it("planStudioLiveHeldResourceClear releases every tracked resource", () => {
    const plan = planStudioLiveHeldResourceClear(["page:p1", "element:p1:a"]);
    expect(plan.toRelease).toEqual(["page:p1", "element:p1:a"]);
    expect(plan.held).toEqual([]);
  });

  it("builds and parses the first-class layer resource grammar", () => {
    expect(studioLiveLayerResource("p1", "l1")).toBe("layer:p1:l1");
    expect(parseStudioLiveLayerLockResource("layer:p1:l1")).toEqual({
      pageId: "p1",
      layerId: "l1",
    });
    // Layer ids may themselves contain separators; the first `:` splits page from layer.
    expect(parseStudioLiveLayerLockResource("layer:p1:l:sub")).toEqual({
      pageId: "p1",
      layerId: "l:sub",
    });
    expect(parseStudioLiveLayerLockResource("layer:p1:")).toBeNull();
    expect(parseStudioLiveLayerLockResource("layer::l1")).toBeNull();
    expect(parseStudioLiveLayerLockResource("layer:")).toBeNull();
    expect(parseStudioLiveLayerLockResource("page:p1")).toBeNull();
    expect(parseStudioLiveLayerLockResource("element:p1:e1")).toBeNull();
  });

  it("layer-aware conflicts: page covers its layers, sibling layers stay independent", () => {
    // Page ↔ layer, both directions.
    expect(studioLiveLayerAwareLockResourcesConflict("page:p1", "layer:p1:l1")).toBe(true);
    expect(studioLiveLayerAwareLockResourcesConflict("layer:p1:l1", "page:p1")).toBe(true);
    expect(studioLiveLayerAwareLockResourcesConflict("layer:p1:l1", "page:p2")).toBe(false);
    // Layer ↔ layer: exact match only.
    expect(studioLiveLayerAwareLockResourcesConflict("layer:p1:l1", "layer:p1:l1")).toBe(true);
    expect(studioLiveLayerAwareLockResourcesConflict("layer:p1:l1", "layer:p1:l2")).toBe(false);
    expect(studioLiveLayerAwareLockResourcesConflict("layer:p1:l1", "layer:p2:l1")).toBe(false);
    // Layer ↔ element: never at the grammar level — element ids do not encode their layer, so
    // the caller passes the containing layer resource alongside element resources instead.
    expect(studioLiveLayerAwareLockResourcesConflict("layer:p1:l1", "element:p1:e1")).toBe(false);
    expect(studioLiveLayerAwareLockResourcesConflict("element:p1:e1", "layer:p1:l1")).toBe(false);
    // Layer ↔ unknown/legacy ids: exact-match semantics only.
    expect(studioLiveLayerAwareLockResourcesConflict("layer:p1:l1", "legacy-lock")).toBe(false);
    expect(studioLiveLayerAwareLockResourcesConflict("legacy-lock", "legacy-lock")).toBe(true);
  });

  it("layer-aware conflicts delegate non-layer pairs to the shared grammar byte-identically", () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ["page:p1", "page:p1"],
      ["page:p1", "page:p2"],
      ["page:p1", "element:p1:e1"],
      ["element:p1:e1", "page:p1"],
      ["element:p1:e1", "element:p1:e1"],
      ["element:p1:e1", "element:p1:e2"],
      ["element:p1:e1", "element:p2:e1"],
      ["legacy-a", "legacy-b"],
      ["page:", "page:"],
    ];
    for (const [left, right] of pairs) {
      expect(studioLiveLayerAwareLockResourcesConflict(left, right)).toBe(
        studioLiveLockResourcesConflict(left, right)
      );
    }
  });

  it("claims layer resources first-class and keeps the legacy element/page fallback", () => {
    expect(
      studioLiveMutationResources({ pageId: "p1", layerIds: ["l1", "l1", " l2 "] })
    ).toEqual(["layer:p1:l1", "layer:p1:l2"]);
    // Caller contract: declaring the containing layer alongside elements claims both scopes.
    expect(
      studioLiveMutationResources({ pageId: "p1", layerIds: ["l1"], elementIds: ["e1"] })
    ).toEqual(["layer:p1:l1", "element:p1:e1"]);
    expect(studioLiveMutationResources({ pageId: "p1", layerIds: [], elementIds: [] })).toEqual([
      "page:p1",
    ]);
    expect(studioLiveMutationResources({ pageId: "p1", layerIds: ["", "  "] })).toEqual([
      "page:p1",
    ]);
  });

  it("gates layer edits against page and layer locks; siblings stay editable", () => {
    const pageLock = lock("page:p1", "other", now + 5_000, "민수");
    const deniedByPage = canBeginStudioLiveMutation({
      locks: [pageLock],
      pageId: "p1",
      layerIds: ["l1"],
      selfSessionId: "self",
      now,
    });
    expect(deniedByPage.ok).toBe(false);
    if (!deniedByPage.ok) expect(deniedByPage.lock.resource).toBe("page:p1");

    const layerLock = lock("layer:p1:l1", "other", now + 5_000, "지영");
    const deniedByLayer = canBeginStudioLiveMutation({
      locks: [layerLock],
      pageId: "p1",
      layerIds: ["l1"],
      selfSessionId: "self",
      now,
    });
    expect(deniedByLayer.ok).toBe(false);
    if (!deniedByLayer.ok) {
      expect(deniedByLayer.reason).toContain("지영");
      expect(deniedByLayer.lock.resource).toBe("layer:p1:l1");
    }

    // A peer layer lock blocks a whole-page edit (page resource conflicts with its layers).
    const deniedPageByLayer = canBeginStudioLiveMutation({
      locks: [layerLock],
      pageId: "p1",
      selfSessionId: "self",
      now,
    });
    expect(deniedPageByLayer.ok).toBe(false);

    // Sibling layers and self-owned layer leases never block.
    expect(canBeginStudioLiveMutation({
      locks: [layerLock],
      pageId: "p1",
      layerIds: ["l2"],
      selfSessionId: "self",
      now,
    })).toEqual({ ok: true });
    expect(canBeginStudioLiveMutation({
      locks: [lock("layer:p1:l1", "self", now + 5_000)],
      pageId: "p1",
      layerIds: ["l1"],
      selfSessionId: "self",
      now,
    })).toEqual({ ok: true });
    expect(findConflictingStudioLiveLock([layerLock], "layer:p1:l2", "self", now)).toBeNull();
  });

  it("layer↔element exclusion is the caller's contract: declare the containing layer", () => {
    const layerLock = lock("layer:p1:l1", "other", now + 5_000, "지영");
    // Element ids do not encode layers, so an undeclared element edit passes the guard.
    expect(canBeginStudioLiveMutation({
      locks: [layerLock],
      pageId: "p1",
      elementIds: ["e1"],
      selfSessionId: "self",
      now,
    })).toEqual({ ok: true });
    // Declaring the containing layer makes the peer's layer lease block the same element edit.
    const denied = canBeginStudioLiveMutation({
      locks: [layerLock],
      pageId: "p1",
      layerIds: ["l1"],
      elementIds: ["e1"],
      selfSessionId: "self",
      now,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.lock.resource).toBe("layer:p1:l1");
  });

  it("atomic acquisition: a denied layer claim releases the whole mixed set", async () => {
    const held = new Set<string>();
    const room = {
      async claimLockAsync(resource: string): Promise<StudioLiveLockAcquireResult> {
        if (resource === "layer:p1:l1") {
          return {
            status: "denied",
            resource,
            requestId: `r-${resource}`,
            code: "held",
            message: "다른 세션이 레이어를 점유 중입니다.",
          };
        }
        held.add(resource);
        return {
          status: "acquired",
          resource,
          requestId: `r-${resource}`,
          lock: {
            resource,
            claimId: `c-${resource}`,
            owner: { sessionId: "self", displayName: "나", role: "editor" as const },
            leaseUntil: now + 10_000,
          },
        };
      },
      releaseLock(resource: string) {
        return held.delete(resource);
      },
    };

    const denied = await replaceStudioLiveMutationLocks({
      room,
      previouslyHeld: ["element:p1:e0"],
      nextResources: studioLiveMutationResources({
        pageId: "p1",
        layerIds: ["l1"],
        elementIds: ["e1", "e2"],
      }),
    });
    expect(denied.ok).toBe(false);
    expect(denied.ok ? null : denied.failure.status).toBe("denied");
    // All-or-nothing: partially acquired element leases were rolled back too.
    expect(held.size).toBe(0);

    const acquired = await replaceStudioLiveMutationLocks({
      room,
      previouslyHeld: [],
      nextResources: studioLiveMutationResources({
        pageId: "p1",
        layerIds: ["l2"],
        elementIds: ["e1"],
      }),
    });
    expect(acquired.ok).toBe(true);
    if (acquired.ok) {
      expect([...acquired.held]).toEqual(["layer:p1:l2", "element:p1:e1"]);
    }
    expect([...held].sort()).toEqual(["element:p1:e1", "layer:p1:l2"]);
  });

  it("claim/release contract: simulated room never strands after replace+clear", () => {
    const claimed = new Set<string>();
    const room = {
      claimLock(resource: string) {
        claimed.add(resource);
      },
      releaseLock(resource: string) {
        claimed.delete(resource);
      },
    };
    let held: string[] = [];
    // First edit claim
    {
      const next = studioLiveMutationResources({ pageId: "p1", elementIds: null });
      const plan = planStudioLiveHeldResourceReplace(held, next);
      for (const resource of plan.toRelease) room.releaseLock(resource);
      for (const resource of plan.toClaim) room.claimLock(resource);
      held = [...plan.held];
    }
    expect([...claimed].sort()).toEqual(["page:p1"]);
    // A concrete element edit replaces the page-wide claim instead of holding both scopes.
    {
      const next = studioLiveMutationResources({ pageId: "p1", elementIds: ["e9"] });
      const plan = planStudioLiveHeldResourceReplace(held, next);
      for (const resource of plan.toRelease) room.releaseLock(resource);
      for (const resource of plan.toClaim) room.claimLock(resource);
      held = [...plan.held];
    }
    expect([...claimed].sort()).toEqual(["element:p1:e9"]);
    // Early-exit path: clear must empty room
    {
      const plan = planStudioLiveHeldResourceClear(held);
      for (const resource of plan.toRelease) room.releaseLock(resource);
      held = [...plan.held];
    }
    expect(held).toEqual([]);
    expect(claimed.size).toBe(0);
  });
});
