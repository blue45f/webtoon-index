import { describe, expect, it, vi } from "vitest";

import { renderStudioVectorReference } from "../studio-vector-fill-reference";

import { planStudioLayerMergeSelected } from "./studio-layer-merge";
import {
  applyStudioDocumentMergeBake,
  isStudioDocumentMergeBakePlanCurrent,
  materializeStudioDocumentMergeBake,
  planStudioDocumentMergeBake,
  renderStudioDocumentMergeBake,
} from "./studio-layer-merge-document-bake";

import type { El } from "../studio-element-model";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function line(id: string, mode?: "eraser"): Extract<El, { type: "draw" }> {
  return {
    id,
    type: "draw",
    kind: "freehand",
    points: [10, 10, 40, 40],
    stroke: "#111111",
    strokeWidth: 4,
    brush: "gpen",
    mode,
  };
}

function caption(id: string): Extract<El, { type: "text" }> {
  return {
    id,
    type: "text",
    text: "효과음",
    x: 50,
    y: 60,
    width: 120,
    fontSize: 30,
    fill: "#111111",
    rotation: 0,
  };
}

function mergeInput(elements: readonly El[]) {
  const planned = planStudioLayerMergeSelected({
    items: elements,
    selectedIds: elements.map((element) => element.id),
  });
  expect(planned.ok).toBe(true);
  if (!planned.ok) throw new Error(planned.reason);
  return {
    plan: planned.plan,
    pageId: "page-1",
    width: 320,
    height: 480,
    elements,
  } as const;
}

describe("mixed document layer merge bake", () => {
  it("bakes vector/text mixtures into one exact ImageEl instead of grouping", async () => {
    const elements: El[] = [line("ink"), caption("sfx")];
    const input = mergeInput(elements);
    const planned = planStudioDocumentMergeBake(input);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const rasterize = vi.fn(async (request: { svg: string; width: number; height: number }) => ({
      dataUrl: PNG,
      width: request.width,
      height: request.height,
    }));
    const rendered = await renderStudioDocumentMergeBake(
      planned.plan,
      renderStudioVectorReference,
      {
        workerFactory: null,
        rasterExecutionBackend: "custom",
        rasterize,
      },
    );
    expect(rasterize.mock.calls[0]?.[0].svg).toContain("효과음");
    const composite = materializeStudioDocumentMergeBake({
      plan: planned.plan,
      rendered,
      newId: "merged",
    });
    expect(composite).toMatchObject({
      id: "merged",
      type: "image",
      x: 0,
      y: 0,
      width: 320,
      height: 480,
    });
    expect(applyStudioDocumentMergeBake(elements, planned.plan, composite).map((item) => item.id)).toEqual([
      "merged",
    ]);
  });

  it("fails closed instead of silently dropping eraser fidelity", () => {
    expect(planStudioDocumentMergeBake(mergeInput([
      line("ink"),
      line("erase", "eraser"),
    ]))).toMatchObject({ ok: false, code: "unsupported-fidelity" });
  });

  it("rejects missing, duplicated and hidden source ownership", () => {
    const elements: El[] = [line("a"), line("b")];
    const input = mergeInput(elements);
    expect(planStudioDocumentMergeBake({
      ...input,
      elements: [elements[0]!],
    })).toMatchObject({ ok: false, code: "invalid-merge-plan" });
    expect(planStudioDocumentMergeBake({
      ...input,
      plan: {
        ...input.plan,
        sources: [input.plan.sources[0]!, input.plan.sources[0]!],
      },
    })).toMatchObject({ ok: false, code: "invalid-merge-plan" });
    expect(planStudioDocumentMergeBake({
      ...input,
      elements: [elements[0]!, { ...elements[1]!, hidden: true }],
    })).toMatchObject({ ok: false, code: "source-selection-mismatch" });
  });

  it("rechecks the same merge/source plan after async work", () => {
    const elements: El[] = [line("a"), line("b")];
    const input = mergeInput(elements);
    const result = planStudioDocumentMergeBake(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isStudioDocumentMergeBakePlanCurrent(result.plan, input)).toBe(true);
    expect(isStudioDocumentMergeBakePlanCurrent(result.plan, {
      ...input,
      elements: [line("a"), { ...line("b"), strokeWidth: 9 }],
    })).toBe(false);
  });
});
