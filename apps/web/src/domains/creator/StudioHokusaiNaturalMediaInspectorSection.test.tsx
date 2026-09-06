// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
  STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
} from "./render/studio-hokusai-natural-media-worker-protocol";
import {
  StudioHokusaiNaturalMediaInspectorSection,
} from "./StudioHokusaiNaturalMediaInspectorSection";

import type {
  StudioHokusaiMaterialProfileId,
  StudioHokusaiNaturalMediaPresetId,
} from "./render/studio-hokusai-natural-media-contract";
import type { StudioHokusaiNaturalMediaProductResult } from "./render/studio-hokusai-natural-media-product";
import type { DrawEl } from "./studio-element-model";

const probeProduct = vi.fn(async () => ({
  available: true as const,
  message: "Hokusai WASM 준비 완료",
  runtime: {
    engine: "reearth-hokusai" as const,
    version: "0.3.0" as const,
    adapterVersion: STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
    wasm: true as const,
    dedicatedWorker: true as const,
    transparentRgba: true as const,
    dirtyTiles: true as const,
    packedDirtyFrame: true as const,
    mainThreadFallback: false as const,
  },
}));
const generateProduct = vi.fn();

vi.mock("./render/studio-hokusai-natural-media-product", () => ({
  probeStudioHokusaiNaturalMediaProduct: probeProduct,
  generateStudioHokusaiNaturalMediaProduct: generateProduct,
}));

const selected: DrawEl = {
  id: "draw-1",
  type: "draw",
  points: [10, 10, 20, 20, 30, 15],
  pressures: [0.2, 0.5, 1],
  stroke: "#102030",
  strokeWidth: 6,
  brush: "gpen",
};

beforeEach(() => {
  probeProduct.mockClear();
  generateProduct.mockReset();
});

afterEach(cleanup);

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}> {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T): void {
      if (!resolvePromise) throw new Error("Deferred promise is unavailable.");
      resolvePromise(value);
    },
  };
}

function productResult(
  presetId: StudioHokusaiNaturalMediaPresetId = "pencil",
  materialProfileId: StudioHokusaiMaterialProfileId = "pencil",
): StudioHokusaiNaturalMediaProductResult {
  return {
    src: "data:image/png;base64,iVBORw0KGgo=",
    rasterWidth: 32,
    rasterHeight: 24,
    logicalBounds: { x: 8, y: 8, width: 24, height: 18 },
    sourceElementId: selected.id,
    sourceRevision: "hokusai-source-v1:0123456789abcdef",
    name: "Hokusai 연필",
    message: "Hokusai 자연매체 변환 완료",
    receipt: {
      kind: "studio-hokusai/receipt",
      version: STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
      requestId: 1,
      engineEpoch: 1,
      sourceElementId: selected.id,
      presetId,
      materialProfileId,
      seed: 0x48_4f_4b_55,
      rasterWidth: 32,
      rasterHeight: 24,
      outputRasterWidth: 32,
      outputRasterHeight: 24,
      dirtyBounds: [0, 0, 32, 24],
      pixelLayout: "packed-dirty-rgba8",
      inputHash: `sha256:${"1".repeat(64)}`,
      pixelHash: `sha256:${"2".repeat(64)}`,
      pngHash: `sha256:${"3".repeat(64)}`,
      adapterVersion: STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
      execution: "dedicated-worker-wasm-packed-dirty-frame",
      complete: true,
    },
  };
}

