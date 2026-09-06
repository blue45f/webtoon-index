import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CreatorDraftCollaborationHttpError,
  CreatorDraftCollaborationInputError,
  CreatorDraftCollaborationNetworkError,
  CreatorDraftCollaborationResponseContractError,
  CreatorDraftCollaborationTimeoutError,
  createCreatorDraftCollaborationClient,
  promoteCreatorDraftCollaborationRoom,
  provisionCreatorDraftCollaborationRoom,
  type CreatorDraftCollaborationTransportRequest,
} from "./creator-draft-collaboration-client";

import type {
  StudioDraftCollaborationPromotionRequest,
  StudioDraftCollaborationProvisionRequest,
} from "./studio-draft-collaboration";

const { apiRawPost } = vi.hoisted(() => ({
  apiRawPost: vi.fn(),
}));

vi.mock("@/src/infrastructure/api", () => ({
  api: { raw: { post: apiRawPost } },
  apiPath: (path: string) => `/api${path}`,
}));

const NOW = Date.parse("2026-07-26T00:00:00.000Z");
const DRAFT_ID = "draft_11111111-1111-4111-8111-111111111111";
const ROOM_ID = "draft-room_22222222-2222-4222-8222-222222222222";
const WORK_ID = "33333333-3333-4333-8333-333333333333";
const PROVISION_MUTATION_ID = "44444444-4444-4444-8444-444444444444";
const PROMOTION_MUTATION_ID = "55555555-5555-4555-8555-555555555555";
const OWNER_SCOPE_KEY = "owner-1";
const PROVISIONED_AT = "2026-07-25T23:59:00.000Z";
const EXPIRES_AT = "2026-08-01T23:59:00.000Z";
const PROMOTED_AT = "2026-07-26T00:01:00.000Z";

