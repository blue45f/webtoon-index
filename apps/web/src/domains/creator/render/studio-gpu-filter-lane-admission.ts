/**
 * Session-scoped admission for the GPU filter lane.
 *
 * `isStudioGpuFilterChainEligible` answers a question about the *program* — can this filter chain be
 * expressed in WGSL — and the lane planner consumed that answer as if it also meant "and this host
 * can run WGSL". It does not. A browser that exposes `navigator.gpu` but whose `requestAdapter()`
 * resolves to null passes every program check and then fails at execution: GPU blocklisted or
 * disabled, hardware acceleration off, a VM or remote-desktop session, enterprise policy, a build
 * shipping the API without a working backend. Because the GPU branch returns instead of continuing
 * to the Worker dispatch below it, the artist pressed 적용 on a selected image and got zero changed
 * pixels with only a toast — measured at 0/180744 px on `--disable-gpu` Chrome.
 *
 * This is admission, not a fallback: the answer is settled BEFORE a lane is chosen, so no execution
 * ever switches lanes after failing, and the repo's no-silent-lane-switch rule stays intact. The
 * probe runs once per session because adapter availability does not change under a live document,
 * and it never throws — `probeStudioCapabilitySnapshot` reports every failure as a snapshot.
 */
import {
  probeStudioCapabilitySnapshot,
  type StudioCapabilityProbeInput,
} from "../studio-capability-probe";

/** `unknown` until the probe settles; callers must treat it as "not yet admitted", never as refused. */
export type StudioGpuFilterLaneAdmission = "unknown" | "admitted" | "refused";

let admission: StudioGpuFilterLaneAdmission = "unknown";
let pending: Promise<StudioGpuFilterLaneAdmission> | null = null;

/** Synchronous read of the settled verdict; does not start a probe. */
export function readStudioGpuFilterLaneAdmission(): StudioGpuFilterLaneAdmission {
  return admission;
}

/**
 * Settles the verdict, probing at most once per session. Concurrent callers share one probe, so a
 * page full of filtered images does not issue one `requestAdapter()` per node.
 */
export function ensureStudioGpuFilterLaneAdmission(
  input: StudioCapabilityProbeInput = {},
): Promise<StudioGpuFilterLaneAdmission> {
  if (admission !== "unknown") return Promise.resolve(admission);
  pending ??= probeStudioCapabilitySnapshot({
    navigator: input.navigator ?? (typeof navigator === "undefined" ? null : navigator),
    ...input,
  })
    .then((snapshot) => {
      admission = snapshot.adapterAvailable ? "admitted" : "refused";
      return admission;
    })
    .catch(() => {
      // The probe is documented never to throw; refuse rather than admit a lane we cannot vouch for.
      admission = "refused";
      return admission;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Test seam only — the verdict is otherwise immutable for the life of the session. */
export function resetStudioGpuFilterLaneAdmissionForTests(): void {
  admission = "unknown";
  pending = null;
}
