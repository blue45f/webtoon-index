/* eslint-disable react-refresh/only-export-components -- command-center view models are intentionally unit-tested beside the component. */
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  MessageCircle,
  MonitorUp,
  MousePointer2,
  Search,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { studioLiveParticipantColor } from "./studio-live-canvas-overlay-model";

import type {
  StudioLiveAvailability,
  StudioLiveRecoveryState,
} from "./studio-live-collaboration-context";
import type {
  StudioLiveChatMessage,
  StudioLivePeer,
} from "./studio-live-collaboration-room";
import type { StudioLiveTransportMode } from "./studio-live-collaboration-transport";
import type {
  StudioLiveSyncPhase,
  StudioLiveSyncSnapshot,
} from "./studio-live-sync-safety";
import type { StudioScreenShareState } from "../studio-screen-share";

import { cn } from "@/shared/lib/utils";

export type StudioLiveCollaborationSection =
  | "people"
  | "chat"
  | "screen"
  | "sync";

export type StudioLiveRosterRoleFilter = StudioLivePeer["role"] | "all";

export interface StudioLiveCollaborationAttention {
  readonly tone: "bad" | "warn" | "cool" | "good";
  readonly label: string;
  readonly detail: string;
  readonly target: StudioLiveCollaborationSection;
}

export interface StudioLiveCollaborationCommandCenterProps {
  readonly availability: StudioLiveAvailability;
  readonly mode: StudioLiveTransportMode | null;
  readonly peers: readonly StudioLivePeer[];
  readonly chatMessages: readonly StudioLiveChatMessage[];
  readonly screenState: StudioScreenShareState;
  readonly syncSnapshot?: StudioLiveSyncSnapshot;
  readonly recovery?: StudioLiveRecoveryState | null;
  readonly followingSessionId?: string | null;
  readonly onToggleFollow?: (sessionId: string) => void;
}

export interface StudioLiveHandoffSummaryInput
  extends Omit<
    StudioLiveCollaborationCommandCenterProps,
    "chatMessages" | "onToggleFollow"
  > {
  readonly chatMessageCount: number;
  readonly generatedAt?: Date;
}

const ROLE_LABEL: Readonly<Record<StudioLivePeer["role"], string>> = {
  owner: "소유자",
  admin: "관리자",
  editor: "편집자",
  commenter: "검토자",
  viewer: "열람자",
};

const ROLE_ORDER: readonly StudioLivePeer["role"][] = [
  "owner",
  "admin",
  "editor",
  "commenter",
  "viewer",
];

const ROLE_RANK: Readonly<Record<StudioLivePeer["role"], number>> = {
  owner: 0,
  admin: 1,
  editor: 2,
  commenter: 3,
  viewer: 4,
};

const SYNC_PHASE_LABEL: Readonly<Record<StudioLiveSyncPhase, string>> = {
  initializing: "보호 상태 확인 중",
  synced: "서버 승인 완료",
  syncing: "변경 동기화 중",
  "offline-queued": "기기에 안전하게 보관 중",
  retrying: "서버 연결 재시도 중",
  repairing: "원고 복구 중",
  "durability-risk": "저장 보호 확인 필요",
  "read-only-follower": "다른 탭이 저장 담당",
  revoked: "작품 권한 회수됨",
  "recovery-required": "로컬 변경 복구 필요",
};

const SECTION_TARGET_ID: Readonly<Record<StudioLiveCollaborationSection, string>> = {
  people: "studio-live-people-section",
  chat: "studio-live-chat-section",
  screen: "studio-live-screen-section",
  sync: "studio-live-sync-section",
};

const ATTENTION_TONE_CLASS = {
  bad: "border-bad/40 bg-bad/10 text-bad",
  warn: "border-warn/40 bg-warn/10 text-warn",
  cool: "border-cool/35 bg-cool/10 text-cool",
  good: "border-good/35 bg-good/10 text-good",
} as const;

