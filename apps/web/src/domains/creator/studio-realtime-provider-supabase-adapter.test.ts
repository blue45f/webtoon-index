import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_REALTIME_CAPABILITIES,
  type StudioRealtimeConnectionRequest,
} from "./studio-realtime-provider-protocol";
import { createStudioSupabaseRealtimeAdapterFactory } from "./studio-realtime-provider-supabase-adapter";

const request: StudioRealtimeConnectionRequest = {
  version: 1,
  clientInstanceId: "00000000-0000-4000-8000-000000000001",
  sessionId: "session-1",
  scope: { workId: "work-1", roomId: "room-1" },
  requiredWorkloads: ["presence", "comments", "screen-signaling"],
  requiredCapabilities: [...STUDIO_REALTIME_CAPABILITIES],
  resume: [],
};

describe("Supabase realtime dynamic adapter boundary", () => {
  it("loads the deployment port lazily and forwards an ephemeral ticket only to connect", async () => {
    const connect = vi.fn(async () => ({ ok: true }));
    const publish = vi.fn(async () => ({ ok: true }));
    const close = vi.fn();
    const load = vi.fn(async () => ({ connect, publish, close }));
    const factory = createStudioSupabaseRealtimeAdapterFactory({
      providerId: "supabase-seoul",
      load,
    });
    expect(load).not.toHaveBeenCalled();

    const adapter = await factory.create();
    expect(load).not.toHaveBeenCalled();
    const controller = new AbortController();
    const handlers = {
      onEvent: vi.fn(),
      onDisconnect: vi.fn(),
    };
    await adapter.connect(
      request,
      "ephemeral-server-ticket-12345678901234567890",
      handlers,
      controller.signal,
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(
      request,
      "ephemeral-server-ticket-12345678901234567890",
      handlers,
      controller.signal,
    );
    expect(JSON.stringify(adapter.descriptor)).not.toContain("ticket");
    await adapter.close();
    await adapter.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes a dynamically loaded port when connection fails", async () => {
    const close = vi.fn();
    const factory = createStudioSupabaseRealtimeAdapterFactory({
      providerId: "supabase-seoul",
      load: async () => ({
        connect: async () => {
          throw new Error("failed");
        },
        publish: async () => null,
        close,
      }),
    });
    const adapter = await factory.create();
    await expect(
      adapter.connect(
        request,
        "ephemeral-server-ticket-12345678901234567890",
        { onEvent: vi.fn(), onDisconnect: vi.fn() },
        new AbortController().signal,
      ),
    ).rejects.toThrow("failed");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
