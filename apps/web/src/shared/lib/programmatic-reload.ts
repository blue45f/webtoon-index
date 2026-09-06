let programmaticReloadAllowed = false;

/** Next `beforeunload` is an app/HMR reload, not a user leaving with unsaved ink. */
export function allowStudioProgrammaticReload(): void {
  programmaticReloadAllowed = true;
}

export function consumeStudioProgrammaticReloadAllowance(): boolean {
  if (!programmaticReloadAllowed) return false;
  programmaticReloadAllowed = false;
  return true;
}

if (import.meta.hot) {
  import.meta.hot.on("vite:beforeFullReload", () => {
    allowStudioProgrammaticReload();
  });
}
