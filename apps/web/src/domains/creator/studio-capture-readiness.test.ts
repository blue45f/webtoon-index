import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collectStudioCaptureAssetSources,
  STUDIO_CAPTURE_READY_MAX_ASSETS,
  StudioCaptureReadinessError,
  waitForStudioCaptureReady,
  type StudioCaptureStageLike,
} from "./studio-capture-readiness";

import type { StudioLinked3dPassCasAuthority } from "./studio-linked-3d-pass-transaction";

afterEach(() => {
  vi.useRealTimers();
});

function stage(): StudioCaptureStageLike & { drawCount: number } {
  return {
    drawCount: 0,
    batchDraw() {
      this.drawCount += 1;
    },
  };
}

const LINKED_3D_LOCATOR = `studio-opfs-cas:sha256:${"a".repeat(64)}`;

function linked3dPassAuthority(): StudioLinked3dPassCasAuthority {
  return {
    kind: "opfs",
    put: vi.fn(),
    get: vi.fn(),
    ownerRefs: vi.fn(),
    setOwnerRefs: vi.fn(),
  } as unknown as StudioLinked3dPassCasAuthority;
}

describe("waitForStudioCaptureReady", () => {
  it("waits for the requested React commit, fonts, unique assets, and Konva paint frames", async () => {
    const targetStage = stage();
    let renderedPageId: string | null = null;
    let frames = 0;
    let fontsReady = false;
    const preloaded: string[] = [];

    const result = await waitForStudioCaptureReady({
      pageId: "page-2",
      getRenderedPageId: () => renderedPageId,
      getStage: () => targetStage,
      assetSources: ["data:image/png;base64,AA", "data:image/png;base64,AA", "blob:second"],
      nextFrame: async () => {
        frames += 1;
        if (frames === 1) renderedPageId = "page-2";
      },
      waitForFonts: async () => {
        fontsReady = true;
      },
      preloadImage: async (source) => {
        preloaded.push(source);
      },
    });

    expect(result).toBe(targetStage);
    expect(fontsReady).toBe(true);
    expect(new Set(preloaded)).toEqual(new Set(["data:image/png;base64,AA", "blob:second"]));
    expect(preloaded).toHaveLength(2);
    expect(frames).toBe(4);
    expect(targetStage.drawCount).toBe(1);
  });

  it("stops when the selected page changes during readiness work", async () => {
    const targetStage = stage();
    let renderedPageId = "page-1";
    let frames = 0;

    const promise = waitForStudioCaptureReady({
      pageId: "page-1",
      getRenderedPageId: () => renderedPageId,
      getStage: () => targetStage,
      nextFrame: async () => {
        frames += 1;
        if (frames === 1) renderedPageId = "page-2";
      },
      waitForFonts: async () => undefined,
      preloadImage: async () => undefined,
    });

    await expect(promise).rejects.toMatchObject({ code: "stale-page" });
    expect(targetStage.drawCount).toBe(0);
  });

  it("times out instead of silently capturing the previously rendered page", async () => {
    vi.useFakeTimers();
    const targetStage = stage();
    const promise = waitForStudioCaptureReady({
      pageId: "never-committed",
      getRenderedPageId: () => "previous-page",
      getStage: () => targetStage,
      timeoutMs: 250,
      nextFrame: () => new Promise(() => undefined),
      waitForFonts: async () => undefined,
      preloadImage: async () => undefined,
    });

    const assertion = expect(promise).rejects.toMatchObject({ code: "render-timeout" });
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
  });

  it("honors cancellation before any image work begins", async () => {
    const controller = new AbortController();
    controller.abort();
    const preloadImage = vi.fn(async (_source: string, _signal?: AbortSignal) => undefined);

    await expect(waitForStudioCaptureReady({
      pageId: "page-1",
      getRenderedPageId: () => "page-1",
      getStage: () => stage(),
      assetSources: ["private-source"],
      signal: controller.signal,
      nextFrame: async () => undefined,
      waitForFonts: async () => undefined,
      preloadImage,
    })).rejects.toMatchObject({ code: "aborted" });

    expect(preloadImage).not.toHaveBeenCalled();
  });

  it("does not reflect a private asset URL when decode fails", async () => {
    const privateSource = "https://assets.example/private.png?token=do-not-reflect";
    const promise = waitForStudioCaptureReady({
      pageId: "page-1",
      getRenderedPageId: () => "page-1",
      getStage: () => stage(),
      assetSources: [privateSource],
      nextFrame: async () => undefined,
      waitForFonts: async () => undefined,
      preloadImage: async () => {
        throw new Error(privateSource);
      },
    });

    await expect(promise).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(StudioCaptureReadinessError);
      expect((error as StudioCaptureReadinessError).code).toBe("asset-load");
      expect((error as Error).message).not.toContain("do-not-reflect");
      return true;
    });
  });

  it("rejects pathological per-page asset counts before starting decodes", async () => {
    const preloadImage = vi.fn(async () => undefined);
    const promise = waitForStudioCaptureReady({
      pageId: "page-1",
      getRenderedPageId: () => "page-1",
      getStage: () => stage(),
      assetSources: Array.from(
        { length: STUDIO_CAPTURE_READY_MAX_ASSETS + 1 },
        (_, index) => `blob:asset-${index}`
      ),
      nextFrame: async () => undefined,
      waitForFonts: async () => undefined,
      preloadImage,
    });

    await expect(promise).rejects.toMatchObject({ code: "asset-limit" });
    expect(preloadImage).not.toHaveBeenCalled();
  });

  it("resolves a strict linked-3D CAS locator with the injected authority and revokes after preload", async () => {
    const targetStage = stage();
    const authority = linked3dPassAuthority();
    const revoke = vi.fn();
    const resolveLinked3dPassRasterSource = vi.fn(async () => ({
      src: "blob:verified-linked-3d-pass",
      revoke,
    }));
    const preloadImage = vi.fn(async (_source: string, _signal?: AbortSignal) => undefined);

    await expect(waitForStudioCaptureReady({
      pageId: "page-1",
      getRenderedPageId: () => "page-1",
      getStage: () => targetStage,
      assetSources: [LINKED_3D_LOCATOR, "blob:ordinary"],
      linked3dPassAuthority: authority,
      resolveLinked3dPassRasterSource,
      nextFrame: async () => undefined,
      waitForFonts: async () => undefined,
      preloadImage,
    })).resolves.toBeDefined();

    expect(resolveLinked3dPassRasterSource).toHaveBeenCalledOnce();
    expect(resolveLinked3dPassRasterSource).toHaveBeenCalledWith(
      LINKED_3D_LOCATOR,
      authority,
      expect.any(AbortSignal),
    );
    expect(preloadImage.mock.calls.map(([source]) => source)).toEqual(expect.arrayContaining([
      "blob:verified-linked-3d-pass",
      "blob:ordinary",
    ]));
    expect(preloadImage).not.toHaveBeenCalledWith(LINKED_3D_LOCATOR, expect.anything());
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("waits for an exact linked-pass Konva draw receipt before returning the capture stage", async () => {
    const targetStage = stage();
    const waitForRasterPresentations = vi.fn(async (
      identities: readonly { elementId: string; src: string }[],
      requestDraw: () => void,
    ) => {
      expect(targetStage.drawCount).toBe(0);
      expect(identities).toEqual([{ elementId: "line-1", src: LINKED_3D_LOCATOR }]);
      requestDraw();
      expect(targetStage.drawCount).toBe(1);
    });

    await expect(waitForStudioCaptureReady({
      pageId: "page-1",
      getRenderedPageId: () => "page-1",
      getStage: () => targetStage,
      rasterPresentationIdentities: [{ elementId: "line-1", src: LINKED_3D_LOCATOR }],
      waitForRasterPresentations,
      nextFrame: async () => undefined,
      waitForFonts: async () => undefined,
      preloadImage: async () => undefined,
    })).resolves.toBe(targetStage);

    expect(waitForRasterPresentations).toHaveBeenCalledOnce();
  });

  it("fails closed before resolver or preload when a linked-3D locator hash is not strict", async () => {
    const resolveLinked3dPassRasterSource = vi.fn();
    const preloadImage = vi.fn(async () => undefined);

    await expect(waitForStudioCaptureReady({
      pageId: "page-1",
      getRenderedPageId: () => "page-1",
      getStage: () => stage(),
      assetSources: [`studio-opfs-cas:sha256:${"A".repeat(64)}`],
      resolveLinked3dPassRasterSource,
      nextFrame: async () => undefined,
      waitForFonts: async () => undefined,
      preloadImage,
    })).rejects.toMatchObject({ code: "asset-load" });

    expect(resolveLinked3dPassRasterSource).not.toHaveBeenCalled();
    expect(preloadImage).not.toHaveBeenCalled();
  });

  it("fails closed when CAS authority rejects a well-formed locator hash", async () => {
    const resolveLinked3dPassRasterSource = vi.fn(async () => {
      throw new Error("integrity-mismatch");
    });
    const preloadImage = vi.fn(async () => undefined);

    await expect(waitForStudioCaptureReady({
      pageId: "page-1",
      getRenderedPageId: () => "page-1",
      getStage: () => stage(),
      assetSources: [LINKED_3D_LOCATOR],
      resolveLinked3dPassRasterSource,
      nextFrame: async () => undefined,
      waitForFonts: async () => undefined,
      preloadImage,
    })).rejects.toMatchObject({ code: "asset-load" });

    expect(resolveLinked3dPassRasterSource).toHaveBeenCalledOnce();
    expect(preloadImage).not.toHaveBeenCalled();
  });

  it("revokes a resolved linked-3D Blob URL exactly once when preload fails", async () => {
    const revoke = vi.fn();

    await expect(waitForStudioCaptureReady({
      pageId: "page-1",
      getRenderedPageId: () => "page-1",
      getStage: () => stage(),
      assetSources: [LINKED_3D_LOCATOR],
      resolveLinked3dPassRasterSource: async () => ({
        src: "blob:decode-error",
        revoke,
      }),
      nextFrame: async () => undefined,
      waitForFonts: async () => undefined,
      preloadImage: async () => {
        throw new Error("decode failed");
      },
    })).rejects.toMatchObject({ code: "asset-load" });

    expect(revoke).toHaveBeenCalledOnce();
  });

  it("revokes a resolved linked-3D Blob URL exactly once on cancellation", async () => {
    const controller = new AbortController();
    const revoke = vi.fn();
    let notePreloadStarted: (() => void) | null = null;
    const preloadStarted = new Promise<void>((resolve) => {
      notePreloadStarted = resolve;
    });
    const promise = waitForStudioCaptureReady({
      pageId: "page-1",
      getRenderedPageId: () => "page-1",
      getStage: () => stage(),
      assetSources: [LINKED_3D_LOCATOR],
      signal: controller.signal,
      resolveLinked3dPassRasterSource: async () => ({
        src: "blob:cancelled",
        revoke,
      }),
      nextFrame: async () => undefined,
      waitForFonts: async () => undefined,
      preloadImage: (_source, signal) => new Promise((_resolve, reject) => {
        notePreloadStarted?.();
        signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      }),
    });

    await preloadStarted;
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "aborted" });
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("revokes a resolved linked-3D Blob URL exactly once when readiness times out", async () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    const preloadImage = vi.fn(() => new Promise<void>(() => undefined));
    const promise = waitForStudioCaptureReady({
      pageId: "page-1",
      getRenderedPageId: () => "page-1",
      getStage: () => stage(),
      assetSources: [LINKED_3D_LOCATOR],
      timeoutMs: 250,
      resolveLinked3dPassRasterSource: async () => ({
        src: "blob:timed-out",
        revoke,
      }),
      nextFrame: async () => undefined,
      waitForFonts: async () => undefined,
      preloadImage,
    });

    await vi.waitFor(() => expect(preloadImage).toHaveBeenCalledOnce());
    const assertion = expect(promise).rejects.toMatchObject({ code: "render-timeout" });
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
    expect(revoke).toHaveBeenCalledOnce();
  });
});

describe("collectStudioCaptureAssetSources", () => {
  it("collects and deduplicates only raster and mask dependencies from pages and master", () => {
    expect(collectStudioCaptureAssetSources(
      {
        id: "page-1",
        elements: [
          { type: "image", src: " data:image/png;base64,AA ", prompt: "private prompt" },
          { type: "image", src: "data:image/png;base64,AA", maskSrc: "blob:mask" },
          { type: "text", text: "not an asset", sourceUrl: "https://ignore.example" },
        ],
      },
      { elements: [{ type: "image", src: "blob:master" }] },
      { elements: "malformed" }
    )).toEqual(["data:image/png;base64,AA", "blob:mask", "blob:master"]);
  });

  it("returns an empty list for malformed and private non-render fields", () => {
    expect(collectStudioCaptureAssetSources(
      null,
      { elements: [{ requestId: "provider-secret", referenceAssetIds: ["asset-1"] }] }
    )).toEqual([]);
  });
});
