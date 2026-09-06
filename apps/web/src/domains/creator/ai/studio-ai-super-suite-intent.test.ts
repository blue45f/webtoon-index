import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeStudioAiSuperSuiteOpenRequest,
  requestStudioAiSuperSuiteOpen,
  subscribeStudioAiSuperSuiteOpenRequest,
} from "./studio-ai-super-suite-intent";

beforeEach(() => {
  consumeStudioAiSuperSuiteOpenRequest();
});

describe("studio AI super-suite intent", () => {
  it("keeps a request until a later-mounted surface consumes it", () => {
    requestStudioAiSuperSuiteOpen(null);

    expect(consumeStudioAiSuperSuiteOpenRequest()).toBe(true);
    expect(consumeStudioAiSuperSuiteOpenRequest()).toBe(false);
  });

  it("closes the render-to-effect race when a request is already pending", () => {
    const target = new EventTarget();
    const listener = vi.fn();

    requestStudioAiSuperSuiteOpen(null);
    const unsubscribe = subscribeStudioAiSuperSuiteOpenRequest(listener, target);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeStudioAiSuperSuiteOpenRequest()).toBe(false);
    unsubscribe();
  });

  it("delivers to a mounted surface without leaving a stale pending request", () => {
    const target = new EventTarget();
    const listener = vi.fn();
    const unsubscribe = subscribeStudioAiSuperSuiteOpenRequest(listener, target);

    requestStudioAiSuperSuiteOpen(target);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeStudioAiSuperSuiteOpenRequest()).toBe(false);

    unsubscribe();
    requestStudioAiSuperSuiteOpen(target);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
