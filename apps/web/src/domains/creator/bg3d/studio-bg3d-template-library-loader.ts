type StudioBg3dTemplateLibraryModule = typeof import( "./bg3d-template-library");

export type Bg3dTemplateLibraryEntry =
  import( "./bg3d-template-library").Bg3dTemplateLibraryEntry;

let studioBg3dTemplateLibraryModulePromise:
  Promise<StudioBg3dTemplateLibraryModule> | null = null;

/**
 * Templates are a Models-panel product surface. Keep their SQLite/OPFS authority outside the
 * editor activation closure until that panel is opened or a template action is invoked.
 */
export function loadStudioBg3dTemplateLibraryModule():
Promise<StudioBg3dTemplateLibraryModule> {
  studioBg3dTemplateLibraryModulePromise ??= import( "./bg3d-template-library").catch(
    (cause: unknown) => {
      studioBg3dTemplateLibraryModulePromise = null;
      throw cause;
    },
  );
  return studioBg3dTemplateLibraryModulePromise;
}

export async function deleteBg3dTemplateV12(
  ...args: Parameters<StudioBg3dTemplateLibraryModule["deleteBg3dTemplateV12"]>
): Promise<Awaited<ReturnType<StudioBg3dTemplateLibraryModule["deleteBg3dTemplateV12"]>>> {
  const library = await loadStudioBg3dTemplateLibraryModule();
  return library.deleteBg3dTemplateV12(...args);
}

export async function instantiateBg3dTemplateDocument(
  ...args: Parameters<
    StudioBg3dTemplateLibraryModule["instantiateBg3dTemplateDocument"]
  >
): Promise<
  Awaited<
    ReturnType<StudioBg3dTemplateLibraryModule["instantiateBg3dTemplateDocument"]>
  >
> {
  const library = await loadStudioBg3dTemplateLibraryModule();
  return library.instantiateBg3dTemplateDocument(...args);
}

export async function listBg3dTemplatesV12(
  ...args: Parameters<StudioBg3dTemplateLibraryModule["listBg3dTemplatesV12"]>
): Promise<Awaited<ReturnType<StudioBg3dTemplateLibraryModule["listBg3dTemplatesV12"]>>> {
  const library = await loadStudioBg3dTemplateLibraryModule();
  return library.listBg3dTemplatesV12(...args);
}

export async function saveBg3dTemplateV12(
  ...args: Parameters<StudioBg3dTemplateLibraryModule["saveBg3dTemplateV12"]>
): Promise<Awaited<ReturnType<StudioBg3dTemplateLibraryModule["saveBg3dTemplateV12"]>>> {
  const library = await loadStudioBg3dTemplateLibraryModule();
  return library.saveBg3dTemplateV12(...args);
}
