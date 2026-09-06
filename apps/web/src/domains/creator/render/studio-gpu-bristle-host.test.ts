import { afterEach, describe, expect, it } from "vitest";

import { planOilBrushDabs } from "../studio-fx-brush";

import {
  deliverStudioGpuBristleResponseForTests,
  installStudioGpuBristleWorkerForTests,
  requestStudioGpuBristleOverlay,
  resetStudioGpuBristleHostForTests,
  setStudioGpuBristleSupportForTests,
  studioGpuBristleLaneDisabledReason,
  studioGpuBristleOilRequest,
  studioGpuBristleSeedFromKey,
  supportsStudioGpuBristleOverlay,
  STUDIO_GPU_BRISTLE_BRUSH_ID_PREFIX,
  type StudioGpuBristleOverlayRequest,
  type StudioGpuBristleWorkerAdvanceMessage,
} from "./studio-gpu-bristle-host";

import type { StudioGpuBristleStation } from "./studio-gpu-bristle-reference";

interface FakeBitmap {
  width: number;
  height: number;
  closed: boolean;
  close(): void;
}

function fakeBitmap(width = 64, height = 32): FakeBitmap {
  const bitmap: FakeBitmap = {
    width,
    height,
    closed: false,
    close() {
      bitmap.closed = true;
    },
  };
  return bitmap;
}

