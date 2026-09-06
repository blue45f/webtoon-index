import {
  STUDIO_REALTIME_WORKLOADS,
  type StudioRealtimeCapability,
  type StudioRealtimeInboundEvent,
  type StudioRealtimeOutboundEvent,
  type StudioRealtimeProviderHello,
  type StudioRealtimeScope,
  type StudioRealtimeWorkload,
} from "./studio-realtime-provider-protocol";
import {
  StudioRealtimeProviderContractError,
  StudioRealtimeProviderSession,
  type StudioRealtimeProviderAdapterFactory,
  type StudioRealtimeProviderSessionOptions,
  type StudioRealtimeProviderStatus,
  type StudioRealtimeTicketIssuer,
} from "./studio-realtime-provider-runtime";

export interface StudioRealtimeWorkloadRoute {
  readonly routeId: string;
  readonly workloads: readonly StudioRealtimeWorkload[];
  readonly capabilities: readonly StudioRealtimeCapability[];
  /**
   * Providers in one route are semantic substitutes for the same workload set. They are tried in
   * order; a route never falls through to a provider with a smaller capability contract.
   */
  readonly providers: readonly StudioRealtimeProviderAdapterFactory[];
}

export interface StudioRealtimeWorkloadCoordinatorOptions {
  readonly scope: StudioRealtimeScope;
  readonly clientInstanceId: string;
  readonly sessionId: string;
  readonly routes: readonly StudioRealtimeWorkloadRoute[];
  readonly ticketIssuer: StudioRealtimeTicketIssuer;
  readonly reconnect?: StudioRealtimeProviderSessionOptions["reconnect"];
  readonly now?: StudioRealtimeProviderSessionOptions["now"];
  readonly random?: StudioRealtimeProviderSessionOptions["random"];
  readonly setTimeout?: StudioRealtimeProviderSessionOptions["setTimeout"];
  readonly clearTimeout?: StudioRealtimeProviderSessionOptions["clearTimeout"];
}

export type StudioRealtimeWorkloadStatus = Readonly<{
  routeId: string;
  workload: StudioRealtimeWorkload;
  status: StudioRealtimeProviderStatus;
}>;

interface RouteRuntime {
  readonly route: StudioRealtimeWorkloadRoute;
  readonly session: StudioRealtimeProviderSession;
  readonly unsubscribeEvent: () => void;
  readonly unsubscribeStatus: () => void;
}

const ROUTE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,159}$/u;

/**
 * Coordinates independent purpose-specific realtime sessions.
 *
 * Deployments may group all three workloads into one Cloudflare connection, or route presence,
 * comment invalidations, and screen signaling to separate providers. No route is allowed to
 * overlap another, so one workload always has one explicit operational owner.
 */
export class StudioRealtimeWorkloadCoordinator {
  private readonly eventListeners = new Set<
    (event: StudioRealtimeInboundEvent) => void
  >();
  private readonly statusListeners = new Set<
    (status: StudioRealtimeWorkloadStatus) => void
  >();
  private readonly routeByWorkload = new Map<
    StudioRealtimeWorkload,
    RouteRuntime
  >();
  private readonly statusByWorkload = new Map<
    StudioRealtimeWorkload,
    StudioRealtimeProviderStatus
  >();
  private readonly routes: RouteRuntime[];
  private disposed = false;

