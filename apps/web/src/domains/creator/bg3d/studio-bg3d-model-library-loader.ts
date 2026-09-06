type StudioBg3dModelLibraryModule = typeof import("./bg3d-model-library");

export type Bg3dModelImportItem = import("./bg3d-model-library").Bg3dModelImportItem;
export type Bg3dModelLibraryEntry = import("./bg3d-model-library").Bg3dModelLibraryEntry;
export type Bg3dVerifiedStoredRecord = import("./bg3d-model-library").Bg3dVerifiedStoredRecord;

let studioBg3dModelLibraryModulePromise: Promise<StudioBg3dModelLibraryModule> | null = null;

/**
 * The editor can render primitives without opening SQLite/OPFS. Load the model authority only
 * when scene restoration actually encounters an attachment or the user activates the asset tab.
 */
export function loadStudioBg3dModelLibraryModule(): Promise<StudioBg3dModelLibraryModule> {
  studioBg3dModelLibraryModulePromise ??= import("./bg3d-model-library").catch(
    (cause: unknown) => {
      studioBg3dModelLibraryModulePromise = null;
      throw cause;
    }
  );
  return studioBg3dModelLibraryModulePromise;
}

export async function admitStoredBg3dModelForRenderingV12(
  ...args: Parameters<StudioBg3dModelLibraryModule["admitStoredBg3dModelForRenderingV12"]>
): Promise<Awaited<ReturnType<StudioBg3dModelLibraryModule["admitStoredBg3dModelForRenderingV12"]>>> {
  const library = await loadStudioBg3dModelLibraryModule();
  return library.admitStoredBg3dModelForRenderingV12(...args);
}

export async function deleteStoredBg3dModelV12(
  ...args: Parameters<StudioBg3dModelLibraryModule["deleteStoredBg3dModelV12"]>
): Promise<Awaited<ReturnType<StudioBg3dModelLibraryModule["deleteStoredBg3dModelV12"]>>> {
  const library = await loadStudioBg3dModelLibraryModule();
  return library.deleteStoredBg3dModelV12(...args);
}

export async function createStudioBg3dModelAttachment(
  ...args: Parameters<StudioBg3dModelLibraryModule["createStudioBg3dModelAttachment"]>
): Promise<Awaited<ReturnType<StudioBg3dModelLibraryModule["createStudioBg3dModelAttachment"]>>> {
  const library = await loadStudioBg3dModelLibraryModule();
  return library.createStudioBg3dModelAttachment(...args);
}

export async function getStoredBg3dModelV12(
  ...args: Parameters<StudioBg3dModelLibraryModule["getStoredBg3dModelV12"]>
): Promise<Awaited<ReturnType<StudioBg3dModelLibraryModule["getStoredBg3dModelV12"]>>> {
  const library = await loadStudioBg3dModelLibraryModule();
  return library.getStoredBg3dModelV12(...args);
}

export async function getStoredBg3dModelByHashV12(
  ...args: Parameters<StudioBg3dModelLibraryModule["getStoredBg3dModelByHashV12"]>
): Promise<Awaited<ReturnType<StudioBg3dModelLibraryModule["getStoredBg3dModelByHashV12"]>>> {
  const library = await loadStudioBg3dModelLibraryModule();
  return library.getStoredBg3dModelByHashV12(...args);
}

export async function importVerifiedBg3dModelsAtomicallyV12(
  ...args: Parameters<StudioBg3dModelLibraryModule["importVerifiedBg3dModelsAtomicallyV12"]>
): Promise<Awaited<ReturnType<StudioBg3dModelLibraryModule["importVerifiedBg3dModelsAtomicallyV12"]>>> {
  const library = await loadStudioBg3dModelLibraryModule();
  return library.importVerifiedBg3dModelsAtomicallyV12(...args);
}

export async function listBg3dModelLibraryEntriesV12(
  ...args: Parameters<StudioBg3dModelLibraryModule["listBg3dModelLibraryEntriesV12"]>
): Promise<Awaited<ReturnType<StudioBg3dModelLibraryModule["listBg3dModelLibraryEntriesV12"]>>> {
  const library = await loadStudioBg3dModelLibraryModule();
  return library.listBg3dModelLibraryEntriesV12(...args);
}

export async function resolveBg3dModelHashV12(
  ...args: Parameters<StudioBg3dModelLibraryModule["resolveBg3dModelHashV12"]>
): Promise<Awaited<ReturnType<StudioBg3dModelLibraryModule["resolveBg3dModelHashV12"]>>> {
  const library = await loadStudioBg3dModelLibraryModule();
  return library.resolveBg3dModelHashV12(...args);
}
