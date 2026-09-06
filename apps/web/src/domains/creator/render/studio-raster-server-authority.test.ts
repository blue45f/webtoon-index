import { describe, expect, it, vi } from "vitest";

import {
  approveStudioRasterServerAuthority,
  captureStudioRasterServerAuthoritySnapshot,
  sameStudioRasterServerAuthoritySnapshot,
  sha256StudioRasterOperationLogAuthority,
  StudioRasterServerAuthorityCoordinator,
  studioRasterServerAuthorityForSurface,
} from "./studio-raster-server-authority";

import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_KERNEL,
  createStudioRasterOperationLog,
  type StudioRasterOperationLog,
} from "@/shared/lib/studio-crdt-raster-ops";

function rasterLog(input: {
  readonly surfaceId: string;
  readonly operationId: string;
  readonly clock?: string;
}): StudioRasterOperationLog {
  return createStudioRasterOperationLog({
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: {
      version: STUDIO_RASTER_CRDT_VERSION,
      surfaceId: input.surfaceId,
      width: 128,
      height: 128,
      tileSize: 128,
    },
    operations: [{
      version: STUDIO_RASTER_CRDT_VERSION,
      operationId: input.operationId,
      order: { logicalClock: input.clock ?? "1", actorId: "artist-a" },
      pageId: "page-a",
      layerId: "page-root",
      intent: "paint",
      kernel: STUDIO_RASTER_KERNEL,
      semanticParametersSha256: "a".repeat(64),
      patches: [{
        tileX: 0,
        tileY: 0,
        region: { x: 0, y: 0, width: 1, height: 1 },
        effect: {
          kind: "composite",
          blendMode: "source-over",
          payload: {
            scope: "work",
            assetId: "b".repeat(64),
            sha256: "b".repeat(64),
            byteLength: 68,
            mediaType: "image/png",
            width: 1,
            height: 1,
          },
        },
      }],
    }],
    undoOperations: [],
    undoAcknowledgements: [],
  });
}

const first = rasterLog({
  surfaceId: "raster:page-a:ink",
  operationId: "00000000-0000-4000-8000-000000000001",
});
const second = rasterLog({
  surfaceId: "raster:page-b:ink",
  operationId: "00000000-0000-4000-8000-000000000002",
});

describe("studio raster server authority", () => {
  it("hashes the complete immutable log and changes authority for a later event", async () => {
    const current = await sha256StudioRasterOperationLogAuthority(first);
    const changed = await sha256StudioRasterOperationLogAuthority(rasterLog({
      surfaceId: first.surface.surfaceId,
      operationId: first.operations[0]!.operationId,
      clock: "2",
    }));

    expect(current).toMatch(/^[a-f0-9]{64}$/u);
    expect(changed).not.toBe(current);
  });

  it("sorts surfaces into a stable exact snapshot and resolves one surface", async () => {
    const hash = vi.fn(async (log: StudioRasterOperationLog) =>
      `hash:${log.surface.surfaceId}`
    );
    const snapshot = await captureStudioRasterServerAuthoritySnapshot([second, first], { hash });

    expect(snapshot).toEqual([
      { surfaceId: first.surface.surfaceId, logSha256: `hash:${first.surface.surfaceId}` },
      { surfaceId: second.surface.surfaceId, logSha256: `hash:${second.surface.surfaceId}` },
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(studioRasterServerAuthorityForSurface(snapshot, second.surface.surfaceId))
      .toBe(`hash:${second.surface.surfaceId}`);
    expect(sameStudioRasterServerAuthoritySnapshot(snapshot, [...snapshot])).toBe(true);
  });

  it("waits for the authoritative ACK before publishing an unchanged frontier", async () => {
    const order: string[] = [];
    const approved = await approveStudioRasterServerAuthority({
      readLogs: () => {
        order.push("read");
        return [first];
      },
      waitForAuthoritativeAck: async () => {
        order.push("ack");
      },
      hash: async () => "c".repeat(64),
    });

    expect(order).toEqual(["read", "ack", "read"]);
    expect(approved).toEqual([{
      surfaceId: first.surface.surfaceId,
      logSha256: "c".repeat(64),
    }]);
  });

  it("fails closed when a raster operation changes during the ACK round trip", async () => {
    let logs: readonly StudioRasterOperationLog[] = [first];
    const approved = await approveStudioRasterServerAuthority({
      readLogs: () => logs,
      waitForAuthoritativeAck: async () => {
        logs = [rasterLog({
          surfaceId: first.surface.surfaceId,
          operationId: "00000000-0000-4000-8000-000000000003",
        })];
      },
      hash: async (log) => log.operations[0]!.operationId,
    });

    expect(approved).toBeNull();
  });

  it("does not spend a network round trip for an empty raster document", async () => {
    const waitForAuthoritativeAck = vi.fn(async () => undefined);
    await expect(approveStudioRasterServerAuthority({
      readLogs: () => [],
      waitForAuthoritativeAck,
    })).resolves.toEqual([]);
    expect(waitForAuthoritativeAck).not.toHaveBeenCalled();
  });

  it("propagates cancellation without publishing authority", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("scope changed", "AbortError"));
    await expect(approveStudioRasterServerAuthority({
      readLogs: () => [first],
      waitForAuthoritativeAck: async () => undefined,
      signal: controller.signal,
      hash: async () => "d".repeat(64),
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("coalesces a burst and revokes authority before the next ACK", async () => {
    const waitForAuthoritativeAck = vi.fn(async () => undefined);
    const authorities: unknown[] = [];
    const coordinator = new StudioRasterServerAuthorityCoordinator({
      readLogs: () => [first],
      waitForAuthoritativeAck,
      onAuthorityChange: (authority) => authorities.push(authority),
      hash: async () => "e".repeat(64),
      debounceMs: 60,
    });

    coordinator.start();
    coordinator.invalidate();
    coordinator.invalidate();
    await coordinator.flushNow();
    expect(waitForAuthoritativeAck).toHaveBeenCalledOnce();
    expect(authorities.at(-1)).toEqual([{
      surfaceId: first.surface.surfaceId,
      logSha256: "e".repeat(64),
    }]);

    coordinator.invalidate();
    expect(authorities.at(-1)).toEqual([]);
    coordinator.close();
  });

  it("folds a mutation during an ACK into one follow-up authority pass", async () => {
    let releaseFirst: (() => void) | null = null;
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const waitForAuthoritativeAck = vi.fn()
      .mockImplementationOnce(() => firstBarrier)
      .mockResolvedValue(undefined);
    const authorities: unknown[] = [];
    const coordinator = new StudioRasterServerAuthorityCoordinator({
      readLogs: () => [first],
      waitForAuthoritativeAck,
      onAuthorityChange: (authority) => authorities.push(authority),
      hash: async () => "f".repeat(64),
      debounceMs: 0,
    });

    const running = coordinator.flushNow();
    await vi.waitFor(() => expect(waitForAuthoritativeAck).toHaveBeenCalledOnce());
    coordinator.invalidate();
    releaseFirst!();
    await running;

    expect(waitForAuthoritativeAck).toHaveBeenCalledTimes(2);
    expect(authorities.at(-1)).toEqual([{
      surfaceId: first.surface.surfaceId,
      logSha256: "f".repeat(64),
    }]);
    coordinator.close();
  });
});