const NAV_BUTTON_CLASS =
  "group min-h-16 rounded-xl border border-line bg-card px-2.5 py-2 text-left transition-colors " +
  "hover:border-line-strong hover:bg-raised focus-visible:outline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-accent";

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ").trim();
}

function participantInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("ko-KR") ?? "?";
}

function modeLabel(
  availability: StudioLiveAvailability,
  mode: StudioLiveTransportMode | null
): string {
  if (availability === "ready") {
    return mode === "server" ? "팀 서버 연결" : "같은 출처 로컬 탭 연결";
  }
  if (availability === "connecting") return "연결 준비 중";
  if (availability === "unsupported") return "브라우저 미지원";
  if (availability === "error") return "연결 오류";
  return "연결 대기";
}

function truncateSummaryNames(peers: readonly StudioLivePeer[]): string {
  const visible = peers.slice(0, 10).map((peer) => `${peer.displayName}(${ROLE_LABEL[peer.role]})`);
  const hiddenCount = peers.length - visible.length;
  return hiddenCount > 0 ? `${visible.join(", ")} 외 ${hiddenCount}개 탭` : visible.join(", ");
}

export function filterStudioLiveCollaborationPeers(
  peers: readonly StudioLivePeer[],
  query: string,
  roleFilter: StudioLiveRosterRoleFilter,
  activeOnly: boolean,
  followingSessionId: string | null = null
): StudioLivePeer[] {
  const normalizedQuery = normalizeSearch(query);
  return [...peers]
    .filter((peer) => {
      if (roleFilter !== "all" && peer.role !== roleFilter) return false;
      if (activeOnly && peer.visibility !== "active") return false;
      if (!normalizedQuery) return true;
      return normalizeSearch(`${peer.displayName} ${ROLE_LABEL[peer.role]}`).includes(
        normalizedQuery
      );
    })
    .sort((left, right) => {
      const leftFollowed = left.sessionId === followingSessionId;
      const rightFollowed = right.sessionId === followingSessionId;
      if (leftFollowed !== rightFollowed) return leftFollowed ? -1 : 1;
      if (left.visibility !== right.visibility) return left.visibility === "active" ? -1 : 1;
      if (ROLE_RANK[left.role] !== ROLE_RANK[right.role]) {
        return ROLE_RANK[left.role] - ROLE_RANK[right.role];
      }
      return (
        left.displayName.localeCompare(right.displayName, "ko-KR") ||
        left.sessionId.localeCompare(right.sessionId)
      );
    });
}

