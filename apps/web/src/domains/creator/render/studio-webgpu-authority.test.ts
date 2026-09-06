import { describe, expect, it } from "vitest";

import {
  isStudioWebGpuAuthorityCurrent,
  snapshotStudioWebGpuAuthority,
  type StudioWebGpuAuthorityInput,
} from "./studio-webgpu-authority";

function frame(
  overrides: Partial<StudioWebGpuAuthorityInput> = {}
): StudioWebGpuAuthorityInput {
  return {
    strokes: [{
      id: "ink",
      points: [0, 0, 12, 8],
      pressures: [0.25, 0.75],
      color: "#123456",
      size: 6,
      opacity: 1,
      composite: "normal",
    }],
    committedElementIds: ["ink"],
    draftElementId: null,
    documentWidth: 800,
    documentHeight: 12_000,
    viewport: {
      surface: { left: 0, top: 4_000, width: 800, height: 900 },
      transform: {
        scaleX: 1,
        scaleY: 13.333333333333334,
        offsetX: 0,
        offsetY: -53_333.333333333336,
        flipX: false,
      },
    },
    ...overrides,
  };
}

describe("Studio WebGPU authority", () => {
  it("authorizes independently allocated exact scene and viewport state", () => {
    const authority = snapshotStudioWebGpuAuthority(frame());
    expect(isStudioWebGpuAuthorityCurrent(authority, frame())).toBe(true);
  });

  it.each([
    ["stroke pixels", frame({
      strokes: [{ id: "ink", points: [0, 0, 13, 8], color: "#123456", size: 6 }],
    })],
    ["scene ownership", frame({ committedElementIds: ["another-ink"] })],
    ["draft ownership", frame({ draftElementId: "draft" })],
    ["document extent", frame({ documentHeight: 11_999 })],
    ["scroll viewport", frame({
      viewport: {
        ...frame().viewport,
        surface: { ...frame().viewport.surface, top: 4_001 },
      },
    })],
    ["flip transform", frame({
      viewport: {
        ...frame().viewport,
        transform: { ...frame().viewport.transform, flipX: true },
      },
    })],
  ] as const)("revokes authority when %s changes", (_label, changed) => {
    expect(isStudioWebGpuAuthorityCurrent(snapshotStudioWebGpuAuthority(frame()), changed)).toBe(false);
  });

  it("deep-snapshots hot pointer arrays and viewport objects", () => {
    const current = frame();
    const authority = snapshotStudioWebGpuAuthority(current);
    (current.strokes[0]!.points as number[]).push(20, 20);
    (current.viewport.surface as { top: number }).top = 5_000;

    expect(authority.strokes[0]?.points).toEqual([0, 0, 12, 8]);
    expect(authority.viewport.surface.top).toBe(4_000);
    expect(isStudioWebGpuAuthorityCurrent(authority, current)).toBe(false);
  });

  it("never authorizes an empty compositor frame", () => {
    const empty = frame({ strokes: [], committedElementIds: [] });
    expect(isStudioWebGpuAuthorityCurrent(snapshotStudioWebGpuAuthority(empty), empty)).toBe(false);
  });
});
