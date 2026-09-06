import { useEffect, useRef, useState } from "react";

import {
  persistStudioLiveGuestCredential,
  requestStudioLiveAuthTicket,
  type StudioLiveAuthTicketClientOptions,
} from "./studio-live-auth-ticket-client";

import type { StudioLiveTransportFactory } from "./studio-live-collaboration-transport";
import type { createStudioServerLiveTransportFactory } from "./studio-live-socket-transport";
import type { StudioLiveAuthTicketResponse } from "../../../shared/lib/studio-live-auth-ticket";

const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8_000;
const MAX_AUTOMATIC_RETRY_ATTEMPTS = 5;

type StudioServerLiveTransportFactoryBuilder = typeof createStudioServerLiveTransportFactory;

let serverTransportBuilderRequest: Promise<StudioServerLiveTransportFactoryBuilder> | null = null;

/**
 * The Socket.IO transport is ~4.5k lines and pulls the live wire protocol, the ink codec and the
 * lock ledger with it. None of that is needed to paint the editor, so it is fetched only once an
 * admission credential exists — the point at which a collaboration channel is actually wanted.
 */
function loadStudioServerLiveTransportFactoryBuilder(): Promise<StudioServerLiveTransportFactoryBuilder> {
  serverTransportBuilderRequest ??= import("./studio-live-socket-transport")
    .then((module) => module.createStudioServerLiveTransportFactory)
    .catch((error: unknown) => {
      serverTransportBuilderRequest = null;
      throw error;
    });
  return serverTransportBuilderRequest;
}

function buildGuestTransportFactory(
  build: StudioServerLiveTransportFactoryBuilder,
  createGuestCredential: () => string,
): { readonly credential: string; readonly factory: StudioLiveTransportFactory } | null {
  try {
    const credential = createGuestCredential();
    return {
      credential,
      factory: build(credential, {
        refreshSocketCredential: async () => credential,
      }),
    };
  } catch {
    return null;
  }
}

function defaultScheduleTimeout(handler: () => void, delayMs: number): unknown {
  return globalThis.setTimeout(handler, delayMs);
}

function defaultCancelTimeout(handle: unknown): void {
  globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
}

interface AuthenticatedTransportFactoryState {
  readonly userId: string;
  readonly factory: StudioLiveTransportFactory;
}

export interface StudioLiveTransportAuthInput {
  readonly authReady: boolean;
  readonly userId: string | null;
}