export function projectStudioLiveCollaborationAttention({
  availability,
  mode,
  peers,
  screenState,
  syncSnapshot,
  recovery,
}: Omit<StudioLiveCollaborationCommandCenterProps, "chatMessages" | "onToggleFollow">): StudioLiveCollaborationAttention {
  if (syncSnapshot?.phase === "recovery-required" || (recovery?.updateCount ?? 0) > 0) {
    return {
      tone: "bad",
      label: "복구 파일을 먼저 보존해 주세요",
      detail: `서버 원고와 분리된 로컬 변경 ${(recovery?.updateCount ?? syncSnapshot?.pendingCount ?? 0).toLocaleString("ko-KR")}개가 있습니다.`,
      target: "sync",
    };
  }
  if (syncSnapshot?.phase === "revoked") {
    return {
      tone: "bad",
      label: "작품 접근 권한이 회수되었습니다",
      detail: "원고 변경과 공유 연결을 중단하고 서버 상태를 다시 확인합니다.",
      target: "sync",
    };
  }
  if (availability === "error" || availability === "unsupported") {
    return {
      tone: "bad",
      label: availability === "unsupported" ? "이 브라우저는 실시간 연결을 지원하지 않습니다" : "실시간 연결을 다시 확인해 주세요",
      detail: modeLabel(availability, mode),
      target: "sync",
    };
  }
  if (screenState.pendingRequests.length > 0) {
    return {
      tone: "warn",
      label: `화면 시청 승인 ${screenState.pendingRequests.length.toLocaleString("ko-KR")}건 대기`,
      detail: "요청자를 확인한 뒤 승인하거나 거절해 주세요.",
      target: "screen",
    };
  }
  if (
    syncSnapshot &&
    (syncSnapshot.pendingCount > 0 ||
      syncSnapshot.phase === "durability-risk" ||
      syncSnapshot.phase === "retrying" ||
      syncSnapshot.phase === "repairing" ||
      syncSnapshot.phase === "offline-queued")
  ) {
    return {
      tone: syncSnapshot.phase === "durability-risk" ? "bad" : "warn",
      label: SYNC_PHASE_LABEL[syncSnapshot.phase],
      detail:
        syncSnapshot.pendingCount > 0
          ? `서버 승인을 기다리는 변경 ${syncSnapshot.pendingCount.toLocaleString("ko-KR")}개`
          : syncSnapshot.message,
      target: "sync",
    };
  }
  if (availability !== "ready") {
    return {
      tone: "cool",
      label: modeLabel(availability, mode),
      detail: "연결이 준비되면 참여 탭과 협업 활동을 한곳에서 확인할 수 있습니다.",
      target: "sync",
    };
  }
  if (peers.length === 0) {
    return {
      tone: "cool",
      label: "다른 참여 탭을 기다리고 있습니다",
      detail: "초대 링크를 공유하거나 같은 작품을 다른 탭에서 열어 연결 상태를 확인해 보세요.",
      target: "people",
    };
  }
  return {
    tone: "good",
    label: `${(peers.length + 1).toLocaleString("ko-KR")}개 작업 탭 연결됨`,
    detail: "원고 보호와 실시간 협업 상태가 정상입니다.",
    target: "people",
  };
}

export function buildStudioLiveHandoffSummary({
  availability,
  mode,
  peers,
  chatMessageCount,
  screenState,
  syncSnapshot,
  recovery,
  followingSessionId = null,
  generatedAt = new Date(),
}: StudioLiveHandoffSummaryInput): string {
  const orderedPeers = filterStudioLiveCollaborationPeers(
    peers,
    "",
    "all",
    false,
    followingSessionId
  );
  const activeCount = peers.filter((peer) => peer.visibility === "active").length;
  const roleSummary = ROLE_ORDER.map((role) => {
    const count = peers.filter((peer) => peer.role === role).length;
    return count > 0 ? `${ROLE_LABEL[role]} ${count}` : null;
  })
    .filter((value): value is string => value !== null)
    .join(" · ");
  const followedPeer = peers.find((peer) => peer.sessionId === followingSessionId) ?? null;
  const syncLabel = syncSnapshot ? SYNC_PHASE_LABEL[syncSnapshot.phase] : "보호 상태 정보 없음";
  const screenActivity =
    Number(screenState.localSharing) +
    screenState.shares.length +
    screenState.viewers.length +
    Number(screenState.watching !== null);
  const generatedLabel = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(generatedAt);

  const lines = [
    "ToonSpectrum Studio 협업 인계 요약",
    `생성: ${generatedLabel}`,
    `연결: ${modeLabel(availability, mode)}`,
    `참여: 나 포함 ${(peers.length + 1).toLocaleString("ko-KR")}개 작업 탭 · 활성 ${activeCount.toLocaleString("ko-KR")}개${roleSummary ? ` · ${roleSummary}` : ""}`,
    `원고 보호: ${syncLabel}${syncSnapshot?.pendingCount ? ` · 승인 대기 ${syncSnapshot.pendingCount.toLocaleString("ko-KR")}개` : ""}`,
    `화면 공유: 활동 ${screenActivity.toLocaleString("ko-KR")}건 · 승인 대기 ${screenState.pendingRequests.length.toLocaleString("ko-KR")}건`,
    `세션 채팅: ${Math.max(0, chatMessageCount).toLocaleString("ko-KR")}개 · 기록에 저장되지 않음`,
  ];

  if (orderedPeers.length > 0) lines.push(`연결 탭: ${truncateSummaryNames(orderedPeers)}`);
  if (followedPeer) lines.push(`집중 따라가기: ${followedPeer.displayName}`);
  if ((recovery?.updateCount ?? 0) > 0) {
    const recoveryCount = recovery?.updateCount ?? 0;
    lines.push(`주의: 분리된 로컬 변경 ${recoveryCount.toLocaleString("ko-KR")}개 복구 필요`);
  }
  return lines.join("\n");
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") throw new Error("clipboard unavailable");
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("clipboard unavailable");
}

