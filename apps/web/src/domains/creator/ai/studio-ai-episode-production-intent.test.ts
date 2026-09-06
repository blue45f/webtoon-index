import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeStudioAiEpisodeProductionOpenRequest,
  requestStudioAiEpisodeProductionOpen,
  subscribeStudioAiEpisodeProductionOpenRequest,
} from "./studio-ai-episode-production-intent";

beforeEach(() => {
  consumeStudioAiEpisodeProductionOpenRequest();
});

describe("studio AI episode production intent", () => {
  it("keeps a request until a later-mounted gateway consumes it", () => {
    requestStudioAiEpisodeProductionOpen(null);

    expect(consumeStudioAiEpisodeProductionOpenRequest()).toBe(true);
    expect(consumeStudioAiEpisodeProductionOpenRequest()).toBe(false);
  });

  it("closes the render-to-effect race when a request is already pending", () => {
    const target = new EventTarget();
    const listener = vi.fn();

    requestStudioAiEpisodeProductionOpen(null);
    const unsubscribe = subscribeStudioAiEpisodeProductionOpenRequest(listener, target);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeStudioAiEpisodeProductionOpenRequest()).toBe(false);
    unsubscribe();
  });

  it("delivers to a mounted gateway without leaving a stale pending request", () => {
    const target = new EventTarget();
    const listener = vi.fn();
    const unsubscribe = subscribeStudioAiEpisodeProductionOpenRequest(listener, target);

    requestStudioAiEpisodeProductionOpen(target);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeStudioAiEpisodeProductionOpenRequest()).toBe(false);

    unsubscribe();
    requestStudioAiEpisodeProductionOpen(target);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
