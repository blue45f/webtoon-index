import { describe, expect, it } from "vitest";

import { STUDIO_ALL_BRUSH_CATALOG_ITEMS } from "./studio-brush-catalog";

/** Names are also accessible selection labels: collisions must identify both saved IDs. */
describe("complete brush catalogue selection labels", () => {
  it("keeps every registered name non-empty and unambiguous", () => {
    const byName = new Map<string, string[]>();
    for (const item of STUDIO_ALL_BRUSH_CATALOG_ITEMS) {
      const name = item.name.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
      expect(name, item.id).not.toBe("");
      byName.set(name, [...(byName.get(name) ?? []), item.id]);
    }
    const collisions = [...byName].filter(([, ids]) => ids.length > 1);
    expect(collisions, "Ambiguous displayed names and their stable IDs").toEqual([]);
  });
});
