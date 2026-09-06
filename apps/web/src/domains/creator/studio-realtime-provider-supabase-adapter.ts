import {
  STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
  type StudioRealtimeConnectionRequest,
  type StudioRealtimeOutboundEvent,
} from "./studio-realtime-provider-protocol";

import type {
  StudioRealtimeProviderAdapter,
  StudioRealtimeProviderAdapterFactory,
  StudioRealtimeProviderAdapterHandlers,
  StudioRealtimeProviderDescriptor,
} from "./studio-realtime-provider-runtime";

/**
 * Minimal dynamic port implemented by a deployment-owned Supabase integration chunk. It contains
 * no `@supabase/supabase-js` type or import, keeping the product contract vendor-neutral and
 * preventing the SDK from entering the initial Studio bundle before the deployment is configured.
 */
export interface StudioSupabaseRealtimeDynamicPort {
  connect(
    request: StudioRealtimeConnectionRequest,
    ticket: string,
    handlers: StudioRealtimeProviderAdapterHandlers,
    signal: AbortSignal,
  ): Promise<unknown>;
  publish(
    event: StudioRealtimeOutboundEvent,
    signal: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void> | void;
}

export type StudioSupabaseRealtimeDynamicPortLoader = (
  signal: AbortSignal,
) => Promise<StudioSupabaseRealtimeDynamicPort>;

export interface StudioSupabaseRealtimeAdapterFactoryOptions {
  readonly providerId: string;
  readonly load: StudioSupabaseRealtimeDynamicPortLoader;
}

class StudioSupabaseRealtimeAdapter
  implements StudioRealtimeProviderAdapter
{
  readonly descriptor: StudioRealtimeProviderDescriptor;
  private readonly load: StudioSupabaseRealtimeDynamicPortLoader;
  private port: StudioSupabaseRealtimeDynamicPort | null = null;
  private closed = false;

  constructor(options: StudioSupabaseRealtimeAdapterFactoryOptions) {
    this.descriptor = Object.freeze({
      providerId: options.providerId,
      kind: "supabase-realtime",
      protocolVersion: STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
    });
    this.load = options.load;
  }

  async connect(
    request: StudioRealtimeConnectionRequest,
    ticket: string,
    handlers: StudioRealtimeProviderAdapterHandlers,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.closed || signal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    if (this.port) {
      throw new Error("Supabase Realtime adapter already connected.");
    }
    const port = await this.load(signal);
    if (
      !port ||
      typeof port.connect !== "function" ||
      typeof port.publish !== "function" ||
      typeof port.close !== "function"
    ) {
      throw new Error("Invalid Supabase Realtime dynamic port.");
    }
    if (this.closed || signal.aborted) {
      await port.close();
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    let hello: unknown;
    try {
      hello = await port.connect(request, ticket, handlers, signal);
    } catch (error) {
      await port.close();
      throw error;
    }
    if (this.closed || signal.aborted) {
      await port.close();
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    this.port = port;
    return hello;
  }

  publish(
    event: StudioRealtimeOutboundEvent,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.closed || !this.port || signal.aborted) {
      return Promise.reject(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    }
    return this.port.publish(event, signal);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const port = this.port;
    this.port = null;
    if (port) await port.close();
  }
}

/**
 * The loader may use a real dynamic `import("@supabase/supabase-js")` in a deployment adapter, or
 * an existing preloaded client. This module itself never depends on or initializes that SDK.
 */
export function createStudioSupabaseRealtimeAdapterFactory(
  options: StudioSupabaseRealtimeAdapterFactoryOptions,
): StudioRealtimeProviderAdapterFactory {
  const descriptor = Object.freeze({
    providerId: options.providerId,
    kind: "supabase-realtime" as const,
    protocolVersion: STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
  });
  return Object.freeze({
    descriptor,
    create: () => new StudioSupabaseRealtimeAdapter(options),
  });
}
