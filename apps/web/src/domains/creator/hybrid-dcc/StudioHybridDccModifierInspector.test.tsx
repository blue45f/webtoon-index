// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioHybridDccModifierInspector,
  type StudioHybridDccModifierInspectorProps,
  type StudioHybridDccModifierView,
} from "./StudioHybridDccModifierInspector";

afterEach(cleanup);

const MIRROR: StudioHybridDccModifierView = {
  id: "mirror-1",
  kind: "mirror",
  enabled: true,
  axis: "x",
  merge: true,
  mergeThreshold: 0.0001,
  bisect: false,
  clip: true,
};

const ARRAY: StudioHybridDccModifierView = {
  id: "array-1",
  kind: "array",
  enabled: true,
  count: 3,
  offset: { x: 1.5, y: 0, z: 0 },
  mode: "radial",
  radialAngleRad: Math.PI * 2,
  realizeInstances: false,
};

const BOOLEAN: StudioHybridDccModifierView = {
  id: "boolean-1",
  kind: "boolean",
  enabled: false,
  operation: "difference",
  operandId: "door-cutter",
  operandOptions: [
    { id: "door-cutter", label: "문틀 커터" },
    {
      id: "very-long-cutter",
      label: "아주 긴 이름을 가진 배경 오브젝트 커터가 좁은 인스펙터에서도 잘리지 않아야 합니다",
    },
  ],
};

const SOLIDIFY: StudioHybridDccModifierView = {
  id: "solidify-1",
  kind: "solidify",
  enabled: true,
  thickness: 0.08,
  evenThickness: true,
  rim: true,
};

const BEVEL: StudioHybridDccModifierView = {
  id: "bevel-1",
  kind: "bevel",
  enabled: true,
  amount: 0.04,
  segments: 3,
  angleLimitRad: Math.PI / 6,
  weightInfluence: 0.25,
};

function renderInspector(
  overrides: Partial<StudioHybridDccModifierInspectorProps> = {},
) {
  const props: StudioHybridDccModifierInspectorProps = {
    stack: { modifiers: [] },
    busy: false,
    error: null,
    onAdd: vi.fn(),
    onToggle: vi.fn(),
    onMove: vi.fn(),
    onRemove: vi.fn(),
    onPatch: vi.fn(),
    onApply: vi.fn(),
    ...overrides,
  };
  return { props, view: render(<StudioHybridDccModifierInspector {...props} />) };
}

