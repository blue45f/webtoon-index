import { describe, expect, it, vi } from "vitest";

import { STUDIO_CANONICAL_BRUSH_PLAN_VERSION } from "../studio-canonical-brush-plan";

import {
  StudioEngineTileAuthority,
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  studioEngineRgba16FloatTileDigest,
  studioEngineTileProviderBatchDigest,
  type StudioEngineTileExecutionProvider,
  type StudioEngineTileProviderDelta,
  type StudioEngineTileProviderInput,
} from "./studio-engine-tile-authority";

function curve() {
  return { minimum: 1, maximum: 1, exponent: 1 };
}

function brushPlan(commandSequence = 1, size = 1) {
  return {
    kind: "studio-canonical-brush-plan",
    version: STUDIO_CANONICAL_BRUSH_PLAN_VERSION,
    sessionEpoch: 19,
    strokeEpoch: 7,
    commandSequence,
    strokeId: "stroke-authority",
    seed: 0x1234_5678,
    coordinateSpace: "document-css-px",
    transform: {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.1, 0.2, 0.3, 0.9],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: "normal",
      opacity: 1,
    },
    recipe: {
      version: 1,
      brushId: "authority-g-pen",
      engine: "dab-v1",
      material: "ink",
      tip: { kind: "analytic", shape: "round", edgeSoftness: 0.1 },
      size,
      flow: 1,
      hardness: 1,
      spacingRatio: 0.1,
      scatter: { radiusRatio: 0, distribution: "uniform-disk" },
      angleRadians: 0,
      roundness: 1,
      pressure: {
        size: curve(),
        opacity: curve(),
        flow: curve(),
      },
      grain: null,
      wetMedia: null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: 1,
      lastSequence: 1,
      samples: [{
        role: "authoritative",
        sequence: 1,
        x: 0.5,
        y: 0.5,
        pressure: 1,
        tangentialPressure: 0,
        tiltX: 0,
        tiltY: 0,
        twist: 0,
        timeMilliseconds: 1,
        pointerId: 1,
        flags: 0,
      }],
    },
  };
}

function fullBatch(
  input: StudioEngineTileProviderInput,
  word = 0x3c00,
): {
  batch: Record<string, unknown>;
  payloads: Uint16Array[];
} {
  const payloads: Uint16Array[] = [];
  const deltas: StudioEngineTileProviderDelta[] = input.targets.map((target, index) => {
    const encoded = new Uint16Array(input.tileSize * input.tileSize * 4);
    encoded.fill(word + index);
    payloads.push(encoded);
    return {
      index,
      tileId: target.address.tileId,
      column: target.address.column,
      row: target.address.row,
      baseTileRevision: target.tileRevision,
      encoded,
      contentDigest: studioEngineRgba16FloatTileDigest(encoded),
    };
  });
  const framing = {
    commandIdentity: input.commandIdentity,
    baseDocumentRevision: input.baseDocumentRevision,
    baseLayerRevision: input.baseLayerRevision,
    complete: true,
    deltaCount: deltas.length,
    deltas,
  };
  return {
    batch: {
      kind: "studio-engine-tile-provider-delta",
      version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
      ...framing,
      batchDigest: studioEngineTileProviderBatchDigest(framing),
    },
    payloads,
  };
}

function provider(
  render: (input: StudioEngineTileProviderInput) => unknown = (input) =>
    fullBatch(input).batch,
): StudioEngineTileExecutionProvider {
  return { render };
}

function actor(
  executionProvider: StudioEngineTileExecutionProvider = provider(),
  overrides: Partial<ConstructorParameters<typeof StudioEngineTileAuthority>[0]> = {},
) {
  return new StudioEngineTileAuthority({
    documentId: "authority-doc",
    documentWidth: 8,
    documentHeight: 8,
    tileSize: 2,
    layerIds: ["ink"],
    sessionEpoch: 19,
    strokeEpoch: 7,
    shardBytes: BigInt(64),
    provider: executionProvider,
    ...overrides,
  });
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    baseDocumentRevision: 0,
    baseLayerRevision: 0,
    layerId: "ink",
    dirtyRects: [{ x: 0, y: 0, width: 4, height: 2 }],
    brushPlan: brushPlan(),
    ...overrides,
  };
}

