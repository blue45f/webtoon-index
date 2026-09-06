import { describe, expect, it } from "vitest";

import { serializeStudioCommandJournal } from "../studio-command-journal";
import {
  createStudioUnitCubeMesh,
  extrudeStudioEditableMeshFacesWithReceipt,
  matchesStudioEditableMeshPersistedHash,
} from "../studio-editable-half-edge-mesh";

import {
  createStudioHybridDccSession,
  hybridDccCommitTopologyMutation,
  hybridDccRedo,
  hybridDccRegisterAsset,
  hybridDccUndo,
  restoreStudioHybridDccStateFromSnapshot,
  snapshotStudioHybridDccState,
} from "./studio-hybrid-dcc-document";

const RIGHTS = {
  source: "primitive",
  creator: "toonspectrum",
  license: "CC0-1.0",
  useScope: "commercial",
  derivative: "original",
} as const;

describe("Hybrid DCC topology command receipt", () => {
  it("binds region extrude evidence to source/result authority and snapshot-backed undo", () => {
    const cube = createStudioUnitCubeMesh();
    const registered = hybridDccRegisterAsset(
      createStudioHybridDccSession("region-extrude-command"),
      "cube",
      cube,
      RIGHTS,
    );
    const sourceRightsHash = registered.state.rightsBom[0]?.contentHash;
    const mutation = extrudeStudioEditableMeshFacesWithReceipt(cube, [1, 3], 0.25);
    expect(mutation.ok).toBe(true);
    if (!mutation.ok) return;

    const committed = hybridDccCommitTopologyMutation(
      registered,
      "cube",
      mutation.value.mesh,
      {
        kind: "geometry.extrude-region",
        receipt: mutation.value.receipt,
      },
    );
    expect(committed.state.geometry.records.cube?.meshHash)
      .toBe(mutation.value.receipt.resultMeshHash);
    expect(committed.state.rightsBom[0]?.contentHash).not.toBe(sourceRightsHash);

    const journal = JSON.parse(serializeStudioCommandJournal(committed.journal)) as {
      records: Array<{
        command: { kind: string; payload: { receipt?: unknown } };
        inverse: { kind: string; payload: { receipt?: unknown } };
      }>;
    };
    const record = journal.records.at(-1);
    expect(record?.command.kind).toBe("geometry.extrude-region");
    expect(record?.inverse.kind).toBe("geometry.extrude-region.undo");
    expect(record?.command.payload.receipt).toEqual(mutation.value.receipt);
    expect(record?.inverse.payload.receipt).toBeUndefined();

    const undone = hybridDccUndo(committed);
    expect(undone.state.geometry.records.cube?.meshHash)
      .toBe(mutation.value.receipt.sourceMeshHash);
    expect(undone.state.rightsBom[0]?.contentHash).toBe(sourceRightsHash);

    const redone = hybridDccRedo(undone);
    expect(redone.state.geometry.records.cube?.meshHash)
      .toBe(mutation.value.receipt.resultMeshHash);
    expect(redone.state.rightsBom[0]?.contentHash)
      .toBe(committed.state.rightsBom[0]?.contentHash);
  });

  it("rejects forged source and result hashes before advancing document authority", () => {
    const cube = createStudioUnitCubeMesh();
    const registered = hybridDccRegisterAsset(
      createStudioHybridDccSession("region-extrude-forgery"),
      "cube",
      cube,
      RIGHTS,
    );
    const mutation = extrudeStudioEditableMeshFacesWithReceipt(cube, [0], 0.25);
    expect(mutation.ok).toBe(true);
    if (!mutation.ok) return;

    expect(() => hybridDccCommitTopologyMutation(
      registered,
      "cube",
      mutation.value.mesh,
      {
        kind: "geometry.extrude-region",
        receipt: { ...mutation.value.receipt, sourceMeshHash: "mesh:deadbeef" },
      },
    )).toThrow(/source mesh/u);
    expect(() => hybridDccCommitTopologyMutation(
      registered,
      "cube",
      mutation.value.mesh,
      {
        kind: "geometry.extrude-region",
        receipt: { ...mutation.value.receipt, resultMeshHash: "mesh:deadbeef" },
      },
    )).toThrow(/result mesh/u);
    expect(registered.state.commandCount).toBe(1);
    expect(registered.state.geometry.records.cube?.meshHash)
      .toBe(mutation.value.receipt.sourceMeshHash);
  });

  it("rejects forged topology classifications even when source and result hashes are genuine", () => {
    const cube = createStudioUnitCubeMesh();
    const registered = hybridDccRegisterAsset(
      createStudioHybridDccSession("region-extrude-structure-forgery"),
      "cube",
      cube,
      RIGHTS,
    );
    const mutation = extrudeStudioEditableMeshFacesWithReceipt(cube, [0, 2], 0.25);
    expect(mutation.ok).toBe(true);
    if (!mutation.ok) return;

    const commit = (receipt: typeof mutation.value.receipt) => hybridDccCommitTopologyMutation(
      registered,
      "cube",
      mutation.value.mesh,
      { kind: "geometry.extrude-region", receipt },
    );
    expect(() => commit({
      ...mutation.value.receipt,
      connectedRegionCount: mutation.value.receipt.connectedRegionCount + 1,
    })).toThrow(/not issued/u);
    expect(() => commit({
      ...mutation.value.receipt,
      boundaryHalfEdgeIds: mutation.value.receipt.boundaryHalfEdgeIds.slice(1),
    })).toThrow(/not issued/u);
    expect(() => commit({
      ...mutation.value.receipt,
      capFaceIds: [
        mutation.value.receipt.sideFaceIds[0]!,
        ...mutation.value.receipt.capFaceIds.slice(1),
      ],
    })).toThrow(/not issued/u);
    expect(() => commit({
      ...mutation.value.receipt,
      faceRemap: {
        entries: mutation.value.receipt.faceRemap.entries.slice(1),
      },
    })).toThrow(/not issued/u);
    expect(() => commit(JSON.parse(JSON.stringify(mutation.value.receipt)) as (
      typeof mutation.value.receipt
    ))).toThrow(/not issued/u);
    expect(registered.state.commandCount).toBe(1);
  });

  it("migrates a genuine legacy cube fingerprint but rejects a forged legacy hash", () => {
    // Produced by git show 7b039bbc:.../studio-editable-half-edge-mesh.ts, not re-minted by
    // the current exact authority implementation.
    const preSliceCubeHash = "mesh:1d31fe58";
    expect(matchesStudioEditableMeshPersistedHash(
      createStudioUnitCubeMesh(),
      preSliceCubeHash,
    )).toBe(true);
    const registered = hybridDccRegisterAsset(
      createStudioHybridDccSession("legacy-mesh-hash-migration"),
      "cube",
      createStudioUnitCubeMesh(),
      RIGHTS,
    );
    const snapshot = snapshotStudioHybridDccState(registered.state);
    const legacy = {
      ...snapshot,
      assets: snapshot.assets.map((asset) => ({
        ...asset,
        meshHash: preSliceCubeHash,
      })),
    };
    const restored = restoreStudioHybridDccStateFromSnapshot(legacy);
    expect(restored.geometry.records.cube?.meshHash)
      .toMatch(/^mesh:sha256:[0-9a-f]{64}$/u);
    expect(restored.rightsBom[0]?.contentHash)
      .toMatch(/^sha256:[0-9a-f]{64}$/u);

    expect(() => restoreStudioHybridDccStateFromSnapshot({
      ...legacy,
      assets: legacy.assets.map((asset) => ({ ...asset, meshHash: "mesh:00000000" })),
    })).toThrow(/mesh hash mismatch/u);
  });
});
