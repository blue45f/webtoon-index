import { installStudioWeightedDeformationWorkerHost } from "./studio-weighted-deformation-worker-host";

import type { StudioWeightedDeformationWorkerHostScope } from "./studio-weighted-deformation-worker-host";

installStudioWeightedDeformationWorkerHost(
  globalThis as unknown as StudioWeightedDeformationWorkerHostScope,
);
