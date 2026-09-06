/**
 * Dependency-free capability probe for the same-origin tab transport.
 *
 * It lives apart from `studio-live-collaboration-transport` on purpose: the provider must be able
 * to answer "can this browser do local collaboration at all?" during its gating effect, and that
 * question must not drag the wire protocol, the ink codec or the Socket.IO transport into the
 * eager Studio chunk. Everything that actually moves bytes loads with the room.
 */
export function isStudioLocalLiveTransportSupported(): boolean {
  return typeof BroadcastChannel === "function";
}
