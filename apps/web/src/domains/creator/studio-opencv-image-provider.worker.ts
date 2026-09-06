import { installStudioOpenCvImageWorkerHost } from "./studio-opencv-image-worker-host";

import type { StudioOpenCvImageWorkerHostScope } from "./studio-opencv-image-worker-host";

installStudioOpenCvImageWorkerHost(
  globalThis as unknown as StudioOpenCvImageWorkerHostScope,
);
