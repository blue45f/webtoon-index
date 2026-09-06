// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_COLOR_VISION_COACH_GRAYSCALE_SATURATION,
  STUDIO_COLOR_VISION_COACH_MATRIX,
} from "./studio-color-vision-coach";
import {
  STUDIO_CVD_GRAYSCALE_SATURATION,
  STUDIO_CVD_MATRIX,
} from "./studio-color-vision-model";
import {
  StudioColorBlindFilterDefs,
  colorBlindFilterStyle,
  type CvdMode,
} from "./StudioColorBlindPreview";
import { StudioColorBlindPreviewToggle } from "./StudioColorBlindPreviewToggle";

afterEach(cleanup);

describe("colorBlindFilterStyle", () => {
  it("returns no filter for none", () => {
    expect(colorBlindFilterStyle("none")).toEqual({});
  });

  it("routes grayscale through the same SVG filter pipeline as its coach", () => {
    expect(colorBlindFilterStyle("grayscale")).toEqual({ filter: "url(#cvd-grayscale)" });
  });

  it("still routes the 3 CVD modes through the SVG feColorMatrix defs by id", () => {
    expect(colorBlindFilterStyle("protanopia")).toEqual({ filter: "url(#cvd-protanopia)" });
    expect(colorBlindFilterStyle("deuteranopia")).toEqual({ filter: "url(#cvd-deuteranopia)" });
    expect(colorBlindFilterStyle("tritanopia")).toEqual({ filter: "url(#cvd-tritanopia)" });
  });

  it("uses the shared linear-RGB matrices in the live canvas filter defs", () => {
    const html = renderToStaticMarkup(createElement(StudioColorBlindFilterDefs));

    expect(html).toContain('color-interpolation-filters="linearRGB"');
    expect(html).toContain('id="cvd-grayscale"');
    expect(html).toContain(
      `type="saturate" values="${STUDIO_CVD_GRAYSCALE_SATURATION}"`
    );
    for (const mode of ["protanopia", "deuteranopia", "tritanopia"] as const) {
      expect(html).toContain(`id="cvd-${mode}"`);
      expect(html).toContain(`values="${STUDIO_CVD_MATRIX[mode]}"`);
    }
  });

  it("keeps the lazy motion coach numerically identical to the live canvas filters", () => {
    expect(STUDIO_COLOR_VISION_COACH_GRAYSCALE_SATURATION).toBe(
      STUDIO_CVD_GRAYSCALE_SATURATION
    );
    expect(STUDIO_COLOR_VISION_COACH_MATRIX).toEqual(STUDIO_CVD_MATRIX);
  });

  it("renders one keyboard-roving radio group with exact accessible names and no native titles", () => {
    const { container } = render(createElement(StudioColorBlindPreviewToggle, {
      value: "deuteranopia",
      onChange: vi.fn(),
    }));
    const group = screen.getByRole("radiogroup", { name: "흑백·색각 시뮬레이션 미리보기" });
    const radios = within(group).getAllByRole("radio");

    expect(radios).toHaveLength(5);
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "색각 미리보기 끄기 · 원본 색상",
      "흑백 명암 미리보기",
      "1형 적록 색각 시뮬레이션",
      "2형 적록 색각 시뮬레이션",
      "3형 청황 색각 시뮬레이션 · 근사치",
    ]);
    expect(radios.filter((radio) => radio.getAttribute("aria-checked") === "true")).toEqual([
      radios[3],
    ]);
    expect(radios.filter((radio) => radio.getAttribute("tabindex") === "0")).toEqual([
      radios[3],
    ]);
    expect(container.querySelector("[title]")).toBeNull();
    expect(radios.every((radio) => radio.className.includes("pointer-coarse:h-11"))).toBe(true);
    expect(radios.every((radio) => radio.className.includes("pointer-coarse:min-w-11"))).toBe(true);
  });

  it("routes every click and arrow-key selection to its exact CVD mode", () => {
    const onChange = vi.fn<(mode: CvdMode) => void>();
    render(createElement(StudioColorBlindPreviewToggle, { value: "none", onChange }));
    const group = screen.getByRole("radiogroup");
    const radios = within(group).getAllByRole("radio");

    radios.forEach((radio) => fireEvent.click(radio));
    expect(onChange.mock.calls.map(([mode]) => mode)).toEqual([
      "none",
      "grayscale",
      "protanopia",
      "deuteranopia",
      "tritanopia",
    ]);

    onChange.mockClear();
    radios[0]?.focus();
    fireEvent.keyDown(radios[0]!, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("tritanopia");
    expect(document.activeElement).toBe(radios[4]);
    fireEvent.keyDown(radios[4]!, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("none");
    expect(document.activeElement).toBe(radios[0]);
  });

  it("opens only the focused mode's exact rich preview", async () => {
    render(createElement(StudioColorBlindPreviewToggle, {
      value: "none",
      onChange: vi.fn(),
    }));

    screen.getByRole("radio", { name: "색각 미리보기 끄기 · 원본 색상" }).focus();
    await waitFor(() => {
      expect(screen.getAllByRole("tooltip")).toHaveLength(1);
      expect(document.querySelector('[data-preview-operation="color-vision-original"]')).not.toBeNull();
    });

    screen.getByRole("radio", { name: "흑백 명암 미리보기" }).focus();
    await waitFor(() => {
      expect(screen.getAllByRole("tooltip")).toHaveLength(1);
      expect(document.querySelector('[data-preview-operation="color-vision-grayscale"]')).not.toBeNull();
      expect(document.querySelector('[data-preview-operation="color-vision-original"]')).toBeNull();
    });
  });

  it("does not let an older lazy color preview reclaim the exclusive tooltip lane", async () => {
    render(createElement(StudioColorBlindPreviewToggle, {
      value: "none",
      onChange: vi.fn(),
    }));

    const original = screen.getByRole("radio", {
      name: "색각 미리보기 끄기 · 원본 색상",
    });
    const tritanopia = screen.getByRole("radio", {
      name: "3형 청황 색각 시뮬레이션 · 근사치",
    });

    original.focus();
    tritanopia.focus();

    await waitFor(() => {
      expect(screen.getAllByRole("tooltip")).toHaveLength(1);
      expect(
        document.querySelector('[data-preview-operation="color-vision-tritanopia"]')
      ).not.toBeNull();
      expect(
        document.querySelector('[data-preview-operation="color-vision-original"]')
      ).toBeNull();
    });
  });
});
