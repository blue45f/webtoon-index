// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioGeneric3dGlbManifest,
  createStudioGeneric3dRightsFromAttachment,
} from "./studio-generic-3d-model-mode";
import { createStudioGeneric3dPoseProxies } from "./studio-generic-3d-pose-proxy";
import { StudioGeneric3dModelModePanel } from "./StudioGeneric3dModelModePanel";

import type {
  StudioBg3dGlbValidationFailure,
  StudioBg3dGlbValidationSuccess,
} from "./bg3d/studio-bg3d-glb-validation";
import type { ComponentProps } from "react";

function validation(): StudioBg3dGlbValidationSuccess {
  const metrics = {
    byteSize: 8_192,
    jsonByteSize: 1_024,
    binByteSize: 7_148,
    nodes: 1,
    meshes: 1,
    meshPrimitives: 1,
    drawCalls: 1,
    triangles: 24,
    materials: 1,
    textures: 0,
    images: 0,
    imageBytes: 0,
    estimatedDecodedImageBytes: 0,
    maxImageDimension: 0,
    undeterminedImageDimensions: 0,
    lights: 0,
    animations: 0,
    animationChannels: 0,
    animationKeyframes: 0,
    animationValues: 0,
    skins: 0,
    joints: 0,
    morphTargets: 0,
    accessorElements: 72,
    estimatedDecodedGeometryBytes: 2_048,
  };
  return {
    ok: true,
    code: "valid",
    message: "검증 완료",
    profile: "desktop",
    verifiedSha256: `sha256:${"c".repeat(64)}`,
    verifiedBytes: new Uint8Array(metrics.byteSize),
    cumulativeBytesAfter: metrics.byteSize,
    usesBasisTextures: false,
    requiresBasisTextures: false,
    metrics,
  };
}

function createProps(
  patch: Partial<ComponentProps<typeof StudioGeneric3dModelModePanel>> = {},
): ComponentProps<typeof StudioGeneric3dModelModePanel> {
  const manifest = createStudioGeneric3dGlbManifest({
    name: "교실 의자.glb",
    validation: validation(),
    rights: createStudioGeneric3dRightsFromAttachment({
      status: "owned",
      commercialUse: true,
      attributionRequired: false,
    }),
  });
  return {
    manifest,
    proxies: createStudioGeneric3dPoseProxies({ manifest }),
    controlMode: "root",
    selectedProxyId: null,
    onClassificationChange: vi.fn(),
    onControlModeChange: vi.fn(),
    onProxySelect: vi.fn(),
    ...patch,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StudioGeneric3dModelModePanel", () => {
  it("exposes the separate generic-model boundary, model status, and accessible controls", () => {
    const props = createProps();
    render(<StudioGeneric3dModelModePanel {...props} />);

    expect(screen.getByRole("heading", { name: "범용 3D 모델" })).toBeTruthy();
    expect(screen.getByText("VRM과 별도")).toBeTruthy();
    expect(screen.getByText(/GLB · 정적 모델/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("검사 완료");
    expect(screen.getByRole("button", { name: "소품" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "부위" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /포즈\s*제한됨/ }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("데스크톱 예산 통과")).toBeTruthy();
    expect(screen.getByText("직접 제작")).toBeTruthy();
  });

  it("forwards classification and available mode changes", () => {
    const props = createProps();
    render(<StudioGeneric3dModelModePanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "캐릭터" }));
    fireEvent.click(screen.getByRole("button", { name: /포즈\s*제한됨/ }));

    expect(props.onClassificationChange).toHaveBeenCalledWith("character");
    expect(props.onControlModeChange).toHaveBeenCalledWith("pose");
  });

  it("shows pose proxy operation semantics without claiming guides deform the model", () => {
    const base = createProps();
    const props = createProps({
      manifest: base.manifest,
      proxies: base.proxies,
      controlMode: "pose",
    });
    render(<StudioGeneric3dModelModePanel {...props} />);

    expect(screen.getByText(`조작 가능 1/${props.proxies.length}`)).toBeTruthy();
    expect(screen.getByText("가이드는 구도 참고용이며 메시를 변형하지 않습니다. 정적 부위 이동은 이음새가 벌어질 수 있습니다.")).toBeTruthy();
    const headButton = screen.getByRole("button", { name: /머리\s*가이드/ });
    fireEvent.click(headButton);
    expect(props.onProxySelect).toHaveBeenCalledWith(
      props.proxies.find((proxy) => proxy.role === "head")?.id,
    );
  });

  it("renders a blocking alert and disables manipulation when validation fails", () => {
    const failure: StudioBg3dGlbValidationFailure = {
      ok: false,
      code: "model-byte-budget-exceeded",
      message: "이 기기의 모델 용량 기준을 초과했습니다.",
    };
    const manifest = createStudioGeneric3dGlbManifest({
      name: "oversized.glb",
      validation: failure,
    });
    const props = createProps({
      manifest,
      proxies: createStudioGeneric3dPoseProxies({ manifest }),
      controlMode: "pose",
    });
    render(<StudioGeneric3dModelModePanel {...props} />);

    expect(screen.getByRole("alert").textContent).toContain("사용 차단");
    expect(screen.getByRole("button", { name: "전체" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "부위" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "포즈" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("button", { name: /가이드/ }).every((button) => button.hasAttribute("disabled"))).toBe(true);
  });

  it("keeps detailed limitations discoverable from the summary", () => {
    const props = createProps();
    render(<StudioGeneric3dModelModePanel {...props} />);

    const summary = screen.getByText(/제한 사항 \d+개/);
    fireEvent.click(summary);
    expect(screen.getByRole("list", { name: "3D 모델 제한 사항" })).toBeTruthy();
    expect(screen.getByText("정적 모델")).toBeTruthy();
    expect(screen.getByText("단일 부위")).toBeTruthy();
  });
});
