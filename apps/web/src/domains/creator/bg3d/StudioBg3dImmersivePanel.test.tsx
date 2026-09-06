// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioBg3dImmersivePanel } from "./StudioBg3dImmersivePanel";

import type {
  StudioWebXrSessionErrorCode,
  StudioWebXrSessionState,
  StudioWebXrSupportSnapshot,
} from "../studio-webxr-session";
import type { ComponentProps } from "react";

const SUPPORTED: StudioWebXrSupportSnapshot = Object.freeze({
  kind: "toonspectrum.studio-webxr-support",
  version: 1,
  secureContext: true,
  immersiveAr: "supported",
  immersiveVr: "supported",
});

type PanelProps = ComponentProps<typeof StudioBg3dImmersivePanel>;

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    support: SUPPORTED,
    sessionState: { status: "idle" },
    onStart: vi.fn(),
    onEnd: vi.fn(),
    savedShotCount: 3,
    ...overrides,
  };
  return { props, ...render(<StudioBg3dImmersivePanel {...props} />) };
}

afterEach(cleanup);

describe("StudioBg3dImmersivePanel", () => {
  it("exposes two keyboard-reachable native actions and forwards exact WebXR modes", () => {
    const onStart = vi.fn();
    renderPanel({ onStart });

    const group = screen.getByRole("group", { name: "몰입형 미리보기 모드" });
    const arButton = within(group).getByRole("button", { name: "AR 미니어처 미리보기" });
    const vrButton = within(group).getByRole("button", { name: "VR 장면 미리보기" });

    expect((arButton as HTMLButtonElement).type).toBe("button");
    expect((vrButton as HTMLButtonElement).type).toBe("button");
    expect(arButton.getAttribute("aria-disabled")).toBe("false");
    expect(vrButton.getAttribute("aria-disabled")).toBe("false");
    arButton.focus();
    expect(document.activeElement).toBe(arButton);

    fireEvent.click(arButton);
    fireEvent.click(vrButton);

    expect(onStart).toHaveBeenNthCalledWith(1, "immersive-ar");
    expect(onStart).toHaveBeenNthCalledWith(2, "immersive-vr");
    expect(screen.getByText(/저장된 컷 3개는 편집기로 돌아와 전환/u)).toBeTruthy();
  });

  it("states that device sessions are runtime-only and announces idle support atomically", () => {
    renderPanel();

    expect(screen.getByText(/현재 브라우저 세션에서만 사용합니다/u)).toBeTruthy();
    expect(screen.getByText(/OPFS, Undo 기록에는 기기 세션을 저장하지/u)).toBeTruthy();
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toContain("사용할 모드를 선택하세요");
  });

  it("disables only an unsupported mode and explains the fallback", () => {
    renderPanel({
      support: {
        ...SUPPORTED,
        immersiveAr: "unsupported",
      },
    });

    const arButton = screen.getByRole("button", { name: "AR 미니어처 미리보기" });
    const vrButton = screen.getByRole("button", { name: "VR 장면 미리보기" });
    expect((arButton as HTMLButtonElement).disabled).toBe(false);
    expect(arButton.getAttribute("aria-disabled")).toBe("true");
    expect(vrButton.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(arButton);
    expect(screen.getByText(/이 기기에서는 AR을 열 수 없습니다/u)).toBeTruthy();
  });

  it("keeps current-scene VR available when no saved shots exist", () => {
    renderPanel({ savedShotCount: 0 });

    const vrButton = screen.getByRole("button", { name: "VR 장면 미리보기" });
    expect((vrButton as HTMLButtonElement).disabled).toBe(false);
    expect(vrButton.getAttribute("aria-disabled")).toBe("false");
    expect(screen.getByText(/컷 순회와 공간 Story Stop은 후속 기능/u)).toBeTruthy();
    expect((screen.getByRole("button", { name: "AR 미니어처 미리보기" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it("keeps current-scene VR available while saved-shot context is unresolved", () => {
    const onStart = vi.fn();
    renderPanel({ savedShotCount: undefined, onStart });

    const vrButton = screen.getByRole("button", { name: "VR 장면 미리보기" });
    expect((vrButton as HTMLButtonElement).disabled).toBe(false);
    expect(vrButton.getAttribute("aria-disabled")).toBe("false");
    vrButton.focus();
    expect(document.activeElement).toBe(vrButton);
    fireEvent.click(vrButton);
    expect(onStart).toHaveBeenCalledWith("immersive-vr");
    expect(screen.getByText(/컷 순회와 공간 Story Stop은 후속 기능/u)).toBeTruthy();
  });

  it("blocks both modes without HTTPS and announces the recovery as an alert", () => {
    renderPanel({
      support: {
        ...SUPPORTED,
        secureContext: false,
        immersiveAr: "unsupported",
        immersiveVr: "unsupported",
      },
    });

    expect((screen.getByRole("button", { name: "AR 미니어처 미리보기" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByRole("button", { name: "VR 장면 미리보기" }) as HTMLButtonElement).disabled)
      .toBe(true);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toContain("HTTPS 보안 연결이 없어");
  });

  it.each([
    ["unavailable", "immersive-ar"],
    ["disposed", null],
  ] as const)("keeps both starts terminally locked after a %s error", (code, mode) => {
    renderPanel({ sessionState: { status: "error", code, mode } });

    expect((screen.getByRole("button", { name: "AR 미니어처 미리보기" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByRole("button", { name: "VR 장면 미리보기" }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("locks only the rejected unsupported mode while keeping its reason focusable", () => {
    const onStart = vi.fn();
    renderPanel({
      support: null,
      savedShotCount: 2,
      sessionState: { status: "error", code: "unsupported", mode: "immersive-ar" },
      onStart,
    });

    const arButton = screen.getByRole("button", { name: "AR 미니어처 미리보기" });
    expect((arButton as HTMLButtonElement).disabled).toBe(false);
    expect(arButton.getAttribute("aria-disabled")).toBe("true");
    arButton.focus();
    expect(document.activeElement).toBe(arButton);
    fireEvent.click(arButton);
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "VR 장면 미리보기" }).getAttribute("aria-disabled"))
      .toBe("false");
  });

  it.each<{
    code: StudioWebXrSessionErrorCode;
    expected: RegExp;
  }>([
    { code: "insecure-context", expected: /HTTPS 보안 연결이 필요합니다/u },
    { code: "unavailable", expected: /WebXR API가 없습니다/u },
    { code: "unsupported", expected: /AR 미니어처 미리보기를 이 기기에서 지원하지/u },
    { code: "request-failed", expected: /권한이 거절됐거나/u },
    { code: "renderer-failed", expected: /3D 렌더러가 WebXR 세션에 연결되지 않아/u },
  ])("announces $code failures with an actionable Korean fallback", ({ code, expected }) => {
    const sessionState: StudioWebXrSessionState = {
      status: "error",
      mode: "immersive-ar",
      code,
    };
    renderPanel({ sessionState });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(expected);
    expect(alert.getAttribute("aria-atomic")).toBe("true");
  });

  it("locks starts during a permission request and exposes busy semantics", () => {
    renderPanel({
      sessionState: { status: "requesting", mode: "immersive-vr" },
    });

    const panel = screen.getByTestId("studio-bg3d-immersive-panel");
    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "AR 미니어처 미리보기" }) as HTMLButtonElement).disabled)
      .toBe(true);
    const vrButton = screen.getByRole("button", { name: "VR 장면 미리보기" });
    expect((vrButton as HTMLButtonElement).disabled).toBe(true);
    expect(vrButton.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("권한 요청을 확인해 주세요");
  });

  it("keeps ending available during presentation and forwards the end handler", () => {
    const onEnd = vi.fn();
    renderPanel({
      sessionState: { status: "presenting", mode: "immersive-vr" },
      onEnd,
    });

    expect((screen.getByRole("button", { name: "AR 미니어처 미리보기" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByRole("button", { name: "VR 장면 미리보기" }) as HTMLButtonElement).disabled)
      .toBe(true);
    const endButton = screen.getByRole("button", { name: "몰입형 미리보기 종료" });
    expect((endButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(endButton);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("VR 장면 미리보기가 실행 중");
  });

  it("honors a parent lock for starts without hiding its reason", () => {
    const reason = "검증된 3D 장면 원본을 복원하는 중입니다.";
    renderPanel({ disabledReason: reason });

    expect(screen.getByRole("status").textContent).toContain(reason);
    expect((screen.getByRole("button", { name: "AR 미니어처 미리보기" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByRole("button", { name: "VR 장면 미리보기" }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("combines a previous error with a current parent lock or support refresh", () => {
    const sessionState: StudioWebXrSessionState = {
      status: "error",
      mode: "immersive-vr",
      code: "request-failed",
    };
    const view = renderPanel({
      sessionState,
      disabledReason: "3D 장면을 복원하는 중입니다.",
    });

    expect(screen.getByRole("alert").textContent).toContain("현재 작업 잠금");
    expect(screen.getByRole("alert").textContent).toContain("3D 장면을 복원하는 중입니다.");

    view.rerender(
      <StudioBg3dImmersivePanel
        {...view.props}
        disabledReason={null}
        supportPending
        sessionState={sessionState}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("기기 지원 여부를 다시 확인하는 중");
  });
});
