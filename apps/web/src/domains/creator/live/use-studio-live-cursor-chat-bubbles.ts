import { useEffect, useState } from "react";

import type {
  StudioLiveCursorChatMessage,
  StudioLiveRoom,
} from "./studio-live-collaboration-room";

export function useStudioLiveCursorChatBubbles(
  room: StudioLiveRoom | null
): readonly StudioLiveCursorChatMessage[] {
  const [messages, setMessages] = useState<StudioLiveCursorChatMessage[]>([]);

  useEffect(() => {
    setMessages([]);
    if (!room) return;
    const timers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
    const messageIdBySession = new Map<string, string>();
    const sessionByMessageId = new Map<string, string>();

    const forgetMessage = (messageId: string) => {
      const timer = timers.get(messageId);
      if (timer !== undefined) globalThis.clearTimeout(timer);
      timers.delete(messageId);
      const sessionId = sessionByMessageId.get(messageId);
      sessionByMessageId.delete(messageId);
      if (sessionId && messageIdBySession.get(sessionId) === messageId) {
        messageIdBySession.delete(sessionId);
      }
    };

    const removeMessage = (messageId: string) => {
      forgetMessage(messageId);
      setMessages((current) => current.filter((message) => message.id !== messageId));
    };

    const unsubscribe = room.subscribe((event) => {
      if (event.type === "cursor-chat") {
        const message = event.message;
        const sessionId = message.participant.sessionId;
        const replacedMessageId = messageIdBySession.get(sessionId);
        if (replacedMessageId) forgetMessage(replacedMessageId);
        // A duplicate transport delivery with the same id restarts one timer instead of retaining
        // parallel callbacks. Room sequence validation normally removes it before this layer.
        forgetMessage(message.id);
        messageIdBySession.set(sessionId, message.id);
        sessionByMessageId.set(message.id, sessionId);
        setMessages((current) => [
          ...current.filter(
            (candidate) =>
              candidate.id !== message.id &&
              candidate.participant.sessionId !== sessionId
          ),
          message,
        ]);
        timers.set(
          message.id,
          globalThis.setTimeout(
            () => removeMessage(message.id),
            Math.max(0, message.expiresAt - Date.now())
          )
        );
        return;
      }
      if (event.type === "presence") {
        const activeSessions = new Set(event.peers.map((peer) => peer.sessionId));
        setMessages((current) => {
          const next = current.filter((message) => activeSessions.has(message.participant.sessionId));
          for (const message of current) {
            if (!activeSessions.has(message.participant.sessionId)) {
              forgetMessage(message.id);
            }
          }
          return next.length === current.length ? current : next;
        });
        return;
      }
      if (
        event.type === "transport-status" &&
        event.status.state !== "ready" &&
        !(event.status.state === "error" && room.ready)
      ) {
        for (const timer of timers.values()) globalThis.clearTimeout(timer);
        timers.clear();
        messageIdBySession.clear();
        sessionByMessageId.clear();
        setMessages([]);
      }
    });

    return () => {
      unsubscribe();
      for (const timer of timers.values()) globalThis.clearTimeout(timer);
      timers.clear();
      messageIdBySession.clear();
      sessionByMessageId.clear();
    };
  }, [room]);

  return messages;
}
