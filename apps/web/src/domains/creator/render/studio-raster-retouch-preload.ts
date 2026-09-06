import { loadStudioSvgExportWorkerClientModule } from "../export/studio-document-export-loaders";

interface StudioRasterRetouchPreloadedModules {
  readonly svgWorkerClient: typeof import("../export/studio-svg-export-worker-client");
  readonly vectorReference: typeof import("../studio-vector-fill-reference");
}

let commonRasterRetouchPreload: Promise<StudioRasterRetouchPreloadedModules> | null = null;
let liquifyRasterRetouchPreload: Promise<void> | null = null;

function retryable<T>(
  current: Promise<T> | null,
  assign: (promise: Promise<T> | null) => void,
  load: () => Promise<T>,
): Promise<T> {
  if (current) return current;
  const pending = load().catch((error: unknown) => {
    assign(null);
    throw error;
  });
  assign(pending);
  return pending;
}

/**
 * Intent-only warmup for the four vector-to-raster retouch tools.
 *
 * Hover, focus, and pointer-down may fetch code and start empty Worker handshakes, but never read,
 * serialize, rasterize, or mutate the current document. Browser module caching makes this converge
 * with the click path while failed deployment chunks remain retryable.
 */
export function preloadStudioRasterRetouchRuntime(options: {
  readonly liquify?: boolean;
} = {}): Promise<void> {
  const commonModules = retryable(
    commonRasterRetouchPreload,
    (promise) => { commonRasterRetouchPreload = promise; },
    async () => {
      const [svgWorkerClient, vectorReference] = await Promise.all([
        loadStudioSvgExportWorkerClientModule(),
        import("../studio-vector-fill-reference"),
        import("./studio-raster-edit-preparation"),
        import("../studio-pixel-edit-brush-runtime"),
      ]);
      return { svgWorkerClient, vectorReference };
    },
  );
  // Module loading is cached permanently, but the empty Worker leases intentionally expire.
  // Re-arm those leases for every later intent so returning after 45 seconds is warm again.
  const common = commonModules.then(({ svgWorkerClient, vectorReference }) => {
    svgWorkerClient.preloadStudioSvgExportWorker();
    vectorReference.preloadStudioVectorReferenceRasterizer();
  });
  if (!options.liquify) return common;
  const liquify = retryable(
    liquifyRasterRetouchPreload,
    (promise) => { liquifyRasterRetouchPreload = promise; },
    async () => {
      await import("../studio-liquify-browser");
    },
  );
  return Promise.all([common, liquify]).then(() => undefined);
}