describe("StudioHybridDccModifierInspector", () => {
  it("teaches the empty state and offers all five modifiers without pretending to alter the source", () => {
    const { props } = renderInspector();
    const inspector = document.querySelector(
      '[data-studio-hybrid-dcc-modifier-inspector="true"]',
    );
    const kindSelect = screen.getByRole("combobox", { name: "추가할 변형 종류" });
    const apply = screen.getByRole("button", { name: "적용해 원본 메시로 확정" });

    expect(inspector?.getAttribute("aria-busy")).toBe("false");
    expect(inspector?.className).toContain("max-w-full");
    expect(inspector?.className).toContain("overflow-hidden");
    expect(screen.getByText("아직 쌓인 변형이 없습니다")).toBeTruthy();
    expect(screen.getByText(/적용하기 전에는 원본 메시를 바꾸지 않습니다/u)).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(9);
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect(apply.getAttribute("aria-describedby")).toBeTruthy();

    fireEvent.change(kindSelect, { target: { value: "boolean" } });
    fireEvent.click(screen.getByRole("button", { name: "변형 추가" }));

    expect(props.onAdd).toHaveBeenCalledWith("boolean");
  });

  it("keeps enable, reorder, and delete controls explicit, touch-sized, and boundary-safe", () => {
    const { props } = renderInspector({
      stack: { modifiers: [MIRROR, ARRAY] },
    });
    const mirrorSwitch = screen.getByRole("switch", {
      name: "1단계 대칭 복사",
    });
    const mirrorUp = screen.getByRole("button", { name: "1단계 대칭 복사 위로 이동" });
    const mirrorDown = screen.getByRole("button", { name: "1단계 대칭 복사 아래로 이동" });
    const arrayDown = screen.getByRole("button", { name: "2단계 반복 배열 아래로 이동" });
    const arrayUp = screen.getByRole("button", { name: "2단계 반복 배열 위로 이동" });
    const removeArray = screen.getByRole("button", { name: "2단계 반복 배열 삭제" });

    expect(mirrorSwitch.getAttribute("aria-checked")).toBe("true");
    expect(mirrorSwitch.className).toContain("min-h-11");
    expect(mirrorUp.className).toContain("min-h-11");
    expect((mirrorUp as HTMLButtonElement).disabled).toBe(true);
    expect((arrayDown as HTMLButtonElement).disabled).toBe(true);
    expect((mirrorDown as HTMLButtonElement).disabled).toBe(false);
    expect((arrayUp as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(mirrorSwitch);
    fireEvent.click(mirrorDown);
    fireEvent.click(arrayUp);
    fireEvent.click(removeArray);

    expect(props.onToggle).toHaveBeenCalledWith("mirror-1");
    expect(props.onMove).toHaveBeenNthCalledWith(1, "mirror-1", "down");
    expect(props.onMove).toHaveBeenNthCalledWith(2, "array-1", "up");
    expect(props.onRemove).toHaveBeenCalledWith("array-1");
  });

  it("emits engine-neutral patches for the core parameters of every modifier kind", () => {
    const { props } = renderInspector({
      stack: { modifiers: [MIRROR, ARRAY, BOOLEAN, SOLIDIFY, BEVEL] },
    });

    fireEvent.change(screen.getByRole("combobox", { name: "1단계 대칭 복사 기준 축" }), {
      target: { value: "z" },
    });
    fireEvent.click(screen.getByRole("switch", {
      name: "1단계 대칭 복사 가운데 점 합치기",
    }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "2단계 반복 배열 전체 개수" }), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "2단계 반복 배열 간격 X" }), {
      target: { value: "2.25" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "2단계 반복 배열 원형 전체 각도" }), {
      target: { value: "180" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "3단계 형태 합치기·빼기 계산 방식" }), {
      target: { value: "union" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "3단계 형태 합치기·빼기 대상 오브젝트" }), {
      target: { value: "very-long-cutter" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "4단계 두께 만들기 두께" }), {
      target: { value: "0.12" },
    });
    fireEvent.click(screen.getByRole("switch", {
      name: "4단계 두께 만들기 열린 가장자리 막기",
    }));
    const bevelSegments = screen.getByRole("spinbutton", {
      name: "5단계 모서리 다듬기 분할 수",
    }) as HTMLInputElement;
    fireEvent.change(screen.getByRole("spinbutton", { name: "5단계 모서리 다듬기 적용 각도" }), {
      target: { value: "45" },
    });

    expect(props.onPatch).toHaveBeenCalledWith("mirror-1", { axis: "z" });
    expect(props.onPatch).toHaveBeenCalledWith("mirror-1", { merge: false });
    expect(props.onPatch).toHaveBeenCalledWith("array-1", { count: 7 });
    expect(props.onPatch).toHaveBeenCalledWith("array-1", {
      offset: { x: 2.25, y: 0, z: 0 },
    });
    expect(props.onPatch).toHaveBeenCalledWith("array-1", {
      radialAngleRad: Math.PI,
    });
    expect(props.onPatch).toHaveBeenCalledWith("boolean-1", { operation: "union" });
    expect(props.onPatch).toHaveBeenCalledWith("boolean-1", {
      operandId: "very-long-cutter",
    });
    expect(props.onPatch).toHaveBeenCalledWith("solidify-1", { thickness: 0.12 });
    expect(props.onPatch).toHaveBeenCalledWith("solidify-1", { rim: false });
    expect(bevelSegments.min).toBe("1");
    expect(bevelSegments.max).toBe("1");
    expect(bevelSegments.disabled).toBe(true);
    expect(props.onPatch).not.toHaveBeenCalledWith("bevel-1", expect.objectContaining({
      segments: expect.anything(),
    }));
    expect(props.onPatch).toHaveBeenCalledWith("bevel-1", {
      angleLimitRad: Math.PI / 4,
    });
  });

  it("preserves visible settings, announces busy work, and blocks every repeated mutation", () => {
    const { props } = renderInspector({
      busy: true,
      stack: { modifiers: [MIRROR] },
    });
    const inspector = document.querySelector(
      '[data-studio-hybrid-dcc-modifier-inspector="true"]',
    );
    const status = screen.getByRole("status", {
      name: "",
    });
    const switchControl = screen.getByRole("switch", {
      name: "1단계 대칭 복사",
    });
    const inputs = document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "input, select",
    );

    expect(inspector?.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toMatch(/현재 설정은 그대로 보존/u);
    expect((switchControl as HTMLButtonElement).disabled).toBe(true);
    expect([...inputs].every((input) => input.disabled)).toBe(true);
    expect(screen.getByText(/한쪽 모양을 기준 축 반대편에 복사/u)).toBeTruthy();

    fireEvent.click(switchControl);
    fireEvent.click(screen.getByRole("button", { name: "변형 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "적용해 원본 메시로 확정" }));

    expect(props.onToggle).not.toHaveBeenCalled();
    expect(props.onAdd).not.toHaveBeenCalled();
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("names preview failure and per-modifier diagnostics while leaving recovery controls available", () => {
    const diagnosticMirror: StudioHybridDccModifierView = {
      ...MIRROR,
      diagnostic: "대칭 축에서 겹친 면 2개를 확인해 주세요.",
    };
    const { props } = renderInspector({
      error: "Boolean 대상이 닫힌 솔리드가 아닙니다.",
      stack: { modifiers: [diagnosticMirror] },
    });
    const alert = screen.getByRole("alert");
    const apply = screen.getByRole("button", { name: "적용해 원본 메시로 확정" });

    expect(alert.textContent).toContain("미리보기를 계산하지 못했습니다");
    expect(alert.textContent).toContain("Boolean 대상이 닫힌 솔리드가 아닙니다.");
    expect(alert.textContent).toContain("문제가 된 변형을 잠시 끈 뒤");
    expect(screen.getByText("대칭 축에서 겹친 면 2개를 확인해 주세요.")).toBeTruthy();
    expect((apply as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("switch", {
      name: "1단계 대칭 복사",
    }));
    fireEvent.click(apply);

    expect(props.onToggle).toHaveBeenCalledWith("mirror-1");
    expect(props.onApply).toHaveBeenCalledOnce();
  });

  it("stays structurally shrinkable at 320px and keeps every interactive target keyboard-focusable", () => {
    const { view } = renderInspector({
      stack: { modifiers: [BOOLEAN, BEVEL] },
    });
    const wrapper = view.container.firstElementChild as HTMLElement;
    wrapper.style.width = "320px";
    const actionButtons = view.container.querySelectorAll<HTMLButtonElement>(
      '[role="group"] button',
    );
    const fields = view.container.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "input, select",
    );

    expect(wrapper.className).toContain("min-w-0");
    expect(wrapper.className).toContain("max-w-full");
    expect(wrapper.className).toContain("overflow-hidden");
    expect([...actionButtons].every((button) => button.className.includes("min-h-11")))
      .toBe(true);
    expect([...fields].every((field) => field.className.includes("min-w-0"))).toBe(true);

    const addSelect = screen.getByRole("combobox", { name: "추가할 변형 종류" });
    addSelect.focus();
    expect(document.activeElement).toBe(addSelect);
    const moveDown = screen.getByRole("button", { name: "1단계 형태 합치기·빼기 아래로 이동" });
    moveDown.focus();
    expect(document.activeElement).toBe(moveDown);
  });
});