describe("StudioEngineTileAuthority", () => {
  it("atomically commits a complete RGBA16F delta with document/layer/tile revisions", async () => {
    const authority = actor();
    const result = await authority.commit(request());

    expect(result.status).toBe("committed");
    if (result.status !== "committed") return;
    expect(result.receipt).toMatchObject({
      baseDocumentRevision: 0,
      documentRevision: 1,
      baseLayerRevision: 0,
      layerRevision: 1,
      commandSequence: 1,
      journalSequence: 1,
    });
    expect(result.receipt.tiles.map((tile) => ({
      id: tile.tileId,
      base: tile.baseTileRevision,
      revision: tile.tileRevision,
    }))).toEqual([
      { id: "0:0", base: 0, revision: 1 },
      { id: "1:0", base: 0, revision: 1 },
    ]);
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.receipt.tiles)).toBe(true);
    expect(Object.isFrozen(result.receipt.tiles[0])).toBe(true);
    expect(authority.stats()).toMatchObject({
      documentRevision: 1,
      tileCount: 2,
      residentBytes: 64,
      journalRecordCount: 1,
      commandCount: 1,
    });
    expect(authority.deviceLossReplaySource().tiles).toHaveLength(2);
  });

  it("rejects stale document and layer bases before invoking the provider", async () => {
    const render = vi.fn((input: StudioEngineTileProviderInput) => fullBatch(input).batch);
    const authority = actor(provider(render));

    await expect(authority.commit(request({ baseDocumentRevision: 1 }))).resolves.toEqual({
      status: "rejected",
      reason: "stale-document-revision",
    });
    await expect(authority.commit(request({ baseLayerRevision: 1 }))).resolves.toEqual({
      status: "rejected",
      reason: "stale-layer-revision",
    });
    expect(render).not.toHaveBeenCalled();
    expect(authority.stats().documentRevision).toBe(0);
  });

  it("returns the exact immutable receipt for an idempotent duplicate and rejects a conflict", async () => {
    const authority = actor();
    const first = await authority.commit(request());
    const duplicate = await authority.commit(request());
    const conflict = await authority.commit(request({
      brushPlan: brushPlan(1, 2),
    }));

    expect(first.status).toBe("committed");
    expect(duplicate.status).toBe("duplicate");
    if (first.status === "committed" && duplicate.status === "duplicate") {
      expect(duplicate.receipt).toBe(first.receipt);
    }
    expect(conflict).toEqual({
      status: "rejected",
      reason: "command-sequence-conflict",
    });
    expect(authority.stats()).toMatchObject({
      documentRevision: 1,
      journalRecordCount: 1,
    });
  });

  it("rolls back a torn delta that omits one declared dirty tile", async () => {
    const authority = actor(provider((input) => {
      const { batch } = fullBatch(input);
      const deltas = (batch.deltas as StudioEngineTileProviderDelta[]).slice(0, 1);
      return { ...batch, deltas };
    }));

    await expect(authority.commit(request())).resolves.toEqual({
      status: "rejected",
      reason: "partial-provider-delta",
    });
    expect(authority.stats()).toMatchObject({
      documentRevision: 0,
      tileCount: 0,
      residentBytes: 0,
      journalRecordCount: 0,
    });
  });

  it("rolls back an explicit partial provider result", async () => {
    const authority = actor(provider((input) => {
      const { batch } = fullBatch(input);
      return { ...batch, complete: false };
    }));

    await expect(authority.commit(request())).resolves.toEqual({
      status: "rejected",
      reason: "partial-provider-delta",
    });
    expect(authority.readTile("ink", 0, 0)).toBeNull();
    expect(authority.layerRevision("ink")).toBe(0);
  });

  it("rolls back when the provider throws after doing partial local work", async () => {
    const authority = actor(provider((input) => {
      fullBatch(input);
      throw new Error("GPU device lost after first tile");
    }));

    await expect(authority.commit(request())).resolves.toEqual({
      status: "rejected",
      reason: "provider-failed",
    });
    expect(authority.stats()).toMatchObject({
      documentRevision: 0,
      tileCount: 0,
      journalBytes: 0,
    });
  });

  it("defensively copies provider payloads and all read/replay outputs", async () => {
    let providerPayloads: Uint16Array[] = [];
    const authority = actor(provider((input) => {
      const built = fullBatch(input);
      providerPayloads = built.payloads;
      return built.batch;
    }));
    const result = await authority.commit(request({
      dirtyRects: [{ x: 0, y: 0, width: 2, height: 2 }],
    }));
    expect(result.status).toBe("committed");

    providerPayloads[0]!.fill(0);
    const firstRead = authority.readTile("ink", 0, 0)!;
    expect(new Uint16Array(firstRead.encoded)[0]).toBe(0x3c00);
    new Uint16Array(firstRead.encoded).fill(1);
    const secondRead = authority.readTile("ink", 0, 0)!;
    expect(new Uint16Array(secondRead.encoded)[0]).toBe(0x3c00);

    const replay = authority.deviceLossReplaySource();
    new Uint16Array(replay.tiles[0]!.encoded).fill(2);
    expect(new Uint16Array(authority.readTile("ink", 0, 0)!.encoded)[0]).toBe(0x3c00);
  });

  it("rejects an oversized staged resident set without leaking any tile or revision", async () => {
    const authority = actor(provider(), {
      limits: {
        maxResidentBytes: 32,
        maxDirtyTiles: 8,
        maxJournalBytes: 64 * 1024,
        maxCommands: 8,
        maxTiles: 8,
      },
    });

    await expect(authority.commit(request())).resolves.toEqual({
      status: "rejected",
      reason: "resident-byte-limit",
    });
    expect(authority.stats()).toEqual({
      documentRevision: 0,
      layerCount: 1,
      tileCount: 0,
      residentBytes: 0,
      journalRecordCount: 0,
      journalBytes: 0,
      commandCount: 0,
    });
  });

  it("rejects hostile accessors without invoking them or mutating authority", async () => {
    let getterCalls = 0;
    const authority = actor(provider((input) => {
      const { batch } = fullBatch(input);
      const hostile: Record<string, unknown> = { ...batch };
      Object.defineProperty(hostile, "deltas", {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("must not run");
        },
      });
      return hostile;
    }));

    await expect(authority.commit(request())).resolves.toEqual({
      status: "rejected",
      reason: "invalid-provider-delta",
    });
    expect(getterCalls).toBe(0);
    expect(authority.stats().documentRevision).toBe(0);
  });

  it("serializes concurrent commits so a second stale base cannot race through", async () => {
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    const render = vi.fn(async (input: StudioEngineTileProviderInput) => {
      call += 1;
      if (call === 1) await gate;
      return fullBatch(input).batch;
    });
    const authority = actor(provider(render));

    const first = authority.commit(request());
    const second = authority.commit(request({
      brushPlan: brushPlan(2),
    }));
    releaseFirst!();

    await expect(first).resolves.toMatchObject({ status: "committed" });
    await expect(second).resolves.toEqual({
      status: "rejected",
      reason: "stale-document-revision",
    });
    expect(render).toHaveBeenCalledTimes(1);
    expect(authority.stats().documentRevision).toBe(1);
  });

  it("does not resurrect authority when disposal races a pending provider result", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const authority = actor(provider(async (input) => {
      await gate;
      return fullBatch(input).batch;
    }));

    const pending = authority.commit(request());
    await Promise.resolve();
    authority.dispose();
    release!();

    await expect(pending).resolves.toEqual({
      status: "rejected",
      reason: "disposed",
    });
    expect(authority.stats()).toMatchObject({
      documentRevision: 0,
      tileCount: 0,
      journalRecordCount: 0,
      commandCount: 0,
    });
  });

  it("emits byte-identical journal records without provider objects", async () => {
    const providerA = Object.assign(provider(), { gpuDevice: { vendor: "A" } });
    const providerB = Object.assign(provider(), { gpuDevice: { vendor: "B" } });
    const first = actor(providerA);
    const second = actor(providerB);

    const [left, right] = await Promise.all([
      first.commit(request()),
      second.commit(structuredClone(request())),
    ]);
    expect(left.status).toBe("committed");
    expect(right.status).toBe("committed");
    if (left.status !== "committed" || right.status !== "committed") return;
    expect(left.receipt.journalDigest).toBe(right.receipt.journalDigest);
    expect([...left.journalBytes]).toEqual([...right.journalBytes]);
    const journalText = new TextDecoder().decode(left.journalBytes);
    expect(journalText).not.toContain("gpuDevice");
    expect(journalText).not.toContain("vendor");
    expect(JSON.parse(journalText)).toMatchObject({
      format: "toonspectrum:studio-engine-tile-authority-journal",
      recordType: "atomic-rgba16float-tile-commit",
      encoding: "linear-rgba16float-le-v1",
    });
  });

  it("preserves logical tile and shard offsets as bigint beyond safe integer range", async () => {
    const hugeY = 600_000_000_000_000;
    const authority = actor(provider(), {
      documentWidth: 2,
      documentHeight: 700_000_000_000_000,
      shardBytes: BigInt(1_024),
    });
    const result = await authority.commit(request({
      dirtyRects: [{ x: 0, y: hugeY, width: 1, height: 1 }],
    }));

    expect(result.status).toBe("committed");
    if (result.status !== "committed") return;
    const tile = result.receipt.tiles[0]!;
    expect(typeof tile.logicalTileIndex).toBe("bigint");
    expect(typeof tile.logicalByteOffset).toBe("bigint");
    expect(typeof tile.shardIndex).toBe("bigint");
    expect(tile.logicalByteOffset).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(tile.shardByteOffset).toBe(tile.logicalByteOffset % BigInt(1_024));
  });
});
