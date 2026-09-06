/// <reference lib="webworker" />

import { createStudioEngineWorkerRuntime } from "./render/studio-engine-worker-runtime";

const scope = self as DedicatedWorkerGlobalScope;

const runtime = createStudioEngineWorkerRuntime({
  postMessage(message) {
    scope.postMessage(message);
  },
});

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  runtime.handleMessage(event.data);
});

scope.addEventListener("messageerror", () => {
  runtime.dispose();
  scope.close();
});

export {};
