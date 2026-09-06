import type { StudioBrushR8PngDecoder } from "./studio-brush-r8-grain-hydrator";

interface StudioBrushR8PngModule {
  readonly decodePng: StudioBrushR8PngDecoder;
}

/** Share a successful lazy decoder without making a failed chunk load permanent. */
export function createStudioBrushR8PngDecoder(
  loadModule: () => Promise<StudioBrushR8PngModule>,
): StudioBrushR8PngDecoder {
  let modulePromise: Promise<StudioBrushR8PngModule> | null = null;
  return async (bytes) => {
    // Promise.resolve also turns a synchronous loader error into the same recoverable rejection.
    const pending = modulePromise ??= Promise.resolve().then(loadModule);
    const module = await pending.catch((error: unknown) => {
      // An older rejection must not clear a newer retry started by another caller.
      if (modulePromise === pending) modulePromise = null;
      throw error;
    });
    // Invalid image bytes do not invalidate the successfully loaded decoder.
    return module.decodePng(bytes);
  };
}
