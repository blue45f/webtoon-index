import { validateStudioBg3dGlb } from "./studio-bg3d-glb-validation";
import {
  STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
  type StudioBg3dGlbWorkerRequest,
} from "./studio-bg3d-glb-validation-worker-protocol";

import type { StudioBg3dValidationWorkerLike } from "./studio-bg3d-glb-validation-worker-client";

interface TestMessageEvent {
  readonly data: unknown;
}

interface TestErrorEvent {
  preventDefault?(): void;
}

/** Runs the real validator behind the same message boundary used by the browser module Worker. */
export class StudioBg3dValidationWorkerTestFixture implements StudioBg3dValidationWorkerLike {
  readonly #messageListeners = new Set<(event: TestMessageEvent) => void>();
  readonly #errorListeners = new Set<(event: TestErrorEvent) => void>();

  postMessage(message: StudioBg3dGlbWorkerRequest): void {
    if (message.kind !== "validate") return;
    void validateStudioBg3dGlb(message.bytes, message.options).then(
      (result) => {
        const data = {
          version: STUDIO_BG3D_GLB_VALIDATION_WORKER_PROTOCOL_VERSION,
          kind: "result" as const,
          requestId: message.requestId,
          result,
        };
        for (const listener of this.#messageListeners) listener({ data });
      },
      () => {
        for (const listener of this.#errorListeners) listener({});
      },
    );
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: TestMessageEvent) => void) | ((event: TestErrorEvent) => void),
  ): void {
    if (type === "message") {
      this.#messageListeners.add(listener as (event: TestMessageEvent) => void);
    } else {
      this.#errorListeners.add(listener as (event: TestErrorEvent) => void);
    }
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: TestMessageEvent) => void) | ((event: TestErrorEvent) => void),
  ): void {
    if (type === "message") {
      this.#messageListeners.delete(listener as (event: TestMessageEvent) => void);
    } else {
      this.#errorListeners.delete(listener as (event: TestErrorEvent) => void);
    }
  }

  terminate(): void {
    this.#messageListeners.clear();
    this.#errorListeners.clear();
  }
}