function jumpToSection(section: StudioLiveCollaborationSection): void {
  if (typeof document === "undefined") return;
  const target = document.getElementById(SECTION_TARGET_ID[section]);
  if (!target) return;
  const reducedMotion =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "start",
  });
  target.focus({ preventScroll: true });
  if (section !== "chat") return;
  globalThis.requestAnimationFrame?.(() => {
    document.getElementById("studio-live-chat-input")?.focus({ preventScroll: true });
  });
}

function CommandMetric({
  icon,
  label,
  value,
  detail,
  section,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly section: StudioLiveCollaborationSection;
}) {
  return (
    <button
      type="button"
      className={NAV_BUTTON_CLASS}
      data-studio-collaboration-jump={section}
      onClick={() => jumpToSection(section)}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[0.68rem] font-bold text-fg-2">
          <span className="text-accent" aria-hidden>
            {icon}
          </span>
          {label}
        </span>
        <strong className="text-sm font-black tabular-nums text-fg">{value}</strong>
      </span>
      <span className="mt-1 block truncate text-[0.62rem] text-fg-3">{detail}</span>
    </button>
  );
}

export function StudioLiveCollaborationCommandCenter({
  availability,
  mode,
  peers,
  chatMessages,
  screenState,
  syncSnapshot,
  recovery,
  followingSessionId = null,
  onToggleFollow,
}: StudioLiveCollaborationCommandCenterProps) {
  const rosterId = useId();
  const rosterSearchId = useId();
  const rosterSearchRef = useRef<HTMLInputElement>(null);
  const copyNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<StudioLiveRosterRoleFilter>("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (copyNoticeTimerRef.current !== null) clearTimeout(copyNoticeTimerRef.current);
    },
    []
  );

  const attention = projectStudioLiveCollaborationAttention({
    availability,
    mode,
    peers,
    screenState,
    syncSnapshot,
    recovery,
    followingSessionId,
  });
  const filteredPeers = useMemo(
    () =>
      filterStudioLiveCollaborationPeers(
        peers,
        query,
        roleFilter,
        activeOnly,
        followingSessionId
      ),
    [activeOnly, followingSessionId, peers, query, roleFilter]
  );
  const followedPeer = peers.find((peer) => peer.sessionId === followingSessionId) ?? null;
  const activePeer =
    followedPeer ??
    filterStudioLiveCollaborationPeers(peers, "", "all", true, null)[0] ??
    null;
  const screenActivityCount =
    Number(screenState.localSharing) +
    screenState.shares.length +
    screenState.viewers.length +
    Number(screenState.watching !== null);
  const syncValue = syncSnapshot
    ? syncSnapshot.pendingCount > 0
      ? syncSnapshot.pendingCount.toLocaleString("ko-KR")
      : syncSnapshot.phase === "synced"
        ? "안전"
        : "확인"
    : "대기";
  const syncDetail = syncSnapshot ? SYNC_PHASE_LABEL[syncSnapshot.phase] : "보호 상태 준비 중";

  const toggleRoster = () => {
    setRosterOpen((current) => {
      const next = !current;
      if (next) {
        globalThis.requestAnimationFrame?.(() => rosterSearchRef.current?.focus());
      }
      return next;
    });
  };

  const handleCopySummary = async () => {
    setCopying(true);
    try {
      await copyText(
        buildStudioLiveHandoffSummary({
          availability,
          mode,
          peers,
          chatMessageCount: chatMessages.length,
          screenState,
          syncSnapshot,
          recovery,
          followingSessionId,
        })
      );
      setCopyNotice("현재 협업 상태를 인계 요약으로 복사했습니다.");
    } catch {
      setCopyNotice("인계 요약을 복사하지 못했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    } finally {
      setCopying(false);
      if (copyNoticeTimerRef.current !== null) clearTimeout(copyNoticeTimerRef.current);
      copyNoticeTimerRef.current = setTimeout(() => setCopyNotice(null), 3_000);
    }
  };

  return (
    <section
      aria-labelledby="studio-live-command-center-title"
      className="mt-3 rounded-2xl border border-accent/25 bg-card/65 p-3 shadow-sm"
      data-studio-live-command-center="v20"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <ShieldCheck size={15} aria-hidden />
            </span>
            <div>
              <h4 className="text-xs font-black text-fg" id="studio-live-command-center-title">
                협업 관제
              </h4>
              <p className="mt-0.5 text-[0.64rem] text-fg-3">상태·참여·대화·공유를 한 번에 이동</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-card px-2.5 text-[0.66rem] font-bold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60"
          disabled={copying}
          onClick={handleCopySummary}
        >
          {copying ? <span className="size-3 animate-pulse rounded-full bg-accent" aria-hidden /> : <Copy size={13} aria-hidden />}
          인계 요약 복사
        </button>
      </div>

      <button
        type="button"
        className={cn(
          "mt-3 flex min-h-12 w-full items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
          ATTENTION_TONE_CLASS[attention.tone]
        )}
        onClick={() => jumpToSection(attention.target)}
      >
        {attention.tone === "bad" || attention.tone === "warn" ? (
          <AlertCircle className="mt-0.5 shrink-0" size={15} aria-hidden />
        ) : attention.tone === "good" ? (
          <Check className="mt-0.5 shrink-0" size={15} aria-hidden />
        ) : (
          <ShieldCheck className="mt-0.5 shrink-0" size={15} aria-hidden />
        )}
        <span className="min-w-0">
          <strong className="block text-[0.7rem] font-black">{attention.label}</strong>
          <span className="mt-0.5 block text-[0.64rem] leading-relaxed opacity-85">
            {attention.detail}
          </span>
        </span>
      </button>

      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <CommandMetric
          icon={<UsersRound size={14} />}
          label="참여 탭"
          value={(peers.length + 1).toLocaleString("ko-KR")}
          detail={`${peers.filter((peer) => peer.visibility === "active").length.toLocaleString("ko-KR")}개 활성`}
          section="people"
        />
        <CommandMetric
          icon={<MessageCircle size={14} />}
          label="세션 채팅"
          value={chatMessages.length.toLocaleString("ko-KR")}
          detail="휘발성 대화"
          section="chat"
        />
        <CommandMetric
          icon={<MonitorUp size={14} />}
          label="화면 공유"
          value={
            screenState.pendingRequests.length > 0
              ? `${screenState.pendingRequests.length} 승인`
              : screenActivityCount.toLocaleString("ko-KR")
          }
          detail={screenState.localSharing ? "내 화면 공유 중" : "요청 기반 연결"}
          section="screen"
        />
        <CommandMetric
          icon={<ShieldCheck size={14} />}
          label="원고 보호"
          value={syncValue}
          detail={syncDetail}
          section="sync"
        />
      </div>

      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <button
          type="button"
          aria-controls={rosterId}
          aria-expanded={rosterOpen}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-card px-3 text-[0.68rem] font-bold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={toggleRoster}
        >
          <Search size={14} aria-hidden /> 전체 참여 탭 찾기
          {rosterOpen ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
        </button>
        <button
          type="button"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-card px-3 text-[0.68rem] font-bold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!activePeer || !onToggleFollow}
          onClick={() => activePeer && onToggleFollow?.(activePeer.sessionId)}
        >
          {followedPeer ? <Check size={14} aria-hidden /> : <MousePointer2 size={14} aria-hidden />}
          {followedPeer
            ? `집중 모드 종료 · ${followedPeer.displayName}`
            : activePeer
              ? `집중 모드 시작 · ${activePeer.displayName}`
              : "집중할 활성 탭 없음"}
        </button>
      </div>

      {rosterOpen ? (
        <div
          className="mt-2 rounded-xl border border-line bg-panel/80 p-2.5"
          data-studio-live-full-roster="true"
          id={rosterId}
        >
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <label className="relative block" htmlFor={rosterSearchId}>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"
                size={14}
                aria-hidden
              />
              <input
                ref={rosterSearchRef}
                id={rosterSearchId}
                type="search"
                autoComplete="off"
                className="min-h-11 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-xs text-fg outline-none placeholder:text-fg-3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/45"
                placeholder="이름 또는 역할 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label="역할로 참여 탭 필터"
              className="min-h-11 rounded-xl border border-line bg-card px-2 text-xs font-semibold text-fg-2 outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/45"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as StudioLiveRosterRoleFilter)}
            >
              <option value="all">모든 역할</option>
              {ROLE_ORDER.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-pressed={activeOnly}
              className={cn(
                "min-h-11 rounded-xl border px-3 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                activeOnly
                  ? "border-accent/50 bg-accent-soft text-accent"
                  : "border-line bg-card text-fg-2 hover:bg-raised"
              )}
              onClick={() => setActiveOnly((current) => !current)}
            >
              활성만
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 text-[0.64rem] text-fg-3">
            <span>검색 결과 {filteredPeers.length.toLocaleString("ko-KR")}개 탭</span>
            {followingSessionId ? <span className="font-semibold text-accent">집중 따라가기 중</span> : null}
          </div>

          {filteredPeers.length > 0 ? (
            <ul aria-label="전체 참여 작업 탭" className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
              {filteredPeers.map((peer) => {
                const following = peer.sessionId === followingSessionId;
                return (
                  <li
                    className="flex min-h-12 items-center gap-2 rounded-xl border border-transparent bg-card/70 px-2.5 py-1.5 hover:border-line"
                    key={peer.sessionId}
                  >
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-full text-[0.65rem] font-black text-[oklch(0.96_0.01_85)]"
                      style={{ backgroundColor: studioLiveParticipantColor(peer.sessionId) }}
                    >
                      {participantInitial(peer.displayName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[0.7rem] text-fg">{peer.displayName}</strong>
                      <span className="mt-0.5 block truncate text-[0.62rem] text-fg-3">
                        {ROLE_LABEL[peer.role]} · {peer.visibility === "active" ? "활성 탭" : "유휴 탭"}
                        {peer.pageId ? " · 캔버스 위치 공유 중" : ""}
                      </span>
                    </span>
                    {onToggleFollow ? (
                      <button
                        type="button"
                        aria-label={
                          following
                            ? `${peer.displayName} 따라가기 중지`
                            : `${peer.displayName} 작업 페이지 따라가기`
                        }
                        aria-pressed={following}
                        className={cn(
                          "inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg border px-2 text-[0.62rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                          following
                            ? "border-accent/50 bg-accent text-on-accent"
                            : "border-line bg-panel text-fg-2 hover:bg-raised hover:text-fg"
                        )}
                        onClick={() => onToggleFollow(peer.sessionId)}
                      >
                        {following ? <Check size={12} aria-hidden /> : <MousePointer2 size={12} aria-hidden />}
                        {following ? "중지" : "따라가기"}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs leading-relaxed text-fg-3">
              현재 필터와 일치하는 참여 탭이 없습니다.
            </p>
          )}
        </div>
      ) : null}

      {copyNotice ? (
        <p
          aria-live="polite"
          className={cn(
            "mt-2 text-[0.65rem] font-semibold",
            copyNotice.startsWith("현재") ? "text-good" : "text-bad"
          )}
          role="status"
        >
          {copyNotice}
        </p>
      ) : null}
    </section>
  );
}
