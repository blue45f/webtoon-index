import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_GEOMETRY_MAX_TRIANGLES,
  STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_HISTORY_BYTES,
  STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_RESIDENT_BYTES,
  STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_TARGET_RESIDENT_BYTES,
  planStudioVrmTexturePaintDeviceTier,
} from "./studio-vrm-texture-paint-device-tier";
import {
  estimateStudioVrmTexturePaintTargetResidentBytes,
  STUDIO_VRM_TEXTURE_PAINT_STANDARD_GEOMETRY_MAX_TRIANGLES,
} from "./studio-vrm-texture-paint-runtime";

describe("Studio VRM texture-paint device tier", () => {
  it.each([
    {
      name: "coarse pointer",
      signals: {
        coarsePointer: true,
        viewportWidthCssPixels: 1_440,
        deviceMemoryGb: 8,
      },
    },
    {
      name: "narrow viewport",
      signals: {
        coarsePointer: false,
        viewportWidthCssPixels: 390,
        deviceMemoryGb: 8,
      },
    },
    {
      name: "low device memory",
      signals: {
        coarsePointer: false,
        viewportWidthCssPixels: 1_440,
        deviceMemoryGb: 2,
      },
    },
  ])("applies a fail-closed resident envelope to $name environments", ({ signals }) => {
    expect(planStudioVrmTexturePaintDeviceTier(signals)).toEqual({
      tier: "constrained",
      runtimeOptions: {
        maxTargetResidentBytes: STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_TARGET_RESIDENT_BYTES,
        maxAggregateResidentBytes: STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_RESIDENT_BYTES,
        maxConcurrentReads: 1,
        maxHistoryBytes: STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_HISTORY_BYTES,
        maxGeometryIndexTriangles:
          STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_GEOMETRY_MAX_TRIANGLES,
      },
    });
  });

  it("keeps desktop runtime defaults when no constrained signal is present", () => {
    expect(planStudioVrmTexturePaintDeviceTier({
      coarsePointer: false,
      viewportWidthCssPixels: 1_440,
      deviceMemoryGb: 8,
    })).toEqual({
      tier: "standard",
      runtimeOptions: {
        maxGeometryIndexTriangles:
          STUDIO_VRM_TEXTURE_PAINT_STANDARD_GEOMETRY_MAX_TRIANGLES,
      },
    });
  });

  it("does not mistake missing or unusable optional telemetry for a mobile device", () => {
    expect(planStudioVrmTexturePaintDeviceTier({
      coarsePointer: false,
      viewportWidthCssPixels: null,
      deviceMemoryGb: Number.NaN,
    }).tier).toBe("standard");
  });

  it("charges conservative 2K and 4K resident copies before allocating raster resources", () => {
    const twoKBytes = estimateStudioVrmTexturePaintTargetResidentBytes({
      width: 2_048,
      height: 2_048,
    });
    const fourKBytes = estimateStudioVrmTexturePaintTargetResidentBytes({
      width: 4_096,
      height: 4_096,
    });
    expect(twoKBytes).toBe(64 * 1024 * 1024);
    expect(fourKBytes).toBe(256 * 1024 * 1024);
    expect(twoKBytes).toBeGreaterThan(
      STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_TARGET_RESIDENT_BYTES,
    );
    expect(fourKBytes).toBeGreaterThan(
      STUDIO_VRM_TEXTURE_PAINT_CONSTRAINED_MAX_RESIDENT_BYTES,
    );
  });
});
