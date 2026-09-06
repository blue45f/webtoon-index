import type { StudioBg3dLtPresetPayload } from "./studio-bg3d-lt-presets";

type StudioBg3dLtPresetRepositoryModule =
  typeof import("../scene-3d/studio-mannequin-bg3d-preset-sqlite-repository");

export interface LazyStudioBg3dLtPresetSqliteRepository {
  readonly authority: "sqlite";
  load(): Promise<StudioBg3dLtPresetPayload>;
  save(payload: StudioBg3dLtPresetPayload): Promise<StudioBg3dLtPresetPayload>;
}

let repositoryModulePromise: Promise<StudioBg3dLtPresetRepositoryModule> | null = null;
let productRepository: LazyStudioBg3dLtPresetSqliteRepository | null = null;

function loadRepositoryModule(): Promise<StudioBg3dLtPresetRepositoryModule> {
  repositoryModulePromise ??= import("../scene-3d/studio-mannequin-bg3d-preset-sqlite-repository"
  ).catch((cause: unknown) => {
    repositoryModulePromise = null;
    throw cause;
  });
  return repositoryModulePromise;
}

/** Stable facade; SQLite is not fetched until the LT panel first hydrates or saves a preset. */
export function getProductStudioBg3dLtPresetSqliteRepository():
LazyStudioBg3dLtPresetSqliteRepository {
  productRepository ??= Object.freeze({
    authority: "sqlite" as const,
    async load() {
      const repositories = await loadRepositoryModule();
      return repositories.getProductStudioBg3dLtPresetSqliteRepository().load();
    },
    async save(payload: StudioBg3dLtPresetPayload) {
      const repositories = await loadRepositoryModule();
      return repositories.getProductStudioBg3dLtPresetSqliteRepository().save(payload);
    },
  });
  return productRepository;
}
