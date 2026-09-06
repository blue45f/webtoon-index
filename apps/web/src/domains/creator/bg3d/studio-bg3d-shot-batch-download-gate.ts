export interface StudioBg3dShotBatchDownloadGateInput {
  readonly signal: AbortSignal;
  readonly isActive: () => boolean;
  readonly assertAccess: () => Promise<void>;
  readonly markDownloadRequested: () => Promise<void>;
  readonly download: () => void;
}

function downloadAbortError(): Error {
  return Object.assign(new Error("컷 배치 다운로드가 취소되었습니다."), { name: "AbortError" });
}

function assertActive(input: StudioBg3dShotBatchDownloadGateInput): void {
  if (input.signal.aborted || !input.isActive()) throw downloadAbortError();
}

/**
 * Keeps the final authorization decision adjacent to the synchronous browser download gesture.
 * Storage bookkeeping may await IndexedDB, so access and component liveness are checked again after it.
 */
export async function commitStudioBg3dShotBatchDownload(
  input: StudioBg3dShotBatchDownloadGateInput,
): Promise<void> {
  assertActive(input);
  await input.assertAccess();
  assertActive(input);
  await input.markDownloadRequested();
  assertActive(input);
  await input.assertAccess();
  assertActive(input);
  input.download();
}
