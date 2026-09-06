import {
  emptyTutorialProgress,
  normalizeTutorialProgress,
  type StudioTutorialProgress,
} from "./studio-feature-tutorials";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

async function acquireStudioTutorialProgressDatabase() {
  const { acquireStudioLocalDatabase } = await import("./studio-local-database-runtime");
  return acquireStudioLocalDatabase();
}

export const STUDIO_TUTORIAL_PROGRESS_SQLITE_NAMESPACE = "studio-tutorial-progress-v1";
const PROGRESS_KEY = "progress";

export interface StudioTutorialProgressRepository {
  readonly authority: "sqlite-opfs";
  load(): Promise<StudioTutorialProgress>;
  save(progress: StudioTutorialProgress): Promise<void>;
}

function decodeProgress(raw: string | null): StudioTutorialProgress {
  if (raw === null) return emptyTutorialProgress();
  try {
    return normalizeTutorialProgress(JSON.parse(raw) as unknown);
  } catch {
    return emptyTutorialProgress();
  }
}

export function createStudioTutorialProgressRepository(
  store: StudioAsyncKeyValueStore,
): StudioTutorialProgressRepository {
  let writeTail: Promise<void> = Promise.resolve();
  return Object.freeze({
    authority: "sqlite-opfs" as const,
    async load() {
      return decodeProgress(await store.get(PROGRESS_KEY));
    },
    save(progress: StudioTutorialProgress) {
      const payload = JSON.stringify(normalizeTutorialProgress(progress));
      const operation = writeTail.then(() => store.set(PROGRESS_KEY, payload));
      writeTail = operation.catch(() => undefined);
      return operation;
    },
  });
}

let sharedRepository: Promise<StudioTutorialProgressRepository> | null = null;

export function acquireProductStudioTutorialProgressRepository(): Promise<
  StudioTutorialProgressRepository
> {
  sharedRepository ??= acquireStudioTutorialProgressDatabase().then((database) =>
    createStudioTutorialProgressRepository(
      database.asAsyncKeyValueStore(STUDIO_TUTORIAL_PROGRESS_SQLITE_NAMESPACE),
    ));
  return sharedRepository;
}

export function resetStudioTutorialProgressRepositoryForTests(): void {
  sharedRepository = null;
}
