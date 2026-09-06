// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_URL,
  type StudioVrmAvatarReferenceCatalogueEnvelope,
} from "./studio-vrm-avatar-reference-product";
import {
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
  type StudioVrmAvatarReferenceCatalogue,
} from "./studio-vrm-avatar-reference-recommendation";
import {
  studioVrmAvatarReferenceCatalogueDiagnosticMessage,
  useStudioVrmAvatarReferenceCatalogue,
} from "./useStudioVrmAvatarReferenceCatalogue";

import type {
  StudioVrmAvatarReferenceCatalogueLoadResult,
} from "./studio-vrm-avatar-reference-catalogue-runtime";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function readyResult(revision = "catalogue-v1"): StudioVrmAvatarReferenceCatalogueLoadResult {
  const catalogue = {
    version: 1 as const,
    providerId: "google-mediapipe-tasks-vision/image-embedder" as const,
    modelId: "mobilenet-v3-small-float32" as const,
    modelRevision: "1" as const,
    modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
    catalogueRevision: revision,
    entries: [],
  } satisfies StudioVrmAvatarReferenceCatalogue;
  return {
    status: "ready",
    envelope: { authority: {} as never, renders: [], catalogue } as StudioVrmAvatarReferenceCatalogueEnvelope,
    catalogue,
    catalogueRevision: revision,
    diagnostic: {
      code: "ready",
      url: STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_URL,
      expectedByteLength: 1,
      expectedSha256: "a".repeat(64),
    },
  };
}

function unavailableResult(code: "network" | "digest" = "network"):
StudioVrmAvatarReferenceCatalogueLoadResult {
  return {
    status: "unavailable",
    envelope: null,
    catalogue: null,
    catalogueRevision: null,
    diagnostic: {
      code,
      url: STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_URL,
      expectedByteLength: 1,
      expectedSha256: "a".repeat(64),
    },
  };
}

describe("useStudioVrmAvatarReferenceCatalogue", () => {
  it("does not fetch until the Forge product surface is active", async () => {
    const load = vi.fn(async () => readyResult());
    const hook = renderHook(
      ({ active }) => useStudioVrmAvatarReferenceCatalogue({ active, load }),
      { initialProps: { active: false } },
    );

    expect(hook.result.current.status).toBe("idle");
    expect(load).not.toHaveBeenCalled();
    hook.rerender({ active: true });
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    expect(load).toHaveBeenCalledOnce();
  });

  it("aborts only the inactive caller, ignores its stale result, and reuses the shared load later", async () => {
    const pending = deferred<StudioVrmAvatarReferenceCatalogueLoadResult>();
    const signals: AbortSignal[] = [];
    const load = vi.fn((options) => {
      signals.push(options?.signal as AbortSignal);
      return pending.promise;
    });
    const hook = renderHook(
      ({ active }) => useStudioVrmAvatarReferenceCatalogue({ active, load }),
      { initialProps: { active: true } },
    );
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    hook.rerender({ active: false });
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => pending.resolve(readyResult("stale")));
    expect(hook.result.current.status).toBe("loading");

    hook.rerender({ active: true });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("keeps an admitted result across tab changes without refetching", async () => {
    const load = vi.fn(async () => readyResult("stable"));
    const hook = renderHook(
      ({ active }) => useStudioVrmAvatarReferenceCatalogue({ active, load }),
      { initialProps: { active: true } },
    );
    await waitFor(() => expect(hook.result.current.catalogueRevision).toBe("stable"));
    hook.rerender({ active: false });
    hook.rerender({ active: true });
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    expect(load).toHaveBeenCalledOnce();
  });

  it("exposes an explicit retry after a failed load", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce(unavailableResult("digest"))
      .mockResolvedValueOnce(readyResult("retry-ready"));
    const hook = renderHook(() => useStudioVrmAvatarReferenceCatalogue({ active: true, load }));
    await waitFor(() => expect(hook.result.current.status).toBe("unavailable"));
    expect(hook.result.current.diagnosticCode).toBe("digest");

    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.catalogueRevision).toBe("retry-ready"));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("maps integrity and transport failures to bounded Korean recovery copy", () => {
    expect(studioVrmAvatarReferenceCatalogueDiagnosticMessage("network")).toContain("네트워크");
    expect(studioVrmAvatarReferenceCatalogueDiagnosticMessage("digest")).toContain("안전하게 검증");
  });
});
