import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createStudioBrushRenderProvenanceCrdtSidecar,
  type StudioBrushRenderProvenance,
  type StudioBrushRenderProvenanceCrdtSidecar,
} from "../brush/studio-brush-render-provenance";

import {
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_CONTENT_INDEX_ROOT,
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_BYTES,
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_ENTRIES,
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT,
  STUDIO_CRDT_RASTER_OPERATIONS_ROOT,
  StudioCrdtDocument,
} from "./studio-crdt-document";
import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_KERNEL,
  createStudioRasterOperationLog,
  type StudioRasterOperation,
  type StudioRasterOperationLog,
} from "./studio-crdt-raster-ops";

const sha = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;
const rasterSha = (character: string): string => character.repeat(64);
const uuid = (value: number): string =>
  `40000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function mixedUnit(seed: number, salt: number): number {
  let value = ((Math.trunc(seed) >>> 0) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function operation(
  id: number,
  semanticParametersSha256 = rasterSha("b")
): StudioRasterOperation {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    operationId: uuid(id),
    order: { logicalClock: String(id), actorId: "artist-a" },
    pageId: "page-1",
    layerId: "layer-ink",
    intent: "paint",
    kernel: STUDIO_RASTER_KERNEL,
    semanticParametersSha256,
    patches: [{
      tileX: 0,
      tileY: 0,
      region: { x: 0, y: 0, width: 16, height: 16 },
      effect: {
        kind: "composite",
        blendMode: "source-over",
        payload: {
          scope: "work",
          assetId: `patch-${id}`,
          sha256: rasterSha("c"),
          byteLength: 1_024,
          mediaType: "image/png",
          width: 16,
          height: 16,
        },
      },
    }],
  };
}

function log(...operations: readonly StudioRasterOperation[]): StudioRasterOperationLog {
  return createStudioRasterOperationLog({
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: {
      version: STUDIO_RASTER_CRDT_VERSION,
      surfaceId: "surface-main",
      width: 256,
      height: 256,
      tileSize: 128,
    },
    operations,
    undoOperations: [],
    undoAcknowledgements: [],
  });
}

function provenance(
  operationId: string,
  variant = "1"
): Readonly<StudioBrushRenderProvenanceCrdtSidecar> {
  const grainSeed = 0x1020_3040;
  const strokeSeed = 0xa0b0_c0d0;
  const phaseSeed = (grainSeed ^ strokeSeed) >>> 0;
  const record: StudioBrushRenderProvenance = {
    kind: "studio-brush-render-provenance",
    version: 1,
    rendererContract: "durable-r8-repeat-bilinear-v1",
    asset: {
      assetId: `paper.${variant}`,
      encodedSha256: sha(variant),
      decodedSha256: sha(variant === "1" ? "2" : "3"),
      byteLength: 4_096,
      mediaType: "image/png",
      width: 64,
      height: 32,
      channel: "luminance",
      encoding: "r8-unorm",
    },
    sampling: {
      filter: "bilinear",
      edgeMode: "repeat",
      space: "canvas-fixed",
      scale: 18.5,
      amount: 0.72,
      contrast: 0.4,
      contrastTransfer: "midpoint-gain-4x",
      origin: { x: 0, y: 0 },
      phase: {
        algorithm: "xor-mix-u32-v1",
        grainSeed,
        strokeSeed,
        x: mixedUnit(phaseSeed, 0x9e37_79b9),
        y: mixedUnit(phaseSeed, 0x243f_6a88),
      },
    },
    dynamics: {
      kind: "studio-professional-brush-dynamics-digest",
      version: 1,
      planId: `brush.ink.${variant}`,
      revision: 1,
      sha256: sha(variant === "1" ? "4" : "5"),
    },
  };
  const result = createStudioBrushRenderProvenanceCrdtSidecar(operationId, record);
  if (result.status !== "ready") {
    throw new Error(`${result.reason} ${result.path}`);
  }
  return result.sidecar;
}

function boundOperation(id: number, variant = "1"): Readonly<{
  paint: StudioRasterOperation;
  sidecar: Readonly<StudioBrushRenderProvenanceCrdtSidecar>;
}> {
  const sidecar = provenance(uuid(id), variant);
  return {
    paint: operation(
      id,
      sidecar.provenanceSha256.slice("sha256:".length)
    ),
    sidecar,
  };
}

function underlyingYDoc(document: StudioCrdtDocument): Y.Doc {
  return (document as unknown as { doc: Y.Doc }).doc;
}

describe("StudioCrdtDocument brush render provenance registry", () => {
  it("publishes a raster operation and canonical sidecar in one Yjs transaction", () => {
    const document = new StudioCrdtDocument();
    const updates: Uint8Array[] = [];
    document.subscribe((update) => updates.push(update));
    const { paint, sidecar } = boundOperation(1);

    document.mergeRasterOperationLogWithBrushRenderProvenance(
      log(paint),
      [sidecar]
    );

    expect(updates).toHaveLength(1);
    expect(document.getBrushRenderProvenance(paint.operationId)).toEqual(sidecar);
    expect(document.getBrushRenderProvenanceSidecars()).toEqual([sidecar]);

    const raw = underlyingYDoc(document);
    const rasterEnvelope = JSON.parse(
      raw.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT)
        .get(paint.operationId)!
    ) as Record<string, unknown>;
    expect(Object.keys(rasterEnvelope).sort()).toEqual(["operation", "surfaceId"]);
    expect(
      raw.getMap<string>(STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT)
        .get(paint.operationId)
    ).toBe(JSON.stringify(sidecar));
    expect(
      raw.getMap<string>(STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_CONTENT_INDEX_ROOT)
        .get(`${paint.operationId}|${sidecar.provenanceSha256}`)
    ).toBe(sidecar.provenanceSha256);

    document.destroy();
  });

  it("replicates and converges independent immutable sidecars through Yjs state updates", () => {
    const left = new StudioCrdtDocument();
    const right = new StudioCrdtDocument();
    const first = boundOperation(10, "1");
    const second = boundOperation(11, "2");
    left.mergeRasterOperationLogWithBrushRenderProvenance(
      log(first.paint),
      [first.sidecar]
    );
    right.mergeRasterOperationLogWithBrushRenderProvenance(
      log(second.paint),
      [second.sidecar]
    );

    left.applyUpdate(right.encodeStateAsUpdate());
    right.applyUpdate(left.encodeStateAsUpdate());

    const expectedIds = [first.paint.operationId, second.paint.operationId];
    expect(left.getBrushRenderProvenanceSidecars().map(({ operationId }) => operationId))
      .toEqual(expectedIds);
    expect(right.getBrushRenderProvenanceSidecars())
      .toEqual(left.getBrushRenderProvenanceSidecars());

    const restored = new StudioCrdtDocument(left.encodeStateAsUpdate());
    expect(restored.getBrushRenderProvenanceSidecars())
      .toEqual(left.getBrushRenderProvenanceSidecars());

    restored.destroy();
    left.destroy();
    right.destroy();
  });

  it("is idempotent for identical content and rejects a local immutable replacement", () => {
    const document = new StudioCrdtDocument();
    const first = boundOperation(20, "1");
    document.mergeRasterOperationLogWithBrushRenderProvenance(
      log(first.paint),
      [first.sidecar]
    );
    const before = document.encodeStateVector();

    document.mergeRasterOperationLogWithBrushRenderProvenance(
      log(first.paint),
      [first.sidecar]
    );
    expect(document.encodeStateVector()).toEqual(before);
    const replacementSidecar = provenance(first.paint.operationId, "2");
    const replacementPaint = operation(
      20,
      replacementSidecar.provenanceSha256.slice("sha256:".length)
    );
    expect(() => document.mergeRasterOperationLogWithBrushRenderProvenance(
      log(replacementPaint),
      [replacementSidecar]
    )).toThrow(/서로 다른 불변/u);
    expect(document.getBrushRenderProvenance(first.paint.operationId))
      .toEqual(first.sidecar);

    document.destroy();
  });

  it("retains concurrent same-operation hash conflicts in the content index and fails closed", () => {
    const left = new StudioCrdtDocument();
    const right = new StudioCrdtDocument();
    const first = boundOperation(30, "1");
    const secondSidecar = provenance(first.paint.operationId, "2");
    const secondPaint = operation(
      30,
      secondSidecar.provenanceSha256.slice("sha256:".length)
    );
    left.mergeRasterOperationLogWithBrushRenderProvenance(
      log(first.paint),
      [first.sidecar]
    );
    right.mergeRasterOperationLogWithBrushRenderProvenance(
      log(secondPaint),
      [secondSidecar]
    );

    left.applyUpdate(right.encodeStateAsUpdate());
    right.applyUpdate(left.encodeStateAsUpdate());

    expect(() => left.getBrushRenderProvenanceSidecars())
      .toThrow(/동시 충돌|content index/u);
    expect(() => right.getBrushRenderProvenance(first.paint.operationId))
      .toThrow(/동시 충돌|content index/u);
    expect(
      underlyingYDoc(left)
        .getMap<string>(STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_CONTENT_INDEX_ROOT)
        .size
    ).toBe(2);

    left.destroy();
    right.destroy();
  });

  it("rejects unknown sidecar fields, non-canonical tampering, and orphan data", () => {
    const document = new StudioCrdtDocument();
    const { paint, sidecar } = boundOperation(40);
    document.mergeRasterOperationLogWithBrushRenderProvenance(log(paint), [sidecar]);
    const raw = underlyingYDoc(document);
    raw.getMap<string>(STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT).set(
      paint.operationId,
      JSON.stringify({ ...sidecar, extension: { accepted: true } })
    );
    expect(() => document.getBrushRenderProvenanceSidecars())
      .toThrow(/비정규|고아/u);

    const orphan = new StudioCrdtDocument();
    const orphanRaw = underlyingYDoc(orphan);
    orphanRaw.getMap<string>(STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT).set(
      paint.operationId,
      JSON.stringify(sidecar)
    );
    orphanRaw.getMap<string>(
      STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_CONTENT_INDEX_ROOT
    ).set(`${paint.operationId}|${sidecar.provenanceSha256}`, sidecar.provenanceSha256);
    expect(() => orphan.getBrushRenderProvenanceSidecars())
      .toThrow(/고아/u);

    document.destroy();
    orphan.destroy();
  });

  it("fails closed when a remote canonical sidecar is bound to a different operation hash", () => {
    const document = new StudioCrdtDocument();
    const mismatchedOperation = operation(45, rasterSha("a"));
    const sidecar = provenance(mismatchedOperation.operationId, "1");
    document.mergeRasterOperationLog(log(mismatchedOperation));

    const raw = underlyingYDoc(document);
    raw.transact(() => {
      raw.getMap<string>(STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT).set(
        mismatchedOperation.operationId,
        JSON.stringify(sidecar)
      );
      raw.getMap<string>(
        STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_CONTENT_INDEX_ROOT
      ).set(
        `${mismatchedOperation.operationId}|${sidecar.provenanceSha256}`,
        sidecar.provenanceSha256
      );
    });

    expect(() => document.getBrushRenderProvenance(mismatchedOperation.operationId))
      .toThrow(/semantic hash/u);
    expect(() => document.getBrushRenderProvenanceSidecars())
      .toThrow(/semantic hash/u);

    document.destroy();
  });

  it("binds every atomic raster operation to its exact provenance semantic hash", () => {
    const document = new StudioCrdtDocument();
    const first = boundOperation(50, "1");
    const second = boundOperation(51, "2");

    expect(() => document.mergeRasterOperationLogWithBrushRenderProvenance(
      log(operation(50)),
      [first.sidecar],
    )).toThrow(/semantic hash/u);

    expect(() => document.mergeRasterOperationLogWithBrushRenderProvenance(
      log(first.paint, second.paint),
      [first.sidecar],
    )).toThrow(/모든 작업/u);

    expect(document.getRasterOperationLog("surface-main")).toBeNull();
    expect(document.getBrushRenderProvenanceSidecars()).toEqual([]);
    document.destroy();
  });

  it("enforces hard root-count and combined UTF-8 byte budgets before parsing", () => {
    const tooMany = new StudioCrdtDocument();
    const tooManyRaw = underlyingYDoc(tooMany);
    tooManyRaw.transact(() => {
      const root = tooManyRaw.getMap<string>(
        STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT
      );
      for (
        let index = 0;
        index <= STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_ENTRIES;
        index += 1
      ) {
        root.set(`operation-${index}`, "{}");
      }
    });
    expect(() => tooMany.getBrushRenderProvenanceSidecars())
      .toThrow(/항목 수/u);

    const tooLarge = new StudioCrdtDocument();
    underlyingYDoc(tooLarge)
      .getMap<string>(STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT)
      .set("operation-large", "x".repeat(
        STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_BYTES + 1
      ));
    expect(() => tooLarge.getBrushRenderProvenanceSidecars())
      .toThrow(/바이트 예산/u);

    tooMany.destroy();
    tooLarge.destroy();
  });
});
