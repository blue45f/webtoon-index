import { describe, expect, it } from "vitest";

import {
  gateStudioCanvasMutation,
  selfHoldsStudioCanvasMutationTargets,
} from "./studio-live-canvas-mutation-gate";

const now = 2_000_000;

function lock(
  resource: string,
  sessionId: string,
  displayName = "동료",
  leaseUntil = now + 30_000
) {
  return {
    resource,
    claimId: `claim-${resource}`,
    owner: { sessionId, displayName },
    leaseUntil,
  };
}

describe("gateStudioCanvasMutation", () => {
  it("allows select without a lease while blocking drag/text for non-holders", () => {
    const locks = [lock("element:p1:e1", "other", "민수")];

    const select = gateStudioCanvasMutation({
      locks,
      pageId: "p1",
      elementIds: ["e1"],
      selfSessionId: "self",
      intent: "select",
      now,
    });
    expect(select).toEqual({ ok: true, resources: [], intent: "select" });

    const drag = gateStudioCanvasMutation({
      locks,
      pageId: "p1",
      elementIds: ["e1"],
      selfSessionId: "self",
      intent: "drag",
      now,
    });
    expect(drag.ok).toBe(false);
    if (!drag.ok) {
      expect(drag.reason).toContain("민수");
      expect(drag.reason).toContain("드래그");
      expect(drag.lock.resource).toBe("element:p1:e1");
    }

    const text = gateStudioCanvasMutation({
      locks,
      pageId: "p1",
      elementIds: ["e1"],
      selfSessionId: "self",
      intent: "text-edit",
      now,
    });
    expect(text.ok).toBe(false);
    if (!text.ok) expect(text.reason).toContain("텍스트");
  });

  it("lets the lease holder mutate selection targets", () => {
    const locks = [lock("element:p1:e1", "self", "나")];
    for (const intent of ["drag", "text-edit", "transform"] as const) {
      const result = gateStudioCanvasMutation({
        locks,
        pageId: "p1",
        elementIds: ["e1"],
        selfSessionId: "self",
        intent,
        now,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.resources).toEqual(["element:p1:e1"]);
      }
    }
    expect(
      selfHoldsStudioCanvasMutationTargets({
        locks,
        pageId: "p1",
        elementIds: ["e1"],
        selfSessionId: "self",
        now,
      })
    ).toBe(true);
  });

  it("page locks block element drag for non-holders; siblings stay free under element locks", () => {
    const pageLock = [lock("page:p1", "other", "지영")];
    const blocked = gateStudioCanvasMutation({
      locks: pageLock,
      pageId: "p1",
      elementIds: ["e9"],
      selfSessionId: "self",
      intent: "drag",
      now,
    });
    expect(blocked.ok).toBe(false);

    const elementLock = [lock("element:p1:e1", "other")];
    const sibling = gateStudioCanvasMutation({
      locks: elementLock,
      pageId: "p1",
      elementIds: ["e2"],
      selfSessionId: "self",
      intent: "drag",
      now,
    });
    expect(sibling.ok).toBe(true);
  });

  it("fail-closes on empty page id", () => {
    const result = gateStudioCanvasMutation({
      locks: [],
      pageId: "  ",
      selfSessionId: "self",
      intent: "page-edit",
      now,
    });
    expect(result.ok).toBe(false);
  });
});
