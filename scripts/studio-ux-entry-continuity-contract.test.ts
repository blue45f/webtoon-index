import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  STUDIO_UX_ENTRY_CONTINUITY_CHECKPOINT_IDS,
  STUDIO_UX_ENTRY_CONTINUITY_CANDIDATES,
  STUDIO_UX_ENTRY_CONTINUITY_CONTRACTS,
  auditStudioUxEntryContinuity,
} from "./studio-ux-entry-continuity-contract";

function sourceMap(): ReadonlyMap<string, string> {
  const files = new Set(
    [...STUDIO_UX_ENTRY_CONTINUITY_CONTRACTS, ...STUDIO_UX_ENTRY_CONTINUITY_CANDIDATES].flatMap((contract) =>
      contract.checkpoints.flatMap((checkpoint) =>
        checkpoint.clauses.map((clause) => clause.file),
      ),
    ),
  );
  return new Map(
    [...files].map((file) => [
      file,
      readFileSync(resolve(process.cwd(), file), "utf8"),
    ]),
  );
}

describe("Studio conditional-entry continuity contract", () => {
  it("pins every P0 flow to the five prerequisite-to-reentry checkpoints", () => {
    expect(STUDIO_UX_ENTRY_CONTINUITY_CONTRACTS.map((contract) => contract.id)).toEqual([
      "hokusai-selected-freehand",
      "native-raster-recovery",
      "paper-vector-refinement-selected-stroke",
      "pixel-transform-selection",
      "frame-animation-selected-image",
      "brush-dynamics-compatible-brush",
      "ai-character-reference-image",
    ]);
    for (const contract of STUDIO_UX_ENTRY_CONTINUITY_CONTRACTS) {
      expect(contract.checkpoints.map((checkpoint) => checkpoint.id)).toEqual(
        STUDIO_UX_ENTRY_CONTINUITY_CHECKPOINT_IDS,
      );
    }
  });

  it("leaves no known high-risk selection guard as diagnostic-only", () => {
    expect(STUDIO_UX_ENTRY_CONTINUITY_CANDIDATES).toEqual([]);
  });

  it("keeps CTA, state transition, target selection and feature reentry connected", () => {
    const sources = sourceMap();
    const results = STUDIO_UX_ENTRY_CONTINUITY_CONTRACTS.map((contract) =>
      auditStudioUxEntryContinuity(contract, sources),
    );
    expect(results).toHaveLength(7);
    expect(results).toEqual(
      STUDIO_UX_ENTRY_CONTINUITY_CONTRACTS.map((contract) =>
        expect.objectContaining({
          id: contract.id,
          ok: true,
          score: 100,
          passedCheckpoints: 5,
        }),
      ),
    );
  });

  it("reports the exact dead-end checkpoint when reentry disappears", () => {
    const sources = new Map(sourceMap());
    const inspectorPath = "apps/web/src/domains/creator/StudioInspectorDrawingSection.tsx";
    sources.set(
      inspectorPath,
      sources.get(inspectorPath)!.replace(
        'visible={drawMode !== "shape" && drawMode !== "pixel"}',
        "visible={false}",
      ),
    );
    const contract = STUDIO_UX_ENTRY_CONTINUITY_CONTRACTS[0]!;
    const result = auditStudioUxEntryContinuity(contract, sources);
    expect(result).toMatchObject({
      ok: false,
      score: 80,
      passedCheckpoints: 4,
    });
    expect(result.checkpoints).toContainEqual(expect.objectContaining({
      id: "entry-visible-after-target-selection",
      ok: false,
    }));
  });
});
