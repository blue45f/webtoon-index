import { describe, expect, expectTypeOf, it } from "vitest";

import { STUDIO_CANONICAL_BRUSH_PLAN_VERSION } from "../studio-canonical-brush-plan";

import {
  createStudioEngineSettledTileRasterAdapter,
} from "./studio-engine-settled-tile-raster-adapter";
import {
  STUDIO_ENGINE_SETTLED_TILE_RASTER_VERSION,
  studioEngineSettledTileRevisionFromCommitReceipt,
  type StudioEngineSettledTileAuthorityBoundary,
  type StudioEngineSettledTileRasterSessionBoundary,
  type StudioEngineSettledTileRevision,
} from "./studio-engine-settled-tile-raster-contract";
import {
  StudioEngineTileAuthority,
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  STUDIO_ENGINE_TILE_ENCODING,
  studioEngineRgba16FloatTileDigest,
  studioEngineTileProviderBatchDigest,
  type StudioEngineTileDeviceLossReplaySource,
  type StudioEngineTileExecutionProvider,
  type StudioEngineTileProviderDelta,
  type StudioEngineTileProviderInput,
  type StudioEngineTileReadResult,
} from "./studio-engine-tile-authority";

import type { StudioEngineWebGpuTileProviderV1 } from "./studio-engine-webgpu-tile-provider-v1";
import type {
  StudioOffscreenRasterRunInput,
  StudioOffscreenRasterRunOptions,
  StudioOffscreenRasterRunResult,
} from "../studio-offscreen-raster-worker-client";

const PNG_OUTPUT = Object.freeze({
  kind: "encoded",
  mime: "image/png",
} as const);
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function curve() {
  return { minimum: 1, maximum: 1, exponent: 1 };
}

