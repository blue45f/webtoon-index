import { describe, expect, it, vi } from "vitest";

import { exportPageToSvg } from "./export/studio-svg-export";
import {
  describeStudioAdvancedFillVectorReferenceExclusion,
  fingerprintStudioVectorReference,
  materializeStudioAdvancedFillVectorTarget,
  planStudioAdvancedFillVectorTarget,
  prepareStudioVectorReferenceExport,
  renderPreparedStudioVectorReference,
  renderStudioAdvancedFillVectorReference,
  renderStudioVectorReference,
  StudioVectorReferenceError,
  type StudioAdvancedFillVectorTargetInput,
  type StudioVectorReferenceRasterizer,
} from "./studio-vector-fill-reference";
import { createStudioVectorReferenceSourceBudgetReceipt } from "./studio-vector-reference-source-budget-receipt";

import type { El } from "./studio-element-model";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

function draw(id: string, over: Partial<Extract<El, { type: "draw" }>> = {}): Extract<El, { type: "draw" }> {
  return {
    id,
    type: "draw",
    kind: "freehand",
    points: [10, 10, 20, 20, 30, 15],
    stroke: "#111111",
    strokeWidth: 8,
    brush: "gpen",
    pressures: [0.25, 0.7, 0.45],
    ...over,
  };
}

function input(
  elements: readonly El[],
  over: Partial<StudioAdvancedFillVectorTargetInput> = {},
): StudioAdvancedFillVectorTargetInput {
  return {
    pageId: "page-1",
    width: 720,
    height: 1_000,
    elements,
    ...over,
  };
}

function rasterizer(spy?: (svg: string) => void): StudioVectorReferenceRasterizer {
  return async (request) => {
    spy?.(request.svg);
    return {
      dataUrl: PNG_DATA_URL,
      width: request.width,
      height: request.height,
    };
  };
}

