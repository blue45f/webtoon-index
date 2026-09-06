type StudioBg3dShotBatchCoreRuntime = typeof import("./studio-bg3d-shot-batch-runtime");
type StudioBg3dShotBatchRecoveryRuntime =
  typeof import( "./studio-bg3d-shot-batch-recovery-store");

export type StudioBg3dShotBatchRuntime = StudioBg3dShotBatchCoreRuntime & Pick<
  StudioBg3dShotBatchRecoveryRuntime,
  | "STUDIO_BG3D_SHOT_BATCH_RECOVERY_AUTHORIZATION_RECEIPT_MAX_TTL_MS"
  | "StudioBg3dShotBatchRecoveryError"
  | "createStudioBg3dShotBatchRecoveryStore"
>;

type StudioBg3dShotBatchRuntimeImporter = () => Promise<StudioBg3dShotBatchRuntime>;

function createAbortError(): Error {
  return Object.assign(new Error("취소됨"), { name: "AbortError" });
}

async function importStudioBg3dShotBatchRuntime(): Promise<StudioBg3dShotBatchRuntime> {
  const [core, recovery] = await Promise.all([
    import("./studio-bg3d-shot-batch-runtime"),
    import( "./studio-bg3d-shot-batch-recovery-store"),
  ]);
  return Object.freeze({
    ...core,
    STUDIO_BG3D_SHOT_BATCH_RECOVERY_AUTHORIZATION_RECEIPT_MAX_TTL_MS:
      recovery.STUDIO_BG3D_SHOT_BATCH_RECOVERY_AUTHORIZATION_RECEIPT_MAX_TTL_MS,
    StudioBg3dShotBatchRecoveryError: recovery.StudioBg3dShotBatchRecoveryError,
    createStudioBg3dShotBatchRecoveryStore: recovery.createStudioBg3dShotBatchRecoveryStore,
  });
}

/**
 * Loads the optional production runtime without making cancellation wait for an unabortable native
 * `import()` fetch. The import may finish in the background, but its settled rejection is observed
 * by `Promise.race` and it cannot mutate editor state after the caller aborts.
 */
export async function loadStudioBg3dShotBatchRuntime(
  signal: AbortSignal,
  importRuntime: StudioBg3dShotBatchRuntimeImporter = importStudioBg3dShotBatchRuntime,
): Promise<StudioBg3dShotBatchRuntime> {
  if (signal.aborted) throw createAbortError();
  let removeAbortListener: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([importRuntime(), aborted]);
  } finally {
    removeAbortListener();
  }
}