function brushPlan(commandSequence: number, strokeId: string) {
  return {
    kind: "studio-canonical-brush-plan",
    version: STUDIO_CANONICAL_BRUSH_PLAN_VERSION,
    sessionEpoch: 19,
    strokeEpoch: 7,
    commandSequence,
    strokeId,
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
      brushId: "settled-raster-test",
      engine: "dab-v1",
      material: "ink",
      tip: { kind: "analytic", shape: "round", edgeSoftness: 0.1 },
      size: 1,
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

function encodedTile(
  tileSize: number,
  channels: readonly [number, number, number, number],
): Uint16Array {
  const encoded = new Uint16Array(tileSize * tileSize * 4);
  for (let pixel = 0; pixel < tileSize * tileSize; pixel += 1) {
    encoded.set(channels, pixel * 4);
  }
  return encoded;
}

function layerColourProvider(): StudioEngineTileExecutionProvider {
  return {
    render(input: StudioEngineTileProviderInput) {
      const channels: readonly [number, number, number, number] = input.layerId === "under"
        ? [0x3c00, 0, 0, 0x3c00]
        : [0, 0, 0x3800, 0x3800];
      const deltas: StudioEngineTileProviderDelta[] = input.targets.map((target, index) => {
        const encoded = encodedTile(input.tileSize, channels);
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
      const frame = {
        commandIdentity: input.commandIdentity,
        baseDocumentRevision: input.baseDocumentRevision,
        baseLayerRevision: input.baseLayerRevision,
        complete: true as const,
        deltaCount: deltas.length,
        deltas,
      };
      return {
        kind: "studio-engine-tile-provider-delta",
        version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
        ...frame,
        batchDigest: studioEngineTileProviderBatchDigest(frame),
      };
    },
  };
}

interface SessionCall {
  readonly jobKey: string;
  readonly input: StudioOffscreenRasterRunInput;
  readonly options: StudioOffscreenRasterRunOptions | undefined;
}

class RecordingSession implements StudioEngineSettledTileRasterSessionBoundary {
  public readonly calls: SessionCall[] = [];
  public disposeCount = 0;

  public constructor(
    private readonly response: (
      call: SessionCall,
    ) => StudioOffscreenRasterRunResult | Promise<StudioOffscreenRasterRunResult> =
      (call) => ({
        ok: true,
        runId: 1,
        width: call.input.target.width,
        height: call.input.target.height,
        payload: {
          kind: "encoded",
          mime: "image/png",
          blob: new Blob([PNG_SIGNATURE], { type: "image/png" }),
        },
      }),
  ) {}

  public run(
    jobKey: string,
    input: StudioOffscreenRasterRunInput,
    options?: StudioOffscreenRasterRunOptions,
  ): Promise<StudioOffscreenRasterRunResult> {
    const call = { jobKey, input, options };
    this.calls.push(call);
    return Promise.resolve(this.response(call));
  }

  public dispose(): void {
    this.disposeCount += 1;
  }
}

interface TileFixture {
  readonly layerIndex: number;
  readonly column: number;
  readonly row: number;
  readonly channels: readonly [number, number, number, number];
  readonly tileRevision?: number;
}

interface FakeAuthorityOptions {
  readonly documentId?: string;
  readonly documentWidth?: number;
  readonly documentHeight?: number;
  readonly tileSize?: number;
  readonly layerIds?: readonly string[];
  readonly layerRevisions?: readonly number[];
  readonly documentRevision?: number;
  readonly journalHeadDigest?: string;
  readonly tiles?: readonly TileFixture[];
  readonly mutateTile?: (tile: StudioEngineTileReadResult) => StudioEngineTileReadResult;
}

function fakeAuthority(
  options: FakeAuthorityOptions = {},
): StudioEngineSettledTileAuthorityBoundary {
  const documentId = options.documentId ?? "fake-authority";
  const documentWidth = options.documentWidth ?? 4;
  const documentHeight = options.documentHeight ?? 4;
  const tileSize = options.tileSize ?? 2;
  const layerIds = options.layerIds ?? ["ink"];
  const layerRevisions = options.layerRevisions ?? layerIds.map(() => 1);
  const documentRevision = options.documentRevision ?? 1;
  const journalHeadDigest = options.journalHeadDigest ?? `journal:${documentRevision}`;
  const shardBytes = BigInt(64);
  const tileByteLength = tileSize * tileSize * 4 * Uint16Array.BYTES_PER_ELEMENT;
  const tileColumns = Math.ceil(documentWidth / tileSize);
  const tileRows = Math.ceil(documentHeight / tileSize);
  const tilesPerLayer = BigInt(tileColumns * tileRows);
  const tiles = (options.tiles ?? []).map((fixture): StudioEngineTileReadResult => {
    const layerId = layerIds[fixture.layerIndex]!;
    const tileRevision = fixture.tileRevision ?? 1;
    const encoded = encodedTile(tileSize, fixture.channels);
    const logicalTileIndex =
      BigInt(fixture.layerIndex) * tilesPerLayer
      + BigInt(fixture.row * tileColumns + fixture.column);
    const logicalByteOffset = logicalTileIndex * BigInt(tileByteLength);
    const tile: StudioEngineTileReadResult = {
      tileId: `${fixture.column}:${fixture.row}`,
      column: fixture.column,
      row: fixture.row,
      layerId,
      layerIndex: fixture.layerIndex,
      logicalTileIndex,
      logicalByteOffset,
      shardIndex: logicalByteOffset / shardBytes,
      shardByteOffset: logicalByteOffset % shardBytes,
      baseTileRevision: Math.max(0, tileRevision - 1),
      tileRevision,
      contentDigest: studioEngineRgba16FloatTileDigest(encoded),
      byteLength: encoded.byteLength,
      encoded: encoded.buffer as ArrayBuffer,
    };
    return options.mutateTile?.(tile) ?? tile;
  });
  const snapshot: StudioEngineTileDeviceLossReplaySource = {
    kind: "studio-engine-tile-device-loss-replay",
    version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
    encoding: STUDIO_ENGINE_TILE_ENCODING,
    documentId,
    documentRevision,
    layers: layerIds.map((layerId, index) => ({
      layerId,
      layerRevision: layerRevisions[index] ?? 1,
    })),
    tiles,
    journalHeadDigest,
  };
  return {
    documentId,
    documentWidth,
    documentHeight,
    tileSize,
    tileByteLength,
    shardBytes,
    deviceLossReplaySource: () => snapshot,
  };
}

function expectedRevision(
  documentId = "fake-authority",
  documentRevision = 1,
  journalHeadDigest = `journal:${documentRevision}`,
): StudioEngineSettledTileRevision {
  return {
    kind: "studio-engine-settled-tile-revision",
    version: STUDIO_ENGINE_SETTLED_TILE_RASTER_VERSION,
    documentId,
    documentRevision,
    journalHeadDigest,
  };
}

describe("StudioEngineSettledTileRasterAdapter", () => {
  it("is structurally compatible with the real tile authority and its WebGPU execution provider", () => {
    expectTypeOf<StudioEngineTileAuthority>()
      .toMatchTypeOf<StudioEngineSettledTileAuthorityBoundary>();
    expectTypeOf<StudioEngineWebGpuTileProviderV1>()
      .toMatchTypeOf<StudioEngineTileExecutionProvider>();
  });

  it("renders an actual atomic authority receipt through the Worker seam without a Konva capture", async () => {
    const authority = new StudioEngineTileAuthority({
      documentId: "settled-document",
      documentWidth: 2,
      documentHeight: 2,
      tileSize: 2,
      layerIds: ["under", "over"],
      sessionEpoch: 19,
      strokeEpoch: 7,
      shardBytes: BigInt(64),
      provider: layerColourProvider(),
    });
    const under = await authority.commit({
      baseDocumentRevision: 0,
      baseLayerRevision: 0,
      layerId: "under",
      dirtyRects: [{ x: 0, y: 0, width: 2, height: 2 }],
      brushPlan: brushPlan(1, "under-stroke"),
    });
    const over = await authority.commit({
      baseDocumentRevision: 1,
      baseLayerRevision: 0,
      layerId: "over",
      dirtyRects: [{ x: 0, y: 0, width: 2, height: 2 }],
      brushPlan: brushPlan(2, "over-stroke"),
    });
    expect(under.status).toBe("committed");
    expect(over.status).toBe("committed");
    if (over.status !== "committed") return;

    const session = new RecordingSession();
    const adapter = createStudioEngineSettledTileRasterAdapter({
      authority,
      sourceColorSpace: "linear-srgb",
      session,
    });
    const result = await adapter.render({
      jobKey: "export:settled-document",
      output: PNG_OUTPUT,
      expectedRevision: studioEngineSettledTileRevisionFromCommitReceipt(over.receipt),
    });

    expect(result.status).toBe("rendered");
    expect(session.calls).toHaveLength(1);
    const source = session.calls[0]!.input.sources[0]!;
    expect(source.kind).toBe("pixels");
    if (source.kind !== "pixels") return;
    // Opaque linear red under 50%-alpha premultiplied linear blue = linear (0.5, 0, 0.5, 1).
    // The Worker boundary receives straight sRGB, whose 0.5 channel encodes to byte 188.
    expect([...new Uint8Array(source.pixels).slice(0, 4)]).toEqual([188, 0, 188, 255]);
    expect(result).toMatchObject({
      status: "rendered",
      receipt: {
        backend: "studio-engine-tile-authority/offscreen-raster-worker",
        documentId: "settled-document",
        documentRevision: 2,
        layerCount: 2,
        authorityTileCount: 2,
        flattenedTileCount: 1,
        workerSourceCount: 1,
        sourcePixelBytes: 16,
        konvaCapture: false,
      },
      payload: {
        kind: "encoded",
        mime: "image/png",
      },
    });
  });

  it("sorts coordinates deterministically and crops edge tiles before scaled Worker placement", async () => {
    const authority = fakeAuthority({
      documentWidth: 3,
      documentHeight: 3,
      tiles: [
        { layerIndex: 0, column: 1, row: 1, channels: [0x3c00, 0, 0, 0x3c00] },
        { layerIndex: 0, column: 0, row: 0, channels: [0, 0x3c00, 0, 0x3c00] },
      ],
    });
    const session = new RecordingSession();
    const adapter = createStudioEngineSettledTileRasterAdapter({
      authority,
      sourceColorSpace: "linear-srgb",
      session,
    });

    const result = await adapter.render({
      jobKey: "export:edge-crop",
      scale: 2,
      output: PNG_OUTPUT,
    });

    expect(result.status).toBe("rendered");
    const call = session.calls[0]!;
    expect(call.input.target).toEqual({ width: 6, height: 6, background: null });
    expect(call.input.sources.map((source) => ({
      width: source.kind === "pixels" ? source.width : source.bitmap.width,
      height: source.kind === "pixels" ? source.height : source.bitmap.height,
      placement: source.placement,
    }))).toEqual([
      {
        width: 2,
        height: 2,
        placement: {
          dx: 0,
          dy: 0,
          dw: 4,
          dh: 4,
          opacity: 1,
          rotation: 0,
          flipX: false,
          flipY: false,
        },
      },
      {
        width: 1,
        height: 1,
        placement: {
          dx: 4,
          dy: 4,
          dw: 2,
          dh: 2,
          opacity: 1,
          rotation: 0,
          flipX: false,
          flipY: false,
        },
      },
    ]);
  });

  it("uses one transparent source for an empty atomic authority because the Worker forbids zero sources", async () => {
    const session = new RecordingSession();
    const adapter = createStudioEngineSettledTileRasterAdapter({
      authority: fakeAuthority({
        documentRevision: 0,
        layerRevisions: [0],
        tiles: [],
      }),
      sourceColorSpace: "linear-srgb",
      session,
    });

    const result = await adapter.render({
      jobKey: "export:empty",
      background: "#ffffff",
      output: PNG_OUTPUT,
    });

    expect(result.status).toBe("rendered");
    const source = session.calls[0]!.input.sources[0]!;
    expect(source.kind).toBe("pixels");
    if (source.kind !== "pixels") return;
    expect({ width: source.width, height: source.height }).toEqual({ width: 1, height: 1 });
    expect([...new Uint8Array(source.pixels)]).toEqual([0, 0, 0, 0]);
    expect(source.placement).toMatchObject({ dx: 0, dy: 0, dw: 4, dh: 4 });
    expect(result).toMatchObject({
      status: "rendered",
      receipt: {
        authorityTileCount: 0,
        flattenedTileCount: 0,
        workerSourceCount: 1,
        sourcePixelBytes: 4,
      },
    });
  });

  it("rejects a stale selected revision before any pixels cross the Worker boundary", async () => {
    const session = new RecordingSession();
    const adapter = createStudioEngineSettledTileRasterAdapter({
      authority: fakeAuthority({
        documentRevision: 2,
        journalHeadDigest: "journal:2",
      }),
      sourceColorSpace: "linear-srgb",
      session,
    });

    await expect(adapter.render({
      jobKey: "export:stale",
      output: PNG_OUTPUT,
      expectedRevision: expectedRevision("fake-authority", 1, "journal:1"),
    })).resolves.toMatchObject({
      status: "rejected",
      reason: "stale-authority-revision",
      runId: null,
    });
    expect(session.calls).toHaveLength(0);
  });

  it("fails closed for a bad authority digest and for non-finite premultiplied pixels", async () => {
    const digestSession = new RecordingSession();
    const badDigest = createStudioEngineSettledTileRasterAdapter({
      authority: fakeAuthority({
        tiles: [
          { layerIndex: 0, column: 0, row: 0, channels: [0x3c00, 0, 0, 0x3c00] },
        ],
        mutateTile: (tile) => ({ ...tile, contentDigest: "rgba16f-v1:forged" }),
      }),
      sourceColorSpace: "linear-srgb",
      session: digestSession,
    });
    await expect(badDigest.render({
      jobKey: "export:bad-digest",
      output: PNG_OUTPUT,
    })).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-authority-snapshot",
    });
    expect(digestSession.calls).toHaveLength(0);

    const pixelSession = new RecordingSession();
    const badPixels = createStudioEngineSettledTileRasterAdapter({
      authority: fakeAuthority({
        tiles: [
          // 0x7e00 is a binary16 NaN. The digest is valid, but the semantic pixel domain is not.
          { layerIndex: 0, column: 0, row: 0, channels: [0x7e00, 0, 0, 0x3c00] },
        ],
      }),
      sourceColorSpace: "linear-srgb",
      session: pixelSession,
    });
    await expect(badPixels.render({
      jobKey: "export:bad-pixels",
      output: PNG_OUTPUT,
    })).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-authority-pixels",
    });
    expect(pixelSession.calls).toHaveLength(0);
  });

  it("enforces the Worker's bounded source count after flattening layers by tile coordinate", async () => {
    const tiles: TileFixture[] = Array.from({ length: 1_025 }, (_, column) => ({
      layerIndex: 0,
      column,
      row: 0,
      channels: [0x3c00, 0, 0, 0x3c00],
    }));
    const session = new RecordingSession();
    const adapter = createStudioEngineSettledTileRasterAdapter({
      authority: fakeAuthority({
        documentWidth: 1_025,
        documentHeight: 1,
        tileSize: 1,
        tiles,
      }),
      sourceColorSpace: "linear-srgb",
      session,
    });

    await expect(adapter.render({
      jobKey: "export:source-budget",
      output: PNG_OUTPUT,
    })).resolves.toMatchObject({
      status: "rejected",
      reason: "source-budget",
    });
    expect(session.calls).toHaveLength(0);
  });

  it("preserves typed Worker failure provenance and caller ownership of an injected session", async () => {
    const session = new RecordingSession(() => ({
      ok: false,
      runId: 17,
      code: "unsupported",
      message: "OffscreenCanvas is unavailable.",
    }));
    const adapter = createStudioEngineSettledTileRasterAdapter({
      authority: fakeAuthority({
        tiles: [
          { layerIndex: 0, column: 0, row: 0, channels: [0, 0, 0, 0] },
        ],
      }),
      sourceColorSpace: "linear-srgb",
      session,
    });

    await expect(adapter.render({
      jobKey: "export:unsupported",
      output: PNG_OUTPUT,
    })).resolves.toEqual({
      status: "rejected",
      reason: "worker-rejected",
      message: "OffscreenCanvas is unavailable.",
      runId: 17,
      workerCode: "unsupported",
    });
    adapter.dispose();
    expect(session.disposeCount).toBe(0);
    await expect(adapter.render({
      jobKey: "export:disposed",
      output: PNG_OUTPUT,
    })).resolves.toMatchObject({
      status: "rejected",
      reason: "disposed",
    });
  });

  it("rejects a Worker result whose PNG label hides another encoded container", async () => {
    const session = new RecordingSession((call) => ({
      ok: true,
      runId: 23,
      width: call.input.target.width,
      height: call.input.target.height,
      payload: {
        kind: "encoded",
        mime: "image/png",
        blob: new Blob([new TextEncoder().encode("RIFF0000WEBP")], { type: "image/png" }),
      },
    }));
    const adapter = createStudioEngineSettledTileRasterAdapter({
      authority: fakeAuthority({
        tiles: [
          { layerIndex: 0, column: 0, row: 0, channels: [0, 0, 0, 0] },
        ],
      }),
      sourceColorSpace: "linear-srgb",
      session,
    });

    await expect(adapter.render({
      jobKey: "export:codec-substitution",
      output: PNG_OUTPUT,
    })).resolves.toMatchObject({
      status: "rejected",
      reason: "worker-failed",
      runId: 23,
    });
  });
});
