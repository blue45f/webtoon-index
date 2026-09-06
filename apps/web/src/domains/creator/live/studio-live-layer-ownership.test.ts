import { describe, expect, it } from "vitest";

import {
  buildStudioLiveLayerOwnershipByItemId,
  fingerprintStudioLiveLocks,
  FREE_STUDIO_LIVE_LAYER_OWNERSHIP,
  listStudioLiveLayerOwnershipLocksOnPage,
  resolveStudioLiveLayerOwnership,
  reuseOrBuildStudioLiveLayerOwnershipByItemId,
  studioLiveSelectionEditGate,
  summarizeStudioLiveActiveOwners,
  summarizeStudioLiveSelectionOwnership,
} from "./studio-live-layer-ownership";
import {
  studioLiveElementResource,
  studioLiveLayerResource,
  studioLivePageResource,
  type StudioLiveLockLike,
} from "./studio-live-mutation-guard";

function lock(
  resource: string,
  sessionId: string,
  displayName: string,
  leaseUntil = Date.now() + 60_000,
): StudioLiveLockLike {
  return {
    resource,
    claimId: `claim-${sessionId}-${resource}`,
    owner: { sessionId, displayName },
    leaseUntil,
  };
}

describe("studio live layer ownership", () => {
  const pageId = "page-1";
  const layerA = "layer-a";
  const layerB = "layer-b";
  const now = 1_000_000;

  it("returns free ownership when no locks apply", () => {
    expect(
      resolveStudioLiveLayerOwnership({
        pageId,
        elementId: layerA,
        locks: [],
        selfSessionId: "me",
        now,
      }),
    ).toEqual(FREE_STUDIO_LIVE_LAYER_OWNERSHIP);
  });

  it("marks self-held element leases", () => {
    const ownership = resolveStudioLiveLayerOwnership({
      pageId,
      elementId: layerA,
      locks: [lock(studioLiveElementResource(pageId, layerA), "me", "나")],
      selfSessionId: "me",
      now,
    });
    expect(ownership.kind).toBe("self");
    expect(ownership.blocksLocalEdit).toBe(false);
    expect(ownership.statusLabel).toBe("내가 편집 중");
  });

  it("marks peer element leases as blocking", () => {
    const ownership = resolveStudioLiveLayerOwnership({
      pageId,
      elementId: layerA,
      locks: [lock(studioLiveElementResource(pageId, layerA), "peer", "민수")],
      selfSessionId: "me",
      now,
    });
    expect(ownership.kind).toBe("peer");
    expect(ownership.blocksLocalEdit).toBe(true);
    expect(ownership.ownerDisplayName).toBe("민수");
    expect(ownership.statusLabel).toContain("민수");
    expect(ownership.ownerColor).toMatch(/^#/);
  });

  it("page peer lock shadows every element on the page", () => {
    const ownership = resolveStudioLiveLayerOwnership({
      pageId,
      elementId: layerA,
      locks: [
        lock(studioLivePageResource(pageId), "peer", "지민"),
        lock(studioLiveElementResource(pageId, layerA), "me", "나"),
      ],
      selfSessionId: "me",
      now,
    });
    expect(ownership.kind).toBe("page-peer");
    expect(ownership.blocksLocalEdit).toBe(true);
    expect(ownership.statusLabel).toContain("페이지");
  });

  it("ignores expired leases", () => {
    expect(
      resolveStudioLiveLayerOwnership({
        pageId,
        elementId: layerA,
        locks: [
          lock(
            studioLiveElementResource(pageId, layerA),
            "peer",
            "만료",
            now - 1,
          ),
        ],
        selfSessionId: "me",
        now,
      }).kind,
    ).toBe("free");
  });

  it("marks peer layer seat leases as blocking with the layer status label", () => {
    const ownership = resolveStudioLiveLayerOwnership({
      pageId,
      elementId: layerA,
      locks: [lock(studioLiveLayerResource(pageId, layerA), "peer", "민수")],
      selfSessionId: "me",
      now,
    });
    expect(ownership.kind).toBe("peer");
    expect(ownership.blocksLocalEdit).toBe(true);
    expect(ownership.resource).toBe(studioLiveLayerResource(pageId, layerA));
    expect(ownership.statusLabel).toBe("민수 · 레이어 편집 중");
    expect(ownership.ownerColor).toMatch(/^#/);
  });

  it("marks self-held layer seat leases without blocking", () => {
    const ownership = resolveStudioLiveLayerOwnership({
      pageId,
      elementId: layerA,
      locks: [lock(studioLiveLayerResource(pageId, layerA), "me", "나")],
      selfSessionId: "me",
      now,
    });
    expect(ownership.kind).toBe("self");
    expect(ownership.blocksLocalEdit).toBe(false);
    expect(ownership.resource).toBe(studioLiveLayerResource(pageId, layerA));
    expect(ownership.statusLabel).toBe("내가 편집 중");
  });

  it("layer seat leases stay row-scoped; page peers still shadow the seat", () => {
    // A sibling row is untouched by the seat lease.
    expect(
      resolveStudioLiveLayerOwnership({
        pageId,
        elementId: layerB,
        locks: [lock(studioLiveLayerResource(pageId, layerA), "peer", "민수")],
        selfSessionId: "me",
        now,
      }).kind,
    ).toBe("free");
    // The seat lease outranks an element lease on the same row (it covers the whole layer)…
    const seated = resolveStudioLiveLayerOwnership({
      pageId,
      elementId: layerA,
      locks: [
        lock(studioLiveElementResource(pageId, layerA), "peer2", "지영"),
        lock(studioLiveLayerResource(pageId, layerA), "peer", "민수"),
      ],
      selfSessionId: "me",
      now,
    });
    expect(seated.resource).toBe(studioLiveLayerResource(pageId, layerA));
    expect(seated.ownerDisplayName).toBe("민수");
    // …while a page-level peer lock still shadows every seat on the page.
    const shadowed = resolveStudioLiveLayerOwnership({
      pageId,
      elementId: layerA,
      locks: [
        lock(studioLiveLayerResource(pageId, layerA), "me", "나"),
        lock(studioLivePageResource(pageId), "peer", "지민"),
      ],
      selfSessionId: "me",
      now,
    });
    expect(shadowed.kind).toBe("page-peer");
    expect(shadowed.blocksLocalEdit).toBe(true);
  });

  it("builds a dense map only for non-free entries", () => {
    const map = buildStudioLiveLayerOwnershipByItemId({
      pageId,
      elementIds: [layerA, layerB],
      locks: [
        lock(studioLiveElementResource(pageId, layerA), "peer", "민수"),
      ],
      selfSessionId: "me",
      now,
    });
    expect(map.size).toBe(1);
    expect(map.get(layerA)?.kind).toBe("peer");
    expect(map.get(layerB)).toBeUndefined();
  });

  it("lists active locks that belong to a page, layer seats included", () => {
    const locks = listStudioLiveLayerOwnershipLocksOnPage(
      [
        lock(studioLiveElementResource(pageId, layerA), "peer", "민수"),
        lock(studioLiveLayerResource(pageId, layerB), "peer2", "지영"),
        lock(studioLiveLayerResource("other", layerA), "peer2", "다른페이지시트"),
        lock(studioLivePageResource("other"), "peer", "다른페이지"),
        lock(studioLiveElementResource(pageId, layerB), "me", "나", now - 10),
      ],
      pageId,
      now,
    );
    expect(locks.map((entry) => entry.resource)).toEqual([
      studioLiveElementResource(pageId, layerA),
      studioLiveLayerResource(pageId, layerB),
    ]);
  });

  it("summarizes selection ownership for banners with blocked vs free contrast", () => {
    const ownershipByItemId = buildStudioLiveLayerOwnershipByItemId({
      pageId,
      elementIds: [layerA, layerB],
      locks: [
        lock(studioLiveElementResource(pageId, layerA), "peer", "민수"),
      ],
      selfSessionId: "me",
      now,
    });
    const blocked = summarizeStudioLiveSelectionOwnership({
      selectedIds: [layerA, layerB],
      ownershipByItemId,
    });
    expect(blocked.selectedCount).toBe(2);
    expect(blocked.blockedCount).toBe(1);
    expect(blocked.freeCount).toBe(1);
    expect(blocked.blocksLocalEdit).toBe(true);
    expect(blocked.primaryPeerName).toBe("민수");
    expect(blocked.bannerLabel).toContain("민수");
    expect(blocked.bannerLabel).toMatch(/1\/2/);

    const free = summarizeStudioLiveSelectionOwnership({
      selectedIds: [layerB],
      ownershipByItemId,
    });
    expect(free.blocksLocalEdit).toBe(false);
    expect(free.bannerLabel).toBeNull();
    expect(free.freeCount).toBe(1);

    const blockedGate = studioLiveSelectionEditGate({
      selectedIds: [layerA, layerB],
      ownershipByItemId,
    });
    expect(blockedGate.allowed).toBe(false);
    expect(blockedGate.reason).toContain("민수");
    expect(blockedGate.summary.blockedCount).toBe(1);

    const freeGate = studioLiveSelectionEditGate({
      selectedIds: [layerB],
      ownershipByItemId,
    });
    expect(freeGate.allowed).toBe(true);
    expect(freeGate.reason).toBeNull();
  });

  it("reuses the dense ownership map when lock fingerprint is unchanged", () => {
    const locks = [
      lock(studioLiveElementResource(pageId, layerA), "peer", "민수"),
    ];
    const first = reuseOrBuildStudioLiveLayerOwnershipByItemId({
      pageId,
      elementIds: [layerA, layerB],
      locks,
      selfSessionId: "me",
      now,
      previous: null,
    });
    expect(first.reused).toBe(false);
    expect(first.map.get(layerA)?.kind).toBe("peer");

    const second = reuseOrBuildStudioLiveLayerOwnershipByItemId({
      pageId,
      elementIds: [layerA, layerB],
      // New array identity, same leases.
      locks: locks.map((entry) => ({ ...entry, owner: { ...entry.owner } })),
      selfSessionId: "me",
      now,
      previous: first,
    });
    expect(second.reused).toBe(true);
    expect(second.map).toBe(first.map);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.fingerprint).toBe(fingerprintStudioLiveLocks(locks, now));
    expect(second.fingerprint.length).toBeGreaterThan(0);

    const third = reuseOrBuildStudioLiveLayerOwnershipByItemId({
      pageId,
      elementIds: [layerA, layerB],
      locks: [
        lock(studioLiveElementResource(pageId, layerB), "peer2", "지민"),
      ],
      selfSessionId: "me",
      now,
      previous: second,
    });
    expect(third.reused).toBe(false);
    expect(third.map).not.toBe(first.map);
    expect(third.map.get(layerB)?.ownerDisplayName).toBe("지민");
  });

  it("summarizes active owners for presence chips with peer vs self contrast", () => {
    const locks = [
      lock(studioLiveElementResource(pageId, layerA), "peer", "민수"),
      lock(studioLiveElementResource(pageId, layerB), "me", "나"),
      lock(studioLivePageResource(pageId), "peer2", "지민"),
    ];
    const summary = summarizeStudioLiveActiveOwners({
      locks,
      selfSessionId: "me",
      now,
      nameLimit: 2,
    });
    expect(summary.activeLockCount).toBe(3);
    expect(summary.selfLockCount).toBe(1);
    expect(summary.peerLockCount).toBe(2);
    expect(summary.peerOwnerNames).toEqual(["민수", "지민"]);
    expect(summary.label).toContain("활성 편집 잠금 3개");
    expect(summary.label).toContain("민수");
    expect(summary.label).toContain("나 1");

    const empty = summarizeStudioLiveActiveOwners({ locks: [], selfSessionId: "me", now });
    expect(empty.activeLockCount).toBe(0);
    expect(empty.label).toBeNull();

    const expiredOnly = summarizeStudioLiveActiveOwners({
      locks: [
        lock(studioLiveElementResource(pageId, layerA), "peer", "민수", now - 1),
      ],
      selfSessionId: "me",
      now,
    });
    expect(expiredOnly.activeLockCount).toBe(0);
    expect(expiredOnly.label).toBeNull();

    // Room-pruned path: omit now → count every snapshot row without time filter.
    const snapshotPath = summarizeStudioLiveActiveOwners({
      locks: [
        lock(studioLiveElementResource(pageId, layerA), "peer", "민수", now - 1),
      ],
      selfSessionId: "me",
    });
    expect(snapshotPath.activeLockCount).toBe(1);
    expect(snapshotPath.peerOwnerNames).toEqual(["민수"]);
  });

  it("does not reuse a peer map after leaseUntil expires with the same lock list", () => {
    const leaseUntil = now + 5_000;
    const locks = [
      lock(
        studioLiveElementResource(pageId, layerA),
        "peer",
        "민수",
        leaseUntil,
      ),
    ];
    const whileActive = reuseOrBuildStudioLiveLayerOwnershipByItemId({
      pageId,
      elementIds: [layerA, layerB],
      locks,
      selfSessionId: "me",
      now,
      previous: null,
    });
    expect(whileActive.reused).toBe(false);
    expect(whileActive.map.get(layerA)?.kind).toBe("peer");
    expect(whileActive.fingerprint).toBe(
      fingerprintStudioLiveLocks(locks, now),
    );

    // Same lock array, clock past lease — must rebuild to free (not freeze peer badge).
    const afterExpiry = reuseOrBuildStudioLiveLayerOwnershipByItemId({
      pageId,
      elementIds: [layerA, layerB],
      locks,
      selfSessionId: "me",
      now: leaseUntil + 1,
      previous: whileActive,
    });
    expect(afterExpiry.reused).toBe(false);
    expect(afterExpiry.map).not.toBe(whileActive.map);
    expect(afterExpiry.map.get(layerA)).toBeUndefined();
    expect(afterExpiry.fingerprint).toBe("");
    expect(
      resolveStudioLiveLayerOwnership({
        pageId,
        elementId: layerA,
        locks,
        selfSessionId: "me",
        now: leaseUntil + 1,
      }),
    ).toEqual(FREE_STUDIO_LIVE_LAYER_OWNERSHIP);
    // Direct build at the same now matches the reuse path.
    expect(
      buildStudioLiveLayerOwnershipByItemId({
        pageId,
        elementIds: [layerA, layerB],
        locks,
        selfSessionId: "me",
        now: leaseUntil + 1,
      }).size,
    ).toBe(0);
  });
});
