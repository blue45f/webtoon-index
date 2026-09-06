/**
 * Automatic raster publication stays fail-closed until the replay surface has completed its
 * verified renderer handoff. An environment token alone can never turn a parallel, non-visible log
 * into production authority.
 */
import { STUDIO_RASTER_ASSET_ADMISSION_OPT_IN_TOKEN } from "@/shared/lib/studio-raster-asset-admission";

export const STUDIO_RASTER_PUBLICATION_EXPERIMENT_TOKEN =
  STUDIO_RASTER_ASSET_ADMISSION_OPT_IN_TOKEN;

// StudioPage now mounts the verified two-phase replay surface. The experiment token remains a
// separate deployment opt-in so renderer and server asset admission must be enabled together.
export const STUDIO_RASTER_VERIFIED_RENDERER_HANDOFF_MOUNTED = true;

export function isStudioAutomaticRasterPublicationEnabled(input: {
  readonly experimentToken: string | undefined;
  readonly rendererHandoffMounted: boolean;
}): boolean {
  return input.rendererHandoffMounted &&
    input.experimentToken === STUDIO_RASTER_PUBLICATION_EXPERIMENT_TOKEN;
}

export const STUDIO_AUTOMATIC_RASTER_PUBLICATION_ENABLED =
  isStudioAutomaticRasterPublicationEnabled({
    experimentToken: import.meta.env.VITE_STUDIO_RASTER_CRDT_AUTO_PUBLICATION,
    rendererHandoffMounted: STUDIO_RASTER_VERIFIED_RENDERER_HANDOFF_MOUNTED,
  });