function provisionRequest(
  overrides: Partial<StudioDraftCollaborationProvisionRequest> = {}
): StudioDraftCollaborationProvisionRequest {
  return {
    version: 1,
    draftDocumentId: DRAFT_ID,
    ownerScopeKey: OWNER_SCOPE_KEY,
    intent: "share-link",
    clientMutationId: PROVISION_MUTATION_ID,
    initialSnapshotByteLength: 1_024,
    requestedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function promotionRequest(
  overrides: Partial<StudioDraftCollaborationPromotionRequest> = {}
): StudioDraftCollaborationPromotionRequest {
  return {
    version: 1,
    draftDocumentId: DRAFT_ID,
    roomId: ROOM_ID,
    ownerScopeKey: OWNER_SCOPE_KEY,
    targetWorkId: WORK_ID,
    expectedGraphRevision: 0,
    expectedWorkRevision: 2,
    finalStatus: "published",
    clientMutationId: PROMOTION_MUTATION_ID,
    requestedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function activeRoom(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    roomId: ROOM_ID,
    draftDocumentId: DRAFT_ID,
    provisionalWorkId: WORK_ID,
    ownerScopeKey: OWNER_SCOPE_KEY,
    status: "active",
    graphRevision: 0,
    initialSnapshotByteLength: 1_024,
    provisionIntent: "share-link",
    provisionedAt: PROVISIONED_AT,
    expiresAt: EXPIRES_AT,
    promotedAt: null,
    ...overrides,
  };
}

function promotedRoom(overrides: Record<string, unknown> = {}) {
  return activeRoom({
    status: "promoted",
    graphRevision: 1,
    promotedAt: PROMOTED_AT,
    ...overrides,
  });
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function clientFor(
  run: (request: CreatorDraftCollaborationTransportRequest) => Promise<Response>
) {
  return createCreatorDraftCollaborationClient({
    transport: run,
    now: () => NOW,
  });
}

beforeEach(() => {
  apiRawPost.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("creator draft collaboration client", () => {
  it("provisions with the strict server DTO, retry key, and bounded room response", async () => {
    const request = provisionRequest({ intent: "cloud-save" });
    const response = activeRoom({ provisionIntent: "cloud-save" });
    const transport = vi.fn(
      async (_request: CreatorDraftCollaborationTransportRequest) =>
        jsonResponse(response)
    );
    const client = clientFor(transport);

    await expect(client.provision(request)).resolves.toEqual(response);

    expect(transport).toHaveBeenCalledOnce();
    const sent = transport.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      path: "/creator/draft-collaboration/rooms",
      headers: {
        Accept: "application/json",
        "Idempotency-Key": PROVISION_MUTATION_ID,
      },
      body: {
        draftDocumentId: DRAFT_ID,
        ownerScopeKey: OWNER_SCOPE_KEY,
        intent: "cloud-save",
        clientMutationId: PROVISION_MUTATION_ID,
        initialSnapshotByteLength: 1_024,
      },
    });
    expect(Object.keys(sent?.body ?? {})).toEqual([
      "draftDocumentId",
      "ownerScopeKey",
      "intent",
      "clientMutationId",
      "initialSnapshotByteLength",
    ]);
    expect(sent?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the shared authenticated API transport with credentials and no implicit retry", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW);
    apiRawPost.mockResolvedValueOnce(jsonResponse(activeRoom()));

    await expect(provisionCreatorDraftCollaborationRoom(provisionRequest({
      clientMutationId: "66666666-6666-4666-8666-666666666666",
    }))).resolves.toMatchObject({ roomId: ROOM_ID, status: "active" });

    expect(apiRawPost).toHaveBeenCalledOnce();
    expect(apiRawPost).toHaveBeenCalledWith(
      "/api/creator/draft-collaboration/rooms",
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
        retry: 0,
        timeout: false,
        throwHttpErrors: false,
        headers: {
          Accept: "application/json",
          "Idempotency-Key": "66666666-6666-4666-8666-666666666666",
        },
        json: {
          draftDocumentId: DRAFT_ID,
          ownerScopeKey: OWNER_SCOPE_KEY,
          intent: "share-link",
          clientMutationId: "66666666-6666-4666-8666-666666666666",
          initialSnapshotByteLength: 1_024,
        },
        signal: expect.any(AbortSignal),
      })
    );

    nowSpy.mockRestore();
  });

  it("promotes through the room path without sending local-only contract fields", async () => {
    const transport = vi.fn(async () => jsonResponse(promotedRoom()));
    const client = clientFor(transport);

    await expect(client.promote(promotionRequest())).resolves.toEqual(promotedRoom());

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/creator/draft-collaboration/rooms/${ROOM_ID}/promote`,
        headers: {
          Accept: "application/json",
          "Idempotency-Key": PROMOTION_MUTATION_ID,
        },
        body: {
          draftDocumentId: DRAFT_ID,
          ownerScopeKey: OWNER_SCOPE_KEY,
          targetWorkId: WORK_ID,
          expectedGraphRevision: 0,
          expectedWorkRevision: 2,
          finalStatus: "published",
          clientMutationId: PROMOTION_MUTATION_ID,
        },
      })
    );
  });

  it("keeps duplicate submissions idempotent and rejects mutation-key reuse for another body", async () => {
    const transport = vi.fn(
      async (_request: CreatorDraftCollaborationTransportRequest) =>
        jsonResponse(activeRoom())
    );
    const client = clientFor(transport);
    const request = provisionRequest();

    await client.provision(request);
    await client.provision(request);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.map(([sent]) => sent.headers["Idempotency-Key"])).toEqual([
      PROVISION_MUTATION_ID,
      PROVISION_MUTATION_ID,
    ]);

    await expect(client.provision(provisionRequest({
      initialSnapshotByteLength: 2_048,
    }))).rejects.toBeInstanceOf(CreatorDraftCollaborationInputError);
    await expect(client.provision(provisionRequest({
      intent: "cloud-save",
    }))).rejects.toBeInstanceOf(CreatorDraftCollaborationInputError);
    expect(transport).toHaveBeenCalledTimes(2);

    const promotionTransport = vi.fn(async () => jsonResponse(promotedRoom()));
    const promotionClient = clientFor(promotionTransport);
    const promotion = promotionRequest();
    await promotionClient.promote(promotion);
    await promotionClient.promote(promotion);
    await expect(promotionClient.promote(promotionRequest({
      expectedWorkRevision: 3,
    }))).rejects.toBeInstanceOf(CreatorDraftCollaborationInputError);
    await expect(promotionClient.promote(promotionRequest({
      finalStatus: "draft",
    }))).rejects.toBeInstanceOf(CreatorDraftCollaborationInputError);
    expect(promotionTransport).toHaveBeenCalledTimes(2);
  });

  it("propagates a caller abort and never starts a pre-aborted request", async () => {
    const reason = new DOMException("navigation", "AbortError");
    const preAborted = new AbortController();
    preAborted.abort(reason);
    const transport = vi.fn(async () => jsonResponse(activeRoom()));
    const client = clientFor(transport);

    await expect(client.provision(provisionRequest(), {
      signal: preAborted.signal,
    })).rejects.toBe(reason);
    expect(transport).not.toHaveBeenCalled();

    const pendingTransport = vi.fn(
      ({ signal }: CreatorDraftCollaborationTransportRequest) =>
        new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        })
    );
    const pendingClient = clientFor(pendingTransport);
    const controller = new AbortController();
    const pending = pendingClient.provision(provisionRequest(), {
      signal: controller.signal,
    });
    const pendingRejection = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await pendingRejection;
  });

  it("aborts a silent request at the explicit timeout", async () => {
    vi.useFakeTimers();
    const transport = vi.fn(
      ({ signal }: CreatorDraftCollaborationTransportRequest) =>
        new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        })
    );
    const client = clientFor(transport);
    const pending = client.provision(provisionRequest(), { timeoutMs: 25 });
    const rejection = expect(pending).rejects.toMatchObject({
      name: "TimeoutError",
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });

  it("exposes 429 retry timing from Retry-After and the bounded server payload", async () => {
    const client = clientFor(async () =>
      jsonResponse(
        {
          code: "creator_draft_collaboration_rate_limited",
          message: "잠시 후 다시 시도해 주세요.",
          retryAfterSeconds: 99,
        },
        429,
        { "Retry-After": "7" }
      )
    );

    await expect(client.provision(provisionRequest())).rejects.toMatchObject({
      name: "CreatorDraftCollaborationHttpError",
      kind: "rate-limited",
      status: 429,
      serverCode: "creator_draft_collaboration_rate_limited",
      retryAfterMs: 7_000,
      message: "잠시 후 다시 시도해 주세요.",
    });
  });

  it("falls back to retryAfterSeconds when Retry-After is absent", async () => {
    const client = clientFor(async () =>
      jsonResponse({ retryAfterSeconds: 13 }, 429)
    );

    await expect(client.provision(provisionRequest())).rejects.toMatchObject({
      kind: "rate-limited",
      retryAfterMs: 13_000,
    });
  });

  it.each([
    [404, "not-found", null],
    [410, "expired", null],
    [409, "conflict", 7],
  ] as const)(
    "maps HTTP %i to a distinct fail-closed client state",
    async (status, kind, currentGraphRevision) => {
      const payload =
        status === 409
          ? {
              code: "creator_draft_collaboration_graph_conflict",
              currentGraphRevision,
            }
          : {};
      const client = clientFor(async () => jsonResponse(payload, status));

      const rejection = client.promote(promotionRequest());
      await expect(rejection).rejects.toBeInstanceOf(
        CreatorDraftCollaborationHttpError
      );
      await expect(rejection).rejects.toMatchObject({
        status,
        kind,
        currentGraphRevision,
      });
    }
  );

  it("exposes the bounded current work revision from a publication conflict", async () => {
    const client = clientFor(async () =>
      jsonResponse({
        code: "creator_draft_collaboration_work_revision_conflict",
        currentWorkRevision: 12,
      }, 409)
    );

    await expect(client.promote(promotionRequest())).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
      serverCode: "creator_draft_collaboration_work_revision_conflict",
      currentGraphRevision: null,
      currentWorkRevision: 12,
    });
  });

  it("fails closed on invalid JSON, media type, schema, declared size, and actual size", async () => {
    const invalidJson = clientFor(async () =>
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(invalidJson.provision(provisionRequest())).rejects.toBeInstanceOf(
      CreatorDraftCollaborationResponseContractError
    );

    const wrongMediaType = clientFor(async () =>
      new Response(JSON.stringify(activeRoom()), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })
    );
    await expect(wrongMediaType.provision(provisionRequest())).rejects.toBeInstanceOf(
      CreatorDraftCollaborationResponseContractError
    );

    const extraField = clientFor(async () =>
      jsonResponse(activeRoom({ unexpectedPrivateField: "no" }))
    );
    await expect(extraField.provision(provisionRequest())).rejects.toBeInstanceOf(
      CreatorDraftCollaborationResponseContractError
    );

    const unknownIntent = clientFor(async () =>
      jsonResponse(activeRoom({ provisionIntent: "background-save" }))
    );
    await expect(
      unknownIntent.provision(provisionRequest())
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationResponseContractError);

    const declaredOversize = clientFor(async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(64 * 1_024 + 1),
        },
      })
    );
    await expect(declaredOversize.provision(provisionRequest())).rejects.toBeInstanceOf(
      CreatorDraftCollaborationResponseContractError
    );

    const actualOversize = clientFor(async () =>
      jsonResponse({ padding: "x".repeat(64 * 1_024) })
    );
    await expect(actualOversize.provision(provisionRequest())).rejects.toBeInstanceOf(
      CreatorDraftCollaborationResponseContractError
    );
  });

  it("rejects cross-draft, expired-active, and inconsistent promoted room responses", async () => {
    const otherDraft = clientFor(async () =>
      jsonResponse(activeRoom({
        draftDocumentId: "draft_77777777-7777-4777-8777-777777777777",
      }))
    );
    await expect(otherDraft.provision(provisionRequest())).rejects.toBeInstanceOf(
      CreatorDraftCollaborationResponseContractError
    );

    const expired = clientFor(async () =>
      jsonResponse(activeRoom({
        provisionedAt: "2026-07-24T00:00:00.000Z",
        expiresAt: "2026-07-25T00:00:00.000Z",
      }))
    );
    await expect(expired.provision(provisionRequest())).rejects.toBeInstanceOf(
      CreatorDraftCollaborationResponseContractError
    );

    const promotedWithoutTimestamp = clientFor(async () =>
      jsonResponse(promotedRoom({ promotedAt: null }))
    );
    await expect(
      promotedWithoutTimestamp.promote(promotionRequest())
    ).rejects.toBeInstanceOf(CreatorDraftCollaborationResponseContractError);
  });

  it("requires promotion to preserve the exact room, work id, and graph increment", async () => {
    for (const room of [
      promotedRoom({ roomId: "draft-room_88888888-8888-4888-8888-888888888888" }),
      promotedRoom({ provisionalWorkId: "different-work" }),
      promotedRoom({ graphRevision: 2 }),
      activeRoom(),
    ]) {
      const client = clientFor(async () => jsonResponse(room));
      await expect(client.promote(promotionRequest())).rejects.toBeInstanceOf(
        CreatorDraftCollaborationResponseContractError
      );
    }
  });

  it("rejects malformed and oversized requests before touching the network", async () => {
    const transport = vi.fn(async () => jsonResponse(activeRoom()));
    const client = clientFor(transport);

    await expect(client.provision(provisionRequest({
      initialSnapshotByteLength: 16 * 1_024 * 1_024 + 1,
    }))).rejects.toBeInstanceOf(CreatorDraftCollaborationInputError);
    await expect(client.provision(provisionRequest({
      draftDocumentId: "draft-not-a-uuid",
    }))).rejects.toBeInstanceOf(CreatorDraftCollaborationInputError);
    await expect(client.promote(promotionRequest({
      expectedGraphRevision: 2_147_483_647,
    }))).rejects.toBeInstanceOf(CreatorDraftCollaborationInputError);
    await expect(client.promote(promotionRequest({
      expectedWorkRevision: 0,
    }))).rejects.toBeInstanceOf(CreatorDraftCollaborationInputError);
    await expect(client.promote(promotionRequest({
      finalStatus: "hidden" as never,
    }))).rejects.toBeInstanceOf(CreatorDraftCollaborationInputError);
    await expect(client.provision(provisionRequest(), {
      timeoutMs: 60_001,
    })).rejects.toBeInstanceOf(CreatorDraftCollaborationInputError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("wraps transport failures without leaking them as protocol or HTTP failures", async () => {
    const cause = new TypeError("offline");
    const client = clientFor(async () => {
      throw cause;
    });

    const rejection = client.provision(provisionRequest());
    await expect(rejection).rejects.toBeInstanceOf(
      CreatorDraftCollaborationNetworkError
    );
    await expect(rejection).rejects.toMatchObject({ cause });
  });

  it("keeps the default promotion entry point dynamically callable", async () => {
    apiRawPost.mockResolvedValueOnce(jsonResponse(promotedRoom()));

    await expect(promoteCreatorDraftCollaborationRoom(promotionRequest({
      clientMutationId: "99999999-9999-4999-8999-999999999999",
    }))).resolves.toMatchObject({
      roomId: ROOM_ID,
      provisionalWorkId: WORK_ID,
      status: "promoted",
    });
  });

  it("exports an inspectable timeout error class for retry UX", () => {
    expect(new CreatorDraftCollaborationTimeoutError(123)).toMatchObject({
      name: "TimeoutError",
      timeoutMs: 123,
    });
  });
});
