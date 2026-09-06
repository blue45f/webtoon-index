import { installStudioProceduralMediaSurfaceWorkerHost } from "./studio-procedural-media-surface-worker-host";

import type { StudioProceduralMediaSurfaceWorkerHostScope } from "./studio-procedural-media-surface-worker-host";

installStudioProceduralMediaSurfaceWorkerHost(
  globalThis as unknown as StudioProceduralMediaSurfaceWorkerHostScope,
);
