import { describe, expect, it } from "vitest";

import {
  computeNextActiveIdAfterBulkDelete,
  deletePagesBulk,
  movePagesBulk,
  normalizeSelectedPageIds,
  type PageLike,
} from "./studio-pages";

function page(id: string): PageLike {
  return { id, elements: [], bg: "#fff", bgGrad: null, canvasH: 1080 };
}

describe("studio multi-page bulk ops (CSP EX residual)", () => {
  it("normalizes selection to document order and drops unknown ids", () => {
    const pages = [page("a"), page("b"), page("c")];
    expect(normalizeSelectedPageIds(pages, ["c", "a", "missing", "c"])).toEqual(["a", "c"]);
  });

  it("deletes multiple pages but always keeps at least one", () => {
    const pages = [page("a"), page("b"), page("c")];
    const partial = deletePagesBulk(pages, ["a", "c"]);
    expect(partial.nextPages.map((p) => p.id)).toEqual(["b"]);
    expect(partial.removedIds).toEqual(["a", "c"]);

    const wipe = deletePagesBulk(pages, ["a", "b", "c"]);
    expect(wipe.nextPages).toHaveLength(1);
    expect(wipe.nextPages[0]!.id).toBe("a");
    expect(wipe.removedIds).toEqual(["b", "c"]);
  });

  it("moves a multi-selection as a block while preserving relative order", () => {
    const pages = [page("a"), page("b"), page("c"), page("d")];
    const down = movePagesBulk(pages, ["a", "c"], 1);
    expect(down.map((p) => p.id)).toEqual(["b", "a", "c", "d"]);

    // Selected block [b,d] moves one slot earlier as a unit: a,b,c,d → b,d,a,c
    const up = movePagesBulk(pages, ["b", "d"], -1);
    expect(up.map((p) => p.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("picks a surviving neighbour as the next active page after bulk delete", () => {
    const previous = [page("a"), page("b"), page("c"), page("d")];
    const { nextPages } = deletePagesBulk(previous, ["b", "c"]);
    expect(computeNextActiveIdAfterBulkDelete(previous, nextPages, "b")).toBe("a");
    expect(computeNextActiveIdAfterBulkDelete(previous, nextPages, "c")).toBe("a");
    expect(computeNextActiveIdAfterBulkDelete(previous, nextPages, "d")).toBe("d");
  });
});
