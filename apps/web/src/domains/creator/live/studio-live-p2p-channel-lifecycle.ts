import type { StudioLiveP2pRtcDataChannel } from "./studio-live-p2p-overlay-transport";

export interface StudioLiveP2pChannelLink {
  closed: boolean;
  channel: StudioLiveP2pRtcDataChannel | null;
}

export interface StudioLiveP2pChannelLifecycleOptions {
  link: StudioLiveP2pChannelLink;
  channel: StudioLiveP2pRtcDataChannel;
  /** The link must still belong to the current transport generation. */
  isActive: () => boolean;
  resetNegotiation: () => void;
  onOpen: () => void;
  onMessage: (value: unknown) => void;
  onClosed: () => void;
}

function detachChannel(channel: StudioLiveP2pRtcDataChannel): void {
  channel.onopen = null;
  channel.onmessage = null;
  channel.onclose = null;
}

function closeChannel(channel: StudioLiveP2pRtcDataChannel): void {
  detachChannel(channel);
  try {
    channel.close();
  } catch {
    // A replaced or already-disposed native channel can throw while closing.
  }
}

/**
 * Bind exactly one channel generation to a peer link. Native close/message callbacks may
 * already be queued when a channel is replaced, so detaching handlers alone is insufficient:
 * every callback also checks both channel identity and the current owner of the peer link.
 */
export function bindStudioLiveP2pChannelLifecycle({
  link,
  channel,
  isActive,
  resetNegotiation,
  onOpen,
  onMessage,
  onClosed,
}: StudioLiveP2pChannelLifecycleOptions): void {
  if (link.closed || !isActive()) {
    closeChannel(channel);
    return;
  }
  if (link.channel === channel) return;

  const previous = link.channel;
  // Disassociate first: closing the old channel can synchronously invoke a captured callback.
  link.channel = channel;
  if (previous) closeChannel(previous);
  resetNegotiation();
  channel.binaryType = "arraybuffer";

  const isCurrent = () => !link.closed && isActive() && link.channel === channel;
  let opened = false;
  const handleOpen = () => {
    if (!isCurrent() || opened || channel.readyState !== "open") return;
    opened = true;
    onOpen();
  };
  const handleClose = () => {
    if (!isCurrent()) return;
    link.channel = null;
    detachChannel(channel);
    resetNegotiation();
    // Clearing channel alone leaves ensurePeer() stuck on the old, still-open RTC connection.
    // The owner must dispose that peer link so the next presence/signaling event can recreate it.
    onClosed();
  };
  channel.onopen = handleOpen;
  channel.onmessage = (event) => {
    if (!isCurrent() || channel.readyState !== "open") return;
    onMessage(event.data);
  };
  channel.onclose = handleClose;

  if (channel.readyState === "open") handleOpen();
  else if (channel.readyState === "closed" || channel.readyState === "closing") handleClose();
}
