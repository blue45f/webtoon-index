// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useStudioRasterSourcePresentation,
  type StudioRasterSourceLeaseAcquirer,
} from "./use-studio-raster-source-presentation";

afterEach(cleanup);

describe("useStudioRasterSourcePresentation", () => {
  it("keeps ordinary browser sources synchronous without acquiring a CAS lease", () => {
    const acquire = vi.fn<StudioRasterSourceLeaseAcquirer>();
    const { result } = renderHook(() => useStudioRasterSourcePresentation(
      "data:image/png;base64,abc",
      { acquire, consumer: "test" },
    ));

    expect(result.current).toEqual({
      error: null,
      pending: false,
      src: "data:image/png;base64,abc",
    });
    expect(acquire).not.toHaveBeenCalled();
  });

  it("exposes a linked source only after verification and releases it on source change", async () => {
    const release = vi.fn();
    let resolveLease: ((lease: {
      kind: "linked-3d-cas";
      src: string;
      blob: Blob;
      receipt: null;
      release: () => void;
    }) => void) | null = null;
    const acquire = vi.fn<StudioRasterSourceLeaseAcquirer>(() => new Promise((resolve) => {
      resolveLease = resolve;
    }));
    const source = `studio-opfs-cas:sha256:${"a".repeat(64)}`;
    const hook = renderHook(
      ({ value }) => useStudioRasterSourcePresentation(value, { acquire, consumer: "test" }),
      { initialProps: { value: source as string | null } },
    );

    expect(hook.result.current).toEqual({ error: null, pending: true, src: null });
    await act(async () => {
      resolveLease?.({
        kind: "linked-3d-cas",
        src: "blob:verified",
        blob: new Blob(["png"], { type: "image/png" }),
        receipt: null,
        release,
      });
    });
    await waitFor(() => expect(hook.result.current.src).toBe("blob:verified"));

    hook.rerender({ value: "data:image/png;base64,next" });
    expect(hook.result.current.src).toBe("data:image/png;base64,next");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed reserved source fail-closed", async () => {
    const acquire = vi.fn<StudioRasterSourceLeaseAcquirer>(async () => {
      throw new Error("integrity mismatch");
    });
    const source = `studio-opfs-cas:sha256:${"b".repeat(64)}`;
    const { result } = renderHook(() => useStudioRasterSourcePresentation(
      source,
      { acquire, consumer: "test" },
    ));

    await waitFor(() => expect(result.current.error?.message).toBe("integrity mismatch"));
    expect(result.current.src).toBeNull();
    expect(result.current.pending).toBe(false);
  });
});