  constructor(options: StudioRealtimeWorkloadCoordinatorOptions) {
    if (options.routes.length === 0) {
      throw new StudioRealtimeProviderContractError(
        "실시간 작업 경로가 비어 있습니다.",
      );
    }
    const seenRouteIds = new Set<string>();
    const runtimes: RouteRuntime[] = [];
    for (const route of options.routes) {
      if (
        !ROUTE_ID.test(route.routeId) ||
        seenRouteIds.has(route.routeId) ||
        route.workloads.length === 0 ||
        route.providers.length === 0
      ) {
        throw new StudioRealtimeProviderContractError(
          "실시간 작업 경로가 올바르지 않습니다.",
        );
      }
      seenRouteIds.add(route.routeId);
      for (const workload of route.workloads) {
        if (
          !STUDIO_REALTIME_WORKLOADS.includes(workload) ||
          this.routeByWorkload.has(workload)
        ) {
          throw new StudioRealtimeProviderContractError(
            "하나의 실시간 작업에 경로가 중복되었습니다.",
          );
        }
      }
      const session = new StudioRealtimeProviderSession({
        scope: options.scope,
        clientInstanceId: options.clientInstanceId,
        sessionId: options.sessionId,
        requiredWorkloads: route.workloads,
        requiredCapabilities: route.capabilities,
        providers: route.providers,
        ticketIssuer: options.ticketIssuer,
        ...(options.reconnect === undefined
          ? {}
          : { reconnect: options.reconnect }),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.random === undefined ? {} : { random: options.random }),
        ...(options.setTimeout === undefined
          ? {}
          : { setTimeout: options.setTimeout }),
        ...(options.clearTimeout === undefined
          ? {}
          : { clearTimeout: options.clearTimeout }),
      });
      const runtime = {
        route,
        session,
        unsubscribeEvent: session.subscribe((event) => {
          for (const listener of this.eventListeners) {
            try {
              listener(event);
            } catch {
              // One route consumer cannot interrupt delivery to the remaining Studio surfaces.
            }
          }
        }),
        unsubscribeStatus: session.subscribeStatus((status) => {
          for (const workload of route.workloads) {
            this.statusByWorkload.set(workload, status);
            const update = { routeId: route.routeId, workload, status };
            for (const listener of this.statusListeners) {
              try {
                listener(update);
              } catch {
                // Status observers do not own route lifecycle state.
              }
            }
          }
        }),
      };
      runtimes.push(runtime);
      for (const workload of route.workloads) {
        this.routeByWorkload.set(workload, runtime);
      }
    }
    this.routes = runtimes;
  }

  isReady(workload: StudioRealtimeWorkload): boolean {
    return this.statusByWorkload.get(workload)?.state === "ready";
  }

  status(workload: StudioRealtimeWorkload): StudioRealtimeProviderStatus | null {
    return this.statusByWorkload.get(workload) ?? null;
  }

  async connect(): Promise<readonly PromiseSettledResult<StudioRealtimeProviderHello>[]> {
    if (this.disposed) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    return await Promise.allSettled(
      this.routes.map((runtime) => runtime.session.connect()),
    );
  }

  subscribe(
    listener: (event: StudioRealtimeInboundEvent) => void,
  ): () => void {
    if (this.disposed) return () => undefined;
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  subscribeStatus(
    listener: (status: StudioRealtimeWorkloadStatus) => void,
  ): () => void {
    if (this.disposed) return () => undefined;
    this.statusListeners.add(listener);
    for (const runtime of this.routes) {
      for (const workload of runtime.route.workloads) {
        try {
          listener({
            routeId: runtime.route.routeId,
            workload,
            status: runtime.session.currentStatus,
          });
        } catch {
          // Continue the eager snapshot for the remaining independently-routed workloads.
        }
      }
    }
    return () => this.statusListeners.delete(listener);
  }

  publish(
    event: StudioRealtimeOutboundEvent,
    signal?: AbortSignal,
  ) {
    if (this.disposed) {
      return Promise.reject(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    }
    const runtime = this.routeByWorkload.get(event.workload);
    if (!runtime) {
      return Promise.reject(
        new StudioRealtimeProviderContractError(
          "실시간 작업에 연결된 공급자가 없습니다.",
        ),
      );
    }
    return runtime.session.publish(event, signal);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.eventListeners.clear();
    this.statusListeners.clear();
    for (const runtime of this.routes) {
      runtime.unsubscribeEvent();
      runtime.unsubscribeStatus();
    }
    await Promise.allSettled(
      this.routes.map((runtime) => runtime.session.dispose()),
    );
    this.routeByWorkload.clear();
    this.statusByWorkload.clear();
  }
}
