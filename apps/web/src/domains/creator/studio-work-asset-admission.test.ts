import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StudioWorkAssetAdmissionCoordinator,
  createStudioWorkAssetInitialImageDescriptor,
  readBoundedStudioWorkAssetLocalImage,
  replaceStudioWorkAssetSourceAcrossHistory,
} from "./studio-work-asset-admission";

import {
  STUDIO_WORK_ASSET_IMAGE_ADMISSION_OPT_IN_TOKEN,
  STUDIO_WORK_ASSET_MAX_CURVE_POINTS,
  type StudioWorkAssetManifest,
} from "@/shared/lib/studio-work-asset-contract";

function image(id: string, src: string, x = 10) {
  return {
    id,
    type: "image" as const,
    src,
    x,
    y: 20,
    width: 300,
    height: 400,
    rotation: 5,
    opacity: 0.75,
    hidden: false,
    locked: true,
    lockAspect: true,
    flipped: true,
    blur: 4,
    brightness: 0.2,
    smartFilters: { private: "large-program" },
  };
}

function manifest(id: string, x = 10): StudioWorkAssetManifest {
  return {
    version: 1,
    assetId: id,
    elementType: "image",
    mimeType: "image/png",
    byteSize: 4,
    sha256: "a".repeat(64),
    intrinsicImage: { width: 1, height: 1, decodedRgbaBytes: 4 },
    descriptor: {
      version: 1,
      element: {
        id,
        type: "image",
        x,
        y: 20,
        width: 300,
        height: 400,
        rotation: 5,
      },
    },
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

function page(elements: ReturnType<typeof image>[]) {
  return { id: "page-1", elements };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("studio work asset admission", () => {
  beforeEach(() => {
    vi.stubEnv(
      "VITE_STUDIO_WORK_ASSET_IMAGE_ADMISSION",
      STUDIO_WORK_ASSET_IMAGE_ADMISSION_OPT_IN_TOKEN
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps automatic admission disabled unless the exact browser opt-in token is present", async () => {
    const readLocalImage = vi.fn(async () => new Blob([Uint8Array.of(1)]));
    const upload = vi.fn(async () => manifest("image-1"));
    const coordinator = new StudioWorkAssetAdmissionCoordinator({
      readLocalImage,
      upload,
      imageAdmissionOptIn: "true",
    });
    coordinator.sync({
      workId: "work-1",
      authUserId: "editor-1",
      editable: true,
      pages: [page([image("image-1", "blob:local")])],
      onAdmitted: vi.fn(),
      onError: vi.fn(),
    });
    await flush();
    expect(readLocalImage).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it("builds an immutable bounded descriptor without source bytes or unvalidated filter programs", () => {
    const descriptor = createStudioWorkAssetInitialImageDescriptor(image(
      "image-1",
      "data:image/png;base64,private"
    ));
    expect(descriptor.element).toMatchObject({
      id: "image-1",
      type: "image",
      x: 10,
      y: 20,
      width: 300,
      height: 400,
      rotation: 5,
      opacity: 0.75,
      locked: true,
      lockAspect: true,
      flipped: true,
      blur: 4,
      brightness: 0.2,
    });
    expect(descriptor.element).not.toHaveProperty("src");
    expect(descriptor.element).not.toHaveProperty("smartFilters");
    expect(JSON.stringify(descriptor)).not.toContain("base64");
  });

  it("keeps the page-composite marker in the detached immutable image descriptor", () => {
    const source = {
      ...image("filter-composite-1", "data:image/png;base64,private"),
      filterPageComposite: true,
    };
    const descriptor = createStudioWorkAssetInitialImageDescriptor(source);

    source.filterPageComposite = false;
    expect(descriptor.element).toMatchObject({
      id: "filter-composite-1",
      type: "image",
      filterPageComposite: true,
    });
    expect(descriptor.element).not.toHaveProperty("src");
  });

  it("detaches bounded blur, tonal extrema, and curve metadata for shared references", () => {
    const source = {
      ...image("filter-composite-1", "data:image/png;base64,private"),
      blurFx: { type: "motion" as const, strength: 100, radius: 40, angle: 315 },
      brightness: -0.8,
      contrast: 80,
      hue: -180,
      saturation: 1,
      curve: [{ x: 0, y: 10 }, { x: 128, y: 144 }, { x: 255, y: 245 }],
      curveCh: {
        r: [{ x: 0, y: 0 }, { x: 255, y: 240 }],
        g: [{ x: 0, y: 12 }, { x: 255, y: 255 }],
      },
    };
    const descriptor = createStudioWorkAssetInitialImageDescriptor(source);

    source.blurFx.radius = 2;
    source.curve[1]!.y = 20;
    source.curveCh.r[1]!.y = 20;
    expect(descriptor.element).toMatchObject({
      blurFx: { type: "motion", strength: 100, radius: 40, angle: 315 },
      brightness: -0.8,
      contrast: 80,
      hue: -180,
      saturation: 1,
      curve: [{ x: 0, y: 10 }, { x: 128, y: 144 }, { x: 255, y: 245 }],
      curveCh: {
        r: [{ x: 0, y: 0 }, { x: 255, y: 240 }],
        g: [{ x: 0, y: 12 }, { x: 255, y: 255 }],
      },
    });
  });

  it("fails closed before admission when a curve exceeds the shared point budget", () => {
    const curve = Array.from(
      { length: STUDIO_WORK_ASSET_MAX_CURVE_POINTS + 1 },
      (_, index) => ({
        x: Math.round(index * 255 / STUDIO_WORK_ASSET_MAX_CURVE_POINTS),
        y: index,
      })
    );

    expect(() => createStudioWorkAssetInitialImageDescriptor({
      ...image("filter-composite-1", "data:image/png;base64,private"),
      curve,
    })).toThrow();
  });

  it("includes only a normalized bounded smart-filter snapshot", () => {
    const smartFilters = {
      version: 1 as const,
      entries: [{
        id: "tone-1",
        engine: "brightness-contrast" as const,
        enabled: true,
        params: { brightness: 0.2 },
      }],
    };
    const descriptor = createStudioWorkAssetInitialImageDescriptor({
      ...image("image-1", "blob:local"),
      smartFilters,
    });

    expect(descriptor.element.smartFilters).toEqual(smartFilters);
    smartFilters.entries[0]!.params.brightness = 0.7;
    expect(descriptor.element.smartFilters?.entries[0]?.params.brightness).toBe(0.2);

    const overBudget = createStudioWorkAssetInitialImageDescriptor({
      ...image("image-2", "blob:local"),
      smartFilters: {
        version: 1,
        entries: Array.from({ length: 24 }, (_, index) => ({
          id: `filter-${index}`,
          engine: "custom-convolution",
          enabled: true,
          params: { payload: "x".repeat(128) },
        })),
      },
    });
    expect(overBudget.element).not.toHaveProperty("smartFilters");
  });

  it("never fetches arbitrary URLs and rejects over-budget Content-Length before allocation", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn();
    await expect(readBoundedStudioWorkAssetLocalImage(
      "https://private.example/image.png",
      signal,
      fetcher
    )).rejects.toThrow(/data:.*blob:/u);
    expect(fetcher).not.toHaveBeenCalled();

    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    fetcher.mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Length": String(8 * 1024 * 1024 + 1) }),
      body: null,
      arrayBuffer,
    } as unknown as Response);
    await expect(readBoundedStudioWorkAssetLocalImage("blob:oversized", signal, fetcher))
      .rejects.toThrow(/8MB/u);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("deduplicates an in-flight upload and emits a receipt only after server admission", async () => {
    const uploadPending = deferred<StudioWorkAssetManifest>();
    const readLocalImage = vi.fn(async () => new Blob([Uint8Array.of(1, 2, 3, 4)], {
      type: "image/png",
    }));
    const upload = vi.fn(() => uploadPending.promise);
    const onAdmitted = vi.fn();
    const onError = vi.fn();
    const coordinator = new StudioWorkAssetAdmissionCoordinator({ readLocalImage, upload });
    const input = {
      workId: "work-1",
      authUserId: "editor-1",
      editable: true,
      pages: [page([image("image-1", "data:image/png;base64,local")])],
      onAdmitted,
      onError,
    };
    coordinator.sync(input);
    coordinator.sync(input);
    await flush();
    expect(readLocalImage).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
    expect(onAdmitted).not.toHaveBeenCalled();

    uploadPending.resolve(manifest("image-1"));
    await flush();
    expect(onAdmitted).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "image-1",
      source: "data:image/png;base64,local",
      canonicalSource: "work-asset://image/image-1",
    }));
    expect(onError).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it("compensates an upload when the page no longer accepts its exact local source", async () => {
    const cleanup = vi.fn(async () => true);
    const onAdmitted = vi.fn(() => false);
    const coordinator = new StudioWorkAssetAdmissionCoordinator({
      readLocalImage: async () => new Blob([Uint8Array.of(1)], { type: "image/png" }),
      upload: async () => manifest("image-1"),
      cleanup,
    });
    coordinator.sync({
      workId: "work-1",
      authUserId: "editor-1",
      editable: true,
      pages: [page([image("image-1", "blob:stale")])],
      onAdmitted,
      onError: vi.fn(),
    });
    await flush();

    expect(onAdmitted).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith(
      "work-1",
      { assetId: "image-1", elementType: "image" },
      "a".repeat(64)
    );
    coordinator.dispose();
  });

  it("attempts safe compensation when local publication rejects after upload", async () => {
    const cleanup = vi.fn(async () => false);
    const onError = vi.fn();
    const coordinator = new StudioWorkAssetAdmissionCoordinator({
      readLocalImage: async () => new Blob([Uint8Array.of(1)], { type: "image/png" }),
      upload: async () => manifest("image-1"),
      cleanup,
    });
    coordinator.sync({
      workId: "work-1",
      authUserId: "editor-1",
      editable: true,
      pages: [page([image("image-1", "blob:publish-failed")])],
      onAdmitted: async () => {
        throw new Error("publish failed");
      },
      onError,
    });
    await flush();

    expect(cleanup).toHaveBeenCalledWith(
      "work-1",
      { assetId: "image-1", elementType: "image" },
      "a".repeat(64)
    );
    expect(onError).toHaveBeenCalledWith(
      "publish failed",
      expect.objectContaining({ assetId: "image-1" })
    );
    coordinator.dispose();
  });

  it("cleans a superseded receipt before starting the replacement upload for the same ID", async () => {
    const firstUpload = deferred<StudioWorkAssetManifest>();
    const cleanupPending = deferred<boolean>();
    const cleanup = vi.fn(() => cleanupPending.promise);
    const upload = vi.fn()
      .mockImplementationOnce(() => firstUpload.promise)
      .mockResolvedValueOnce(manifest("image-1", 30));
    const coordinator = new StudioWorkAssetAdmissionCoordinator({
      readLocalImage: async () => new Blob([Uint8Array.of(1)], { type: "image/png" }),
      upload,
      cleanup,
    });
    const base = {
      workId: "work-1",
      authUserId: "editor-1",
      editable: true,
      onAdmitted: vi.fn(() => true),
      onError: vi.fn(),
    };
    coordinator.sync({
      ...base,
      pages: [page([image("image-1", "blob:first")])],
    });
    await flush();
    coordinator.sync({
      ...base,
      pages: [page([image("image-1", "blob:replacement", 30)])],
    });
    expect(upload).toHaveBeenCalledOnce();

    firstUpload.resolve(manifest("image-1"));
    await flush();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();

    cleanupPending.resolve(true);
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1]?.[1]).toMatchObject({ assetId: "image-1" });
    coordinator.dispose();
  });

  it("bounds concurrent image reads and uploads, then drains the queue in source order", async () => {
    const pending = new Map<string, ReturnType<typeof deferred<StudioWorkAssetManifest>>>();
    const readLocalImage = vi.fn(async () => new Blob([Uint8Array.of(1)], {
      type: "image/png",
    }));
    const upload = vi.fn((
      _workId: string,
      reference: { assetId: string }
    ) => {
      const request = deferred<StudioWorkAssetManifest>();
      pending.set(reference.assetId, request);
      return request.promise;
    });
    const coordinator = new StudioWorkAssetAdmissionCoordinator({
      readLocalImage,
      upload: upload as never,
      maximumConcurrent: 2,
    });
    coordinator.sync({
      workId: "work-1",
      authUserId: "editor-1",
      editable: true,
      pages: [page(Array.from({ length: 5 }, (_, index) =>
        image(`image-${index + 1}`, `blob:${index + 1}`)
      ))],
      onAdmitted: vi.fn(),
      onError: vi.fn(),
    });
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls.map((call) => call[1].assetId)).toEqual(["image-1", "image-2"]);

    pending.get("image-1")?.resolve(manifest("image-1"));
    await flush();
    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls[2]?.[1].assetId).toBe("image-3");
    coordinator.dispose();
  });

  it("keeps an A/B/A duplicate ID conflicted for the entire scan and reports it once", async () => {
    const readLocalImage = vi.fn(async () => new Blob([Uint8Array.of(1)]));
    const upload = vi.fn(async () => manifest("image-1"));
    const onError = vi.fn();
    const coordinator = new StudioWorkAssetAdmissionCoordinator({ readLocalImage, upload });
    const input = {
      workId: "work-1",
      authUserId: "editor-1",
      editable: true,
      pages: [page([
        image("image-1", "blob:A"),
        image("image-1", "blob:B"),
        image("image-1", "blob:A"),
      ])],
      onAdmitted: vi.fn(),
      onError,
    };

    coordinator.sync(input);
    coordinator.sync(input);
    await flush();
    expect(readLocalImage).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/같은 이미지 ID/u),
      expect.objectContaining({ assetId: "image-1" })
    );
    coordinator.dispose();
  });

  it("fails one malformed descriptor without blocking a different valid image", async () => {
    const readLocalImage = vi.fn(async () => new Blob([Uint8Array.of(1)]));
    const upload = vi.fn(async (
      _workId: string,
      reference: { assetId: string }
    ) => manifest(reference.assetId));
    const onAdmitted = vi.fn();
    const onError = vi.fn();
    const coordinator = new StudioWorkAssetAdmissionCoordinator({
      readLocalImage,
      upload: upload as never,
    });
    coordinator.sync({
      workId: "work-1",
      authUserId: "editor-1",
      editable: true,
      pages: [page([
        { ...image("broken", "blob:broken"), width: 0 },
        image("valid", "blob:valid"),
      ])],
      onAdmitted,
      onError,
    });
    await flush();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/안전 범위/u),
      expect.objectContaining({ assetId: "broken" })
    );
    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0]?.[1]).toMatchObject({ assetId: "valid" });
    expect(onAdmitted).toHaveBeenCalledWith(expect.objectContaining({ assetId: "valid" }));
    coordinator.dispose();
  });

  it("aborts on source/scope changes and leaves failed local sources retryable only after a change", async () => {
    const pending = deferred<StudioWorkAssetManifest>();
    const signals: AbortSignal[] = [];
    const readLocalImage = vi.fn(async (_source: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Blob([Uint8Array.of(1)], { type: "image/png" });
    });
    const upload = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(manifest("image-1", 30));
    const onAdmitted = vi.fn();
    const onError = vi.fn();
    const coordinator = new StudioWorkAssetAdmissionCoordinator({
      readLocalImage,
      upload,
      cleanup: vi.fn(async () => true),
    });
    const base = {
      workId: "work-1",
      authUserId: "editor-1",
      editable: true,
      onAdmitted,
      onError,
    };
    coordinator.sync({
      ...base,
      pages: [page([image("image-1", "blob:first")])],
    });
    await flush();
    coordinator.sync({
      ...base,
      pages: [page([image("image-1", "blob:second", 20)])],
    });
    expect(signals[0]?.aborted).toBe(true);
    pending.resolve(manifest("image-1"));
    await flush();
    expect(onAdmitted).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("offline", expect.objectContaining({ source: "blob:second" }));

    coordinator.sync({
      ...base,
      pages: [page([image("image-1", "blob:second", 20)])],
    });
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);

    coordinator.sync({
      ...base,
      pages: [page([image("image-1", "blob:third", 30)])],
    });
    await flush();
    expect(upload).toHaveBeenCalledTimes(3);
    expect(onAdmitted).toHaveBeenCalledWith(expect.objectContaining({ source: "blob:third" }));

    coordinator.sync({ ...base, editable: false, pages: [] });
    expect(signals.at(-1)?.aborted).toBe(false);
    coordinator.dispose();
  });

  it("replaces only the exact admitted source throughout undo history", () => {
    const first = image("image-1", "blob:pending", 10);
    const changedSource = image("image-1", "blob:newer", 30);
    const unrelated = image("image-2", "blob:pending", 40);
    const history = [
      [page([first, unrelated])],
      [page([{ ...first, x: 20 }])],
      [page([changedSource])],
    ];
    const result = replaceStudioWorkAssetSourceAcrossHistory({
      history,
      currentIndex: 1,
      assetId: "image-1",
      expectedSource: "blob:pending",
      canonicalSource: "work-asset://image/image-1",
    });
    expect(result.changed).toBe(true);
    expect(result.history[0]![0]!.elements[0]!.src).toBe("work-asset://image/image-1");
    expect(result.history[1]![0]!.elements[0]!.src).toBe("work-asset://image/image-1");
    expect(result.history[2]![0]!.elements[0]!.src).toBe("blob:newer");
    expect(result.history[0]![0]!.elements[1]!.src).toBe("blob:pending");
    expect(result.previousCurrentPages[0]!.elements[0]!.src).toBe("blob:pending");
    expect(result.nextCurrentPages[0]!.elements[0]!.src).toBe("work-asset://image/image-1");
    expect(history[0]![0]!.elements[0]!.src).toBe("blob:pending");
  });
});