describe("planStudioAdvancedFillVectorTarget", () => {
  it("selects visible DrawEl only and inserts the materialized color below the first line-art z-index", () => {
    const elements: El[] = [
      {
        id: "caption",
        type: "text",
        text: "UI가 아닌 문서 텍스트",
        x: 0,
        y: 0,
        width: 100,
        fontSize: 20,
        fill: "#000000",
        rotation: 0,
      },
      draw("hidden", { hidden: true }),
      draw("group-hidden", { groupId: "hidden-group" }),
      draw("visible"),
      {
        id: "guide-like-effect",
        type: "focusLines",
        x: 0,
        y: 0,
        width: 720,
        height: 1_000,
        lineCount: 20,
        innerRadius: 20,
        outerRadius: 300,
        stroke: "#000000",
        strokeWidth: 2,
        noise: 0,
        rotation: 0,
      },
    ];

    const plan = planStudioAdvancedFillVectorTarget(input(elements, {
      groups: [{ id: "hidden-group", name: "숨김", hidden: true }],
    }));

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.target.sourceElementCount).toBe(1);
    expect(plan.target.insertionIndex).toBe(3);
    expect(plan.target.frame).toEqual({ x: 0, y: 0, width: 720, height: 1_000, rotation: 0 });
    expect(plan.target.blankSrc).toContain("data:image/svg+xml");
    expect(decodeURIComponent(plan.target.blankSrc)).not.toContain("<rect");

    const materialized = materializeStudioAdvancedFillVectorTarget(plan.target, PNG_DATA_URL);
    expect(materialized).toMatchObject({
      id: plan.target.id,
      type: "image",
      name: "벡터 채색",
      src: PNG_DATA_URL,
      x: 0,
      y: 0,
      width: 720,
      height: 1_000,
      rotation: 0,
    });
  });

  it("returns a stable no-content reason and elements.length insertion fallback", () => {
    const elements: El[] = [{
      id: "caption",
      type: "text",
      text: "대사",
      x: 0,
      y: 0,
      width: 100,
      fontSize: 20,
      fill: "#000000",
      rotation: 0,
    }];
    const plan = planStudioAdvancedFillVectorTarget(input(elements));
    expect(plan).toEqual({
      ok: false,
      code: "no-visible-vector-draw",
      reason: "페이지에 표시 중인 벡터 선화가 없습니다. 펜이나 도형으로 선화를 추가한 뒤 다시 시도해 주세요.",
      insertionIndex: 1,
    });
  });

  it("offers an explicit bottom-layer whole-page bucket target for a raster-free page", async () => {
    const blankInput = input([], {
      allowBlankPage: true,
      name: "페이지 채색",
    });
    const plan = planStudioAdvancedFillVectorTarget(blankInput);
    expect(plan).toMatchObject({
      ok: true,
      target: {
        sourceElementCount: 0,
        insertionIndex: 0,
        name: "페이지 채색",
      },
    });
    if (!plan.ok) return;

    const rendered = await renderStudioAdvancedFillVectorReference(blankInput, {
      workerFactory: null,
      rasterExecutionBackend: "custom",
      rasterize: rasterizer(),
    });
    expect(rendered).toMatchObject({
      elementCount: 0,
      width: 720,
      height: 1_000,
    });
  });

  it("is deterministic for the same visible source and ignores hidden/non-draw document changes", () => {
    const source = draw("line");
    const first = planStudioAdvancedFillVectorTarget(input([source]));
    const second = planStudioAdvancedFillVectorTarget(input([
      source,
      draw("hidden-change", { hidden: true, stroke: "#ff0000" }),
      {
        id: "comment-surrogate",
        type: "text",
        text: "선화 참조 아님",
        x: 20,
        y: 20,
        width: 200,
        fontSize: 16,
        fill: "#ff00ff",
        rotation: 0,
      },
    ]));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.target.sourceFingerprint).toBe(first.target.sourceFingerprint);
    expect(second.target.id).toBe(first.target.id);
  });

  it("changes the source fingerprint when visible brush geometry changes", () => {
    const first = planStudioAdvancedFillVectorTarget(input([draw("line")]));
    const second = planStudioAdvancedFillVectorTarget(input([draw("line", { strokeWidth: 9 })]));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.target.sourceFingerprint).not.toBe(first.target.sourceFingerprint);
  });

  it("fails closed when the shared SVG path cannot reproduce an eraser exactly", () => {
    const plan = planStudioAdvancedFillVectorTarget(input([
      draw("ink"),
      draw("erase", { mode: "eraser" }),
    ]));
    expect(plan).toMatchObject({ ok: false, code: "unsupported-vector-fidelity", insertionIndex: 0 });
  });

  // 아래 세 건은 "지우개 획이 있다" 와 "지우개가 화면을 바꾼다" 를 가르는 회귀다.
  // 예전에는 지우개가 하나라도 있으면 채우기 진입 자체가 막히고 "지우개 벡터 획은 선화 참조
  // 이미지에서 …" 배너가 떴다 — 잉크에 닿지도 않은 획까지 그랬다.
  it("proceeds when an eraser stroke never overlaps any ink", () => {
    const plan = planStudioAdvancedFillVectorTarget(input([
      draw("ink"),
      draw("erase-elsewhere", { mode: "eraser", points: [600, 800, 620, 820] }),
    ]));
    expect(plan.ok).toBe(true);
  });

  it("proceeds when the eraser sits below the ink it would have to erase", () => {
    // 지우개는 자기보다 먼저 그려진 것만 지운다 — 나중에 올라온 잉크는 건드리지 못한다.
    const plan = planStudioAdvancedFillVectorTarget(input([
      draw("erase-first", { mode: "eraser" }),
      draw("ink-on-top"),
    ]));
    expect(plan.ok).toBe(true);
  });

  it("reports an empty page rather than an eraser-fidelity failure when only erasers exist", () => {
    const plan = planStudioAdvancedFillVectorTarget(input([
      draw("erase-only", { mode: "eraser" }),
    ]));
    expect(plan).toMatchObject({ ok: false, code: "no-visible-vector-draw" });
  });

  it("still fails closed when one eraser is inert but another really erases ink", () => {
    const plan = planStudioAdvancedFillVectorTarget(input([
      draw("ink"),
      draw("erase-elsewhere", { mode: "eraser", points: [600, 800, 620, 820] }),
      draw("erase-the-ink", { mode: "eraser" }),
    ]));
    expect(plan).toMatchObject({ ok: false, code: "unsupported-vector-fidelity" });
  });

  it("keeps inert erasers out of the serialized source so the SVG matches the screen", async () => {
    // 참조 PNG 를 만드는 경로도 같은 필터를 지나야 한다 — 안 그러면 렌더 단계의
    // `assertSvgResult` 가 skipped 를 보고 다시 막는다.
    const svgs: string[] = [];
    await expect(
      renderStudioAdvancedFillVectorReference(
        input([
          draw("ink"),
          draw("erase-elsewhere", { mode: "eraser", points: [600, 800, 620, 820] }),
        ]),
        {
          workerFactory: null,
          rasterExecutionBackend: "custom",
          rasterize: rasterizer((svg) => svgs.push(svg)),
        },
      ),
    ).resolves.toMatchObject({ elementCount: 1 });
    expect(svgs).toHaveLength(1);
  });

  it("reports dimension and byte-budget failures before raster allocation", () => {
    expect(planStudioAdvancedFillVectorTarget(input([draw("line")], { width: 0 }))).toMatchObject({
      ok: false,
      code: "invalid-dimensions",
    });
    expect(planStudioAdvancedFillVectorTarget(input([draw("line")], {
      budgets: { maxSourceBytes: 8 },
    }))).toMatchObject({ ok: false, code: "source-budget-exceeded" });
    expect(planStudioAdvancedFillVectorTarget(input([draw("line")], {
      budgets: { maxSvgBytes: 8 },
    }))).toMatchObject({ ok: false, code: "svg-budget-exceeded" });
  });
});

