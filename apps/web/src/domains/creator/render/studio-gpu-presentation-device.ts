import {
  acquireStudioGpuDevice,
  type StudioGpuDeviceLease,
} from "./studio-gpu-fabric";

export type StudioGpuCanvasFormat = "bgra8unorm" | "rgba8unorm";
export type StudioGpuPresentationDeviceStrategy =
  | "auto"
  | "shared"
  | "dedicated";

export interface StudioGpuPresentationDeviceOptions {
  /** Test/embed override. Omit to resolve the browser WebGPU entry point. */
  readonly gpu?: GPU | null;
  /**
   * `auto` uses the shared Studio GPU fabric in product builds and a dedicated device in Vitest.
   * Tests that exercise the production ownership path should request `shared` explicitly.
   */
  readonly strategy?: StudioGpuPresentationDeviceStrategy;
}

export interface StudioGpuPresentationDevice {
  readonly device: GPUDevice;
  readonly deviceEpoch: number;
  readonly canvasFormat: StudioGpuCanvasFormat;
  readonly ownership: "fabric-lease" | "dedicated";
}

function browserGpu(): GPU | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { readonly gpu?: GPU }).gpu ?? null;
}

function preferredCanvasFormat(gpu: GPU): StudioGpuCanvasFormat | null {
  try {
    if (typeof gpu.getPreferredCanvasFormat !== "function") return null;
    const format = gpu.getPreferredCanvasFormat();
    return format === "bgra8unorm" || format === "rgba8unorm" ? format : null;
  } catch {
    return null;
  }
}

function resolvedStrategy(
  strategy: StudioGpuPresentationDeviceStrategy | undefined,
): Exclude<StudioGpuPresentationDeviceStrategy, "auto"> {
  if (strategy === "shared" || strategy === "dedicated") return strategy;
  return import.meta.env.MODE === "test" ? "dedicated" : "shared";
}

function createLeaseDeviceFacade(lease: StudioGpuDeviceLease): GPUDevice {
  let released = false;
  return new Proxy(lease.device, {
    get(real, property) {
      if (property === "destroy") {
        return () => {
          if (released) return;
          released = true;
          lease.release();
        };
      }
      const value: unknown = Reflect.get(real, property, real);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(real)
        : value;
    },
  });
}

async function acquireDedicatedDevice(
  gpu: GPU,
  canvasFormat: StudioGpuCanvasFormat,
): Promise<StudioGpuPresentationDevice | null> {
  try {
    const adapter = await gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    return Object.freeze({
      device,
      deviceEpoch: 1,
      canvasFormat,
      ownership: "dedicated" as const,
    });
  } catch {
    return null;
  }
}

async function acquireSharedDevice(
  gpu: GPU,
  canvasFormat: StudioGpuCanvasFormat,
): Promise<StudioGpuPresentationDevice | null> {
  const lease = await acquireStudioGpuDevice({ gpu }).catch(() => null);
  if (!lease) return null;
  if (lease.lost) {
    lease.release();
    return null;
  }
  return Object.freeze({
    device: createLeaseDeviceFacade(lease),
    deviceEpoch: lease.epoch,
    canvasFormat,
    ownership: "fabric-lease" as const,
  });
}

/**
 * Acquires a presentation-capable GPUDevice without leaking ownership into React components.
 *
 * Product callers borrow the single StudioGpuFabric device. Their existing `device.destroy()`
 * cleanup contract is preserved through a facade that idempotently releases only that lease;
 * it never destroys the physical shared device. The explicit dedicated strategy remains for
 * isolated harnesses and compatibility tests.
 */
export async function acquireStudioGpuPresentationDevice(
  options?: StudioGpuPresentationDeviceOptions,
): Promise<StudioGpuPresentationDevice | null> {
  const gpu = options && "gpu" in options ? options.gpu ?? null : browserGpu();
  if (!gpu) return null;
  const canvasFormat = preferredCanvasFormat(gpu);
  if (!canvasFormat) return null;

  return resolvedStrategy(options?.strategy) === "dedicated"
    ? acquireDedicatedDevice(gpu, canvasFormat)
    : acquireSharedDevice(gpu, canvasFormat);
}
