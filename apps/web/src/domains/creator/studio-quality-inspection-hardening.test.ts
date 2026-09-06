import { describe, expect, it } from "vitest";

import { computeStudioQualityRevisionKey, inspectStudioQuality } from "./studio-quality-inspection";

import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";

function page(elements: El[]): PageState {
  return { id: "page", elements, canvasH: 800, bg: "#fff", bgGrad: null,
    review: { status: "approved", locked: true } };
}

const measurer = { measureWidth: (text: string, size: number) => [...text].length * size };

describe("quality inspection corrupted-content admission", () => {
  for (const type of ["text", "bubble", "sticker"] as const) {
    for (const hidden of [false, true]) {
      it.each([null, undefined, 42, {}, ["not", "a", "string"]].map((text) => ({ text })))(
        `${type} hidden=${hidden} rejects non-string text without throwing: %j`, ({ text }) => {
          const element = { id: "broken", type, text, hidden, x: 20, y: 20,
            width: 300, height: 200, rotation: 0, fontSize: 24, fill: "#fff", textFill: "#000",
            variant: "speech" } as unknown as El;
          const document = page([element]);
          const report = inspectStudioQuality({ pages: [document] }, { textMeasurer: measurer });
          expect(report.canFinalize).toBe(false);
          expect(report.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "INVALID_DIALOGUE_CHARACTER", severity: "blocking", elementId: "broken" }),
          ]));
          expect(document.elements[0]).toBe(element);
          expect((element as unknown as { text: unknown }).text).toBe(text);
        }
      );
    }
  }

  it("keeps invalid geometry findings alongside malformed text", () => {
    const element = { id: "broken", type: "text", text: 1, x: NaN, y: 20,
      width: 300, fontSize: 24, fill: "#000", rotation: 0 } as unknown as El;
    const report = inspectStudioQuality({ pages: [page([element])] }, { textMeasurer: measurer });
    expect(report.issues.some((issue) => issue.code === "INVALID_ELEMENT_GEOMETRY")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "INVALID_DIALOGUE_CHARACTER")).toBe(true);
  });

  it.each(["\u0000", "\uFFFD"])("reports corrupt code units %j", (character) => {
    const element = { id: "text", type: "text", text: `안녕${character}`, x: 20, y: 20,
      width: 300, fontSize: 24, fill: "#000", rotation: 0 } as El;
    expect(inspectStudioQuality({ pages: [page([element])] }, { textMeasurer: measurer }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "INVALID_DIALOGUE_CHARACTER" })]));
  });

  it("does not allow a fractional issue limit to hide all blockers", () => {
    const report = inspectStudioQuality({ pages: [] }, { maxIssues: 0.2 });
    expect(report.canFinalize).toBe(false);
    expect(report.issues.some((issue) => issue.code === "NO_PAGES")).toBe(true);
  });

  it("invalidates review receipts after equal-length edits between old string samples", () => {
    const before = page([]);
    before.note = "a".repeat(10_000);
    const after = { ...before, note: `${before.note.slice(0, 1_000)}b${before.note.slice(1_001)}` };
    expect(computeStudioQualityRevisionKey({ pages: [before] }))
      .not.toBe(computeStudioQualityRevisionKey({ pages: [after] }));
  });
});
