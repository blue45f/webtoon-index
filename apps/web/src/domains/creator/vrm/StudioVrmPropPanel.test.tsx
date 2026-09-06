// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_VRM_PROP_RIG_METRICS,
  type VrmPropMetricBone,
  type VrmPropRigMetrics,
} from "./studio-vrm-prop-rig";
import {
  createPropInstance,
  type PropInstance,
  type Vec3,
} from "./studio-vrm-props";
import { StudioVrmPropPanel } from "./StudioVrmPropPanel";

afterEach(cleanup);

const RIGHT_GRIP_BONES = [
  "rightHand",
  "rightThumbMetacarpal",
  "rightThumbProximal",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal",
] as const satisfies readonly VrmPropMetricBone[];

function completeRightGripMetrics(): VrmPropRigMetrics {
  const boneWorldPositions: Partial<Record<VrmPropMetricBone, Vec3>> = {};
  RIGHT_GRIP_BONES.forEach((bone, index) => {
    boneWorldPositions[bone] = [index * 0.003, 1.2, index * 0.012];
  });
  return {
    ...DEFAULT_VRM_PROP_RIG_METRICS,
    boneWorldPositions,
    rightHand: 0.085,
    hand: 0.085,
    handSockets: {
      ...DEFAULT_VRM_PROP_RIG_METRICS.handSockets,
      rightHand: {
        ...DEFAULT_VRM_PROP_RIG_METRICS.handSockets.rightHand,
        source: "measured",
      },
    },
    missingBones: [],
  };
}

function renderPanel(
  rigMetrics: VrmPropRigMetrics,
  onUpdate = vi.fn(),
  suppliedItems?: PropInstance[],
) {
  const items = suppliedItems ?? [createPropInstance("mug", "panel-mug")!];
  const item = items[0]!;
  render(
    <StudioVrmPropPanel
      vrmReady
      rigMetrics={rigMetrics}
      items={items}
      selectedUid={item.uid}
      onSelect={vi.fn()}
      onAdd={vi.fn()}
      onUpdate={onUpdate}
      onRemove={vi.fn()}
      onClear={vi.fn()}
    />,
  );
  return { item, onUpdate };
}

describe("StudioVrmPropPanel 자동 그립", () => {
  it("실측 리그에서는 ON 권한을 설명하고 70–130% 맞춤값을 저장한다", () => {
    const { item, onUpdate } = renderPanel(completeRightGripMetrics());
    const toggle = screen.getByRole("switch", { name: "손가락 자동 그립" });
    const slider = screen.getByRole("slider", { name: "손가락 맞춤 강도" });

    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/소품 그립이 현재 포즈보다 우선합니다/)).not.toBeNull();
    expect(slider.getAttribute("min")).toBe("70");
    expect(slider.getAttribute("max")).toBe("130");
    expect((slider as HTMLInputElement).value).toBe("100");

    fireEvent.change(slider, { target: { value: "120" } });
    expect(onUpdate).toHaveBeenLastCalledWith(item.uid, {
      rig: expect.objectContaining({ gripFit: 1.2 }),
    });

    fireEvent.click(toggle);
    expect(onUpdate).toHaveBeenLastCalledWith(item.uid, {
      rig: expect.objectContaining({ autoFingerPose: false }),
    });
  });

  it("손가락 본이 불완전해도 이미 켜진 자동 그립은 끌 수 있다", () => {
    const { item, onUpdate } = renderPanel(DEFAULT_VRM_PROP_RIG_METRICS);
    const toggle = screen.getByRole("switch", { name: "손가락 자동 그립" });

    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/필요한 손가락 관절을 모두 찾지 못해/)).not.toBeNull();
    expect(screen.queryByText(/현재 손 포즈는 그대로 유지됩니다/)).not.toBeNull();
    expect(
      (screen.getByRole("slider", { name: "손가락 맞춤 강도" }) as HTMLInputElement).disabled
    ).toBe(true);

    fireEvent.click(toggle);
    expect(onUpdate).toHaveBeenLastCalledWith(item.uid, {
      rig: expect.objectContaining({ autoFingerPose: false }),
    });
  });

  it("같은 손 접촉이 충돌해도 이미 켜진 자동 그립은 끌 수 있다", () => {
    const selected = createPropInstance("mug", "panel-conflict-mug")!;
    const competing = createPropInstance("sword", "panel-conflict-sword")!;
    const onUpdate = vi.fn();
    renderPanel(
      completeRightGripMetrics(),
      onUpdate,
      [selected, competing],
    );
    const toggle = screen.getByRole("switch", { name: "손가락 자동 그립" });

    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/같은 손에 자동 그립 소품이 둘 이상/)).not.toBeNull();

    fireEvent.click(toggle);
    expect(onUpdate).toHaveBeenLastCalledWith(selected.uid, {
      rig: expect.objectContaining({ autoFingerPose: false }),
    });
  });
});
