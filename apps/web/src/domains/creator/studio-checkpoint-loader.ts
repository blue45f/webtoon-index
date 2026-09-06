type StudioCheckpointsModule = typeof import("./studio-checkpoints");

export type StudioCheckpoint = import("./studio-checkpoints").StudioCheckpoint;
export type StudioCheckpointInput = import("./studio-checkpoints").StudioCheckpointInput;
export type StudioCheckpointStorage = import("./studio-checkpoints").StudioCheckpointStorage;

const STUDIO_CHECKPOINT_PREFIX = "toonspectrum-studio-checkpoints:v12";

let studioCheckpointsModulePromise: Promise<StudioCheckpointsModule> | null = null;

/**
 * Keeps SQLite, IndexedDB compatibility, and checkpoint serialization outside the /studio static
 * closure. A failed chunk fetch remains retryable when the user repeats the explicit operation.
 */
export function loadStudioCheckpointsModule(): Promise<StudioCheckpointsModule> {
  studioCheckpointsModulePromise ??= import("./studio-checkpoints").catch((cause: unknown) => {
    studioCheckpointsModulePromise = null;
    throw cause;
  });
  return studioCheckpointsModulePromise;
}

/** Pure key projection needed during render; intentionally mirrors the durable module contract. */
export function studioCheckpointKey(input: {
  userId?: string | null;
  workId?: string | null;
  remixId?: string | null;
}): string {
  const owner = encodeURIComponent(input.userId?.trim() || "guest");
  const documentId = input.workId
    ? `work:${encodeURIComponent(input.workId)}`
    : input.remixId
      ? `remix:${encodeURIComponent(input.remixId)}`
      : "new";
  return `${STUDIO_CHECKPOINT_PREFIX}:${owner}:${documentId}`;
}

export async function listDurableStudioCheckpoints(
  storage: StudioCheckpointStorage | undefined,
  key: string
): Promise<StudioCheckpoint[]> {
  const checkpoints = await loadStudioCheckpointsModule();
  return checkpoints.listDurableStudioCheckpoints(storage, key);
}

export async function createDurableStudioCheckpoint(
  storage: StudioCheckpointStorage | undefined,
  key: string,
  input: StudioCheckpointInput
): Promise<StudioCheckpoint[]> {
  const checkpoints = await loadStudioCheckpointsModule();
  return checkpoints.createDurableStudioCheckpoint(storage, key, input);
}

export async function deleteDurableStudioCheckpoint(
  storage: StudioCheckpointStorage | undefined,
  key: string,
  id: string
): Promise<StudioCheckpoint[]> {
  const checkpoints = await loadStudioCheckpointsModule();
  return checkpoints.deleteDurableStudioCheckpoint(storage, key, id);
}
