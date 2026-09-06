import {
  Check,
  Crosshair,
  EyeOff,
  MousePointer2,
  Sparkles,
  UsersRound,
  Waves,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { studioLivePresenceAlwaysVisible } from "../studio-commercial-residuals";

import { studioLiveParticipantColor } from "./studio-live-canvas-overlay-model";
import { useStudioLiveCollaboration } from "./studio-live-collaboration-context";
import {
  setStudioLiveCursorFocus,
  setStudioLiveCursorTrails,
  setStudioLiveCursorVisibility,
  useStudioLiveViewportPreferences,
  type StudioLiveCursorVisibilityMode,
} from "./studio-live-viewport-preferences";

import type { StudioLivePeer } from "./studio-live-collaboration-room";

import { cn } from "@/shared/lib/utils";

export interface StudioLiveCollaborationQuickControlsProps {
  readonly followingSessionId: string | null;
  readonly onOpenTeam: () => void;
  readonly onToggleFollow: (sessionId: string) => void;
}

const CURSOR_MODE_COPY: Record<
  StudioLiveCursorVisibilityMode,
  { readonly label: string; readonly description: string }
> = {
  all: {
    label: "모든 커서",
    description: "활동 중인 팀원의 커서를 함께 봅니다.",
  },
  followed: {
    label: "따라가기만",
    description: "집중해서 따라가는 한 사람의 커서만 봅니다.",
  },
  hidden: {
    label: "커서 숨김",
    description: "원고와 댓글 핀만 남기고 원격 커서를 숨깁니다.",
  },
};

function participantInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("ko-KR") ?? "?";
}

function roleLabel(role: StudioLivePeer["role"]): string {
  if (role === "owner") return "소유자";
  if (role === "admin") return "관리자";
  if (role === "editor") return "편집자";
  if (role === "commenter") return "검토자";
  return "열람자";
}

function CursorModeIcon({ mode }: { readonly mode: StudioLiveCursorVisibilityMode }) {
  if (mode === "hidden") return <EyeOff size={16} strokeWidth={1.8} aria-hidden />;
  if (mode === "followed") return <Crosshair size={16} strokeWidth={1.8} aria-hidden />;
  return <MousePointer2 size={16} strokeWidth={1.8} aria-hidden />;
}

