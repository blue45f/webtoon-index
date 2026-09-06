import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  STUDIO_CRDT_RASTER_OPERATIONS_ROOT,
  StudioCrdtRasterDocumentContractError,
  appendedStudioCrdtRasterActorEvents,
  assertStudioCrdtRasterGlobalPatchCount,
  snapshotStudioCrdtRasterRoots,
} from "./studio-crdt-raster-document-contract";
import {
  STUDIO_RASTER_MAX_TOTAL_PATCHES,
} from "./studio-crdt-raster-ops";

describe("studio raster document aggregate contract", () => {
  it("enforces one global patch budget rather than resetting it for each surface", () => {
    expect(() => assertStudioCrdtRasterGlobalPatchCount(0)).not.toThrow();
    expect(() => assertStudioCrdtRasterGlobalPatchCount(STUDIO_RASTER_MAX_TOTAL_PATCHES))
      .not.toThrow();
    expect(() => assertStudioCrdtRasterGlobalPatchCount(STUDIO_RASTER_MAX_TOTAL_PATCHES + 1))
      .toThrow(StudioCrdtRasterDocumentContractError);
    expect(() => assertStudioCrdtRasterGlobalPatchCount(Number.NaN))
      .toThrow(StudioCrdtRasterDocumentContractError);
  });

  it("fails closed when newly appended actor events cannot be parsed exactly", () => {
    const base = new Y.Doc();
    const snapshot = snapshotStudioCrdtRasterRoots(base);
    const malformed = new Y.Doc();
    malformed.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).set(
      "30000000-0000-4000-8000-000000000499",
      "not-canonical-json"
    );

    expect(() => appendedStudioCrdtRasterActorEvents(snapshot, malformed))
      .toThrow(StudioCrdtRasterDocumentContractError);

    base.destroy();
    malformed.destroy();
  });
});