// 래스터 대상에서 벡터 선화 참조는 래스터 경계 위에 얹는 **추가** 경계다. 못 만들어도
// 래스터 채우기 자체는 유효하므로, 실패는 채우기를 막을 근거가 아니라 알릴 사실이다.
describe("describeStudioAdvancedFillVectorReferenceExclusion", () => {
  it("stays silent when there was no vector line art to exclude", () => {
    const plan = planStudioAdvancedFillVectorTarget(input([]));
    expect(plan).toMatchObject({ ok: false, code: "no-visible-vector-draw" });
    if (plan.ok) return;
    expect(describeStudioAdvancedFillVectorReferenceExclusion(plan)).toBeNull();
  });

  it("names both what was dropped and the plan's own reason for every other failure", () => {
    const failures = [
      planStudioAdvancedFillVectorTarget(input([draw("ink"), draw("erase", { mode: "eraser" })])),
      planStudioAdvancedFillVectorTarget(input([draw("line")], { width: 0 })),
      planStudioAdvancedFillVectorTarget(input([draw("line")], { budgets: { maxSourceBytes: 8 } })),
      planStudioAdvancedFillVectorTarget(input([draw("line")], { budgets: { maxSvgBytes: 8 } })),
      planStudioAdvancedFillVectorTarget(input([draw("line")], { pageId: "  " })),
    ];

    for (const failure of failures) {
      expect(failure.ok).toBe(false);
      if (failure.ok) continue;
      const notice = describeStudioAdvancedFillVectorReferenceExclusion(failure);
      expect(notice).toContain("벡터 선화는 채우기 경계에서 빼고 래스터 경계만으로 계산했어요.");
      expect(notice).toContain(failure.reason);
    }
  });

  it("degrades the eraser-fidelity failure that used to abort an unrelated raster fill", () => {
    const plan = planStudioAdvancedFillVectorTarget(input([
      draw("ink"),
      draw("erase-the-ink", { mode: "eraser" }),
    ]));
    expect(plan).toMatchObject({ ok: false, code: "unsupported-vector-fidelity" });
    if (plan.ok) return;
    expect(describeStudioAdvancedFillVectorReferenceExclusion(plan)).toContain(
      "지우개 벡터 획은 선화 참조 이미지에서 원본 합성을 정확히 재현할 수 없습니다.",
    );
  });
});

