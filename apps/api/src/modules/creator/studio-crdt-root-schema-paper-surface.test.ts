import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { PAPER_GRAIN_KINDS } from "../../../../web/src/domains/creator/brush/studio-paper-texture";

import { hasValidStudioCrdtRootSchema } from "./studio-crdt-root-schema";

const PAGE_ID = "page-paper";

function pageDocument(): { doc: Y.Doc; page: Y.Map<unknown> } {
  const doc = new Y.Doc();
  doc.getMap<boolean>("studio-pages").set(PAGE_ID, true);
  const page = doc.getMap<unknown>(`studio-page:${PAGE_ID}`);
  page.set("id", PAGE_ID);
  page.set("payloadVersion", 1);
  page.set("deleted", false);
  page.set("prop:bg", "#ffffff");
  page.set("prop:bgGrad", null);
  page.set("prop:canvasH", 1_600);

  const order = new Y.Map<unknown>();
  order.set("pageId", PAGE_ID);
  order.set("active", true);
  doc.getArray<Y.Map<unknown>>("page-order").push([order]);
  return { doc, page };
}

describe("Studio CRDT paper surface page boundary", () => {
  it("accepts every authored paper kind, bounded seeds, and both visibility states", () => {
    for (const [index, kind] of PAPER_GRAIN_KINDS.entries()) {
      const { doc, page } = pageDocument();
      page.set("prop:paperSurface", {
        kind,
        seed: index % 2 === 0 ? 0 : 0xffff_ffff,
      });
      page.set("prop:paperGrainVisible", index % 2 === 0);
      expect(hasValidStudioCrdtRootSchema(doc), kind).toBe(true);
      doc.destroy();
    }
  });

  it("rejects malformed surface settings and visibility values", () => {
    const invalidCases: Array<[label: string, property: string, value: unknown]> = [
      ["unknown kind", "paperSurface", { kind: "papyrus", seed: 41 }],
      ["missing seed", "paperSurface", { kind: "rough" }],
      ["extra key", "paperSurface", { kind: "rough", seed: 41, privateNote: true }],
      ["negative seed", "paperSurface", { kind: "rough", seed: -1 }],
      ["fractional seed", "paperSurface", { kind: "rough", seed: 1.5 }],
      ["overflow seed", "paperSurface", { kind: "rough", seed: 0x1_0000_0000 }],
      ["string seed", "paperSurface", { kind: "rough", seed: "41" }],
      ["non-boolean visibility", "paperGrainVisible", "false"],
    ];

    for (const [label, property, value] of invalidCases) {
      const { doc, page } = pageDocument();
      page.set(`prop:${property}`, value);
      expect(hasValidStudioCrdtRootSchema(doc), label).toBe(false);
      doc.destroy();
    }
  });

  it("rejects an invalid hidden baseline that a later unset could reveal", () => {
    const { doc, page } = pageDocument();
    page.set("base:paperSurface", { kind: "papyrus", seed: 41 });
    page.set("prop:paperSurface", { kind: "rough", seed: 73 });
    page.set("base:paperGrainVisible", "true");
    page.set("prop:paperGrainVisible", true);

    expect(hasValidStudioCrdtRootSchema(doc)).toBe(false);
    doc.destroy();
  });
});