function openSection(container: HTMLElement): void {
  const details = container.querySelector("details");
  if (!(details instanceof HTMLDetailsElement)) {
    throw new Error("Hokusai details section was not rendered.");
  }
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

function selectPreset(
  container: HTMLElement,
  presetId: StudioHokusaiNaturalMediaPresetId,
): void {
  const input = container.querySelector<HTMLInputElement>(
    `input[name="studio-hokusai-preset"][value="${presetId}"]`,
  );
  if (!input) throw new Error(`Missing Hokusai preset radio: ${presetId}`);
  fireEvent.click(input);
}

describe("Studio Hokusai natural-media inspector", () => {
  it("explains non-destructive conversion and exposes all five media presets", () => {
    const { container } = render(
      <StudioHokusaiNaturalMediaInspectorSection
        selected={selected}
        currentColor="#102030"
        documentWidth={800}
        documentHeight={1_200}
        pageId="page-1"
        masterEditMode={false}
        disabled={false}
        disabledReason={null}
        onReplace={vi.fn(() => true)}
      />,
    );

    openSection(container);
    expect(screen.getByText("Hokusai 자연매체 · 실험적")).not.toBeNull();
    expect(screen.getByText(/기본 연필·목탄·오일 브러시에는 자동 적용되지 않습니다/u))
      .not.toBeNull();
    expect(screen.getByText(/원본 벡터는 숨김 보존/u)).not.toBeNull();
    for (const label of ["연필", "목탄", "오일", "캘리그래피", "마커"]) {
      expect(screen.getByRole("radio", {
        name: new RegExp(`^${label}`, "u"),
      })).not.toBeNull();
    }
    expect(screen.queryByRole("group", { name: "재질 결" })).toBeNull();
    const action = screen.getByRole("button", {
      name: "선택 획을 자연매체로 변환",
    });
    expect((action as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows only carrier-compatible material profiles with an accessible touch target", async () => {
    const { container } = render(
      <StudioHokusaiNaturalMediaInspectorSection
        selected={selected}
        currentColor="#102030"
        documentWidth={800}
        documentHeight={1_200}
        pageId="page-1"
        masterEditMode={false}
        disabled={false}
        disabledReason={null}
        onReplace={vi.fn(() => true)}
      />,
    );
    openSection(container);
    await waitFor(() => {
      expect(screen.getByText("사용 가능")).not.toBeNull();
    });

    selectPreset(container, "charcoal");
    let group = screen.getByRole("group", { name: "재질 결" });
    const charcoalProfiles = within(group).getAllByRole("radio");
    expect(charcoalProfiles).toHaveLength(5);
    for (const label of [
      "목탄 · 거친 탄가루",
      "초크 · 분필 미네랄 결",
      "크레용 · 왁스 긁힘 결",
      "파스텔 · 분말·종이 비침",
      "오일파스텔 · 유막 위 왁스",
    ]) {
      expect(within(group).getByRole("radio", {
        name: label,
      })).not.toBeNull();
    }
    const charcoal = within(group).getByRole("radio", {
      name: "목탄 · 거친 탄가루",
    }) as HTMLInputElement;
    expect(charcoal.checked).toBe(true);
    expect(charcoal.closest("label")?.className).toContain("min-h-11");
    const hintId = group.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId ?? "")?.textContent).toContain(
      "표면의 입자와 도막",
    );

    fireEvent.click(within(group).getByRole("radio", {
      name: "파스텔 · 분말·종이 비침",
    }));
    expect((within(group).getByRole("radio", {
      name: "파스텔 · 분말·종이 비침",
    }) as HTMLInputElement).checked)
      .toBe(true);

    selectPreset(container, "oil");
    group = screen.getByRole("group", { name: "재질 결" });
    expect(within(group).getAllByRole("radio")).toHaveLength(4);
    expect((within(group).getByRole("radio", {
      name: "유화 · 유화 필름",
    }) as HTMLInputElement).checked).toBe(true);
    expect(within(group).queryByRole("radio", {
      name: "파스텔 · 분말·종이 비침",
    })).toBeNull();

    selectPreset(container, "marker");
    expect(screen.queryByRole("group", { name: "재질 결" })).toBeNull();

    selectPreset(container, "charcoal");
    group = screen.getByRole("group", { name: "재질 결" });
    expect((within(group).getByRole("radio", {
      name: "목탄 · 거친 탄가루",
    }) as HTMLInputElement).checked).toBe(true);
  });

  it("passes the explicitly selected material profile into the generation request", async () => {
    generateProduct.mockResolvedValueOnce(productResult("charcoal", "chalk"));
    const onReplace = vi.fn(() => true);
    const { container } = render(
      <StudioHokusaiNaturalMediaInspectorSection
        selected={selected}
        currentColor="#102030"
        documentWidth={800}
        documentHeight={1_200}
        pageId="page-1"
        masterEditMode={false}
        disabled={false}
        disabledReason={null}
        onReplace={onReplace}
      />,
    );
    openSection(container);
    await waitFor(() => {
      expect(screen.getByText("사용 가능")).not.toBeNull();
    });

    selectPreset(container, "charcoal");
    const group = screen.getByRole("group", { name: "재질 결" });
    fireEvent.click(within(group).getByRole("radio", {
      name: "초크 · 분필 미네랄 결",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "선택 획을 자연매체로 변환",
    }));

    await waitFor(() => expect(generateProduct).toHaveBeenCalledOnce());
    expect(generateProduct).toHaveBeenCalledWith(
      selected,
      expect.objectContaining({
        presetId: "charcoal",
        materialProfileId: "chalk",
      }),
      expect.objectContaining({
        documentWidth: 800,
        documentHeight: 1_200,
      }),
    );
    await waitFor(() => {
      expect(onReplace).toHaveBeenCalledOnce();
      expect(screen.getByText("Hokusai 자연매체 변환 완료")).not.toBeNull();
    });
  });

  it("offers a direct route into stroke selection when no completed freehand vector is selected", () => {
    const onRequestSelectStroke = vi.fn();
    const { container } = render(
      <StudioHokusaiNaturalMediaInspectorSection
        selected={null}
        currentColor="#102030"
        documentWidth={800}
        documentHeight={1_200}
        pageId="page-1"
        masterEditMode={false}
        disabled={false}
        disabledReason={null}
        onRequestSelectStroke={onRequestSelectStroke}
        onReplace={vi.fn(() => true)}
      />,
    );
    openSection(container);
    expect(screen.getByText(/자유곡선 선화를 먼저 선택/u)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "선화 선택하기" }));
    expect(onRequestSelectStroke).toHaveBeenCalledOnce();
    const action = screen.getByRole("button", {
      name: "선택 획을 자연매체로 변환",
    });
    expect((action as HTMLButtonElement).disabled).toBe(true);
  });

  it("starts from the selected stroke pigment and opacity without overwriting same-selection edits", async () => {
    const firstSelection: DrawEl = {
      ...selected,
      stroke: "#123456",
      opacity: 0.42,
    };
    const { container, rerender } = render(
      <StudioHokusaiNaturalMediaInspectorSection
        selected={firstSelection}
        currentColor="#abcdef"
        documentWidth={800}
        documentHeight={1_200}
        pageId="page-1"
        masterEditMode={false}
        disabled={false}
        disabledReason={null}
        onReplace={vi.fn(() => true)}
      />,
    );
    openSection(container);
    await waitFor(() => {
      expect(screen.getByText("사용 가능")).not.toBeNull();
    });
    const colorInput = screen.getByRole("textbox", {
      name: "Hokusai 안료 색상 코드",
    }) as HTMLInputElement;
    const opacityInput = screen.getByRole("slider", {
      name: /안료 불투명도/u,
    }) as HTMLInputElement;
    expect(colorInput.value).toBe("#123456");
    expect(opacityInput.value).toBe("0.42");

    fireEvent.change(colorInput, { target: { value: "#fedcba" } });
    fireEvent.change(opacityInput, { target: { value: "0.73" } });
    rerender(
      <StudioHokusaiNaturalMediaInspectorSection
        selected={{ ...firstSelection, points: [...firstSelection.points, 44, 28] }}
        currentColor="#654321"
        documentWidth={800}
        documentHeight={1_200}
        pageId="page-1"
        masterEditMode={false}
        disabled={false}
        disabledReason={null}
        onReplace={vi.fn(() => true)}
      />,
    );
    expect(colorInput.value).toBe("#fedcba");
    expect(opacityInput.value).toBe("0.73");

    rerender(
      <StudioHokusaiNaturalMediaInspectorSection
        selected={{
          ...firstSelection,
          id: "draw-2",
          stroke: "#334455",
          opacity: 0.31,
        }}
        currentColor="#654321"
        documentWidth={800}
        documentHeight={1_200}
        pageId="page-1"
        masterEditMode={false}
        disabled={false}
        disabledReason={null}
        onReplace={vi.fn(() => true)}
      />,
    );
    await waitFor(() => {
      expect(colorInput.value).toBe("#334455");
      expect(opacityInput.value).toBe("0.31");
    });
  });

  it("uses the latest document transaction and rejects a stale source revision", async () => {
    const pending = deferred<StudioHokusaiNaturalMediaProductResult>();
    generateProduct.mockReturnValueOnce(pending.promise);
    const staleReplace = vi.fn(() => true);
    const latestReplace = vi.fn(() => false);
    const { container, rerender } = render(
      <StudioHokusaiNaturalMediaInspectorSection
        selected={selected}
        currentColor="#102030"
        documentWidth={800}
        documentHeight={1_200}
        pageId="page-1"
        masterEditMode={false}
        disabled={false}
        disabledReason={null}
        onReplace={staleReplace}
      />,
    );
    openSection(container);
    await waitFor(() => {
      expect(screen.getByText("사용 가능")).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("button", {
      name: "선택 획을 자연매체로 변환",
    }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "취소" })).not.toBeNull();
    });

    rerender(
      <StudioHokusaiNaturalMediaInspectorSection
        selected={{
          ...selected,
          // Same identity, newer geometry: StudioPage's latest closure owns
          // the source-revision comparison and must reject the old receipt.
          points: [...selected.points, 40, 24],
        }}
        currentColor="#102030"
        documentWidth={800}
        documentHeight={1_200}
        pageId="page-1"
        masterEditMode={false}
        disabled={false}
        disabledReason={null}
        onReplace={latestReplace}
      />,
    );
    await act(async () => pending.resolve(productResult()));

    await waitFor(() => {
      expect(screen.getByText(/선택 획이 변경되어/u)).not.toBeNull();
    });
    expect(staleReplace).not.toHaveBeenCalled();
    expect(latestReplace).toHaveBeenCalledOnce();
  });
});