describe("renderStudioAdvancedFillVectorReference", () => {
  it("passes the exact transparent shared-SVG brush serialization to the PNG rasterizer", async () => {
    const line = draw("pressure-line", {
      brush: "gpen",
      pressureModel: "linear-residual-path-v3",
      symmetry: { type: "vertical", centerX: 360, centerY: 500 },
    });
    const nonDraw: El = {
      id: "caption",
      type: "text",
      text: "참조 제외",
      x: 0,
      y: 0,
      width: 100,
      fontSize: 20,
      fill: "#000000",
      rotation: 0,
    };
    let capturedSvg = "";
    const result = await renderStudioAdvancedFillVectorReference(input([nonDraw, line]), {
      workerFactory: null,
      rasterExecutionBackend: "custom",
      rasterize: rasterizer((svg) => {
        capturedSvg = svg;
      }),
    });
    const expected = exportPageToSvg({
      width: 720,
      height: 1_000,
      elements: [line],
      transparentBg: true,
    }).svg;

    expect(capturedSvg).toBe(expected);
    expect(capturedSvg).not.toContain("참조 제외");
    expect(capturedSvg).not.toContain('<rect width="720" height="1000"');
    expect(result).toMatchObject({
      dataUrl: PNG_DATA_URL,
      elementCount: 1,
      width: 720,
      height: 1_000,
      execution: "direct",
    });
    const plan = planStudioAdvancedFillVectorTarget(input([nonDraw, line]));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(result.fingerprint).toBe(plan.target.sourceFingerprint);
  });

  it("aborts before serialization and rechecks ownership after an injected rasterizer", async () => {
    const before = new AbortController();
    before.abort();
    const neverCalled = vi.fn(rasterizer());
    await expect(renderStudioAdvancedFillVectorReference(input([draw("line")]), {
      signal: before.signal,
      workerFactory: null,
      rasterExecutionBackend: "custom",
      rasterize: neverCalled,
    })).rejects.toMatchObject({ name: "AbortError", code: "aborted" });
    expect(neverCalled).not.toHaveBeenCalled();

    const during = new AbortController();
    await expect(renderStudioAdvancedFillVectorReference(input([draw("line")]), {
      signal: during.signal,
      workerFactory: null,
      rasterExecutionBackend: "custom",
      rasterize: async (request) => {
        during.abort();
        return { dataUrl: PNG_DATA_URL, width: request.width, height: request.height };
      },
    })).rejects.toMatchObject({ name: "AbortError", code: "aborted" });
  });

  it("rejects non-PNG, wrong-size and over-budget raster outputs", async () => {
    await expect(renderStudioAdvancedFillVectorReference(input([draw("line")]), {
      workerFactory: null,
      rasterExecutionBackend: "custom",
      rasterize: async (request) => ({
        dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
        width: request.width,
        height: request.height,
      }),
    })).rejects.toMatchObject({ code: "invalid-png-output" });

    await expect(renderStudioAdvancedFillVectorReference(input([draw("line")]), {
      workerFactory: null,
      rasterExecutionBackend: "custom",
      rasterize: async () => ({ dataUrl: PNG_DATA_URL, width: 1, height: 1 }),
    })).rejects.toMatchObject({ code: "invalid-png-output" });

    await expect(renderStudioAdvancedFillVectorReference(input([draw("line")], {
      budgets: { maxPngBytes: 1 },
    }), {
      workerFactory: null,
      rasterExecutionBackend: "custom",
      rasterize: rasterizer(),
    })).rejects.toMatchObject({ code: "png-budget-exceeded" });
  });
});

