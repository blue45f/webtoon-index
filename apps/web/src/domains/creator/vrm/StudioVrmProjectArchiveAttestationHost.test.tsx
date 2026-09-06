// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioVrmProjectArchiveAttestationDialog } from "./StudioVrmProjectArchiveAttestationDialog";
import {
  requestStudioVrmProjectArchiveUseContext,
  StudioVrmProjectArchiveAttestationHost,
  type StudioVrmProjectArchiveAttestationDialogLoader,
} from "./StudioVrmProjectArchiveAttestationHost";

import type { StudioVrmProjectArchiveAttestationPlan } from "./studio-vrm-license-product-gate";

type ReadyPlan = Extract<StudioVrmProjectArchiveAttestationPlan, { readonly ok: true }>;

const PLAN: ReadyPlan = Object.freeze({
  ok: true,
  schema: "toonspectrum.vrm-project-archive-attestation-plan",
  version: 1,
  modelCount: 1,
  exactAttributionTexts: Object.freeze(["작가 A · CC BY 4.0"] as const),
  permittedActorBases: Object.freeze(["author"] as const),
});

const loadDialog: StudioVrmProjectArchiveAttestationDialogLoader = async () => ({
  default: StudioVrmProjectArchiveAttestationDialog,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("StudioVrmProjectArchiveAttestationHost", () => {
  it("returns a neutral fail-closed result when no product host owns the presenter", async () => {
    await expect(requestStudioVrmProjectArchiveUseContext(PLAN)).resolves.toBeNull();
  });

  it("serializes overlapping requests and resets form identity between them", async () => {
    render(<StudioVrmProjectArchiveAttestationHost loadDialog={loadDialog} />);
    const first = requestStudioVrmProjectArchiveUseContext(PLAN);
    const second = requestStudioVrmProjectArchiveUseContext(PLAN);

    expect(await screen.findByText("뒤에 1건 대기")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await expect(first).resolves.toBeNull();

    await screen.findByRole("dialog", { name: "VRM archive 이용 조건 확인" });
    expect(screen.queryByText("뒤에 1건 대기")).toBeNull();
    expect(
      (screen.getByRole("radio", { name: /^VRM 저작자 본인/ }) as HTMLInputElement).checked,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await expect(second).resolves.toBeNull();
  });

  it("settles every queued request when the host unmounts", async () => {
    const view = render(<StudioVrmProjectArchiveAttestationHost loadDialog={loadDialog} />);
    const first = requestStudioVrmProjectArchiveUseContext(PLAN);
    const second = requestStudioVrmProjectArchiveUseContext(PLAN);
    await flush();

    view.unmount();
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    await expect(requestStudioVrmProjectArchiveUseContext(PLAN)).resolves.toBeNull();
  });

  it("settles the whole queue when the dialog chunk rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rejectedLoader: StudioVrmProjectArchiveAttestationDialogLoader = async () => {
      throw new Error("chunk unavailable");
    };
    render(<StudioVrmProjectArchiveAttestationHost loadDialog={rejectedLoader} />);
    const first = requestStudioVrmProjectArchiveUseContext(PLAN);
    const second = requestStudioVrmProjectArchiveUseContext(PLAN);

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    expect(document.querySelector("[aria-modal='true']")).toBeNull();
  });

  it("bounds a permanently pending dialog chunk", async () => {
    vi.useFakeTimers();
    const pendingLoader: StudioVrmProjectArchiveAttestationDialogLoader = () =>
      new Promise(() => undefined);
    render(<StudioVrmProjectArchiveAttestationHost loadDialog={pendingLoader} />);
    const first = requestStudioVrmProjectArchiveUseContext(PLAN);
    const second = requestStudioVrmProjectArchiveUseContext(PLAN);
    await flush();
    expect(screen.getByText("VRM 이용 조건 불러오는 중")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    expect(document.querySelector("[aria-modal='true']")).toBeNull();
  });

  it("does not time out the user's decision after the dialog chunk is ready", async () => {
    vi.useFakeTimers();
    render(<StudioVrmProjectArchiveAttestationHost loadDialog={loadDialog} />);
    const answer = requestStudioVrmProjectArchiveUseContext(PLAN);
    await flush();
    await flush();
    expect(screen.getByText("VRM archive 이용 조건 확인")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText("VRM archive 이용 조건 확인")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await expect(answer).resolves.toBeNull();
  });
});
