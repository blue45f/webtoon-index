import { installStudioFiberBristleWorkerHost } from "./studio-fiber-bristle-brush-worker-host";

import type { StudioFiberBristleWorkerHostScope } from "./studio-fiber-bristle-brush-worker-host";

installStudioFiberBristleWorkerHost(
  globalThis as unknown as StudioFiberBristleWorkerHostScope,
);
