import { describe, expect, it } from "vitest";

import {
  StudioBg3dStableIdPackingError,
  createStudioBg3dStableIdPackingPlan,
  decodeStudioBg3dStableIdReadback,
  encodeStudioBg3dStableIdRgba,
} from "./studio-bg3d-babylon-stable-id-packing";

describe("studio-bg3d-babylon-stable-id-packing", () => {
  it("assigns deterministic IDs by canonical stable identity", () => {
    const plan = createStudioBg3dStableIdPackingPlan([
      { stableId: "node:z", label: "Z" },
      { stableId: "node_a", label: "Underscore" },
      { stableId: "node/a", label: "Slash" },
      { stableId: "node:a", label: "A" },
    ]);

    expect(plan.legend).toEqual([
      { id: 1, stableId: "node/a", label: "Slash" },
      { id: 2, stableId: "node:a", label: "A" },
      { id: 3, stableId: "node:z", label: "Z" },
      { id: 4, stableId: "node_a", label: "Underscore" },
    ]);
    expect(plan.idByStableId["node:a"]).toBe(2);
    expect(Object.isFrozen(plan.legend)).toBe(true);
    expect(Object.isFrozen(plan.idByStableId)).toBe(true);
  });

  it("keeps SceneDocument-compatible tilde IDs valid through readback", () => {
    const plan = createStudioBg3dStableIdPackingPlan([
      { stableId: "obj/node~variant", label: "Node variant" },
    ]);
    const color = encodeStudioBg3dStableIdRgba(1);

    expect(plan.legend).toEqual([{
      id: 1,
      stableId: "obj/node~variant",
      label: "Node variant",
    }]);
    expect(decodeStudioBg3dStableIdReadback({
      data: Uint8Array.from(color),
      width: 1,
      height: 1,
      flipY: false,
      swapRedBlue: false,
      plan,
    })).toEqual(Uint32Array.from([1]));
  });

  it("encodes and decodes exact RGBA palette values with row/channel normalization", () => {
    const plan = createStudioBg3dStableIdPackingPlan([
      { stableId: "node:a", label: "A" },
      { stableId: "node:b", label: "B" },
    ]);
    const first = encodeStudioBg3dStableIdRgba(1);
    const second = encodeStudioBg3dStableIdRgba(2);
    const readback = new Uint8Array([
      second[2], second[1], second[0], second[3],
      0, 0, 0, 0,
      first[2], first[1], first[0], first[3],
      second[2], second[1], second[0], second[3],
    ]);

    expect(decodeStudioBg3dStableIdReadback({
      data: readback,
      width: 2,
      height: 2,
      flipY: true,
      swapRedBlue: true,
      plan,
    })).toEqual(new Uint32Array([1, 2, 2, 0]));
  });

  it("rejects duplicate/unsafe descriptors and exhausted palettes", () => {
    expect(() => createStudioBg3dStableIdPackingPlan([
      { stableId: "same", label: "A" },
      { stableId: "same", label: "B" },
    ])).toThrowError(expect.objectContaining({ code: "duplicate-stable-id" }));
    expect(() => createStudioBg3dStableIdPackingPlan([
      { stableId: "../unsafe", label: "A" },
    ])).toThrowError(expect.objectContaining({ code: "invalid-descriptor" }));
    expect(() => createStudioBg3dStableIdPackingPlan([
      { stableId: "node:a", label: " padded " },
    ])).toThrowError(expect.objectContaining({ code: "invalid-descriptor" }));
    expect(() => createStudioBg3dStableIdPackingPlan(
      Array.from({ length: 16_385 }, (_, index) => ({
        stableId: `node:${index}`,
        label: `Node ${index}`,
      })),
    )).toThrowError(expect.objectContaining({ code: "palette-exhausted" }));
  });

  it("enforces the artifact contract's cumulative UTF-8 legend budget", () => {
    expect(() => createStudioBg3dStableIdPackingPlan(
      Array.from({ length: 16_384 }, (_, index) => ({
        stableId: `node:${index}`,
        label: "가".repeat(53),
      })),
    )).toThrowError(expect.objectContaining({ code: "palette-exhausted" }));
  });

  it("fails closed for blended, alpha-corrupt, and unknown rendered IDs", () => {
    const plan = createStudioBg3dStableIdPackingPlan([
      { stableId: "node:a", label: "A" },
    ]);
    for (const data of [
      new Uint8Array([1, 0, 0, 128]),
      new Uint8Array([2, 0, 0, 255]),
      new Uint8Array([1, 0, 0, 0]),
    ]) {
      expect(() => decodeStudioBg3dStableIdReadback({
        data,
        width: 1,
        height: 1,
        flipY: false,
        swapRedBlue: false,
        plan,
      })).toThrowError(StudioBg3dStableIdPackingError);
    }
  });

  it("reserves zero for an exact transparent-black background only", () => {
    const plan = createStudioBg3dStableIdPackingPlan([]);
    expect(decodeStudioBg3dStableIdReadback({
      data: new Uint8Array([0, 0, 0, 0]),
      width: 1,
      height: 1,
      flipY: false,
      swapRedBlue: false,
      plan,
    })).toEqual(new Uint32Array([0]));
    for (const alpha of [1, 127, 254, 255]) {
      expect(() => decodeStudioBg3dStableIdReadback({
        data: new Uint8Array([0, 0, 0, alpha]),
        width: 1,
        height: 1,
        flipY: false,
        swapRedBlue: false,
        plan,
      })).toThrowError(expect.objectContaining({ code: "unknown-rendered-id" }));
    }
  });

  it("rejects forged plans, non-boolean transforms, and aliased readback storage", () => {
    const plan = createStudioBg3dStableIdPackingPlan([
      { stableId: "node:a", label: "A" },
    ]);
    const aliased = new Uint8Array(8).subarray(0, 4);
    aliased.set([1, 0, 0, 255]);
    expect(() => decodeStudioBg3dStableIdReadback({
      data: aliased,
      width: 1,
      height: 1,
      flipY: false,
      swapRedBlue: false,
      plan,
    })).toThrowError(expect.objectContaining({ code: "invalid-readback" }));
    expect(() => decodeStudioBg3dStableIdReadback({
      data: new Uint8Array([1, 0, 0, 255]),
      width: 1,
      height: 1,
      flipY: 0 as unknown as boolean,
      swapRedBlue: false,
      plan,
    })).toThrowError(expect.objectContaining({ code: "invalid-readback" }));
    expect(() => decodeStudioBg3dStableIdReadback({
      data: new Uint8Array([1, 0, 0, 255]),
      width: 1,
      height: 1,
      flipY: false,
      swapRedBlue: false,
      plan: Object.freeze({
        legend: plan.legend,
        idByStableId: Object.freeze(Object.assign(Object.create(null), {
          "node:a": 2,
        })),
      }),
    })).toThrowError(expect.objectContaining({ code: "invalid-readback" }));
    expect(() => decodeStudioBg3dStableIdReadback({
      data: new Uint8Array([1, 0, 0, 255]),
      width: 1,
      height: 1,
      flipY: false,
      swapRedBlue: false,
      plan: Object.freeze({
        legend: Object.freeze([
          Object.freeze({ id: 1, stableId: "node:z", label: "Z" }),
          Object.freeze({ id: 2, stableId: "node:a", label: "A" }),
        ]),
        idByStableId: Object.freeze(Object.assign(Object.create(null), {
          "node:z": 1,
          "node:a": 2,
        })),
      }),
    })).toThrowError(expect.objectContaining({ code: "invalid-readback" }));
    if (typeof SharedArrayBuffer === "function") {
      const shared = new Uint8Array(new SharedArrayBuffer(4));
      shared.set([1, 0, 0, 255]);
      expect(() => decodeStudioBg3dStableIdReadback({
        data: shared as Uint8Array,
        width: 1,
        height: 1,
        flipY: false,
        swapRedBlue: false,
        plan,
      })).toThrowError(expect.objectContaining({ code: "invalid-readback" }));
    }
  });
});
