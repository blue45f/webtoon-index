// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addStudioBg3dMeasurementGuide,
  classifyStudioBg3dMeasurementInference,
  createStudioBg3dMeasurementDocument,
  measureStudioBg3dWorldPoints,
  type StudioBg3dMeasurementDocument,
} from "./studio-bg3d-measurement";
import { StudioBg3dMeasurementPanel } from "./StudioBg3dMeasurementPanel";

afterEach(cleanup);

function draft() {
  const result = measureStudioBg3dWorldPoints([0, 0, 0], [3, 4, 0]);
  if (!result.ok) throw new Error(result.message);
  return result.measurement;
}

function inference() {
  const result = classifyStudioBg3dMeasurementInference({
    startWorld: [0, 0, 0],
    endWorld: [3, 4, 0],
  });
  if (!result.ok) throw new Error(result.message);
  return result;
}

function withGuide(): StudioBg3dMeasurementDocument {
  const result = addStudioBg3dMeasurementGuide(
    createStudioBg3dMeasurementDocument("cm"),
    {
      startWorld: [0, 0, 0],
      endWorld: [0, 2.5, 0],
      lockedLengthMeters: 2.5,
    },
  );
  if (!result.ok) throw new Error(result.message);
  return result.document;
}

function renderPanel(overrides: Partial<
  Parameters<typeof StudioBg3dMeasurementPanel>[0]
> = {}) {
  const props = {
    document: createStudioBg3dMeasurementDocument("cm"),
    draftMeasurement: draft(),
    inference: inference(),
    lockedLengthMeters: null,
    onDocumentChange: vi.fn(),
    onLengthLockChange: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<StudioBg3dMeasurementPanel {...props} />) };
}

describe("StudioBg3dMeasurementPanel", () => {
  it("shows the live distance, XYZ deltas, midpoint, inference, unit choices, and budget", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "줄자 · 추론 가이드" })).toBeTruthy();
    expect(screen.getByLabelText("현재 측정 거리").textContent).toBe("500 cm");
    expect(screen.getByText("Δx")).toBeTruthy();
    expect(screen.getByText("+300 cm")).toBeTruthy();
    expect(screen.getByText("+400 cm")).toBeTruthy();
    expect(screen.getByText("자유 방향")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "cm" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("0/256")).toBeTruthy();
  });

  it("teaches the two-point interaction when no draft is active", () => {
    renderPanel({ draftMeasurement: null, inference: null });
    expect(screen.getByText("뷰포트에서 시작점과 끝점을 찍어 주세요.")).toBeTruthy();
    expect(screen.getByRole("button", {
      name: "현재 측정을 영구 가이드로 고정",
    }).hasAttribute("disabled")).toBe(true);
  });

  it("changes unit through the canonical document helper", () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "mm" }));
    expect(props.onDocumentChange).toHaveBeenCalledOnce();
    expect(props.onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({
      unit: "mm",
      guides: [],
    }));
  });

  it("enables the length lock from the current distance and converts edited display units", () => {
    const { props, rerender } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "길이 잠금" }));
    expect(props.onLengthLockChange).toHaveBeenCalledWith(5);

    rerender(<StudioBg3dMeasurementPanel {...props} lockedLengthMeters={1.25} />);
    const input = screen.getByRole("spinbutton", { name: "잠금 길이" });
    expect((input as HTMLInputElement).value).toBe("125");
    fireEvent.change(input, { target: { value: "250" } });
    expect(props.onLengthLockChange).toHaveBeenLastCalledWith(2.5);
  });

  it("creates a stable persistent guide directly from the current measurement", () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole("button", {
      name: "현재 측정을 영구 가이드로 고정",
    }));
    expect(props.onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({
      guides: [
        expect.objectContaining({
          id: "measure-guide-0001",
          startWorld: [0, 0, 0],
          endWorld: [3, 4, 0],
        }),
      ],
    }));
    expect(screen.getByLabelText("측정 가이드 알림").textContent).toContain("500 cm");
  });

  it("lists, hides, and deletes a persisted guide with direct accessible actions", () => {
    const document = withGuide();
    const { props } = renderPanel({ document, draftMeasurement: null });
    expect(screen.getByText("250 cm")).toBeTruthy();
    expect(screen.getByText("가이드 01 · 길이 잠금")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "250 cm 가이드 숨기기" }));
    expect(props.onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({
      guides: [expect.objectContaining({ visible: false })],
    }));

    fireEvent.click(screen.getByRole("button", { name: "250 cm 가이드 삭제" }));
    expect(props.onDocumentChange).toHaveBeenLastCalledWith(expect.objectContaining({
      guides: [],
    }));
    expect(screen.getByLabelText("측정 가이드 알림").textContent).toContain("삭제했습니다");
  });

  it("disables every modifying control when the host scene is not editable", () => {
    renderPanel({ document: withGuide(), disabled: true });
    expect(screen.getByRole("radio", { name: "mm" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "길이 잠금" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "250 cm 가이드 숨기기" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "250 cm 가이드 삭제" }).hasAttribute("disabled")).toBe(true);
  });
});
