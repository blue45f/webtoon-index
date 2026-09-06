import { describe, expect, it } from "vitest";

import {
  releaseStudioGpuPendingAuthorityPrefix,
  type StudioGpuPendingDrawAuthority,
} from "./studio-webgpu-pending-authority";

import type { DrawEl } from "../studio-element-model";

function draw(id: string): DrawEl {
  return {
    id,
    mode: "pen",
    points: [0, 0, 10, 10],
    stroke: "#111111",
    strokeWidth: 4,
    type: "draw",
  };
}

function authority(element: DrawEl, gpuStrokeCount = 1): StudioGpuPendingDrawAuthority {
  return { element, gpuStrokeCount };
}

describe("GPU pending authority release", () => {
  it("normalizes a stale partial release count to the proven complete symmetry group", () => {
    const first = authority(draw("first"), 2);
    const second = authority(draw("second"), 4);
    expect(releaseStudioGpuPendingAuthorityPrefix({
      authorities: [first, second],
      requestedGpuStrokeCount: 1,
      availableGpuStrokeCount: 6,
      completeElementIds: new Set([first.element.id]),
    })).toEqual({
      status: "released",
      remaining: [second],
      releasedGpuStrokeCount: 2,
      normalizedToWholeGroup: true,
    });
  });

  it("preserves the complete queue when semantic release evidence is missing", () => {
    const first = authority(draw("first"), 2);
    expect(releaseStudioGpuPendingAuthorityPrefix({
      authorities: [first],
      requestedGpuStrokeCount: 1,
      availableGpuStrokeCount: 2,
      completeElementIds: new Set(),
    })).toEqual({
      status: "rejected",
      reason: "missing-complete-element-evidence",
    });
  });

  it("releases complete authority groups in GPU operation units", () => {
    const first = authority(draw("first"), 2);
    const second = authority(draw("second"), 4);
    expect(releaseStudioGpuPendingAuthorityPrefix({
      authorities: [first, second],
      requestedGpuStrokeCount: 2,
      availableGpuStrokeCount: 6,
      completeElementIds: new Set([first.element.id]),
    })).toEqual({
      status: "released",
      remaining: [second],
      releasedGpuStrokeCount: 2,
      normalizedToWholeGroup: false,
    });
  });

  it("does not consume the next complete authority after an exact target boundary", () => {
    const first = authority(draw("first"), 2);
    const second = authority(draw("second"), 4);

    expect(releaseStudioGpuPendingAuthorityPrefix({
      authorities: [first, second],
      requestedGpuStrokeCount: 2,
      availableGpuStrokeCount: 6,
      completeElementIds: new Set([first.element.id, second.element.id]),
    })).toEqual({
      status: "released",
      remaining: [second],
      releasedGpuStrokeCount: 2,
      normalizedToWholeGroup: false,
    });
  });

  it("releases zero authorities for a zero target without semantic evidence", () => {
    const first = authority(draw("first"), 2);

    expect(releaseStudioGpuPendingAuthorityPrefix({
      authorities: [first],
      requestedGpuStrokeCount: 0,
      availableGpuStrokeCount: 2,
      completeElementIds: new Set(),
    })).toEqual({
      status: "released",
      remaining: [first],
      releasedGpuStrokeCount: 0,
      normalizedToWholeGroup: false,
    });
  });

  it("rejects zero-count ownership evidence so the caller can promote the mismatched authority", () => {
    const first = authority(draw("first"), 2);

    expect(releaseStudioGpuPendingAuthorityPrefix({
      authorities: [first],
      requestedGpuStrokeCount: 0,
      availableGpuStrokeCount: 2,
      completeElementIds: new Set([first.element.id]),
    })).toEqual({
      status: "rejected",
      reason: "zero-count-authority-evidence",
    });
  });

  it("rejects a corrupted operation map without consuming any authority", () => {
    const first = authority(draw("first"), 2);
    expect(releaseStudioGpuPendingAuthorityPrefix({
      authorities: [first],
      requestedGpuStrokeCount: 1,
      availableGpuStrokeCount: 3,
      completeElementIds: new Set([first.element.id]),
    })).toEqual({
      status: "rejected",
      reason: "authority-count-mismatch",
    });
  });
});