export interface StudioLiveTransportAuthDependencies {
  readonly requestTicket?: (
    options?: StudioLiveAuthTicketClientOptions,
  ) => Promise<StudioLiveAuthTicketResponse>;
  readonly createGuestCredential?: () => string;
  readonly createServerFactory?: typeof createStudioServerLiveTransportFactory;
  readonly setTimeout?: (handler: () => void, delayMs: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

/**
 * Owns the browser-only admission credential lifecycle without coupling the one-minute
 * handshake ticket to the lifetime of an already-authorized collaboration room.
 *
 * The returned factory is stable for the authenticated user. Socket reconnects request a fresh
 * admission ticket through the factory's in-memory refresh callback; neither an expired seed
 * ticket nor a transient issuance failure can downgrade an authenticated document to a guest.
 */
export function useStudioLiveTransportAuth(
  input: StudioLiveTransportAuthInput,
  dependencies: StudioLiveTransportAuthDependencies = {},
): StudioLiveTransportFactory | undefined {
  const requestTicket = dependencies.requestTicket ?? requestStudioLiveAuthTicket;
  const createGuestCredential =
    dependencies.createGuestCredential ?? persistStudioLiveGuestCredential;
  const injectedServerFactory = dependencies.createServerFactory ?? null;
  const scheduleTimeout = dependencies.setTimeout ?? defaultScheduleTimeout;
  const cancelTimeout = dependencies.clearTimeout ?? defaultCancelTimeout;
  const guestFactoryRef = useRef<{
    readonly credential: string;
    readonly factory: StudioLiveTransportFactory;
  } | null>(null);
  const [authenticatedFactory, setAuthenticatedFactory] =
    useState<AuthenticatedTransportFactoryState | null>(null);
  // Only bumped when a guest factory is minted from the lazily fetched transport module, so the
  // render below re-reads the ref that the effect just filled.
  const [, setGuestFactoryGeneration] = useState(0);

  useEffect(() => {
    if (!input.authReady || !input.userId) {
      setAuthenticatedFactory(null);
      return;
    }

    const userId = input.userId;
    let cancelled = false;
    let requestInFlight = false;
    let factoryReady = false;
    let automaticFailures = 0;
    let retryTimer: unknown | null = null;
    let requestController: AbortController | null = null;

    const clearRetry = () => {
      if (retryTimer === null) return;
      cancelTimeout(retryTimer);
      retryTimer = null;
    };
    const scheduleRetry = () => {
      if (
        cancelled ||
        factoryReady ||
        retryTimer !== null ||
        automaticFailures >= MAX_AUTOMATIC_RETRY_ATTEMPTS
      ) return;
      const delayMs = Math.min(
        MAX_RETRY_DELAY_MS,
        INITIAL_RETRY_DELAY_MS * 2 ** Math.max(0, automaticFailures - 1),
      );
      retryTimer = scheduleTimeout(() => {
        retryTimer = null;
        void issueInitialCredential();
      }, delayMs);
    };
    const issueInitialCredential = async () => {
      if (cancelled || factoryReady || requestInFlight) return;
      requestInFlight = true;
      const controller = new AbortController();
      requestController = controller;
      try {
        const response = await requestTicket({ signal: controller.signal });
        if (cancelled || controller.signal.aborted) return;
        const build =
          injectedServerFactory ?? (await loadStudioServerLiveTransportFactoryBuilder());
        if (cancelled || controller.signal.aborted) return;
        const factory = build(response.ticket, {
          refreshSocketCredential: async () => {
            const refreshed = await requestTicket();
            return refreshed.ticket;
          },
        });
        factoryReady = true;
        clearRetry();
        setAuthenticatedFactory({ userId, factory });
      } catch {
        if (cancelled || controller.signal.aborted) return;
        automaticFailures += 1;
        scheduleRetry();
      } finally {
        if (requestController === controller) requestController = null;
        requestInFlight = false;
      }
    };
    const recover = () => {
      if (cancelled || factoryReady) return;
      automaticFailures = 0;
      clearRetry();
      void issueInitialCredential();
    };

    setAuthenticatedFactory((current) =>
      current?.userId === userId ? current : null,
    );
    globalThis.addEventListener("online", recover, { passive: true });
    globalThis.addEventListener("focus", recover, { passive: true });
    void issueInitialCredential();

    return () => {
      cancelled = true;
      clearRetry();
      requestController?.abort();
      globalThis.removeEventListener("online", recover);
      globalThis.removeEventListener("focus", recover);
    };
  }, [
    cancelTimeout,
    injectedServerFactory,
    input.authReady,
    input.userId,
    requestTicket,
    scheduleTimeout,
  ]);

  // A signed-out visitor still gets one stable guest identity, but minting it now waits for the
  // transport chunk. Nothing on the canvas depends on it: the room only consumes the factory once
  // a server-backed session is requested, and that path is already asynchronous.
  useEffect(() => {
    if (!input.authReady || input.userId) return;
    if (injectedServerFactory || guestFactoryRef.current) return;
    let cancelled = false;
    void loadStudioServerLiveTransportFactoryBuilder()
      .then((build) => {
        if (cancelled || guestFactoryRef.current) return;
        const minted = buildGuestTransportFactory(build, createGuestCredential);
        if (!minted) return;
        guestFactoryRef.current = minted;
        setGuestFactoryGeneration((generation) => generation + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [createGuestCredential, injectedServerFactory, input.authReady, input.userId]);

  if (!input.authReady) return undefined;
  if (input.userId) {
    return authenticatedFactory?.userId === input.userId
      ? authenticatedFactory.factory
      : undefined;
  }
  // An injected builder keeps the synchronous contract the collaboration tests and callers with
  // their own transport rely on; the default path is filled in by the effect above.
  if (!guestFactoryRef.current && injectedServerFactory) {
    guestFactoryRef.current = buildGuestTransportFactory(
      injectedServerFactory,
      createGuestCredential,
    );
  }
  return guestFactoryRef.current?.factory;
}
