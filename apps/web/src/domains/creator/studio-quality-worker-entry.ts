import { loadStudioCanvasKitQualityEngine } from "./render/studio-canvaskit-quality-engine";
import {
  createStudioQualityWorkerRuntime,
} from "./studio-quality-worker-runtime";

import type { StudioQualityWorkerResponseMessage } from "./studio-quality-worker-protocol";

interface StudioQualityWorkerGlobalScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioQualityWorkerResponseMessage): void;
  close(): void;
}

const workerScope = globalThis as unknown as StudioQualityWorkerGlobalScope;
const runtime = createStudioQualityWorkerRuntime({
  port: {
    postMessage(message) {
      workerScope.postMessage(message);
      if (
        message.type === "studio-quality/fatal"
        || message.type === "studio-quality/disposed"
      ) {
        workerScope.close();
      }
    },
  },
  // The dynamic CanvasKit/WASM imports inside this factory execute once per valid Worker epoch.
  providerFactory: loadStudioCanvasKitQualityEngine,
});

workerScope.onmessage = (event) => {
  runtime.handleMessage(event.data);
};

workerScope.onmessageerror = () => {
  runtime.handleMessage(null);
};
