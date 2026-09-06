import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  createStudioOpenCvImageProvider,
  type StudioOpenCvImageArtifact,
  type StudioOpenCvImageResult,
} from "./studio-opencv-image-provider";

import type { CV, Mat } from "@techstark/opencv-js";

interface FakeRuntimeOptions {
  readonly throwMorphology?: boolean;
  readonly failDeleteId?: number;
  readonly contourCount?: number;
}

interface FakeRuntimeHarness {
  readonly runtime: CV;
  readonly events: string[];
  readonly morphologyCalls: Array<{
    operation: number;
    iterations: number;
    shape: number;
  }>;
  readonly warpCalls: Array<{
    width: number;
    height: number;
    interpolation: number;
    borderMode: number;
  }>;
}

function createFakeRuntime(options: FakeRuntimeOptions = {}): FakeRuntimeHarness {
  const events: string[] = [];
  const morphologyCalls: FakeRuntimeHarness["morphologyCalls"] = [];
  const warpCalls: FakeRuntimeHarness["warpCalls"] = [];
  let nextId = 1;

  const types = {
    CV_8UC1: 1,
    CV_8UC3: 3,
    CV_8UC4: 4,
    CV_32S: 10,
    CV_32SC1: 10,
    CV_32SC2: 11,
    CV_32SC4: 13,
    CV_32FC2: 21,
    CV_64F: 30,
    CV_64FC1: 30,
  } as const;

  function channelCount(type: number): number {
    if (type === types.CV_8UC3) return 3;
    if (type === types.CV_8UC4 || type === types.CV_32SC4) return 4;
    if (type === types.CV_32SC2 || type === types.CV_32FC2) return 2;
    return 1;
  }

  class FakeMat {
    readonly id = nextId++;
    rows = 0;
    cols = 0;
    data8U = new Uint8Array();
    data32S = new Int32Array();
    data32F = new Float32Array();
    data64F = new Float64Array();
    private matType: number = types.CV_8UC1;
    private deleted = false;

    constructor(rows?: number, cols?: number, type?: number) {
      events.push(`create:${this.id}`);
      if (rows !== undefined && cols !== undefined && type !== undefined) {
        this.configure(rows, cols, type);
      }
    }

    configure(rows: number, cols: number, type: number): void {
      this.rows = rows;
      this.cols = cols;
      this.matType = type;
      const values = rows * cols * channelCount(type);
      this.data8U = type <= types.CV_8UC4 ? new Uint8Array(values) : new Uint8Array();
      this.data32S = (
        type === types.CV_32SC1
        || type === types.CV_32SC2
        || type === types.CV_32SC4
      ) ? new Int32Array(values) : new Int32Array();
      this.data32F = type === types.CV_32FC2 ? new Float32Array(values) : new Float32Array();
      this.data64F = type === types.CV_64FC1 ? new Float64Array(values) : new Float64Array();
    }

    channels(): number {
      return channelCount(this.matType);
    }

    type(): number {
      return this.matType;
    }

    delete(): void {
      if (this.deleted) throw new Error("double delete");
      this.deleted = true;
      events.push(`delete:${this.id}`);
      if (this.id === options.failDeleteId) throw new Error("configured delete failure");
    }
  }

  class FakeMatVector {
    readonly id = nextId++;
    private values: Int32Array[] = [];
    private deleted = false;

    constructor() {
      events.push(`create:${this.id}`);
    }

    setValues(values: readonly Int32Array[]): void {
      this.values = values.map((value) => new Int32Array(value));
    }

    size(): number {
      return this.values.length;
    }

    get(index: number): Mat {
      const mat = new FakeMat();
      const value = this.values[index]!;
      mat.configure(value.length / 2, 1, types.CV_32SC2);
      mat.data32S.set(value);
      return mat as unknown as Mat;
    }

    delete(): void {
      if (this.deleted) throw new Error("double delete");
      this.deleted = true;
      events.push(`delete:${this.id}`);
      if (this.id === options.failDeleteId) throw new Error("configured delete failure");
    }
  }

  class FakePoint {
    constructor(
      readonly x: number,
      readonly y: number,
    ) {}
  }

  class FakeSize {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
  }

  class FakeScalar extends Array<number> {
    constructor(...values: number[]) {
      super(...values);
      Object.setPrototypeOf(this, FakeScalar.prototype);
    }
  }

  const runtime = {
    ...types,
    MORPH_RECT: 40,
    MORPH_CROSS: 41,
    MORPH_ELLIPSE: 42,
    MORPH_ERODE: 50,
    MORPH_DILATE: 51,
    MORPH_OPEN: 52,
    MORPH_CLOSE: 53,
    MORPH_GRADIENT: 54,
    RETR_EXTERNAL: 60,
    RETR_LIST: 61,
    RETR_CCOMP: 62,
    RETR_TREE: 63,
    CHAIN_APPROX_SIMPLE: 70,
    INTER_NEAREST: 80,
    INTER_LINEAR: 81,
    INTER_CUBIC: 82,
    BORDER_CONSTANT: 90,
    BORDER_REPLICATE: 91,
    BORDER_REFLECT: 92,
    Mat: FakeMat,
    MatVector: FakeMatVector,
    Point: FakePoint,
    Size: FakeSize,
    Scalar: FakeScalar,
    matFromArray(
      rows: number,
      cols: number,
      type: number,
      array: ArrayBufferView,
    ): Mat {
      const mat = new FakeMat(rows, cols, type);
      if (type <= types.CV_8UC4) {
        mat.data8U.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      } else if (type === types.CV_32FC2) {
        mat.data32F.set(
          new Float32Array(array.buffer, array.byteOffset, array.byteLength / 4),
        );
      }
      return mat as unknown as Mat;
    },
    getStructuringElement(shape: number, size: FakeSize): Mat {
      const mat = new FakeMat(size.height, size.width, types.CV_8UC1);
      mat.data8U.fill(shape);
      return mat as unknown as Mat;
    },
    morphologyEx(
      source: FakeMat,
      destination: FakeMat,
      operation: number,
      kernel: FakeMat,
      _anchor: FakePoint,
      iterations: number,
    ): void {
      morphologyCalls.push({ operation, iterations, shape: kernel.data8U[0]! });
      if (options.throwMorphology) throw new Error("configured morphology failure");
      destination.configure(source.rows, source.cols, source.type());
      for (let index = 0; index < source.data8U.length; index += 1) {
        destination.data8U[index] = (source.data8U[index]! + operation + iterations) & 0xff;
      }
    },
    connectedComponentsWithStats(
      source: FakeMat,
      labels: FakeMat,
      stats: FakeMat,
      centroids: FakeMat,
    ): number {
      labels.configure(source.rows, source.cols, types.CV_32SC1);
      labels.data32S.set([0, 1, 1, 0, 0, 2, 2, 0, 0]);
      stats.configure(3, 5, types.CV_32SC1);
      stats.data32S.set([
        0, 0, 3, 3, 5,
        1, 0, 2, 1, 2,
        1, 1, 2, 1, 2,
      ]);
      centroids.configure(3, 2, types.CV_64FC1);
      centroids.data64F.set([0.5, 1.5, 1.5, 0, 1.5, 1]);
      return 3;
    },
    findContours(
      _source: FakeMat,
      contours: FakeMatVector,
      hierarchy: FakeMat,
    ): void {
      const values = [
        Int32Array.from([0, 0, 2, 0, 2, 2, 0, 2]),
        Int32Array.from([4, 4, 5, 4, 5, 5]),
      ].slice(0, options.contourCount ?? 2);
      contours.setValues(values);
      hierarchy.configure(1, values.length, types.CV_32SC4);
      hierarchy.data32S.set(
        values.flatMap((_, index) => [
          index + 1 < values.length ? index + 1 : -1,
          index > 0 ? index - 1 : -1,
          -1,
          -1,
        ]),
      );
    },
    getPerspectiveTransform(): Mat {
      const transform = new FakeMat(3, 3, types.CV_64FC1);
      transform.data64F.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      return transform as unknown as Mat;
    },
    warpPerspective(
      source: FakeMat,
      destination: FakeMat,
      _transform: FakeMat,
      size: FakeSize,
      interpolation: number,
      borderMode: number,
    ): void {
      warpCalls.push({
        width: size.width,
        height: size.height,
        interpolation,
        borderMode,
      });
      destination.configure(size.height, size.width, source.type());
      for (let index = 0; index < destination.data8U.length; index += 1) {
        destination.data8U[index] = source.data8U[index % source.data8U.length]!;
      }
    },
  };

  return {
    runtime: runtime as unknown as CV,
    events,
    morphologyCalls,
    warpCalls,
  };
}

