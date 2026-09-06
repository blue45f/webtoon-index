// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioVelloHubSurface, type StudioVelloHubAuthority } from "./studio-vello-hub-surface";

import type {
  StudioVelloHub,
  StudioVelloHubOptions,
  StudioVelloHubRenderReceipt,
} from "./studio-vello-hub";
import type { StudioVelloHubCanvasTarget } from "./studio-vello-hub-canvas-target";

const mocks = vi.hoisted(() => ({
  createHub: vi.fn(),
  createTarget: vi.fn(),
}));

vi.mock("./studio-vello-hub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./studio-vello-hub")>();
  return { ...actual, createStudioVelloHub: mocks.createHub };
});

vi.mock("./studio-vello-hub-canvas-target", () => ({
  createStudioVelloHubCanvasTarget: mocks.createTarget,
}));

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function receipt(requestId: number): StudioVelloHubRenderReceipt {
  return {
    requestId,
    primarySurfaceOwner: "vello-hub",
    islandScope: "document-vector-hybrid",
    backendId: "vello-gpu-browser",
    decision: "gpu-first",
    expectedGainPct: null,
    referenceOnly: false,
    admissionMode: "selected-gpu-provider",
    productWidePromoted: false,
  };
}

describe("StudioVelloHubSurface product lifecycle", () => {
  let renderHub: ReturnType<typeof vi.fn>;
  let disposeHub: ReturnType<typeof vi.fn>;
  let destroyTarget: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    renderHub = vi.fn();
    disposeHub = vi.fn();
    destroyTarget = vi.fn();
    mocks.createTarget.mockReturnValue({
      setIsland: vi.fn(),
      destroy: destroyTarget,
    } as unknown as StudioVelloHubCanvasTarget);
    mocks.createHub.mockReturnValue({
      render: renderHub,
      dispose: disposeHub,
    } as unknown as StudioVelloHub);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("ignores a superseded render rejection and keeps the newer product frame authoritative", async () => {
    const first = deferred<StudioVelloHubRenderReceipt>();
    const second = deferred<StudioVelloHubRenderReceipt>();
    renderHub.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const authorities: StudioVelloHubAuthority[] = [];
    const mountParent = document.createElement("div");
    document.body.append(mountParent);
    const selectedIds = ["selection"];
    const baseElement = {
      id: "selection",
      type: "rect",
      x: 4,
      y: 4,
      width: 20,
      height: 20,
    } as const;
    const view = render(
      <StudioVelloHubSurface
        enabled
        mountParent={mountParent}
        width={64}
        height={64}
        elements={[baseElement]}
        selectedIds={selectedIds}
        onAuthorityChange={(authority) => authorities.push(authority)}
      />,
    );
    await waitFor(() => expect(renderHub).toHaveBeenCalledTimes(1));

    view.rerender(
      <StudioVelloHubSurface
        enabled
        mountParent={mountParent}
        width={64}
        height={64}
        elements={[{ ...baseElement, width: 24 }]}
        selectedIds={selectedIds}
        onAuthorityChange={(authority) => authorities.push(authority)}
      />,
    );
    await waitFor(() => expect(renderHub).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.reject(new Error("StudioVelloHub render superseded before presentation"));
      await first.promise.catch(() => undefined);
    });
    expect(disposeHub).not.toHaveBeenCalled();
    expect(destroyTarget).not.toHaveBeenCalled();
    expect(authorities.at(-1)?.status).not.toBe("unavailable");

    await act(async () => {
      second.resolve(receipt(2));
      await second.promise;
    });
    await waitFor(() => {
      expect(authorities.at(-1)).toMatchObject({
        status: "active",
        backendId: "vello-gpu-browser",
      });
    });
  });

  it("surfaces Hub unavailability without destroying the retained Vello surface", async () => {
    renderHub.mockResolvedValue(receipt(1));
    const authorities: StudioVelloHubAuthority[] = [];
    const mountParent = document.createElement("div");
    document.body.append(mountParent);
    render(
      <StudioVelloHubSurface
        enabled
        mountParent={mountParent}
        width={64}
        height={64}
        elements={[
          {
            id: "selection",
            type: "rect",
            x: 4,
            y: 4,
            width: 20,
            height: 20,
          },
        ]}
        selectedIds={["selection"]}
        onAuthorityChange={(authority) => authorities.push(authority)}
      />,
    );
    await waitFor(() => expect(mocks.createHub).toHaveBeenCalledOnce());
    const options = mocks.createHub.mock.calls[0]?.[0] as StudioVelloHubOptions;

    act(() => {
      options.onUnavailable?.({
        source: "device-loss",
        backendId: null,
        reason: "GPUDevice lost",
        cause: new Error("GPUDevice lost"),
      });
    });

    expect(disposeHub).not.toHaveBeenCalled();
    expect(destroyTarget).not.toHaveBeenCalled();
    expect(authorities.at(-1)).toEqual({
      status: "unavailable",
      backendId: null,
      decision: null,
      reason: "device-loss:GPUDevice lost",
    });
  });
});
