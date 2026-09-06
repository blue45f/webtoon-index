import { describe, expect, it, vi } from "vitest";

import {
  saveStudioLinked3dNewWorkThroughCloudRoom,
  type StudioLinked3dProvisionalWorkUpdatePayload,
} from "./studio-linked-3d-new-work-cloud-save";

import type { CreatorDraftCollaborationRoomResponse } from "./creator-draft-collaboration-client";
import type { StudioDraftCollaborationIdentity } from "./studio-draft-collaboration";
import type { CreateWorkInput } from "@/src/infrastructure/creator-client";

const now = Date.now();
const identity: StudioDraftCollaborationIdentity = {
  version: 1,
  draftDocumentId: "draft_12345678-1234-4234-8234-123456789abc",
  documentScopeKey: "studio:new",
  ownerScopeKey: "12345678-1234-4234-8234-123456789abc",
  createdAt: new Date(now - 3600_000).toISOString(),
  lastOpenedAt: new Date(now - 3600_000).toISOString(),
  expiresAt: new Date(now + 14 * 86400_000).toISOString(),
  persistence: "persistent",
};

const createPayload: CreateWorkInput = {
  title: "linked pass",
  description: "",
  tags: [],
  format: "cuttoon",
  cover: "cover",
  pages: ["page"],
  doc: { pagesList: [] },
  status: "published",
  remixFromId: null,
};

function room(status: "active" | "promoted" = "active"): CreatorDraftCollaborationRoomResponse {
  return {
    version: 1,
    roomId: "draft-room_12345678-1234-4234-8234-123456789abc",
    draftDocumentId: identity.draftDocumentId,
    provisionalWorkId: "87654321-4321-4321-8321-cba987654321",
    ownerScopeKey: identity.ownerScopeKey,
    status,
    graphRevision: status === "promoted" ? 1 : 0,
    initialSnapshotByteLength: 1_024,
    provisionIntent: "cloud-save",
    provisionedAt: new Date(now - 3600_000).toISOString(),
    expiresAt: new Date(now + 3 * 86400_000).toISOString(),
    promotedAt: status === "promoted" ? new Date(now - 1800_000).toISOString() : null,
  };
}

function dependencies(activeRoom = room()) {
  const calls: string[] = [];
  return {
    calls,
    value: {
      provision: vi.fn(async () => {
        calls.push("provision");
        return activeRoom;
      }),
      inspectWorkRevision: vi.fn(async () => {
        calls.push("inspect");
        return 4;
      }),
      ensureCloudArtifacts: vi.fn(async () => {
        calls.push("artifacts");
        return [];
      }),
      compensateCloudArtifacts: vi.fn(async () => {
        calls.push("compensate");
      }),
      updateWork: vi.fn(async (
        _workId: string,
        _payload: StudioLinked3dProvisionalWorkUpdatePayload,
        _signal?: AbortSignal,
      ) => {
        calls.push("update");
        return 5;
      }),
      promote: vi.fn(async () => {
        calls.push("promote");
        return room("promoted");
      }),
      retireIdentity: vi.fn(async () => {
        calls.push("retire");
        return true;
      }),
    },
  };
}

