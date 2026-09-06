/**
 * WebGPU-only Living Ink runtime factory, admitted on picture quality rather than capability.
 *
 * A pure WGSL field runtime is returned only when a device can be created *and it proves it draws
 * watercolour* — see `proveWatercolourResolve`. Every failure returns null. The caller may report
 * the selected WebGPU provider unavailable, but must not construct or relabel a WebGL2 runtime.
 *
 * Step 1's proof is not ceremony, and it is deliberately about the *picture*, not about liveness.
 * An earlier version only asked whether the frame was non-blank, which a WGSL resolve consisting of
 * a bare `exp(-density)` answered happily: it rendered, it just rendered pure white paper with ink
 * roughly thirty times too faint. Because this backend is faster, preferring it on liveness alone
 * traded the product's first-order value — handfeel and texture — for frame time, which is exactly
 * the trade the material policy forbids. So admission now measures the two signals a degraded
 * resolve loses first (paper texture standard deviation and ink darkness over paper) and hands the
 * selected WebGPU operation unavailable whenever the WGSL runtime cannot meet them.
 */

import { StudioLivingInkWebGpuPureRuntime } from "./studio-living-ink-webgpu-pure-runtime";

import type { StudioLivingInkExecutionConfig } from "./studio-living-ink-execution-protocol";

export type StudioLivingInkWebGpuRuntime = StudioLivingInkWebGpuPureRuntime;

export async function tryCreateStudioLivingInkWebGpuRuntime(
  config: StudioLivingInkExecutionConfig,
): Promise<StudioLivingInkWebGpuRuntime | null> {
  /*
   * Prefer the pure WGSL field replacement — but only once it has drawn watercolour. The proof
   * doubles as this runtime's warm-up: pipeline compilation, the first dispatches and the first
   * readback all happen here, before the runtime is handed to the Worker, so the user's first
   * stroke is never waiting on a cold WebGPU path — and never watching a washed-out one. Failed
   * admission remains a WebGPU failure; this factory does not create an alternate provider.
   */
  const pure = await StudioLivingInkWebGpuPureRuntime.tryCreate(config);
  if (pure) {
    if ((await pure.proveWatercolourResolve()).admitted) return pure;
    pure.dispose();
  }
  return null;
}