export function StudioLiveCollaborationQuickControls({
  followingSessionId,
  onOpenTeam,
  onToggleFollow,
}: StudioLiveCollaborationQuickControlsProps) {
  const live = useStudioLiveCollaboration();
  const preferences = useStudioLiveViewportPreferences();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const alwaysOn = studioLivePresenceAlwaysVisible(
    live.availability,
    live.peers.length,
  );
  const followedPeer = live.peers.find(
    (peer) => peer.sessionId === followingSessionId,
  ) ?? null;
  const peerOptions = useMemo(
    () => [...live.peers]
      .sort((left, right) => {
        if (left.visibility !== right.visibility) {
          return left.visibility === "active" ? -1 : 1;
        }
        return left.displayName.localeCompare(right.displayName, "ko-KR")
          || left.sessionId.localeCompare(right.sessionId);
      })
      .slice(0, 8),
    [live.peers],
  );

  useEffect(() => {
    setStudioLiveCursorFocus(followingSessionId);
  }, [followingSessionId]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  if (!alwaysOn) return null;

  const currentModeCopy = CURSOR_MODE_COPY[preferences.cursorVisibility];
  const triggerLabel = preferences.cursorVisibility === "followed" && followedPeer
    ? `${followedPeer.displayName} 집중 따라가기 및 커서 설정`
    : `${currentModeCopy.label} 및 실시간 협업 보기 설정`;

  const selectMode = (mode: StudioLiveCursorVisibilityMode) => {
    setStudioLiveCursorVisibility(mode);
  };

  const togglePeerFollow = (peer: StudioLivePeer) => {
    const stopping = peer.sessionId === followingSessionId;
    if (stopping) {
      setStudioLiveCursorFocus(null);
      setStudioLiveCursorVisibility("all");
    } else {
      setStudioLiveCursorFocus(peer.sessionId);
      setStudioLiveCursorVisibility("followed");
    }
    onToggleFollow(peer.sessionId);
    setOpen(false);
  };

  return (
    <div className="pointer-events-auto relative shrink-0" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        data-studio-live-quick-controls="true"
        data-studio-live-cursor-visibility={preferences.cursorVisibility}
        title={triggerLabel}
        className={cn(
          "relative grid size-11 place-items-center rounded-lg border shadow-xl backdrop-blur-md transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none",
          open || preferences.cursorVisibility === "followed"
            ? "border-accent/50 bg-accent-soft text-accent"
            : preferences.cursorVisibility === "hidden"
              ? "border-line/80 bg-panel/95 text-fg-3"
              : "border-line/80 bg-panel/95 text-fg-2 hover:bg-raised hover:text-fg",
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <CursorModeIcon mode={preferences.cursorVisibility} />
        {live.availability === "ready" ? (
          <span
            aria-hidden
            className="absolute bottom-1 right-1 size-2 rounded-full border-2 border-panel bg-good"
          />
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="실시간 협업 보기 설정"
          data-studio-live-quick-controls-panel="true"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-[80] w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-line bg-panel/98 text-left shadow-2xl backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-3.5 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="shrink-0 text-accent" aria-hidden />
                <h3 className="text-xs font-bold text-fg">집중 협업 보기</h3>
              </div>
              <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
                원고 동기화는 유지하고 내 화면의 커서 밀도만 조절합니다.
              </p>
            </div>
            <button
              type="button"
              aria-label="실시간 협업 보기 설정 닫기"
              className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus({ preventScroll: true });
              }}
            >
              <X size={15} aria-hidden />
            </button>
          </div>

          <div className="space-y-3 p-3.5">
            <fieldset>
              <legend className="text-[0.68rem] font-bold text-fg-2">커서 표시 범위</legend>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {(Object.keys(CURSOR_MODE_COPY) as StudioLiveCursorVisibilityMode[]).map(
                  (mode) => {
                    const selected = preferences.cursorVisibility === mode;
                    const disabled = mode === "followed" && !followingSessionId;
                    return (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={selected}
                        disabled={disabled}
                        title={
                          disabled
                            ? "아래 팀원 중 한 명을 선택하면 집중 커서 모드를 사용할 수 있습니다."
                            : CURSOR_MODE_COPY[mode].description
                        }
                        className={cn(
                          "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1.5 text-[0.65rem] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
                          selected
                            ? "border-accent/55 bg-accent-soft text-accent"
                            : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                        )}
                        onClick={() => selectMode(mode)}
                      >
                        <CursorModeIcon mode={mode} />
                        {CURSOR_MODE_COPY[mode].label}
                      </button>
                    );
                  },
                )}
              </div>
            </fieldset>

            <button
              type="button"
              aria-pressed={preferences.showTrails}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                preferences.showTrails
                  ? "border-accent/40 bg-accent-soft/55 text-fg"
                  : "border-line bg-card text-fg-2 hover:bg-raised",
              )}
              onClick={() => setStudioLiveCursorTrails(!preferences.showTrails)}
            >
              <Waves
                size={16}
                className={preferences.showTrails ? "text-accent" : "text-fg-3"}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.7rem] font-bold">실시간 획 트레일</span>
                <span className="mt-0.5 block text-[0.63rem] leading-relaxed text-fg-3">
                  끄면 포인터만 표시해 저사양 기기와 대규모 세션의 렌더 비용을 줄입니다.
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border",
                  preferences.showTrails
                    ? "border-accent bg-accent text-on-accent"
                    : "border-line bg-raised text-transparent",
                )}
              >
                <Check size={12} />
              </span>
            </button>

            <section aria-labelledby={`${panelId}-participants`}>
              <div className="flex items-center justify-between gap-2">
                <h4
                  id={`${panelId}-participants`}
                  className="text-[0.68rem] font-bold text-fg-2"
                >
                  빠른 집중 따라가기
                </h4>
                <span className="text-[0.62rem] text-fg-3">
                  {live.peers.length.toLocaleString("ko-KR")}명 접속
                </span>
              </div>
              {peerOptions.length > 0 ? (
                <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-0.5">
                  {peerOptions.map((peer) => {
                    const following = peer.sessionId === followingSessionId;
                    return (
                      <button
                        key={peer.sessionId}
                        type="button"
                        aria-pressed={following}
                        className={cn(
                          "flex min-h-11 w-full items-center gap-2 rounded-xl border px-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                          following
                            ? "border-accent/50 bg-accent-soft text-fg"
                            : "border-transparent bg-card/70 text-fg-2 hover:border-line hover:bg-raised hover:text-fg",
                        )}
                        onClick={() => togglePeerFollow(peer)}
                      >
                        <span
                          aria-hidden
                          className="grid size-7 shrink-0 place-items-center rounded-full text-[0.62rem] font-black text-[oklch(0.96_0.01_85)]"
                          style={{ backgroundColor: studioLiveParticipantColor(peer.sessionId) }}
                        >
                          {participantInitial(peer.displayName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.7rem] font-semibold">
                            {peer.displayName}
                          </span>
                          <span className="mt-0.5 block truncate text-[0.61rem] text-fg-3">
                            {roleLabel(peer.role)} · {peer.visibility === "active" ? "작업 중" : "자리 비움"}
                          </span>
                        </span>
                        {following ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-1.5 py-1 text-[0.6rem] font-bold text-on-accent">
                            <Check size={10} aria-hidden /> 집중 중
                          </span>
                        ) : (
                          <Crosshair size={14} className="shrink-0 text-fg-3" aria-hidden />
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 rounded-xl border border-dashed border-line px-3 py-3 text-[0.67rem] leading-relaxed text-fg-3">
                  다른 팀원이 접속하면 여기서 바로 따라갈 수 있습니다.
                </p>
              )}
            </section>
          </div>

          <div className="border-t border-line bg-card/45 p-2.5">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-card px-3 text-[0.68rem] font-bold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => {
                setOpen(false);
                onOpenTeam();
              }}
            >
              <UsersRound size={15} aria-hidden /> 팀·화면 공유·채팅 열기
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