describe("saveStudioLinked3dNewWorkThroughCloudRoom", () => {
  it("uploads verified artifacts before the exact-revision update and atomic promotion", async () => {
    const deps = dependencies();
    const result = await saveStudioLinked3dNewWorkThroughCloudRoom({
      actorAuthScopeKey: identity.ownerScopeKey,
      createPayload,
      dependencies: deps.value,
      finalStatus: "published",
      identity,
      initialSnapshotByteLength: 1_024,
    });

    expect(deps.calls).toEqual([
      "provision",
      "inspect",
      "artifacts",
      "update",
      "promote",
      "retire",
    ]);
    expect(deps.value.updateWork).toHaveBeenCalledWith(
      result.workId,
      expect.objectContaining({ baseRevision: 4, status: "draft" }),
      undefined,
    );
    const stagedPayload = deps.value.updateWork.mock.calls[0]?.[1];
    expect(stagedPayload).not.toHaveProperty("remixFromId");
    expect(deps.value.promote).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedWorkRevision: 5,
        finalStatus: "published",
        targetWorkId: result.workId,
      }),
      { signal: undefined },
    );
    expect(result.revision).toBe(5);
    expect(result.outcome).toBe("promoted");
    expect(result.room.status).toBe("promoted");
    expect(deps.value.retireIdentity).toHaveBeenCalledWith(identity);
  });

  it("reuses an existing room without provisioning it again", async () => {
    const deps = dependencies();
    await saveStudioLinked3dNewWorkThroughCloudRoom({
      actorAuthScopeKey: identity.ownerScopeKey,
      createPayload,
      dependencies: deps.value,
      existingRoom: room(),
      finalStatus: "draft",
      identity,
      initialSnapshotByteLength: 1_024,
    });

    expect(deps.calls).toEqual(["inspect", "artifacts", "update", "promote", "retire"]);
  });

  it.each([
    ["provision response", undefined, ["provision", "inspect", "retire"]],
    ["existing room", room("promoted"), ["inspect", "retire"]],
  ] as const)("recovers without upload/update for a promoted %s", async (
    _label,
    existingRoom,
    expectedCalls,
  ) => {
    const deps = dependencies(room("promoted"));
    const result = await saveStudioLinked3dNewWorkThroughCloudRoom({
      actorAuthScopeKey: identity.ownerScopeKey,
      createPayload,
      dependencies: deps.value,
      existingRoom,
      finalStatus: "draft",
      identity,
      initialSnapshotByteLength: 1_024,
    });

    expect(deps.calls).toEqual(expectedCalls);
    expect(deps.value.inspectWorkRevision).toHaveBeenCalledTimes(1);
    expect(deps.value.ensureCloudArtifacts).not.toHaveBeenCalled();
    expect(deps.value.updateWork).not.toHaveBeenCalled();
    expect(deps.value.promote).not.toHaveBeenCalled();
    expect(deps.value.compensateCloudArtifacts).not.toHaveBeenCalled();
    expect(deps.value.retireIdentity).toHaveBeenCalledWith(identity);
    expect(result).toMatchObject({
      outcome: "recovered-existing",
      revision: 4,
      workId: room("promoted").provisionalWorkId,
    });
  });

  it("recovers a promoted work with an unknown revision when read-only inspection fails", async () => {
    const deps = dependencies(room("promoted"));
    deps.value.inspectWorkRevision.mockImplementationOnce(async () => {
      deps.calls.push("inspect");
      throw new Error("read unavailable");
    });

    const result = await saveStudioLinked3dNewWorkThroughCloudRoom({
      actorAuthScopeKey: identity.ownerScopeKey,
      createPayload,
      dependencies: deps.value,
      finalStatus: "draft",
      identity,
      initialSnapshotByteLength: 1_024,
    });

    expect(deps.calls).toEqual(["provision", "inspect", "retire"]);
    expect(result).toMatchObject({ outcome: "recovered-existing", revision: null });
    expect(deps.value.ensureCloudArtifacts).not.toHaveBeenCalled();
    expect(deps.value.updateWork).not.toHaveBeenCalled();
  });

  it("fails before JSON mutation when cloud artifact upload fails", async () => {
    const deps = dependencies();
    deps.value.ensureCloudArtifacts.mockRejectedValueOnce(new Error("asset unavailable"));

    await expect(saveStudioLinked3dNewWorkThroughCloudRoom({
      actorAuthScopeKey: identity.ownerScopeKey,
      createPayload,
      dependencies: deps.value,
      finalStatus: "draft",
      identity,
      initialSnapshotByteLength: 1_024,
    })).rejects.toThrow("asset unavailable");
    expect(deps.value.updateWork).not.toHaveBeenCalled();
    expect(deps.value.promote).not.toHaveBeenCalled();
  });

  it("fails closed when the update response does not advance exactly one revision", async () => {
    const deps = dependencies();
    deps.value.updateWork.mockImplementationOnce(async () => {
      deps.calls.push("update");
      return 7;
    });

    await expect(saveStudioLinked3dNewWorkThroughCloudRoom({
      actorAuthScopeKey: identity.ownerScopeKey,
      createPayload,
      dependencies: deps.value,
      finalStatus: "draft",
      identity,
      initialSnapshotByteLength: 1_024,
    })).rejects.toThrow("정확히 한 세대");
    expect(deps.value.promote).not.toHaveBeenCalled();
    expect(deps.value.retireIdentity).not.toHaveBeenCalled();
    expect(deps.calls).toEqual([
      "provision",
      "inspect",
      "artifacts",
      "update",
      "compensate",
    ]);
  });

  it("fails closed before provisioning a linked remix without atomic provenance promotion", async () => {
    const deps = dependencies();

    await expect(saveStudioLinked3dNewWorkThroughCloudRoom({
      actorAuthScopeKey: identity.ownerScopeKey,
      createPayload: { ...createPayload, remixFromId: "source-work" },
      dependencies: deps.value,
      finalStatus: "draft",
      identity,
      initialSnapshotByteLength: 1_024,
    })).rejects.toThrow("리믹스 신규 저장");

    expect(deps.calls).toEqual([]);
    expect(deps.value.provision).not.toHaveBeenCalled();
  });

  it("treats an already-absent exact identity as safe after promotion", async () => {
    const deps = dependencies();
    deps.value.retireIdentity.mockImplementationOnce(async () => {
      deps.calls.push("retire");
      return false;
    });

    const result = await saveStudioLinked3dNewWorkThroughCloudRoom({
      actorAuthScopeKey: identity.ownerScopeKey,
      createPayload,
      dependencies: deps.value,
      finalStatus: "draft",
      identity,
      initialSnapshotByteLength: 1_024,
    });

    expect(deps.calls).toEqual([
      "provision",
      "inspect",
      "artifacts",
      "update",
      "promote",
      "retire",
    ]);
    expect(result.outcome).toBe("promoted");
  });

  it("checks the caller freshness fence after each awaited authority boundary", async () => {
    const deps = dependencies();
    let checks = 0;
    await expect(saveStudioLinked3dNewWorkThroughCloudRoom({
      actorAuthScopeKey: identity.ownerScopeKey,
      assertFresh: () => {
        checks += 1;
        if (checks === 3) throw new Error("stale document");
      },
      createPayload,
      dependencies: deps.value,
      finalStatus: "draft",
      identity,
      initialSnapshotByteLength: 1_024,
    })).rejects.toThrow("stale document");
    expect(deps.calls).toEqual(["provision", "inspect"]);
    expect(deps.value.ensureCloudArtifacts).not.toHaveBeenCalled();
  });
});