interface FakeWorker {
  readonly sent: StudioGpuBristleWorkerAdvanceMessage[];
  readonly disposed: string[];
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

function installFakeWorker(): FakeWorker {
  const worker: FakeWorker = {
    sent: [],
    disposed: [],
    onmessage: null,
    postMessage(message: unknown) {
      const typed = message as { kind: string; strokeKey: string };
      if (typed.kind === "studio-gpu-bristle-dispose") {
        worker.disposed.push(typed.strokeKey);
        return;
      }
      worker.sent.push(message as StudioGpuBristleWorkerAdvanceMessage);
    },
    terminate() {},
  };
  installStudioGpuBristleWorkerForTests(worker as unknown as Worker);
  return worker;
}

function stations(count: number, offset = 0): StudioGpuBristleStation[] {
  const out: StudioGpuBristleStation[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push({
      x: 10 + (index + offset) * 1.5,
      y: 20 + Math.sin((index + offset) * 0.25) * 3,
      pressure: 0.4 + ((index + offset) % 7) * 0.05,
      dtMs: 1000 / 60,
    });
  }
  return out;
}

function request(
  overrides: Partial<StudioGpuBristleOverlayRequest> = {},
): StudioGpuBristleOverlayRequest {
  return {
    strokeKey: "el-1",
    tuft: { baseRadiusPx: 12, bristleCount: 24, seed: 7 },
    surface: { widthPx: 128, heightPx: 96, originX: 4, originY: 6, pixelsPerUnit: 2 },
    stations: stations(16),
    opacity: 1,
    ...overrides,
  };
}

afterEach(() => {
  resetStudioGpuBristleHostForTests();
});

describe("supportsStudioGpuBristleOverlay", () => {
  it("is false in an environment without WebGPU, Workers or OffscreenCanvas", () => {
    // The Node suite is exactly that environment, which is the point: with no WebGPU the lane never
    // constructs a worker; the selected lane reports unavailable without attempting another provider.
    expect(supportsStudioGpuBristleOverlay()).toBe(false);
  });
});

describe("requestStudioGpuBristleOverlay fail-closed", () => {
  it("returns null with no WebGPU and leaves pixel authority unavailable", () => {
    expect(requestStudioGpuBristleOverlay(request(), () => {})).toBeNull();
  });

  it("declines a surface outside the product floor without touching the worker", () => {
    setStudioGpuBristleSupportForTests(true);
    const worker = installFakeWorker();
    expect(
      requestStudioGpuBristleOverlay(
        request({
          surface: { widthPx: 8, heightPx: 8, originX: 0, originY: 0, pixelsPerUnit: 1 },
        }),
        () => {},
      ),
    ).toBeNull();
    expect(worker.sent).toHaveLength(0);
  });
});

describe("requestStudioGpuBristleOverlay cache and prefix contract", () => {
  it("returns null on a miss, then the overlay once the worker result lands", () => {
    setStudioGpuBristleSupportForTests(true);
    const worker = installFakeWorker();
    let readyCount = 0;
    const first = request();
    expect(requestStudioGpuBristleOverlay(first, () => (readyCount += 1))).toBeNull();
    expect(worker.sent).toHaveLength(1);
    expect(worker.sent[0]!.reset).toBe(true);
    expect(worker.sent[0]!.stations).toHaveLength(16);

    const bitmap = fakeBitmap();
    deliverStudioGpuBristleResponseForTests({
      kind: "studio-gpu-bristle-ok",
      jobId: worker.sent[0]!.jobId,
      strokeKey: "el-1",
      bitmap: bitmap as unknown as ImageBitmap,
      consumedStationCount: 16,
    });
    expect(readyCount).toBe(1);

    const overlay = requestStudioGpuBristleOverlay(first, () => {});
    expect(overlay).not.toBeNull();
    expect(overlay?.bitmap).toBe(bitmap as unknown as ImageBitmap);
    // Destination rect is the surface in the caller's own coordinate space, not device pixels.
    expect(overlay?.dx).toBe(4);
    expect(overlay?.dy).toBe(6);
    expect(overlay?.dw).toBe(64);
    expect(overlay?.dh).toBe(48);
    // No second job for byte-equal inputs.
    expect(worker.sent).toHaveLength(1);
  });

  it("sends only the suffix when the prefix is identical by Object.is", () => {
    setStudioGpuBristleSupportForTests(true);
    const worker = installFakeWorker();
    const base = stations(16);
    requestStudioGpuBristleOverlay(request({ stations: base }), () => {});
    deliverStudioGpuBristleResponseForTests({
      kind: "studio-gpu-bristle-ok",
      jobId: worker.sent[0]!.jobId,
      strokeKey: "el-1",
      bitmap: fakeBitmap() as unknown as ImageBitmap,
      consumedStationCount: 16,
    });

    const grown = [...base, ...stations(4, 16)];
    requestStudioGpuBristleOverlay(request({ stations: grown }), () => {});
    expect(worker.sent).toHaveLength(2);
    expect(worker.sent[1]!.reset).toBe(false);
    expect(worker.sent[1]!.stations).toHaveLength(4);
    expect(worker.sent[1]!.consumedStationCount).toBe(20);
  });

  it("resets and replays the full station history when the render surface changes", () => {
    setStudioGpuBristleSupportForTests(true);
    const worker = installFakeWorker();
    const base = stations(16);
    requestStudioGpuBristleOverlay(request({ stations: base }), () => {});
    deliverStudioGpuBristleResponseForTests({
      kind: "studio-gpu-bristle-ok",
      jobId: worker.sent[0]!.jobId,
      strokeKey: "el-1",
      bitmap: fakeBitmap() as unknown as ImageBitmap,
      consumedStationCount: 16,
    });

    const grown = [...base, ...stations(4, 16)];
    const grownSurface = {
      widthPx: 192,
      heightPx: 120,
      originX: -12,
      originY: 2,
      pixelsPerUnit: 2,
    };
    requestStudioGpuBristleOverlay(
      request({ stations: grown, surface: grownSurface }),
      () => {},
    );

    expect(worker.sent).toHaveLength(2);
    expect(worker.sent[1]!.reset).toBe(true);
    expect(worker.sent[1]!.stations).toEqual(grown);
    expect(worker.sent[1]!.consumedStationCount).toBe(20);
    expect(worker.sent[1]!.surface).toEqual(grownSurface);
  });

  it("resets and replays from station 0 when an earlier station moved", () => {
    setStudioGpuBristleSupportForTests(true);
    const worker = installFakeWorker();
    const base = stations(16);
    requestStudioGpuBristleOverlay(request({ stations: base }), () => {});
    deliverStudioGpuBristleResponseForTests({
      kind: "studio-gpu-bristle-ok",
      jobId: worker.sent[0]!.jobId,
      strokeKey: "el-1",
      bitmap: fakeBitmap() as unknown as ImageBitmap,
      consumedStationCount: 16,
    });

    // A 4096-dab arc refit, an undo, or a pressure resample all look like this: the prefix moved.
    const refit = base.map((station, index) =>
      index === 15 ? { ...station, pressure: station.pressure + 0.01 } : station,
    );
    const grown = [...refit, ...stations(2, 16)];
    requestStudioGpuBristleOverlay(request({ stations: grown }), () => {});
    expect(worker.sent).toHaveLength(2);
    expect(worker.sent[1]!.reset).toBe(true);
    expect(worker.sent[1]!.stations).toHaveLength(18);
  });

  it("keeps at most two strokes resident and disposes the evicted one in the worker", () => {
    setStudioGpuBristleSupportForTests(true);
    const worker = installFakeWorker();
    for (const key of ["a", "b", "c"]) {
      requestStudioGpuBristleOverlay(request({ strokeKey: key }), () => {});
      const job = worker.sent[worker.sent.length - 1]!;
      deliverStudioGpuBristleResponseForTests({
        kind: "studio-gpu-bristle-ok",
        jobId: job.jobId,
        strokeKey: key,
        bitmap: fakeBitmap() as unknown as ImageBitmap,
        consumedStationCount: 16,
      });
    }
    expect(worker.disposed).toEqual(["a"]);
  });

  it("stops asking after a permanent decline and reports the reason", () => {
    setStudioGpuBristleSupportForTests(true);
    const worker = installFakeWorker();
    requestStudioGpuBristleOverlay(request(), () => {});
    deliverStudioGpuBristleResponseForTests({
      kind: "studio-gpu-bristle-decline",
      jobId: worker.sent[0]!.jobId,
      strokeKey: "el-1",
      reason: "impasto-relief-flat",
      message: "임파스토 요철이 평평해 선택한 GPU 강모 레인을 사용할 수 없습니다.",
      permanent: true,
    });
    expect(studioGpuBristleLaneDisabledReason()).toBe("impasto-relief-flat");
    expect(supportsStudioGpuBristleOverlay()).toBe(false);
    expect(requestStudioGpuBristleOverlay(request(), () => {})).toBeNull();
    expect(worker.sent).toHaveLength(1);
  });

  it("does not re-enqueue the same declined input every frame", () => {
    setStudioGpuBristleSupportForTests(true);
    const worker = installFakeWorker();
    const only = request();
    requestStudioGpuBristleOverlay(only, () => {});
    deliverStudioGpuBristleResponseForTests({
      kind: "studio-gpu-bristle-decline",
      jobId: worker.sent[0]!.jobId,
      strokeKey: "el-1",
      reason: "present-unavailable",
      message: "",
      permanent: false,
    });
    expect(requestStudioGpuBristleOverlay(only, () => {})).toBeNull();
    expect(requestStudioGpuBristleOverlay(only, () => {})).toBeNull();
    expect(worker.sent).toHaveLength(1);
  });
});

describe("studioGpuBristleOilRequest", () => {
  const path = stations(24);
  const dabs = planOilBrushDabs({
    points: path.flatMap((station) => [station.x, station.y]),
    pressures: path.map((station) => station.pressure),
    baseWidth: 24,
    seed: 11,
    maxDabs: 512,
  });

  it("declines every brush id that does not opt in, so shipped oil brushes are untouched", () => {
    // The gate is what makes this change additive: nothing in the shipped catalog matches the
    // prefix, so every existing oil stroke keeps its exact current pixels.
    for (const brush of [
      undefined,
      "oil",
      "oil--impasto-ribbon",
      "brush--bristle-physics",
      "brush--impasto-relief",
      "acrylic",
      "oil--filbert-ribbon",
    ]) {
      expect(studioGpuBristleOilRequest("el-1", brush, dabs, 1, "#332211")).toBeNull();
    }
  });

  it("builds a station stream, a padded surface and an RYB ink for an opted-in brush", () => {
    const built = studioGpuBristleOilRequest(
      "el-1",
      `${STUDIO_GPU_BRISTLE_BRUSH_ID_PREFIX}-filbert`,
      dabs,
      0.8,
      "#332211",
    );
    expect(built).not.toBeNull();
    expect(built!.stations).toHaveLength(dabs.length);
    expect(built!.opacity).toBe(0.8);
    expect(built!.tuft.baseRadiusPx).toBeGreaterThan(0);
    expect(built!.tuft.bristleCount).toBeGreaterThan(0);
    // Every station carries its own dt; nothing is derived from the station index.
    for (const station of built!.stations) {
      expect(station.dtMs).toBeGreaterThan(0);
      expect(station.pressure).toBeGreaterThanOrEqual(0);
      expect(station.pressure).toBeLessThanOrEqual(1);
    }
    // Surface encloses every dab with padding on both sides.
    const minX = Math.min(...dabs.map((dab) => dab.x - Math.max(dab.radiusX, dab.radiusY)));
    expect(built!.surface.originX).toBeLessThan(minX);
    expect(built!.surface.widthPx).toBeGreaterThan(0);
    expect(built!.surface.heightPx).toBeGreaterThan(0);
    // Ink is RYB, not RGB: a warm brown must not come back as its own hex channels.
    expect(built!.tuft.ink).not.toEqual([0.2, 0.13, 0.07]);
  });

  it("returns an empty-safe null and a deterministic seed", () => {
    expect(
      studioGpuBristleOilRequest("el-1", `${STUDIO_GPU_BRISTLE_BRUSH_ID_PREFIX}`, [], 1, "#000000"),
    ).toBeNull();
    expect(studioGpuBristleSeedFromKey("el-1")).toBe(studioGpuBristleSeedFromKey("el-1"));
    expect(studioGpuBristleSeedFromKey("el-1")).not.toBe(studioGpuBristleSeedFromKey("el-2"));
  });
});
