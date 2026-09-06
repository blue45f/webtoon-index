import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_MAGIC_FILTER_MASK_PROFILE,
  StudioBg3dMagicFilterMaskError,
  buildStudioBg3dMagicFilterMask,
  type BuildStudioBg3dMagicFilterMaskInput,
} from "./studio-bg3d-magic-filter-mask";

const LEGEND = Object.freeze([
  Object.freeze({ id: 7, stableId: "obj/hero", label: "Hero" }),
  Object.freeze({ id: 23, stableId: "obj/chair~main", label: "Main chair" }),
]);

function input(
  patch: Partial<BuildStudioBg3dMagicFilterMaskInput> = {},
): BuildStudioBg3dMagicFilterMaskInput {
  return {
    width: 3,
    height: 2,
    objectIds: Uint32Array.from([0, 7, 23, 7, 0, 7]),
    legend: LEGEND,
    selectedId: "hero",
    ...patch,
  };
}

function expectCode(
  value: BuildStudioBg3dMagicFilterMaskInput,
  code: StudioBg3dMagicFilterMaskError["code"],
): void {
  expect(() => buildStudioBg3dMagicFilterMask(value)).toThrowError(
    expect.objectContaining({ code }),
  );
}

describe("studio-bg3d-magic-filter-mask", () => {
  it("creates an exact top-down white/alpha mask with immutable selection metadata", () => {
    const result = buildStudioBg3dMagicFilterMask(input());

    expect(result).toEqual({
      profile: STUDIO_BG3D_MAGIC_FILTER_MASK_PROFILE,
      width: 3,
      height: 2,
      selectedId: "hero",
      selectedStableId: "obj/hero",
      selectedNumericId: 7,
      selectedPixelCount: 3,
      totalPixelCount: 6,
      coverageRatio: 0.5,
      selectedBounds: { x: 0, y: 0, width: 3, height: 2 },
      data: Uint8Array.from([
        255, 255, 255, 0,
        255, 255, 255, 255,
        255, 255, 255, 0,
        255, 255, 255, 255,
        255, 255, 255, 0,
        255, 255, 255, 255,
      ]),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.selectedBounds)).toBe(true);
    expect(result.data.byteOffset).toBe(0);
    expect(result.data.buffer.byteLength).toBe(3 * 2 * 4);
  });

  it("preserves canonical row order and reports tight top-origin bounds", () => {
    const result = buildStudioBg3dMagicFilterMask(input({
      width: 4,
      height: 3,
      objectIds: Uint32Array.from([
        0, 7, 7, 0,
        0, 0, 7, 0,
        23, 0, 0, 23,
      ]),
    }));

    expect(result.selectedBounds).toEqual({ x: 1, y: 0, width: 2, height: 2 });
    expect(Array.from(result.data.filter((_, index) => index % 4 === 3)))
      .toEqual([0, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0, 0]);
  });

  it("returns fresh caller-owned storage that never aliases source or sibling results", () => {
    const objectIds = Uint32Array.from([7]);
    const first = buildStudioBg3dMagicFilterMask(input({
      width: 1,
      height: 1,
      objectIds,
    }));
    const second = buildStudioBg3dMagicFilterMask(input({
      width: 1,
      height: 1,
      objectIds,
    }));

    objectIds[0] = 0;
    first.data[3] = 0;
    expect(first.data.buffer).not.toBe(objectIds.buffer);
    expect(first.data.buffer).not.toBe(second.data.buffer);
    expect(second.data).toEqual(Uint8Array.from([255, 255, 255, 255]));
  });

  it.each([
    [0, 1],
    [1, 0],
    [-1, 1],
    [1, -1],
    [1.5, 1],
    [1, Number.NaN],
    [16_385, 1],
    [4_097, 4_097],
  ])("rejects invalid dimensions %s x %s", (width, height) => {
    expectCode(input({
      width,
      height,
      objectIds: new Uint32Array(1),
    }), "invalid-dimensions");
  });

  it("rejects wrong-length, aliased, shared, and non-Uint32 object-ID storage", () => {
    expectCode(input({ objectIds: new Uint32Array(5) }), "invalid-object-id-buffer");

    const aliased = new Uint32Array(7).subarray(0, 6);
    expectCode(input({ objectIds: aliased }), "invalid-object-id-buffer");

    if (typeof SharedArrayBuffer !== "undefined") {
      const shared = new Uint32Array(new SharedArrayBuffer(6 * Uint32Array.BYTES_PER_ELEMENT));
      expectCode(input({ objectIds: shared }), "invalid-object-id-buffer");
    }

    expectCode(input({
      objectIds: new Uint8Array(6) as unknown as Uint32Array,
    }), "invalid-object-id-buffer");
  });

  it.each([
    "",
    "contains space",
    "path/segment",
    "__proto__",
    "constructor",
    "prototype",
    `n${"x".repeat(80)}`,
  ])("rejects unsafe selected node ID %j", (selectedId) => {
    expectCode(input({ selectedId }), "invalid-selected-node-id");
  });

  it("rejects absent and duplicate selected stable identities", () => {
    expectCode(input({ selectedId: "missing" }), "selected-stable-id-missing");
    expectCode(input({
      legend: [
        { id: 7, stableId: "obj/hero", label: "Hero" },
        { id: 8, stableId: "obj/hero", label: "Hero duplicate" },
      ],
    }), "duplicate-legend-stable-id");
  });

  it("rejects duplicate numeric legend IDs even when stable identities differ", () => {
    expectCode(input({
      legend: [
        { id: 7, stableId: "obj/hero", label: "Hero" },
        { id: 7, stableId: "obj/chair", label: "Chair" },
      ],
    }), "duplicate-legend-numeric-id");
  });

  it.each([
    null,
    {},
    [{ id: 7, stableId: "obj/hero", label: "Hero", extra: true }],
    [{ id: 0, stableId: "obj/hero", label: "Hero" }],
    [{ id: -1, stableId: "obj/hero", label: "Hero" }],
    [{ id: 1.5, stableId: "obj/hero", label: "Hero" }],
    [{ id: 0x1_0000_0000, stableId: "obj/hero", label: "Hero" }],
    [{ id: 7, stableId: "mat/hero/primitive", label: "Hero" }],
    [{ id: 7, stableId: "obj/contains/slash", label: "Hero" }],
    [{ id: 7, stableId: "obj/__proto__", label: "Hero" }],
    [{ id: 7, stableId: "obj/hero", label: "" }],
    [{ id: 7, stableId: "obj/hero", label: " padded " }],
    [{ id: 7, stableId: "obj/hero", label: "line\nbreak" }],
  ])("rejects malformed legend value %#", (legend) => {
    expectCode(input({
      legend: legend as BuildStudioBg3dMagicFilterMaskInput["legend"],
    }), "malformed-legend");
  });

  it("rejects sparse/accessor legend entries instead of evaluating them", () => {
    const sparse = new Array(1) as BuildStudioBg3dMagicFilterMaskInput["legend"];
    expectCode(input({ legend: sparse }), "malformed-legend");

    const accessor = [] as unknown[];
    Object.defineProperty(accessor, "0", {
      configurable: true,
      enumerable: true,
      get: () => ({ id: 7, stableId: "obj/hero", label: "Hero" }),
    });
    accessor.length = 1;
    expectCode(input({
      legend: accessor as BuildStudioBg3dMagicFilterMaskInput["legend"],
    }), "malformed-legend");

    const accessorEntry = { id: 7, stableId: "obj/hero" } as Record<string, unknown>;
    Object.defineProperty(accessorEntry, "label", {
      configurable: true,
      enumerable: true,
      get: () => "Hero",
    });
    expectCode(input({
      legend: [accessorEntry] as unknown as BuildStudioBg3dMagicFilterMaskInput["legend"],
    }), "malformed-legend");
  });

  it("rejects every rendered non-background ID that is absent from the legend", () => {
    expectCode(input({
      objectIds: Uint32Array.from([0, 7, 23, 7, 99, 7]),
    }), "unexpected-object-id");
  });

  it("rejects a valid selected identity when the canonical plane contains zero selected pixels", () => {
    expectCode(input({
      objectIds: Uint32Array.from([0, 23, 23, 0, 0, 23]),
    }), "empty-selection");
  });

  it("accepts background pixels, unused valid legend entries, tilde IDs, and Uint32 maximum IDs", () => {
    const result = buildStudioBg3dMagicFilterMask(input({
      width: 2,
      height: 1,
      objectIds: Uint32Array.from([0, 0xffff_ffff]),
      legend: [
        { id: 3, stableId: "obj/unused", label: "Unused" },
        { id: 0xffff_ffff, stableId: "obj/hero~variant", label: "Hero variant" },
      ],
      selectedId: "hero~variant",
    }));

    expect(result.selectedNumericId).toBe(0xffff_ffff);
    expect(result.selectedPixelCount).toBe(1);
    expect(result.coverageRatio).toBe(0.5);
    expect(result.data).toEqual(Uint8Array.from([
      255, 255, 255, 0,
      255, 255, 255, 255,
    ]));
  });

  it("rejects unknown object IDs before exposing a partially populated mask", () => {
    const error = (() => {
      try {
        buildStudioBg3dMagicFilterMask(input({
          objectIds: Uint32Array.from([7, 7, 7, 7, 7, 99]),
        }));
        return null;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(StudioBg3dMagicFilterMaskError);
    expect(error).toMatchObject({
      name: "StudioBg3dMagicFilterMaskError",
      code: "unexpected-object-id",
    });
  });

  it("rejects extra input fields and accessor-backed boundary fields fail closed", () => {
    expectCode({
      ...input(),
      extra: true,
    } as BuildStudioBg3dMagicFilterMaskInput, "invalid-input");

    const accessorInput = {
      width: 1,
      height: 1,
      objectIds: Uint32Array.from([7]),
      legend: LEGEND,
    } as Record<string, unknown>;
    Object.defineProperty(accessorInput, "selectedId", {
      configurable: true,
      enumerable: true,
      get: () => "hero",
    });
    expectCode(
      accessorInput as unknown as BuildStudioBg3dMagicFilterMaskInput,
      "invalid-input",
    );
  });
});
