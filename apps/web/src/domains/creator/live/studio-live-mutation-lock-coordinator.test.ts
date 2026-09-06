import { describe, expect, it } from "vitest";

import {
  releaseStudioLiveMutationLocks,
  replaceStudioLiveMutationLocks,
} from "./studio-live-mutation-lock-coordinator";

import type {
  StudioLiveLockAcquireResult,
  StudioLiveParticipant,
} from "./studio-live-collaboration-protocol";

const self: StudioLiveParticipant = {
  sessionId: "self",
  displayName: "나",
  role: "editor",
};

type AcquiredLockResult = Extract<StudioLiveLockAcquireResult, { status: "acquired" }>;

function acquired(resource: string): AcquiredLockResult {
  return {
    status: "acquired",
    resource,
    requestId: `request-${resource}`,
    lock: {
      resource,
      claimId: `lease-${resource}`,
      owner: self,
      leaseUntil: 20_000,
    },
  };
}

describe("studio live mutation lock coordinator", () => {
  it("treats a missing collaboration room as an immediately available local edit", async () => {
    await expect(
      replaceStudioLiveMutationLocks({
        room: null,
        previouslyHeld: ["page:old"],
        nextResources: [" element:p1:e1 ", "element:p1:e1", "element:p1:e2"],
      })
    ).resolves.toEqual({
      ok: true,
      held: ["element:p1:e1", "element:p1:e2"],
      locks: [],
    });
  });

  it("confirms every desired resource in parallel and releases superseded leases after success", async () => {
    const pending = new Map<string, (result: StudioLiveLockAcquireResult) => void>();
    const claimed: string[] = [];
    const released: string[] = [];
    const operation = replaceStudioLiveMutationLocks({
      room: {
        claimLockAsync(resource) {
          claimed.push(resource);
          return new Promise((resolve) => pending.set(resource, resolve));
        },
        releaseLock(resource) {
          released.push(resource);
          return true;
        },
      },
      previouslyHeld: ["element:p1:old", "element:p1:retained"],
      nextResources: ["element:p1:retained", "element:p1:new"],
    });

    expect(claimed).toEqual(["element:p1:retained", "element:p1:new"]);
    expect(released).toEqual([]);
    pending.get("element:p1:new")?.(acquired("element:p1:new"));
    await Promise.resolve();
    expect(released).toEqual([]);
    pending.get("element:p1:retained")?.(acquired("element:p1:retained"));

    await expect(operation).resolves.toEqual({
      ok: true,
      held: ["element:p1:retained", "element:p1:new"],
      locks: [
        acquired("element:p1:retained").lock,
        acquired("element:p1:new").lock,
      ],
    });
    expect(released).toEqual(["element:p1:old"]);
  });

  it.each([
    {
      status: "denied" as const,
      code: "lock_conflict",
      message: "다른 편집자가 사용 중입니다.",
    },
    {
      status: "timeout" as const,
      message: "잠금 응답 시간이 초과되었습니다.",
    },
    {
      status: "revoked" as const,
      code: "access_revoked",
      message: "편집 권한이 해제되었습니다.",
    },
  ])("rolls every lease back when one correlated claim is $status", async (failure) => {
    const released: string[] = [];
    const result = await replaceStudioLiveMutationLocks({
      room: {
        claimLockAsync(resource) {
          if (resource.endsWith("blocked")) {
            return Promise.resolve({
              ...failure,
              resource,
              requestId: `request-${resource}`,
            });
          }
          return Promise.resolve(acquired(resource));
        },
        releaseLock(resource) {
          released.push(resource);
          return true;
        },
      },
      previouslyHeld: ["element:p1:previous"],
      nextResources: ["element:p1:granted", "element:p1:blocked"],
    });

    expect(result).toMatchObject({
      ok: false,
      held: [],
      failure: {
        status: failure.status,
        resource: "element:p1:blocked",
      },
    });
    expect(released).toEqual(["element:p1:previous", "element:p1:granted"]);
  });

  it("deduplicates release cleanup and tolerates leases that already disappeared", () => {
    const released: string[] = [];
    expect(
      releaseStudioLiveMutationLocks(
        {
          releaseLock(resource) {
            released.push(resource);
            return false;
          },
        },
        ["page:p1", "page:p1", "", " element:p1:e1 "]
      )
    ).toEqual([]);
    expect(released).toEqual(["page:p1", "element:p1:e1"]);
  });
});
