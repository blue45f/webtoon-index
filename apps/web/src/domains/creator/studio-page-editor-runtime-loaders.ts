import type { StudioSavedBrush } from "./brush/studio-brush-library";

export type StudioPixelEditBrushRuntime = typeof import("./studio-pixel-edit-brush-runtime");
export type StudioBrushLibrarySqliteRepositoryModule = typeof import("./brush/studio-brush-library-sqlite-repository"
);
export type StudioBrushQuickSlotsSqliteRepositoryModule = typeof import("./brush/studio-brush-slots-sqlite-repository"
);
export type ProductStudioBrushQuickSlotsRepository = ReturnType<
  StudioBrushQuickSlotsSqliteRepositoryModule["getProductStudioBrushQuickSlotsSqliteRepository"]
>;
export type StudioBrushQuickSlotsSnapshot = Awaited<
  ReturnType<ProductStudioBrushQuickSlotsRepository["load"]>
>;
export type ProductBrushLibraryRepository =
  StudioBrushLibrarySqliteRepositoryModule["openProductBrushLibraryRepository"] extends (
    ...args: never[]
  ) => Promise<infer Repository>
    ? Repository
    : never;
export type StudioLiquifyBrowserRuntime = typeof import("./studio-liquify-browser");

let studioPixelEditBrushRuntimePromise: Promise<StudioPixelEditBrushRuntime> | null = null;
let studioBrushLibrarySqliteRepositoryPromise:
  Promise<StudioBrushLibrarySqliteRepositoryModule> | null = null;
let studioBrushQuickSlotsSqliteRepositoryPromise:
  Promise<StudioBrushQuickSlotsSqliteRepositoryModule> | null = null;
let studioLiquifyBrowserRuntimePromise: Promise<StudioLiquifyBrowserRuntime> | null = null;

export function loadStudioPixelEditBrushRuntime(): Promise<StudioPixelEditBrushRuntime> {
  return studioPixelEditBrushRuntimePromise ??= import("./studio-pixel-edit-brush-runtime").catch(
    (error: unknown) => {
      studioPixelEditBrushRuntimePromise = null;
      throw error;
    }
  );
}

export function loadStudioBrushLibrarySqliteRepository(): Promise<StudioBrushLibrarySqliteRepositoryModule> {
  return studioBrushLibrarySqliteRepositoryPromise ??= import("./brush/studio-brush-library-sqlite-repository"
  ).catch((error: unknown) => {
    studioBrushLibrarySqliteRepositoryPromise = null;
    throw error;
  });
}

export function loadStudioBrushQuickSlotsSqliteRepository():
Promise<StudioBrushQuickSlotsSqliteRepositoryModule> {
  return studioBrushQuickSlotsSqliteRepositoryPromise ??= import("./brush/studio-brush-slots-sqlite-repository"
  ).catch((error: unknown) => {
    studioBrushQuickSlotsSqliteRepositoryPromise = null;
    throw error;
  });
}

export async function readAllProductBrushes(
  product: ProductBrushLibraryRepository,
): Promise<StudioSavedBrush[]> {
  const { readAllBrushesFromRepository } =
    await loadStudioBrushLibrarySqliteRepository();
  return readAllBrushesFromRepository(product.repository);
}

export function loadStudioLiquifyBrowserRuntime(): Promise<StudioLiquifyBrowserRuntime> {
  return studioLiquifyBrowserRuntimePromise ??= import("./studio-liquify-browser").catch(
    (error: unknown) => {
      studioLiquifyBrowserRuntimePromise = null;
      throw error;
    }
  );
}
