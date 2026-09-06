import {
  LocateFixed,
  MessageCircle,
  SendHorizontal,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { STUDIO_LIVE_CURSOR_CHAT_MAX_LENGTH } from "./studio-live-chat-control";

import type {
  StudioLiveAttentionRequest,
  StudioLivePeer,
  StudioLiveRoom,
} from "./studio-live-collaboration-room";

export interface StudioLiveQuickCollaborationControlsProps {
  room: StudioLiveRoom;
  peers: readonly StudioLivePeer[];
  followingSessionId: string | null;
  onToggleFollow: (sessionId: string) => void;
}

function canDirectAttention(room: StudioLiveRoom): boolean {
  return (
    room.participant.role === "owner" ||
    room.participant.role === "admin" ||
    room.participant.role === "editor"
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.closest('[role="textbox"]') !== null)
  );
}

export function StudioLiveQuickCollaborationControls({
  room,
  peers,
  followingSessionId,
  onToggleFollow,
}: StudioLiveQuickCollaborationControlsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const attentionTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [attention, setAttention] = useState<StudioLiveAttentionRequest | null>(null);
  const canChat = room.participant.role !== "viewer";
  const canSpotlight = canDirectAttention(room) && peers.length > 0;
  const roomReady = room.ready;

  const announce = (message: string) => {
    setNotice(message);
    if (noticeTimerRef.current !== null) {
      globalThis.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = globalThis.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 3_000);
  };

  const openComposer = useCallback(() => {
    setComposerOpen(true);
    globalThis.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
  }, []);

  useEffect(() => {
    const unsubscribe = room.subscribe((event) => {
      if (
        event.type !== "attention" ||
        event.request.participant.sessionId === room.participant.sessionId
      ) return;
      if (attentionTimerRef.current !== null) {
        globalThis.clearTimeout(attentionTimerRef.current);
      }
      setAttention(event.request);
      attentionTimerRef.current = globalThis.setTimeout(() => {
        setAttention((current) =>
          current?.requestId === event.request.requestId ? null : current
        );
        attentionTimerRef.current = null;
      }, Math.max(0, event.request.expiresAt - Date.now()));
    });
    return () => {
      unsubscribe();
      if (attentionTimerRef.current !== null) {
        globalThis.clearTimeout(attentionTimerRef.current);
        attentionTimerRef.current = null;
      }
    };
  }, [room]);

  useEffect(() => {
    if (
      attention &&
      !peers.some((peer) => peer.sessionId === attention.participant.sessionId)
    ) {
      setAttention(null);
    }
  }, [attention, peers]);

  useEffect(() => {
    if (!canChat || !roomReady || typeof document === "undefined") return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) return;
      event.preventDefault();
      openComposer();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canChat, openComposer, roomReady]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) {
      globalThis.clearTimeout(noticeTimerRef.current);
    }
  }, []);

  const submitCursorChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (!room.sendCursorChat(text)) {
      announce("커서 메시지를 보내지 못했습니다.");
      return;
    }
    setDraft("");
    setComposerOpen(false);
    announce("커서 메시지를 보냈습니다.");
  };

  const acceptAttention = () => {
    if (!attention) return;
    if (followingSessionId !== attention.participant.sessionId) {
      onToggleFollow(attention.participant.sessionId);
    }
    announce(`${attention.participant.displayName} 작업 위치를 따라갑니다.`);
    setAttention(null);
  };

  return (
    <>
      <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {notice}
      </span>

      {attention ? (
        <div
          className="order-last flex min-h-11 basis-full items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-2 sm:basis-auto"
          data-studio-live-attention-request={attention.requestId}
        >
          <LocateFixed className="shrink-0 text-accent" size={14} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[0.68rem] font-semibold text-fg">
            {attention.participant.displayName} 위치 초대
          </span>
          <button
            className="min-h-9 shrink-0 rounded-md bg-accent px-2 text-[0.65rem] font-bold text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            type="button"
            onClick={acceptAttention}
          >
            따라가기
          </button>
          <button
            aria-label="작업 위치 초대 닫기"
            className="grid size-9 shrink-0 place-items-center rounded-md text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            type="button"
            onClick={() => setAttention(null)}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}

      {composerOpen ? (
        <form
          className="order-last flex min-h-11 min-w-0 basis-full items-center gap-1.5 rounded-lg border border-accent/40 bg-card p-1 sm:basis-auto"
          data-studio-live-cursor-chat-composer="true"
          onSubmit={submitCursorChat}
        >
          <label className="sr-only" htmlFor="studio-live-cursor-chat-input">
            커서 메시지
          </label>
          <input
            ref={inputRef}
            autoComplete="off"
            className="min-h-9 min-w-0 flex-1 rounded-md bg-transparent px-2 text-xs text-fg placeholder:text-fg-3 focus-visible:outline-none sm:w-44"
            id="studio-live-cursor-chat-input"
            maxLength={STUDIO_LIVE_CURSOR_CHAT_MAX_LENGTH}
            placeholder="커서 옆에 잠깐 표시"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setComposerOpen(false);
              setDraft("");
            }}
          />
          <button
            aria-label="커서 메시지 보내기"
            className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-on-accent disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            disabled={!draft.trim()}
            type="submit"
          >
            <SendHorizontal size={14} aria-hidden />
          </button>
          <button
            aria-label="커서 메시지 취소"
            className="grid size-9 shrink-0 place-items-center rounded-md text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            type="button"
            onClick={() => {
              setComposerOpen(false);
              setDraft("");
            }}
          >
            <X size={14} aria-hidden />
          </button>
        </form>
      ) : canChat ? (
        <button
          aria-keyshortcuts="/"
          aria-label="커서 메시지 입력, 단축키 슬래시"
          className="grid size-11 shrink-0 place-items-center rounded-lg border border-line/60 bg-card/80 text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
          data-studio-live-cursor-chat-action="true"
          disabled={!roomReady}
          title="커서 메시지 · /"
          type="button"
          onClick={openComposer}
        >
          <MessageCircle size={16} aria-hidden />
        </button>
      ) : null}

      {canSpotlight ? (
        <button
          aria-label="모든 팀원에게 현재 작업 위치 초대 보내기"
          className="grid size-11 shrink-0 place-items-center rounded-lg border border-accent/40 bg-accent-soft text-accent transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          data-studio-live-attention-action="true"
          title="모두 내 위치로 초대"
          type="button"
          onClick={() => {
            announce(
              room.requestAttention()
                ? "팀원에게 현재 작업 위치 초대를 보냈습니다."
                : "현재 페이지 초대를 보내지 못했습니다."
            );
          }}
        >
          <LocateFixed size={16} aria-hidden />
        </button>
      ) : null}
    </>
  );
}
