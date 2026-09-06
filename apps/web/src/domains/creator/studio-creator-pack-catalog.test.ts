import { describe, expect, it } from "vitest";

import {
  STUDIO_CREATOR_PACK_CATALOG,
  findStudioCreatorPack,
} from "./studio-creator-pack-catalog";

describe("Studio Creator Pack catalog", () => {
  it("covers every requested cross-kind resource with unique ids", () => {
    expect(new Set(STUDIO_CREATOR_PACK_CATALOG.map((pack) => pack.metadata.kind))).toEqual(
      new Set(["brush", "filter", "palette", "template", "3d-preset"]),
    );
    expect(new Set(STUDIO_CREATOR_PACK_CATALOG.map((pack) => pack.metadata.id)).size)
      .toBe(STUDIO_CREATOR_PACK_CATALOG.length);
    expect(
      new Set(STUDIO_CREATOR_PACK_CATALOG.flatMap((pack) => pack.entries.map((entry) => entry.id))).size,
    ).toBe(STUDIO_CREATOR_PACK_CATALOG.reduce((sum, pack) => sum + pack.entries.length, 0));
  });

  it("keeps portable content small and large runtimes as stable builtin references", () => {
    for (const pack of STUDIO_CREATOR_PACK_CATALOG) {
      for (const entry of pack.entries) {
        if (entry.kind === "template" || entry.kind === "3d-preset") {
          expect(entry.delivery.mode).toBe("builtin-ref");
        } else {
          expect(entry.delivery.mode).toBe("portable-json");
          if (entry.delivery.mode === "portable-json") {
            expect(JSON.stringify(entry.delivery.definition).length).toBeLessThan(16_384);
          }
        }
      }
    }
  });

  it("resolves stable package ids without fallback", () => {
    const first = STUDIO_CREATOR_PACK_CATALOG[0]!;
    expect(findStudioCreatorPack(first.metadata.id)).toBe(first);
    expect(findStudioCreatorPack("missing")).toBeNull();
  });
});
