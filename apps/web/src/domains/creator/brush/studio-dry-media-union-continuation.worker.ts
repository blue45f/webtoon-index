import { createStudioDryMediaUnionContinuationOpfsCasStore } from "./studio-dry-media-union-continuation-opfs-store";
import { createStudioDryMediaUnionContinuationStore } from "./studio-dry-media-union-continuation-store";
import {
  installStudioDryMediaUnionContinuationWorkerRuntime,
  StudioDryMediaUnionContinuationWorkerRuntime,
  type StudioDryMediaUnionContinuationWorkerScope,
} from "./studio-dry-media-union-continuation-worker-runtime";

const scope = globalThis as unknown as StudioDryMediaUnionContinuationWorkerScope;
const cas = await createStudioDryMediaUnionContinuationOpfsCasStore(scope);
let runtime: StudioDryMediaUnionContinuationWorkerRuntime | null = null;

try {
  const store = createStudioDryMediaUnionContinuationStore(cas);
  runtime = new StudioDryMediaUnionContinuationWorkerRuntime({ store });
  installStudioDryMediaUnionContinuationWorkerRuntime(scope, runtime);
} catch (error) {
  try {
    if (runtime) await runtime.close();
    else await cas.close();
  } catch {
    // Preserve the initialization failure as the Worker startup authority.
  }
  throw error;
}

export {};