describe("renderStudioVectorReference generic seam", () => {
  it("keeps the exact pressure-outline export in the prepared intermediate", async () => {
    const stroke = draw("prepared-gpen-outline");
    const exportInput = {
      width: 320,
      height: 240,
      elements: [stroke],
      transparentBg: true,
    } as const;
    const expected = exportPageToSvg(exportInput);
    const prepared = await prepareStudioVectorReferenceExport(exportInput, {
      workerFactory: null,
    });

    expect(prepared.result).toEqual(expected);
    expect(prepared.result.skipped).toEqual([]);
    expect(prepared.result.svg).toMatch(/<(?:path|image)\b/u);
  });

  it("pins one raster backend before work and never switches from Worker to browser-direct", async () => {
    const prepared = await prepareStudioVectorReferenceExport({
      width: 320,
      height: 240,
      elements: [draw("exact-raster-provider")],
    }, { workerFactory: null });
    vi.stubGlobal("Worker", undefined);
    vi.stubGlobal("createImageBitmap", undefined);
    vi.stubGlobal("document", undefined);
    try {
      await expect(renderPreparedStudioVectorReference(prepared))
        .rejects.toThrow(/Offscreen/u);
      await expect(renderPreparedStudioVectorReference(prepared, {
        rasterExecutionBackend: "browser-direct",
      })).rejects.toThrow(/브라우저/u);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rasterizes the exact prepared export without running a second serialization phase", async () => {
    const text: Extract<El, { type: "text" }> = {
      id: "prepared-title",
      type: "text",
      text: "한 번만 직렬화",
      x: 12,
      y: 18,
      width: 180,
      fontSize: 24,
      fill: "#111111",
      rotation: 0,
    };
    const prepared = await prepareStudioVectorReferenceExport({
      width: 320,
      height: 240,
      elements: [text],
      fingerprintNamespace: "prepared-vector-v1",
    }, { workerFactory: null });
    const rasterize = vi.fn(rasterizer());
    const expectedFingerprint = fingerprintStudioVectorReference(
      prepared.result.svg,
      "prepared-vector-v1",
    );
    const encode = vi.spyOn(TextEncoder.prototype, "encode");

    const result = await renderPreparedStudioVectorReference(prepared, {
      rasterExecutionBackend: "custom",
      rasterize,
    });

    expect(encode).toHaveBeenCalledOnce();
    encode.mockRestore();
    expect(rasterize).toHaveBeenCalledOnce();
    expect(rasterize.mock.calls[0]?.[0].svg).toBe(prepared.result.svg);
    expect(prepared.result.svg).toContain("한 번만 직렬화");
    expect(result.fingerprint).toBe(expectedFingerprint);
    expect(result.execution).toBe(prepared.execution);
  });

  it("falls back to canonical source bytes when nested input mutates after a receipt", async () => {
    const source = draw("receipt-mutation");
    const elements = [source];
    const maxSourceBytes = 512;
    const { receipt } = createStudioVectorReferenceSourceBudgetReceipt(
      elements,
      maxSourceBytes,
    );
    source.stroke = "x".repeat(2_048);
    await Promise.resolve();

    await expect(prepareStudioVectorReferenceExport({
      width: 320,
      height: 240,
      elements,
      budgets: { maxSourceBytes },
      sourceBudgetReceipt: receipt,
    }, { workerFactory: null })).rejects.toMatchObject({ code: "source-budget-exceeded" });
  });

  it("can abort between prepared export and rasterization without touching the rasterizer", async () => {
    const prepared = await prepareStudioVectorReferenceExport({
      width: 320,
      height: 240,
      elements: [draw("abort-between-phases")],
    }, { workerFactory: null });
    const controller = new AbortController();
    const rasterize = vi.fn(rasterizer());
    controller.abort();

    await expect(renderPreparedStudioVectorReference(prepared, {
      signal: controller.signal,
      rasterExecutionBackend: "custom",
      rasterize,
    })).rejects.toMatchObject({ name: "AbortError", code: "aborted" });
    expect(rasterize).not.toHaveBeenCalled();
  });

  it("lets later attachment-less filters select a different explicit vector subset", async () => {
    const text: Extract<El, { type: "text" }> = {
      id: "title",
      type: "text",
      text: "필터 참조",
      x: 12,
      y: 18,
      width: 180,
      fontSize: 24,
      fill: "#111111",
      rotation: 0,
    };
    let captured = "";
    const result = await renderStudioVectorReference({
      width: 320,
      height: 240,
      elements: [text],
      fingerprintNamespace: "filter-vector-v1",
    }, {
      workerFactory: null,
      rasterExecutionBackend: "custom",
      rasterize: rasterizer((svg) => {
        captured = svg;
      }),
    });
    expect(captured).toContain("필터 참조");
    expect(result.elementCount).toBe(1);
    expect(result.fingerprint).toBe(fingerprintStudioVectorReference(captured, "filter-vector-v1"));
  });

  it("can include the authored page background for an opaque merged filter copy", async () => {
    const line = draw("line");
    let captured = "";
    await renderStudioVectorReference({
      width: 320,
      height: 240,
      elements: [line],
      transparentBg: false,
      bg: "#f3e9d2",
      fingerprintNamespace: "filter-merged-copy-v1",
    }, {
      workerFactory: null,
      rasterExecutionBackend: "custom",
      rasterize: rasterizer((svg) => {
        captured = svg;
      }),
    });
    expect(captured).toContain("#f3e9d2");
    expect(captured).toContain('<rect width="320" height="240"');
  });
});

describe("materializeStudioAdvancedFillVectorTarget", () => {
  it("rejects a non-PNG fill result instead of persisting an untrusted virtual source", () => {
    const plan = planStudioAdvancedFillVectorTarget(input([draw("line")]));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(() => materializeStudioAdvancedFillVectorTarget(
      plan.target,
      "data:image/svg+xml;base64,PHN2Zy8+",
    )).toThrow(StudioVectorReferenceError);
  });
});
