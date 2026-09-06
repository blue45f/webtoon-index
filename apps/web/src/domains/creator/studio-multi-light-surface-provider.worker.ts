import { installStudioMultiLightSurfaceWorkerHost } from "./studio-multi-light-surface-worker-host";

import type { StudioMultiLightSurfaceWorkerHostScope } from "./studio-multi-light-surface-worker-host";

installStudioMultiLightSurfaceWorkerHost(
  globalThis as unknown as StudioMultiLightSurfaceWorkerHostScope,
);
