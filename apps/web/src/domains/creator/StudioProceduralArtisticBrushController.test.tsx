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
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioProceduralArtisticBrushController,
  type StudioProceduralArtisticBrushControllerProps,
  type StudioProceduralArtisticBrushProbeResult,
} from "./StudioProceduralArtisticBrushController";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function props(
  overrides: Partial<StudioProceduralArtisticBrushControllerProps> = {},
): StudioProceduralArtisticBrushControllerProps {
  return {
    currentColor: "#336699",
    probe: vi.fn(async () => ({
      available: true,
      message: "WebGL2 Worker 준비 완료",
    })),
    generate: vi.fn(async () => ({
      message: "흐름장 레이어를 추가했습니다.",
    })),
    ...overrides,
  };
}

function toggle(open: boolean): HTMLDetailsElement {
  const details = document.querySelector(
    "[data-studio-procedural-artistic-brush-controller]",
  ) as HTMLDetailsElement;
  details.open = open;
  fireEvent(details, new Event("toggle", { bubbles: false }));
  return details;
}

describe("StudioProceduralArtisticBrushController", () => {
  it("starts as a compact collapsed launcher and does not probe eagerly", () => {
    const probe = vi.fn<StudioProceduralArtisticBrushControllerProps["probe"]>(
      async (): Promise<StudioProceduralArtisticBrushProbeResult> => ({
        available: true,
      }),
    );
    render(
      <StudioProceduralArtisticBrushController
        {...props({ probe })}
      />,
    );

    const details = document.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(probe).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("region", { name: "절차적 질감 생성기" }),
    ).toBeNull();
    const summary = screen.getByText("절차적 질감 생성기").closest("summary");
    expect(summary?.className).toContain("min-h-11");
    expect(
      screen.getByText("흐름장 · 해칭 · 매스 · 수채 채움 · 플랫 워시"),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("확인 전");
  });

  it("probes only after opening and exposes checking then ready capability", async () => {
    const pending = deferred<StudioProceduralArtisticBrushProbeResult>();
    const probe = vi.fn<StudioProceduralArtisticBrushControllerProps["probe"]>(
      () => pending.promise,
    );
    render(
      <StudioProceduralArtisticBrushController
        {...props({ probe })}
      />,
    );

    toggle(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    expect(screen.getAllByRole("status").some(
      (status) => status.textContent?.includes("확인 중"),
    )).toBe(true);

    await act(async () => {
      pending.resolve({
        available: true,
        message: "전용 Worker 준비 완료",
      });
      await pending.promise;
    });
    expect(screen.getAllByRole("status").some(
      (status) => status.textContent?.includes("전용 Worker 준비 완료"),
    )).toBe(true);
    const generateButton = screen.getByRole("button", {
      name: "질감 생성",
    }) as HTMLButtonElement;
    expect(generateButton.disabled).toBe(false);
  });

  it("aborts an in-flight probe on close and re-probes on the next open", async () => {
    const first = deferred<StudioProceduralArtisticBrushProbeResult>();
    const second = deferred<StudioProceduralArtisticBrushProbeResult>();
    const probe = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    render(
      <StudioProceduralArtisticBrushController
        {...props({ probe })}
      />,
    );

    toggle(true);
    const firstSignal = probe.mock.calls[0]?.[0] as AbortSignal;
    toggle(false);
    expect(firstSignal.aborted).toBe(true);
    expect(
      screen.queryByRole("region", { name: "절차적 질감 생성기" }),
    ).toBeNull();

    toggle(true);
    expect(probe).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve({ available: true });
      await second.promise;
    });
    expect(screen.getByRole("button", { name: "질감 생성" })).toBeTruthy();
  });

  it("owns panel settings and passes one frozen snapshot to generation", async () => {
    const generate =
      vi.fn<StudioProceduralArtisticBrushControllerProps["generate"]>(
        async () => ({
          message: "해칭 질감을 새 레이어에 추가했습니다.",
        }),
      );
    render(
      <StudioProceduralArtisticBrushController
        {...props({ generate })}
      />,
    );
    toggle(true);
    await waitFor(() => {
      expect(
        (screen.getByRole("button", {
          name: "질감 생성",
        }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    fireEvent.click(screen.getByRole("radio", { name: /해칭/ }));
    fireEvent.change(screen.getByLabelText("질감 색상 코드"), {
      target: { value: "#AA5500" },
    });
    fireEvent.change(screen.getByLabelText("결정적 반복 시드"), {
      target: { value: "77" },
    });
    const settings = screen.getByLabelText("해칭 세부 설정");
    const sliders = within(settings).getAllByRole("slider");
    fireEvent.change(sliders[0]!, { target: { value: "74" } });
    fireEvent.change(sliders[1]!, { target: { value: "-30" } });
    fireEvent.change(sliders[2]!, { target: { value: "3.5" } });
    fireEvent.click(screen.getByRole("button", { name: "질감 생성" }));

    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const [snapshot, signal] = generate.mock.calls[0]!;
    expect(snapshot).toEqual({
      technique: "hatch",
      color: "#AA5500",
      density: 74,
      angle: -30,
      weight: 3.5,
      strength: 0.8,
      seed: 77,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(await screen.findByText(
      "해칭 질감을 새 레이어에 추가했습니다.",
    )).toBeTruthy();
  });

  it.each([
    {
      technique: "watercolor-fill",
      label: "수채 채움",
      sliderValues: ["82", "-55", "0.63"],
      expected: {
        density: 82,
        angle: -55,
        weight: 2,
        strength: 0.63,
      },
    },
    {
      technique: "flat-wash",
      label: "플랫 워시",
      sliderValues: ["0.46"],
      expected: {
        density: 60,
        angle: 45,
        weight: 2,
        strength: 0.46,
      },
    },
  ] as const)(
    "passes one exact $technique settings snapshot to generation",
    async ({ technique, label, sliderValues, expected }) => {
      const generate =
        vi.fn<StudioProceduralArtisticBrushControllerProps["generate"]>(
          async () => ({
            message: `${label} 레이어를 추가했습니다.`,
          }),
        );
      render(
        <StudioProceduralArtisticBrushController
          {...props({ generate })}
        />,
      );
      toggle(true);
      await waitFor(() => {
        expect(
          (screen.getByRole("button", {
            name: "질감 생성",
          }) as HTMLButtonElement).disabled,
        ).toBe(false);
      });

      const techniqueRadio = screen.getByRole("radio", { name: label });
      fireEvent.click(techniqueRadio);
      expect((techniqueRadio as HTMLInputElement).checked).toBe(true);
      fireEvent.change(screen.getByLabelText("질감 색상 코드"), {
        target: { value: "#8844aa" },
      });
      fireEvent.change(screen.getByLabelText("결정적 반복 시드"), {
        target: { value: "99" },
      });
      const sliders = within(
        screen.getByLabelText(`${label} 세부 설정`),
      ).getAllByRole("slider");
      expect(sliders).toHaveLength(sliderValues.length);
      sliderValues.forEach((value, index) => {
        fireEvent.change(sliders[index]!, { target: { value } });
      });
      fireEvent.click(screen.getByRole("button", { name: "질감 생성" }));

      await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
      expect(generate.mock.calls[0]?.[0]).toEqual({
        technique,
        color: "#8844aa",
        ...expected,
        seed: 99,
      });
      expect(Object.isFrozen(generate.mock.calls[0]?.[0])).toBe(true);
    },
  );

  it("keeps generation busy while cancellation settles and ignores stale success", async () => {
    const pending = deferred<{ message: string }>();
    const generate =
      vi.fn<StudioProceduralArtisticBrushControllerProps["generate"]>(
        () => pending.promise,
      );
    render(
      <StudioProceduralArtisticBrushController
        {...props({ generate })}
      />,
    );
    toggle(true);
    await waitFor(() => {
      expect(
        (screen.getByRole("button", {
          name: "질감 생성",
        }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "질감 생성" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const signal = generate.mock.calls[0]?.[1] as AbortSignal;

    fireEvent.click(screen.getByRole("button", { name: "생성 취소" }));
    expect(signal.aborted).toBe(true);
    expect(
      screen.getByText("절차적 질감 생성을 취소하는 중입니다."),
    ).toBeTruthy();
    expect(screen.getAllByRole("status").some(
      (status) => status.textContent?.includes("취소하는 중"),
    )).toBe(true);
    const generatingButton = screen.getByRole("button", {
      name: "생성 중…",
    }) as HTMLButtonElement;
    expect(generatingButton.disabled).toBe(true);
    fireEvent.click(generatingButton);
    expect(generate).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ message: "늦은 성공 메시지" });
      await pending.promise;
    });
    expect(screen.queryByText("늦은 성공 메시지")).toBeNull();
    expect(
      await screen.findByText("절차적 질감 생성을 취소했습니다."),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "질감 생성",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("aborts both probe and generation lifecycle when unmounted", async () => {
    const probePending = deferred<StudioProceduralArtisticBrushProbeResult>();
    const probe = vi.fn<StudioProceduralArtisticBrushControllerProps["probe"]>(
      () => probePending.promise,
    );
    const probeView = render(
      <StudioProceduralArtisticBrushController
        {...props({ probe })}
      />,
    );
    toggle(true);
    const probeSignal = probe.mock.calls[0]?.[0] as AbortSignal;
    probeView.unmount();
    expect(probeSignal.aborted).toBe(true);

    const generatePending = deferred<void>();
    const generate =
      vi.fn<StudioProceduralArtisticBrushControllerProps["generate"]>(
        () => generatePending.promise,
      );
    const generateView = render(
      <StudioProceduralArtisticBrushController
        {...props({ generate })}
      />,
    );
    toggle(true);
    await waitFor(() => {
      expect(
        (screen.getByRole("button", {
          name: "질감 생성",
        }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "질감 생성" }));
    const generateSignal = generate.mock.calls[0]?.[1] as AbortSignal;
    generateView.unmount();
    expect(generateSignal.aborted).toBe(true);
  });

  it("shows unavailable and generation errors accessibly and honors disabled reason", async () => {
    const unavailableView = render(
      <StudioProceduralArtisticBrushController
        {...props({
          disabled: true,
          reason: "검토 잠금 중에는 질감을 추가할 수 없습니다.",
          probe: vi.fn(async () => ({
            available: false,
            message: "WebGL2를 사용할 수 없습니다.",
          })),
        })}
      />,
    );
    toggle(true);
    expect(await screen.findByText("WebGL2를 사용할 수 없습니다.")).toBeTruthy();
    expect(screen.getByText(
      "검토 잠금 중에는 질감을 추가할 수 없습니다.",
    )).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "질감 생성",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    unavailableView.unmount();

    const generate = vi.fn(async () => {
      throw new Error("GPU 메모리가 부족합니다.");
    });
    render(
      <StudioProceduralArtisticBrushController
        {...props({ generate })}
      />,
    );
    toggle(true);
    await waitFor(() => {
      expect(
        (screen.getByRole("button", {
          name: "질감 생성",
        }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "질감 생성" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("GPU 메모리가 부족합니다.");
  });

  it("tracks the current Studio color and normalizes invalid external colors", async () => {
    const shared = props();
    const view = render(
      <StudioProceduralArtisticBrushController {...shared} />,
    );
    toggle(true);
    await waitFor(() => {
      expect(
        (screen.getByLabelText("질감 색상 코드") as HTMLInputElement).value,
      ).toBe("#336699");
    });

    view.rerender(
      <StudioProceduralArtisticBrushController
        {...shared}
        currentColor="#ABCDEF"
      />,
    );
    await waitFor(() => {
      expect(
        (screen.getByLabelText("질감 색상 코드") as HTMLInputElement).value,
      ).toBe("#abcdef");
    });
    view.rerender(
      <StudioProceduralArtisticBrushController
        {...shared}
        currentColor="not-a-color"
      />,
    );
    await waitFor(() => {
      expect(
        (screen.getByLabelText("질감 색상 코드") as HTMLInputElement).value,
      ).toBe("#202124");
    });
  });
});
