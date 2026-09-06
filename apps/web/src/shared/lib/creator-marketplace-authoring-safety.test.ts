import { describe, expect, it } from "vitest";

import {
  CreatorMarketplacePortableValueError,
  measureCreatorMarketplacePortableValueBytes,
  sanitizeCreatorMarketplacePortableValue,
} from "./creator-marketplace-authoring-safety";

describe("creator marketplace portable authoring value", () => {
  it("preserves JSON-compatible native engine programs", () => {
    const source = {
      enginePrograms: [
        {
          id: "water-and-grain",
          seed: 42,
          pressureCurve: [0, 0.2, 0.7, 1],
          grain: { scale: 0.75, contrast: 0.3 },
          dualBrush: { operator: "multiply", secondary: "paper" },
        },
      ],
    };
    expect(sanitizeCreatorMarketplacePortableValue(source)).toEqual(source);
    expect(measureCreatorMarketplacePortableValueBytes(source)).toBeGreaterThan(40);
  });

  it("rejects cycles instead of silently dropping the brush source", () => {
    const source: Record<string, unknown> = { id: "cyclic" };
    source.self = source;
    expect(() => sanitizeCreatorMarketplacePortableValue(source)).toThrow(
      CreatorMarketplacePortableValueError,
    );
    try {
      sanitizeCreatorMarketplacePortableValue(source);
    } catch (error) {
      expect(error).toMatchObject({ code: "cycle", path: "$.self" });
    }
  });

  it("omits functions but keeps array positions compatible with JSON semantics", () => {
    const source = {
      callback: () => undefined,
      values: [1, undefined, 3],
    };
    expect(sanitizeCreatorMarketplacePortableValue(source)).toEqual({ values: [1, null, 3] });
  });

  it("rejects non-finite numeric dynamics", () => {
    expect(() => sanitizeCreatorMarketplacePortableValue({ spacing: Number.NaN })).toThrow(
      expect.objectContaining({ code: "unsupported-number" }),
    );
  });

  it("rejects payloads over a caller-supplied byte limit", () => {
    expect(() => sanitizeCreatorMarketplacePortableValue(
      { textureData: "x".repeat(2_000) },
      { maxDepth: 8, maxEntries: 100, maxStringLength: 4_000, maxSerializedBytes: 200 },
    )).toThrow(expect.objectContaining({ code: "serialized-size" }));
  });
});
