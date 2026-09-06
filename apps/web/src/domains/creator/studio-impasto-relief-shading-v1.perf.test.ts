/**
 * Wall-clock gates for the impasto relief shader, kept in their own FILE on purpose.
 *
 * `studio-impasto-relief-shading-v1.test.ts` installs `vi.spyOn` on 24 `Math` members to take an
 * exact transcendental census. Restoring those spies does not restore the shader: measured in a
 * single process, the emboss path costs 33.1ms per 30 passes before the census runs and 154.5ms
 * after it — a 4.7x deoptimisation that survives `mockRestore` — while the ggx path is barely
 * touched. A ratio between the two paths in that process measures the spies, not the shader.
 *
 * That file already notes the half of this it knew about ("a spied call is not the call the
 * budget measures") and keeps the census on a small tile in its own test. The other half is that
 * TIMING cannot share a process with it at all. Vitest isolates modules per file, so a separate
 * file is the enforcement — an ordering convention inside one file would be silently breakable by
 * anyone adding a test above these.
 *
 * The ggx-body-versus-shared-walk band lives in a THIRD file,
 * `studio-impasto-relief-shading-v1.cpu-band.test.ts`, for a related reason: it has to measure
 * the emboss path before `ggx` runs anywhere in the process, and the blow-up bound below calls
 * ggx. Measured, sharing a process with it costs emboss 2.8x and drops the band's ratio from
 * ~20.5 to 6.58.
 */

import { describe, expect, it } from "vitest";

import { computeStudioImpastoReliefShading } from "./studio-impasto-relief-shading-v1";
import { studioOssUnitHash } from "./studio-oss-brush-kernels";

describe("studio impasto relief shading v1 — wall-clock gates", () => {
  /**
   * A catastrophic-blowup smoke bound, and deliberately nothing tighter.
   *
   * The old assertion was `elapsedMs < (process.env.CI ? 80 : 40)`, and it failed on a 4-vCPU
   * container at 58.6ms under load — with nothing regressed. Two measurements explain it and
   * rule out the obvious fixes:
   *
   *  - The shader costs 34.5ms idle on Node 22 and 18.8ms on Node 24. The `CI ? 80 : 40` split
   *    was not compensating for a busy runner at all; it was compensating for CI running Node 24
   *    (see `engines.node`) while a dev container may run something older. A 40ms bound with 16%
   *    idle headroom cannot survive four competing vitest workers.
   *  - Converting it to a calibrated ratio against `studio-perf-calibration.ts` does NOT work
   *    here, and that is measured, not assumed: against a fixed 2744 reference rounds the ratio
   *    read 0.97-1.04 on Node 22 and 0.505-0.518 on Node 24. A 2x baseline spread admits no gate
   *    at all — avoiding false failures needs one above 1.04, catching a doubling needs one below
   *    1.02. This is the same instruction-mix trap the paper-height sampler hit, and for the same
   *    reason: this loop is transcendental-heavy scalar compute, which the reference kernel does
   *    not track across V8 versions.
   *
   * A frozen copy would close that gap, as it did for the paper sampler, but not here: the
   * per-pixel body recomputes `halfLength`, `halfX/Y/Z`, `lDotH` and `schlickFresnel` on every one
   * of 262,144 pixels and every one of those is loop-invariant. That hoist is an obvious pending
   * optimization, and a frozen copy carrying the un-hoisted version would demand a re-freeze the
   * moment anyone takes it.
   *
   * So the absolute clock keeps only the job it can still do honestly — catching an
   * order-of-magnitude blowup such as an accidental per-pixel allocation or a quadratic tap loop.
   *
   * The census above cannot carry the rest on its own, and it is worth being exact about the gap:
   * it counts transcendentals, and deliberately not the shader's arithmetic shape, so a per-pixel
   * body that got slower WITHOUT a new `Math` call — repeated height taps, extra normal
   * arithmetic, a branch, a helper that stopped inlining — leaves every count green and the
   * output identical. That is what the second gate below is for.
   */
  it("relief-shades a 512×512 tile without catastrophic blowup", () => {
    const width = 512;
    const height = 512;
    const heights = new Float32Array(width * height);
    for (let index = 0; index < heights.length; index += 1) {
      heights[index] = studioOssUnitHash(0x7a11, index);
    }
    const into = new Float32Array(width * height);
    // Warm-up pass lets the JIT settle before the measurement.
    computeStudioImpastoReliefShading(heights, { width, height, into });
    // Noise is additive, so the cheapest of three passes is the honest estimate.
    let elapsedMs = Number.POSITIVE_INFINITY;
    for (let pass = 0; pass < 3; pass += 1) {
      const startedAt = performance.now();
      computeStudioImpastoReliefShading(heights, { width, height, into });
      elapsedMs = Math.min(elapsedMs, performance.now() - startedAt);
    }
    // ~10x the slowest honest reading recorded (34.5ms idle on Node 22, 58.6ms under a
    // 250%-oversubscribed box). One gate everywhere: no process.env.CI branch.
    expect(elapsedMs).toBeLessThan(400);
  });

});
