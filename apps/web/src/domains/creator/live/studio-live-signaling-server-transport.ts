import {
  createStudioLocalLiveTransport,
  isStudioLocalLiveTransportSupported,
  type StudioLiveTransport,
  type StudioLiveTransportContext,
  type StudioLiveTransportControlEvent,
  type StudioLiveTransportFactory,
  type StudioLiveTransportStatus,
} from "./studio-live-collaboration-transport";

/**
 * Server-mode shell used when production has Cloudflare presence/signaling but no
 * Nest Socket.IO CRDT host. Same-origin tabs still share a BroadcastChannel so two
 * Studio windows in one profile can exchange presence and Yjs without WebRTC.
 * Purpose-routing and the P2P overlay wrap this for cross-browser peers.
 */
export function createStudioLiveSignalingServerTransport(
  context?: StudioLiveTransportContext,
): StudioLiveTransport {
  const local =
    context && isStudioLocalLiveTransportSupported()
      ? createStudioLocalLiveTransport(context)
      : null;
  const listeners = new Set<(value: unknown) => void>();
  const controlListeners = new Set<(event: StudioLiveTransportControlEvent) => void>();
  let connected = false;
  let closed = false;

  const emitControl = (status: StudioLiveTransportStatus): void => {
    const event: StudioLiveTransportControlEvent = { type: "status", status };
    for (const listener of controlListeners) {
      try {
        listener(event);
      } catch {
        // Room observers do not own this signaling shell.
      }
    }
  };

  const connectLocal = async (): Promise<void> => {
    if (closed) {
      throw new Error("이미 닫힌 실시간 시그널 채널입니다.");
    }
    if (local) await local.connect();
    connected = true;
    emitControl({
      state: "ready",
      message: "실시간 시그널에 연결했습니다.",
      recoverable: true,
    });
  };

  return {
    mode: "server",
    crdtFanout: local ? "mesh" : "none",
    get ready() {
      return connected && !closed && (local ? local.ready : true);
    },
    connect() {
      return connectLocal();
    },
    send(envelope) {
      // This shell's BroadcastChannel reaches only same-origin tabs. Returning true for a
      // cross-browser preview fallback would silently hide a missing mesh packet, so preview is
      // accepted only by the outer P2P mesh or a real Socket.IO authoritative primary.
      if (envelope.kind === "preview:gesture") return false;
      return local?.send(envelope) ?? false;
    },
    subscribe(listener) {
      if (closed) return () => undefined;
      if (local) return local.subscribe(listener);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeControl(listener) {
      if (closed) return () => undefined;
      controlListeners.add(listener);
      return () => controlListeners.delete(listener);
    },
    ...(local
      ? {
          requestCrdtSync: local.requestCrdtSync?.bind(local),
          respondCrdtSync: local.respondCrdtSync?.bind(local),
          publishCrdtUpdate: local.publishCrdtUpdate?.bind(local),
          subscribeCrdt: local.subscribeCrdt?.bind(local),
        }
      : {}),
    close() {
      if (closed) return;
      closed = true;
      connected = false;
      listeners.clear();
      controlListeners.clear();
      local?.close();
    },
  };
}

export const createStudioLiveSignalingServerTransportFactory: StudioLiveTransportFactory =
  (context) => createStudioLiveSignalingServerTransport(context);