function requireArtifact(result: StudioOpenCvImageResult): StudioOpenCvImageArtifact {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  return result.artifact;
}

function mask3x3(): Uint8Array {
  return Uint8Array.from([
    0, 255, 255,
    0, 0, 255,
    0, 0, 0,
  ]);
}

function expectReverseCleanup(events: readonly string[]): void {
  const created = events
    .filter((event) => event.startsWith("create:"))
    .map((event) => event.slice("create:".length));
  const deleted = events
    .filter((event) => event.startsWith("delete:"))
    .map((event) => event.slice("delete:".length));
  expect(deleted).toEqual([...created].reverse());
}

describe("StudioOpenCvImageProvider", () => {
  it("rejects invalid and over-budget input before invoking the lazy runtime loader", async () => {
    const loader = vi.fn(() => createFakeRuntime().runtime);
    const provider = createStudioOpenCvImageProvider({
      requestEpoch: 7,
      runtimeLoader: loader,
      limits: { maxPixels: 4, maxWidth: 4, maxHeight: 4 },
    });

    await expect(provider.execute({
      operation: "connected-components",
      requestEpoch: 7,
      image: { width: 2, height: 2, channels: 1, data: new Uint8Array(3) },
    })).resolves.toMatchObject({ ok: false, reason: "invalid-input" });
    await expect(provider.execute({
      operation: "morphology",
      requestEpoch: 7,
      image: { width: 3, height: 2, channels: 1, data: new Uint8Array(6) },
      mode: "open",
      kernel: { shape: "ellipse", width: 3, height: 3 },
    })).resolves.toMatchObject({ ok: false, reason: "budget-exceeded" });

    expect(loader).not.toHaveBeenCalled();
    expect(provider.getDiagnostics()).toMatchObject({
      phase: "cold",
      completedRequestCount: 0,
      rejectedRequestCount: 2,
      nativeHandleCreateCount: 0,
      nativeHandleDeleteCount: 0,
    });
  });

  it("retries lazy OpenCV initialization after a transient loader failure", async () => {
    const fake = createFakeRuntime();
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(fake.runtime);
    const provider = createStudioOpenCvImageProvider({
      requestEpoch: 7,
      runtimeLoader: loader,
    });
    const request = {
      operation: "morphology",
      requestEpoch: 7,
      image: { width: 3, height: 3, channels: 1, data: mask3x3() },
      mode: "open",
      kernel: { shape: "ellipse", width: 3, height: 3 },
    } as const;

    await expect(provider.execute(request)).resolves.toMatchObject({
      ok: false,
      reason: "provider-unavailable",
    });
    await expect(provider.execute(request)).resolves.toMatchObject({ ok: true });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["erode", 50],
    ["dilate", 51],
    ["open", 52],
    ["close", 53],
    ["gradient", 54],
  ] as const)("runs bounded %s morphology and copies output before reverse cleanup", async (
    mode,
    expectedOperation,
  ) => {
    const fake = createFakeRuntime();
    const provider = createStudioOpenCvImageProvider({
      requestEpoch: 2,
      runtimeLoader: () => fake.runtime,
    });
    const input = mask3x3();
    const before = new Uint8Array(input);
    const artifact = requireArtifact(await provider.execute({
      operation: "morphology",
      requestEpoch: 2,
      image: { width: 3, height: 3, channels: 1, data: input },
      mode,
      kernel: { shape: "ellipse", width: 3, height: 3 },
      iterations: 2,
    }));

    expect(artifact.operation).toBe("morphology");
    if (artifact.operation !== "morphology") return;
    expect(artifact.mode).toBe(mode);
    expect(artifact.image).toMatchObject({ width: 3, height: 3, channels: 1 });
    expect(artifact.image.data).not.toBe(input);
    expect(artifact.image.data).toEqual(
      Uint8Array.from(before, (value) => (value + expectedOperation + 2) & 0xff),
    );
    expect(input).toEqual(before);
    expect(fake.morphologyCalls).toEqual([{
      operation: expectedOperation,
      iterations: 2,
      shape: 42,
    }]);
    expect(artifact.receipt).toMatchObject({
      packageName: "@techstark/opencv-js",
      packageVersion: "5.0.0-release.1",
      runtimeSource: "injected",
      intendedHost: "dedicated-worker",
      synchronousJsFallback: false,
      nativeHandlesReturned: false,
      outputOwnership: "defensive-copy",
    });
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.image)).toBe(true);
    expect(Object.isFrozen(artifact.receipt)).toBe(true);
    expectReverseCleanup(fake.events);
    expect(provider.getDiagnostics()).toMatchObject({
      phase: "ready",
      nativeHandleCreateCount: 3,
      nativeHandleDeleteCount: 3,
    });
  });

  it("returns labels and frozen foreground component metadata with exact shapes", async () => {
    const fake = createFakeRuntime();
    const provider = createStudioOpenCvImageProvider({
      requestEpoch: 0,
      runtimeLoader: () => fake.runtime,
    });
    const artifact = requireArtifact(await provider.execute({
      operation: "connected-components",
      requestEpoch: 0,
      image: { width: 3, height: 3, channels: 1, data: mask3x3() },
      connectivity: 8,
    }));

    expect(artifact.operation).toBe("connected-components");
    if (artifact.operation !== "connected-components") return;
    expect(artifact.labels).toEqual(Int32Array.from([0, 1, 1, 0, 0, 2, 2, 0, 0]));
    expect(artifact.components).toEqual([
      {
        label: 1,
        bounds: { x: 1, y: 0, width: 2, height: 1 },
        area: 2,
        centroid: { x: 1.5, y: 0 },
      },
      {
        label: 2,
        bounds: { x: 1, y: 1, width: 2, height: 1 },
        area: 2,
        centroid: { x: 1.5, y: 1 },
      },
    ]);
    expect(Object.isFrozen(artifact.components)).toBe(true);
    expect(Object.isFrozen(artifact.components[0])).toBe(true);
    expect(Object.isFrozen(artifact.components[0]!.bounds)).toBe(true);
    expectReverseCleanup(fake.events);
  });

  it("copies contour points and hierarchy while deleting MatVector and every child Mat in reverse", async () => {
    const fake = createFakeRuntime();
    const provider = createStudioOpenCvImageProvider({
      requestEpoch: 1,
      runtimeLoader: () => fake.runtime,
    });
    const artifact = requireArtifact(await provider.execute({
      operation: "contours",
      requestEpoch: 1,
      image: { width: 3, height: 3, channels: 1, data: mask3x3() },
      retrieval: "tree",
    }));

    expect(artifact.operation).toBe("contours");
    if (artifact.operation !== "contours") return;
    expect(artifact.contours).toHaveLength(2);
    expect(artifact.contours[0]).toMatchObject({
      pointCount: 4,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    });
    expect(artifact.contours[0]!.points).toEqual(
      Int32Array.from([0, 0, 2, 0, 2, 2, 0, 2]),
    );
    expect(artifact.contours[1]).toMatchObject({
      pointCount: 3,
      bounds: { minX: 4, minY: 4, maxX: 5, maxY: 5 },
    });
    expect(artifact.hierarchy).toEqual(
      Int32Array.from([1, -1, -1, -1, -1, 0, -1, -1]),
    );
    expectReverseCleanup(fake.events);
    expect(provider.getDiagnostics()).toMatchObject({
      nativeHandleCreateCount: 5,
      nativeHandleDeleteCount: 5,
    });
  });

  it("warps a typed-array image with a copied homography and exact output shape", async () => {
    const fake = createFakeRuntime();
    const provider = createStudioOpenCvImageProvider({
      requestEpoch: 4,
      runtimeLoader: () => fake.runtime,
    });
    const rgba = Uint8Array.from({ length: 2 * 2 * 4 }, (_, index) => index);
    const artifact = requireArtifact(await provider.execute({
      operation: "perspective-warp",
      requestEpoch: 4,
      image: { width: 2, height: 2, channels: 4, data: rgba },
      sourceQuad: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      destinationQuad: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 2 },
        { x: 0, y: 2 },
      ],
      output: { width: 4, height: 3 },
      interpolation: "cubic",
      borderMode: "reflect",
      borderValue: [0, 0, 0, 255],
    }));

    expect(artifact.operation).toBe("perspective-warp");
    if (artifact.operation !== "perspective-warp") return;
    expect(artifact.image).toMatchObject({ width: 4, height: 3, channels: 4 });
    expect(artifact.image.data).toHaveLength(48);
    expect(artifact.transform).toEqual(
      Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    );
    expect(fake.warpCalls).toEqual([{
      width: 4,
      height: 3,
      interpolation: 82,
      borderMode: 92,
    }]);
    expectReverseCleanup(fake.events);
    expect(provider.getDiagnostics()).toMatchObject({
      nativeHandleCreateCount: 5,
      nativeHandleDeleteCount: 5,
    });
  });

  it("fails closed on operation errors and still deletes all native handles in reverse", async () => {
    const fake = createFakeRuntime({ throwMorphology: true });
    const provider = createStudioOpenCvImageProvider({
      requestEpoch: 0,
      runtimeLoader: () => fake.runtime,
    });
    const result = await provider.execute({
      operation: "morphology",
      requestEpoch: 0,
      image: { width: 3, height: 3, channels: 1, data: mask3x3() },
      mode: "close",
      kernel: { shape: "rect", width: 3, height: 3 },
    });

    expect(result).toMatchObject({ ok: false, reason: "provider-failure" });
    expectReverseCleanup(fake.events);
    expect(provider.getDiagnostics()).toMatchObject({
      nativeHandleCreateCount: 3,
      nativeHandleDeleteCount: 3,
    });
  });

  it("continues reverse cleanup after a delete failure and reports cleanup-failure", async () => {
    const fake = createFakeRuntime({ failDeleteId: 2 });
    const provider = createStudioOpenCvImageProvider({
      requestEpoch: 0,
      runtimeLoader: () => fake.runtime,
    });
    const result = await provider.execute({
      operation: "morphology",
      requestEpoch: 0,
      image: { width: 3, height: 3, channels: 1, data: mask3x3() },
      mode: "open",
      kernel: { shape: "cross", width: 3, height: 3 },
    });

    expect(result).toMatchObject({ ok: false, reason: "cleanup-failure" });
    expectReverseCleanup(fake.events);
    expect(provider.getDiagnostics()).toMatchObject({
      nativeHandleCreateCount: 3,
      nativeHandleDeleteCount: 3,
    });
  });

  it("enforces component, contour, point, and output-byte budgets", async () => {
    const components = createStudioOpenCvImageProvider({
      requestEpoch: 0,
      runtimeLoader: () => createFakeRuntime().runtime,
      limits: { maxComponents: 1 },
    });
    await expect(components.execute({
      operation: "connected-components",
      requestEpoch: 0,
      image: { width: 3, height: 3, channels: 1, data: mask3x3() },
    })).resolves.toMatchObject({ ok: false, reason: "budget-exceeded" });

    const contours = createStudioOpenCvImageProvider({
      requestEpoch: 0,
      runtimeLoader: () => createFakeRuntime().runtime,
      limits: { maxContours: 1 },
    });
    await expect(contours.execute({
      operation: "contours",
      requestEpoch: 0,
      image: { width: 3, height: 3, channels: 1, data: mask3x3() },
    })).resolves.toMatchObject({ ok: false, reason: "budget-exceeded" });

    const points = createStudioOpenCvImageProvider({
      requestEpoch: 0,
      runtimeLoader: () => createFakeRuntime().runtime,
      limits: { maxPointsPerContour: 3 },
    });
    await expect(points.execute({
      operation: "contours",
      requestEpoch: 0,
      image: { width: 3, height: 3, channels: 1, data: mask3x3() },
    })).resolves.toMatchObject({ ok: false, reason: "budget-exceeded" });

    const output = createStudioOpenCvImageProvider({
      requestEpoch: 0,
      runtimeLoader: () => createFakeRuntime().runtime,
      limits: { maxOutputBytes: 8 },
    });
    await expect(output.execute({
      operation: "morphology",
      requestEpoch: 0,
      image: { width: 3, height: 3, channels: 1, data: mask3x3() },
      mode: "gradient",
      kernel: { shape: "rect", width: 3, height: 3 },
    })).resolves.toMatchObject({ ok: false, reason: "budget-exceeded" });
  });

  it("rejects cancellation, stale epochs, and backpressure without a synchronous fallback", async () => {
    let releaseRuntime!: (runtime: CV) => void;
    const runtimePromise = new Promise<CV>((resolve) => {
      releaseRuntime = resolve;
    });
    const provider = createStudioOpenCvImageProvider({
      requestEpoch: 1,
      runtimeLoader: () => runtimePromise,
      limits: { maxPendingRequests: 1 },
    });
    const request = {
      operation: "morphology",
      requestEpoch: 1,
      image: { width: 3, height: 3, channels: 1, data: mask3x3() },
      mode: "open",
      kernel: { shape: "rect", width: 3, height: 3 },
    } as const;
    const first = provider.execute(request);
    await expect(provider.execute(request)).resolves.toMatchObject({
      ok: false,
      reason: "backpressure",
    });
    expect(provider.advanceRequestEpoch(2)).toBe(true);
    releaseRuntime(createFakeRuntime().runtime);
    await expect(first).resolves.toMatchObject({
      ok: false,
      reason: "stale-request-epoch",
    });

    const aborted = new AbortController();
    aborted.abort();
    await expect(provider.execute({ ...request, requestEpoch: 2 }, {
      signal: aborted.signal,
    })).resolves.toMatchObject({ ok: false, reason: "cancelled" });
    await expect(provider.execute(request)).resolves.toMatchObject({
      ok: false,
      reason: "stale-request-epoch",
    });
    expect(provider.getDiagnostics().nativeHandleCreateCount).toBe(0);
  });

  it("rejects degenerate perspective quads and exact-channel violations before runtime load", async () => {
    const loader = vi.fn(() => createFakeRuntime().runtime);
    const provider = createStudioOpenCvImageProvider({
      requestEpoch: 0,
      runtimeLoader: loader,
    });
    await expect(provider.execute({
      operation: "perspective-warp",
      requestEpoch: 0,
      image: { width: 2, height: 2, channels: 1, data: new Uint8Array(4) },
      sourceQuad: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      destinationQuad: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      output: { width: 2, height: 2 },
    })).resolves.toMatchObject({ ok: false, reason: "invalid-input" });
    await expect(provider.execute({
      operation: "contours",
      requestEpoch: 0,
      image: { width: 1, height: 1, channels: 4, data: new Uint8Array(4) },
    })).resolves.toMatchObject({ ok: false, reason: "invalid-input" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("keeps the package lazy and contains no renderer or UI-surface dependency", () => {
    const source = readFileSync(
      new URL("./studio-opencv-image-provider.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('import("@techstark/opencv-js")');
    expect(source).toContain('import type { CV, Mat } from "@techstark/opencv-js"');
    expect(source).not.toMatch(
      /import\s+(?!type\b)[^;]*from\s+["']@techstark\/opencv-js["']/,
    );
    expect(source).toContain("deleteAllReverse()");
    expect(source).toContain(".delete()");
    expect(source).not.toMatch(/(?:react-)?konva/i);
    expect(source).not.toMatch(/\bdocument\b/i);
    expect(source).not.toMatch(/\bcanvas\b/i);
    expect(source).not.toContain("getContext(");
    expect(source).not.toContain("createElement(");
  });
});
