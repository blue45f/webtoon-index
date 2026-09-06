import {
  AlertCircle,
  Check,
  ChevronDown,
  History,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Share2,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { StudioLiveCollaborationPanel } from "./live/StudioLiveCollaborationPanel";
import {
  STUDIO_TEAM_ASSIGNABLE_ROLES,
  getStudioTeam,
  getStudioTeamActivity,
  getStudioTeamInvitations,
  inviteStudioTeamMember,
  isSameStudioTeamRequestScope,
  isStudioTeamRequestScopeCurrent,
  nextStudioTeamInboxFocusTarget,
  removeStudioTeamMember,
  removeAcknowledgedStudioTeamInvitation,
  respondToStudioTeamInvitation,
  shouldReloadStudioTeamInvitation,
  shouldRequestStudioTeamActivity,
  updateStudioTeamMemberRole,
  type StudioTeamAssignableRole,
  type StudioTeamActivityAction,
  type StudioTeamActivityItem,
  type StudioTeamActivityState,
  type StudioTeamInvitationSummary,
  type StudioTeamInboxFocusTarget,
  type StudioTeamMember,
  type StudioTeamRole,
  type StudioTeamRequestScope,
  type StudioTeamSnapshot,
  type StudioTeamStatus,
} from "./studio-team-client";
import { StudioSharedWorksPanel } from "./StudioSharedWorksPanel";

import type { StudioDraftCollaborationReadiness } from "./studio-draft-collaboration";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

export interface StudioTeamPanelProps {
  open: boolean;
  onClose: () => void;
  workId: string | null;
  loggedIn: boolean;
  authScopeKey: string | null;
  draftCollaboration?: StudioDraftCollaborationReadiness | null;
  onDraftShareRequest?: () => void;
  followingSessionId?: string | null;
  onToggleFollow?: (sessionId: string) => void;
}

const ROLE_COPY: Record<StudioTeamRole, { label: string; description: string }> = {
  owner: { label: "소유자", description: "원고·게시 상태·작품 연결·팀 권한을 모두 관리합니다." },
  admin: { label: "관리자", description: "원고를 공동 저장하고 팀원을 초대·관리합니다. 게시는 소유자 권한입니다." },
  editor: { label: "편집자", description: "원고를 읽고 공동 저장합니다. 게시 상태와 팀원은 변경할 수 없습니다." },
  commenter: { label: "검토자", description: "원고를 읽고 서버 앵커 댓글로 검토 의견을 남깁니다." },
  viewer: { label: "열람자", description: "공유 원고를 읽기 전용으로 확인합니다." },
};

const STATUS_COPY: Record<StudioTeamStatus, string> = {
  active: "참여 중",
  pending: "응답 대기",
  declined: "거절됨",
};

const ACTIVITY_ACTION_COPY: Record<StudioTeamActivityAction, string> = {
  invite: "초대 보냄",
  reinvite: "초대 다시 보냄",
  accept: "초대 수락",
  decline: "초대 거절",
  role_change: "역할 변경",
  remove: "팀에서 내보냄",
};

const TEAM_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const CONTROL_CLASS =
  "min-h-11 rounded-lg border border-line bg-canvas px-3 text-sm text-fg outline-none transition-colors focus:border-accent/70 focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-45";

function isAssignableRole(value: string): value is StudioTeamAssignableRole {
  return (STUDIO_TEAM_ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

function initials(member: StudioTeamMember): string {
  return Array.from(member.name.trim() || member.userId)[0]?.toLocaleUpperCase("ko-KR") ?? "?";
}

function textInitials(value: string): string {
  return Array.from(value.trim())[0]?.toLocaleUpperCase("ko-KR") ?? "?";
}

function formatTeamDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "날짜 확인 불가";
  return TEAM_DATE_FORMATTER.format(date);
}

function activityStateCopy(value: StudioTeamActivityState | null): string {
  if (!value) return "없음";
  return `${ROLE_COPY[value.role].label} · ${STATUS_COPY[value.status]}`;
}

function activityDescription(item: StudioTeamActivityItem): string {
  switch (item.action) {
    case "invite":
      return `${item.actor.name} 님이 ${item.target.name} 님에게 초대를 보냈습니다.`;
    case "reinvite":
      return `${item.actor.name} 님이 ${item.target.name} 님에게 초대를 다시 보냈습니다.`;
    case "accept":
      return `${item.actor.name} 님이 팀 초대를 수락했습니다.`;
    case "decline":
      return `${item.actor.name} 님이 팀 초대를 거절했습니다.`;
    case "role_change":
      return `${item.actor.name} 님이 ${item.target.name} 님의 역할을 변경했습니다.`;
    case "remove":
      return `${item.actor.name} 님이 ${item.target.name} 님을 팀에서 내보냈습니다.`;
  }
}

function canManageSnapshot(snapshot: StudioTeamSnapshot | null): boolean {
  return Boolean(
    snapshot &&
      snapshot.viewer.status === "active" &&
      (snapshot.viewer.role === "owner" || snapshot.viewer.role === "admin") &&
      snapshot.viewer.capabilities.manageMembers
  );
}

function inboxBusyKey(workId: string, action: "accept" | "decline"): string {
  return `inbox:${workId}:${action}`;
}

function MemberAvatar({ member }: { member: StudioTeamMember }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-raised text-xs font-bold text-fg-2"
    >
      {initials(member)}
    </span>
  );
}

function StatusBadge({ status }: { status: StudioTeamStatus }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full border px-2 text-xs font-semibold",
        status === "active" && "border-good/35 bg-good/10 text-good",
        status === "pending" && "border-warn/35 bg-warn/10 text-warn",
        status === "declined" && "border-bad/35 bg-bad/10 text-bad"
      )}
    >
      {STATUS_COPY[status]}
    </span>
  );
}

function ActionFeedback({
  actionError,
  notice,
}: {
  actionError: string | null;
  notice: string | null;
}) {
  if (!actionError && !notice) return null;
  return (
    <div
      aria-live={actionError ? "assertive" : "polite"}
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed",
        actionError ? "border-bad/35 bg-bad/10 text-fg" : "border-good/35 bg-good/10 text-good"
      )}
      role={actionError ? "alert" : "status"}
    >
      {actionError ? (
        <AlertCircle className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
      ) : (
        <Check className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
      )}
      <span>{actionError ?? notice}</span>
    </div>
  );
}

function InvitationOwnerAvatar({ invitation }: { invitation: StudioTeamInvitationSummary }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-raised text-xs font-bold text-fg-2"
    >
      {textInitials(invitation.owner.name)}
    </span>
  );
}

function DraftCollaborationReadinessCard({
  readiness,
  onShareRequest,
}: {
  readiness: StudioDraftCollaborationReadiness;
  onShareRequest?: () => void;
}) {
  const { identity } = readiness;
  const suffix = identity.draftDocumentId.slice(-8);
  const isProvisioning = readiness.status === "provisioning";
  const isReady = readiness.status === "ready";

  return (
    <section
      aria-labelledby="studio-team-unsaved-title"
      className="border-b border-line pb-4"
      data-studio-draft-collaboration-state={readiness.status}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          {isProvisioning ? (
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              size={19}
              aria-hidden="true"
            />
          ) : (
            <ShieldCheck size={19} aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="studio-team-unsaved-title" className="text-sm font-bold text-fg">
              {isReady
                ? "임시 협업 작업실이 준비됐어요"
                : isProvisioning
                  ? "임시 협업 작업실을 준비하고 있어요"
                  : "저장 전 협업을 준비할 수 있어요"}
            </h3>
            <span className="inline-flex min-h-6 items-center rounded-full border border-accent/30 bg-accent-soft px-2 font-mono text-[10px] font-semibold text-accent">
              초안 {suffix}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-2">
            {isReady
              ? "초안 ID와 협업 관계를 유지한 채 링크 공유와 팀원 초대를 이어갈 수 있습니다."
              : "작업실을 여는 것만으로 서버 리소스를 만들지 않습니다. 처음 링크를 공유하거나 팀원을 초대할 때만 임시 작업실을 요청합니다."}
          </p>
          {readiness.status === "ready" ? (
            <p className="mt-2 text-[11px] leading-relaxed text-fg-3">
              임시 작업실 만료 예정 · {formatTeamDate(readiness.room.expiresAt)}
            </p>
          ) : readiness.status === "error" ? (
            <p className="mt-2 text-xs leading-relaxed text-bad" role="alert">
              {readiness.message}
            </p>
          ) : identity.persistence === "memory-only" ? (
            <p className="mt-2 text-[11px] leading-relaxed text-warn">
              브라우저 저장소를 사용할 수 없어 이 탭을 닫으면 초안 협업 ID가 바뀔 수 있습니다.
            </p>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-fg-3">
              초안 ID는 이 브라우저와 현재 계정에만 저장되며, 서버 작업실과 초대는 아직 생성되지
              않았습니다.
            </p>
          )}
          {!isReady && onShareRequest ? (
            <Button
              className="mt-3 min-h-11"
              disabled={isProvisioning}
              size="sm"
              type="button"
              variant="outline"
              onClick={onShareRequest}
            >
              {isProvisioning ? (
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  size={15}
                  aria-hidden="true"
                />
              ) : (
                <Share2 size={15} aria-hidden="true" />
              )}
              {isProvisioning ? "공유 링크 준비 중" : "공유 링크 만들기"}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function UnsavedInvitationInbox({
  actionError,
  busyAction,
  draftCollaboration,
  invitations,
  invitationsError,
  invitationsLoading,
  focusTarget,
  notice,
  onDraftShareRequest,
  onFocusHandled,
  onInvitationRespond,
  onRetry,
}: {
  actionError: string | null;
  busyAction: string | null;
  draftCollaboration: StudioDraftCollaborationReadiness | null;
  invitations: StudioTeamInvitationSummary[];
  invitationsError: string | null;
  invitationsLoading: boolean;
  focusTarget: StudioTeamInboxFocusTarget;
  notice: string | null;
  onDraftShareRequest?: () => void;
  onFocusHandled: () => void;
  onInvitationRespond: (
    workId: string,
    action: "accept" | "decline",
    invitationId: string
  ) => void;
  onRetry: () => void;
}) {
  const refreshButtonRef = useRef<HTMLButtonElement>(null);
  const invitationActionRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!focusTarget) return;
    const target =
      focusTarget.kind === "refresh"
        ? refreshButtonRef.current
        : invitationActionRefs.current.get(focusTarget.workId) ?? null;
    if (!target || target.disabled) return;
    target.focus();
    onFocusHandled();
  }, [busyAction, focusTarget, invitations, invitationsLoading, onFocusHandled]);

  return (
    <div className="space-y-5 px-4 py-4 sm:px-5">
      {draftCollaboration ? (
        <DraftCollaborationReadinessCard
          readiness={draftCollaboration}
          onShareRequest={onDraftShareRequest}
        />
      ) : (
        <section aria-labelledby="studio-team-unsaved-title" className="border-b border-line pb-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <ShieldCheck size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 id="studio-team-unsaved-title" className="text-sm font-bold text-fg">
                작품을 먼저 저장해 주세요
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-2">
                현재 원고는 아직 서버에 저장되지 않았어요. 새 팀원을 초대하려면 이 작품을 한 번
                저장해야 하지만, 다른 작품에서 받은 초대는 지금 확인할 수 있습니다.
              </p>
            </div>
          </div>
        </section>
      )}

      <ActionFeedback actionError={actionError} notice={notice} />

      <section aria-labelledby="studio-team-inbox-title">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Inbox className="text-accent" size={17} aria-hidden="true" />
              <h3 id="studio-team-inbox-title" className="text-sm font-bold text-fg">
                내 팀 초대
              </h3>
            </div>
            <p className="mt-1 text-xs text-fg-3">응답하지 않은 작품 초대만 표시합니다.</p>
          </div>
          <button
            ref={refreshButtonRef}
            aria-label="받은 팀 초대 새로고침"
            className="grid size-11 shrink-0 place-items-center rounded-lg border border-line text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={invitationsLoading || busyAction != null}
            title="새로고침"
            type="button"
            onClick={onRetry}
          >
            <RefreshCw
              className={cn(invitationsLoading && "animate-spin motion-reduce:animate-none")}
              size={16}
              aria-hidden="true"
            />
          </button>
        </div>

        {invitationsLoading ? (
          <div
            aria-busy="true"
            aria-label="받은 팀 초대 불러오는 중"
            className="mt-3 space-y-3"
          >
            {[0, 1].map((index) => (
              <div className="flex items-start gap-3 py-3" key={index}>
                <span className="size-10 animate-pulse rounded-full bg-raised motion-reduce:animate-none" />
                <span className="h-20 flex-1 animate-pulse rounded-xl bg-raised/70 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : invitationsError ? (
          <div className="mt-3 py-6 text-center" role="alert">
            <AlertCircle className="mx-auto text-bad" size={24} aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-fg">초대 목록을 열지 못했어요</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-fg-2">
              {invitationsError}
            </p>
            <Button className="mt-4 min-h-11" size="sm" type="button" variant="outline" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden="true" /> 다시 시도
            </Button>
          </div>
        ) : invitations.length === 0 ? (
          <div className="py-7 text-center">
            <Inbox className="mx-auto text-fg-3" size={25} aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-fg">도착한 초대가 없어요</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-3">
              새 초대를 받으면 작품과 역할을 이곳에서 확인할 수 있습니다.
            </p>
          </div>
        ) : (
          <ul aria-label="받은 작품 팀 초대" className="mt-2 divide-y divide-line">
            {invitations.map((invitation) => {
              const accepting = busyAction === inboxBusyKey(invitation.workId, "accept");
              const declining = busyAction === inboxBusyKey(invitation.workId, "decline");
              return (
                <li className="py-4" key={invitation.workId}>
                  <div className="flex items-start gap-3">
                    <InvitationOwnerAvatar invitation={invitation} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-bold text-fg">
                          {invitation.workTitle}
                        </p>
                        <span className="inline-flex min-h-6 items-center rounded-full border border-accent/35 bg-accent-soft px-2 text-xs font-semibold text-accent">
                          {ROLE_COPY[invitation.role].label}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-fg-2">
                        {invitation.owner.name} · 작품 소유자
                      </p>
                      <time className="mt-1 block text-xs text-fg-3" dateTime={invitation.invitedAt}>
                        {formatTeamDate(invitation.invitedAt)} 초대
                      </time>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 pl-[3.25rem]">
                    <Button
                      ref={(node) => {
                        if (node) invitationActionRefs.current.set(invitation.workId, node);
                        else invitationActionRefs.current.delete(invitation.workId);
                      }}
                      aria-busy={accepting}
                      aria-label={
                        accepting
                          ? `${invitation.workTitle} 팀 초대 수락 처리 중`
                          : `${invitation.workTitle} 팀 초대 수락`
                      }
                      className="min-h-11"
                      disabled={busyAction != null}
                      size="sm"
                      type="button"
                      onClick={() =>
                        onInvitationRespond(invitation.workId, "accept", invitation.invitationId)
                      }
                    >
                      {accepting ? (
                        <LoaderCircle className="animate-spin motion-reduce:animate-none" size={15} aria-hidden="true" />
                      ) : (
                        <Check size={15} aria-hidden="true" />
                      )}
                      수락
                    </Button>
                    <Button
                      aria-busy={declining}
                      aria-label={
                        declining
                          ? `${invitation.workTitle} 팀 초대 거절 처리 중`
                          : `${invitation.workTitle} 팀 초대 거절`
                      }
                      className="min-h-11"
                      disabled={busyAction != null}
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() =>
                        onInvitationRespond(invitation.workId, "decline", invitation.invitationId)
                      }
                    >
                      {declining ? (
                        <LoaderCircle className="animate-spin motion-reduce:animate-none" size={15} aria-hidden="true" />
                      ) : (
                        <XCircle size={15} aria-hidden="true" />
                      )}
                      거절
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function TeamActivityDetails({
  activity,
  error,
  loading,
  onOpenChange,
  onRefresh,
}: {
  activity: StudioTeamActivityItem[];
  error: string | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}) {
  return (
    <details
      className="group rounded-xl border border-line bg-card/35 px-3 py-2.5"
      data-team-activity="manager-only"
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-xs font-semibold text-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <History className="text-accent" size={16} aria-hidden="true" />
          최근 팀 변경 기록
        </span>
        <span className="flex items-center gap-1.5 text-xs font-normal text-fg-3">
          소유자·관리자
          <ChevronDown
            className="transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
            size={15}
            aria-hidden="true"
          />
        </span>
      </summary>
      <div className="border-t border-line pt-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs leading-relaxed text-fg-3">
            서버에 기록된 최근 역할·초대 변경입니다.
          </p>
          <button
            aria-label="팀 변경 기록 새로고침"
            className="grid size-11 shrink-0 place-items-center rounded-lg border border-line text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={loading}
            title="변경 기록 새로고침"
            type="button"
            onClick={onRefresh}
          >
            <RefreshCw
              className={cn(loading && "animate-spin motion-reduce:animate-none")}
              size={15}
              aria-hidden="true"
            />
          </button>
        </div>

        {loading ? (
          <div aria-busy="true" aria-label="팀 변경 기록 불러오는 중" className="mt-2 space-y-2">
            {[0, 1, 2].map((index) => (
              <div className="h-14 animate-pulse rounded-lg bg-raised/70 motion-reduce:animate-none" key={index} />
            ))}
          </div>
        ) : error ? (
          <div className="py-5 text-center" role="alert">
            <AlertCircle className="mx-auto text-bad" size={22} aria-hidden="true" />
            <p className="mt-2 text-xs leading-relaxed text-fg-2">{error}</p>
            <Button className="mt-3 min-h-11" size="sm" type="button" variant="outline" onClick={onRefresh}>
              <RefreshCw size={15} aria-hidden="true" /> 다시 시도
            </Button>
          </div>
        ) : activity.length === 0 ? (
          <div className="py-5 text-center">
            <History className="mx-auto text-fg-3" size={22} aria-hidden="true" />
            <p className="mt-2 text-xs font-semibold text-fg-2">아직 기록된 변경이 없어요</p>
          </div>
        ) : (
          <ol aria-label="최근 팀 변경 기록" className="mt-2 divide-y divide-line">
            {activity.map((item) => (
              <li className="py-3" key={item.id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-xs leading-relaxed text-fg-2">
                    <span className="mr-1.5 font-semibold text-accent">
                      {ACTIVITY_ACTION_COPY[item.action]}
                    </span>
                    <span>{activityDescription(item)}</span>
                  </p>
                  <time
                    className="shrink-0 text-xs text-fg-3"
                    dateTime={item.createdAt}
                    title={formatTeamDate(item.createdAt)}
                  >
                    {formatTeamDate(item.createdAt)}
                  </time>
                </div>
                <p className="mt-1.5 text-xs text-fg-3">
                  <span>{activityStateCopy(item.before)}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only">에서 </span>
                  <span className="text-fg-2">{activityStateCopy(item.after)}</span>
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}

export interface StudioTeamPanelViewProps {
  loggedIn: boolean;
  workId: string | null;
  draftCollaboration?: StudioDraftCollaborationReadiness | null;
  snapshot: StudioTeamSnapshot | null;
  loading: boolean;
  loadError: string | null;
  actionError: string | null;
  notice: string | null;
  busyAction: string | null;
  inviteUserId: string;
  inviteRole: StudioTeamAssignableRole;
  confirmRemoveUserId: string | null;
  invitations: StudioTeamInvitationSummary[];
  invitationsLoading: boolean;
  invitationsError: string | null;
  inboxFocusTarget: StudioTeamInboxFocusTarget;
  activity: StudioTeamActivityItem[];
  activityLoading: boolean;
  activityError: string | null;
  onRetry: () => void;
  onDraftShareRequest?: () => void;
  onInvitationsRetry: () => void;
  onInboxFocusHandled: () => void;
  onInboxInvitationRespond: (
    workId: string,
    action: "accept" | "decline",
    invitationId: string
  ) => void;
  onActivityOpenChange: (open: boolean) => void;
  onActivityRefresh: () => void;
  onInviteUserIdChange: (value: string) => void;
  onInviteRoleChange: (role: StudioTeamAssignableRole) => void;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onRoleChange: (userId: string, role: StudioTeamAssignableRole) => void;
  onRemoveRequest: (userId: string) => void;
  onRemoveCancel: () => void;
  onRemoveConfirm: (userId: string) => void;
  onInvitationRespond: (action: "accept" | "decline") => void;
}

/** 데이터 로딩과 분리된 순수 뷰. SSR 회귀 테스트와 향후 Storybook에서도 같은 상태 계약을 쓴다. */
export function StudioTeamPanelView({
  loggedIn,
  workId,
  draftCollaboration = null,
  snapshot,
  loading,
  loadError,
  actionError,
  notice,
  busyAction,
  inviteUserId,
  inviteRole,
  confirmRemoveUserId,
  invitations,
  invitationsLoading,
  invitationsError,
  inboxFocusTarget,
  activity,
  activityLoading,
  activityError,
  onRetry,
  onDraftShareRequest,
  onInvitationsRetry,
  onInboxFocusHandled,
  onInboxInvitationRespond,
  onActivityOpenChange,
  onActivityRefresh,
  onInviteUserIdChange,
  onInviteRoleChange,
  onInvite,
  onRoleChange,
  onRemoveRequest,
  onRemoveCancel,
  onRemoveConfirm,
  onInvitationRespond,
}: StudioTeamPanelViewProps) {
  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const cancelButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (confirmRemoveUserId) cancelButtonRefs.current.get(confirmRemoveUserId)?.focus();
  }, [confirmRemoveUserId]);

  if (!loggedIn) {
    return (
      <div className="grid min-h-56 place-items-center px-5 py-8 text-center">
        <div className="max-w-xs">
          <UserRound className="mx-auto text-fg-3" size={28} aria-hidden="true" />
          <h3 className="mt-3 text-sm font-bold text-fg">로그인이 필요해요</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-fg-2">
            팀 초대와 작품 권한은 로그인한 계정에 안전하게 연결됩니다.
          </p>
        </div>
      </div>
    );
  }

  if (!workId) {
    return (
      <UnsavedInvitationInbox
        actionError={actionError}
        busyAction={busyAction}
        draftCollaboration={draftCollaboration}
        invitations={invitations}
        invitationsError={invitationsError}
        invitationsLoading={invitationsLoading}
        focusTarget={inboxFocusTarget}
        notice={notice}
        onDraftShareRequest={onDraftShareRequest}
        onFocusHandled={onInboxFocusHandled}
        onInvitationRespond={onInboxInvitationRespond}
        onRetry={onInvitationsRetry}
      />
    );
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-label="팀 작업 공간 불러오는 중" className="space-y-4 px-4 py-5">
        <div className="h-16 animate-pulse rounded-xl bg-raised/70 motion-reduce:animate-none" />
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-3 py-2">
              <span className="size-10 animate-pulse rounded-full bg-raised motion-reduce:animate-none" />
              <span className="h-8 flex-1 animate-pulse rounded-lg bg-raised/70 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="grid min-h-56 place-items-center px-5 py-8 text-center" role="alert">
        <div className="max-w-xs">
          <AlertCircle className="mx-auto text-bad" size={28} aria-hidden="true" />
          <h3 className="mt-3 text-sm font-bold text-fg">팀 정보를 열지 못했어요</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-fg-2">{loadError}</p>
          <Button
            className="mt-4 min-h-11"
            data-team-retry
            size="sm"
            type="button"
            variant="outline"
            onClick={onRetry}
          >
            <RefreshCw size={15} aria-hidden="true" /> 다시 시도
          </Button>
        </div>
      </div>
    );
  }

  if (!snapshot) return null;

  const canManageMembers = canManageSnapshot(snapshot);
  const invitationPending = snapshot.viewer.status === "pending";
  const invitationReady = invitationPending && Boolean(snapshot.viewer.invitationId);

  return (
    <div className="space-y-5 px-4 py-4 sm:px-5">
      {invitationPending && (
        <section
          aria-labelledby="studio-team-invitation-title"
          className="rounded-xl border border-accent/35 bg-accent-soft/60 p-3"
        >
          <div className="flex items-start gap-2.5">
            <UserPlus className="mt-0.5 shrink-0 text-accent" size={18} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 id="studio-team-invitation-title" className="text-sm font-bold text-fg">
                팀 초대가 도착했어요
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-2">
                {ROLE_COPY[snapshot.viewer.role].label} 권한으로 이 작품에 참여할 수 있습니다.
              </p>
            </div>
          </div>
          {!invitationReady ? (
            <p className="mt-3 rounded-lg border border-warn/35 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-fg-2">
              초대 조건이 갱신되었습니다. 패널을 닫았다가 다시 열어 최신 초대를 확인해 주세요.
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              className="min-h-11"
              disabled={busyAction != null || !invitationReady}
              size="sm"
              type="button"
              onClick={() => onInvitationRespond("accept")}
            >
              {busyAction === "invitation:accept" ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" size={15} aria-hidden="true" />
              ) : (
                <Check size={15} aria-hidden="true" />
              )}
              초대 수락
            </Button>
            <Button
              className="min-h-11"
              disabled={busyAction != null || !invitationReady}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => onInvitationRespond("decline")}
            >
              <XCircle size={15} aria-hidden="true" /> 초대 거절
            </Button>
          </div>
        </section>
      )}

      {snapshot.viewer.status === "declined" && (
        <p className="rounded-xl border border-line bg-card/70 px-3 py-3 text-xs leading-relaxed text-fg-2">
          이 작품의 팀 초대를 거절한 상태입니다. 다시 참여하려면 작품 관리자에게 새 초대를 요청하세요.
        </p>
      )}

      <ActionFeedback actionError={actionError} notice={notice} />

      {canManageMembers && (
        <section aria-labelledby="studio-team-invite-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 id="studio-team-invite-title" className="text-sm font-bold text-fg">
                팀원 초대
              </h3>
              <p className="mt-0.5 text-xs text-fg-3">가입한 사용자의 ID로 초대합니다.</p>
            </div>
            <ShieldCheck className="shrink-0 text-accent" size={18} aria-hidden="true" />
          </div>
          <form className="mt-3 space-y-2" onSubmit={onInvite}>
            <label className="block text-xs font-semibold text-fg-2" htmlFor="studio-team-invite-user-id">
              사용자 ID
            </label>
            <input
              autoComplete="off"
              className={cn(CONTROL_CLASS, "w-full")}
              disabled={busyAction != null}
              id="studio-team-invite-user-id"
              maxLength={160}
              placeholder="예: creator_1234"
              spellCheck={false}
              type="text"
              value={inviteUserId}
              onChange={(event) => onInviteUserIdChange(event.target.value)}
            />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <label className="sr-only" htmlFor="studio-team-invite-role">
                초대 역할
              </label>
              <select
                className={cn(CONTROL_CLASS, "w-full")}
                disabled={busyAction != null}
                id="studio-team-invite-role"
                value={inviteRole}
                onChange={(event) => {
                  if (isAssignableRole(event.target.value)) onInviteRoleChange(event.target.value);
                }}
              >
                {STUDIO_TEAM_ASSIGNABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_COPY[role].label}
                  </option>
                ))}
              </select>
              <Button
                className="min-h-11 px-4"
                disabled={busyAction != null || !inviteUserId.trim()}
                size="sm"
                type="submit"
              >
                {busyAction === "invite" ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" size={15} aria-hidden="true" />
                ) : (
                  <UserPlus size={15} aria-hidden="true" />
                )}
                초대
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-fg-3">
              <strong className="font-semibold text-fg-2">{ROLE_COPY[inviteRole].label}</strong>
              {" · "}
              {ROLE_COPY[inviteRole].description}
            </p>
          </form>
        </section>
      )}

      <section aria-labelledby="studio-team-members-title">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
          <h3
            className="text-sm font-bold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            data-team-members-heading
            id="studio-team-members-title"
            tabIndex={-1}
          >
            {canManageMembers ? `멤버 ${snapshot.members.length}명` : "소유자와 내 정보"}
          </h3>
          <span className="text-xs text-fg-3">
            내 역할 · {ROLE_COPY[snapshot.viewer.role].label}
          </span>
        </div>
        {!canManageMembers ? (
          <p className="mt-2 text-xs leading-relaxed text-fg-3">
            전체 팀 명단은 소유자와 관리자에게만 표시됩니다.
          </p>
        ) : null}

        {snapshot.members.length === 0 ? (
          <div className="py-8 text-center">
            <UsersRound className="mx-auto text-fg-3" size={26} aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-fg">표시할 팀원이 없어요</p>
            <p className="mt-1 text-xs text-fg-3">
              권한이 있다면 위 초대 양식에서 첫 팀원을 추가할 수 있습니다.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line" aria-label="작품 팀원">
            {snapshot.members.map((member) => {
              const canEditMember =
                canManageMembers && !member.isOwner && member.userId !== snapshot.viewer.userId;
              const isUpdating = busyAction === `role:${member.userId}`;
              const isRemoving = busyAction === `remove:${member.userId}`;
              const confirmingRemove = confirmRemoveUserId === member.userId;

              return (
                <li className="py-3" key={member.userId}>
                  <div className="flex items-start gap-3">
                    <MemberAvatar member={member} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="min-w-0 truncate text-sm font-semibold text-fg">{member.name}</p>
                        {member.userId === snapshot.viewer.userId && (
                          <span className="text-xs font-semibold text-accent">나</span>
                        )}
                        <StatusBadge status={member.status} />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-fg-3">{member.userId}</p>
                      {!canEditMember && (
                        <p className="mt-1 text-xs text-fg-2">{ROLE_COPY[member.role].label}</p>
                      )}
                    </div>
                  </div>

                  {canEditMember && !confirmingRemove && (
                    <div
                      className="mt-2 grid grid-cols-[minmax(0,1fr)_2.75rem] gap-2 pl-[3.25rem]"
                      data-team-manage-controls="true"
                    >
                      <label className="sr-only" htmlFor={`studio-team-role-${member.userId}`}>
                        {member.name} 역할
                      </label>
                      <select
                        aria-label={`${member.name} 역할`}
                        className={cn(CONTROL_CLASS, "w-full")}
                        disabled={busyAction != null}
                        id={`studio-team-role-${member.userId}`}
                        value={member.role === "owner" ? "viewer" : member.role}
                        onChange={(event) => {
                          if (isAssignableRole(event.target.value)) {
                            onRoleChange(member.userId, event.target.value);
                          }
                        }}
                      >
                        {STUDIO_TEAM_ASSIGNABLE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_COPY[role].label}
                          </option>
                        ))}
                      </select>
                      <button
                        ref={(node) => {
                          if (node) removeButtonRefs.current.set(member.userId, node);
                          else removeButtonRefs.current.delete(member.userId);
                        }}
                        aria-label={`${member.name} 팀에서 내보내기`}
                        className="grid size-11 place-items-center rounded-lg border border-line text-fg-3 transition-colors hover:border-bad/45 hover:bg-bad/10 hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
                        disabled={busyAction != null}
                        title="팀에서 내보내기"
                        type="button"
                        onClick={() => onRemoveRequest(member.userId)}
                      >
                        {isUpdating || isRemoving ? (
                          <LoaderCircle className="animate-spin motion-reduce:animate-none" size={16} aria-hidden="true" />
                        ) : (
                          <Trash2 size={16} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  )}

                  {canEditMember && confirmingRemove && (
                    <div
                      className="mt-2 rounded-xl border border-bad/35 bg-bad/10 p-2.5 pl-3"
                      data-team-remove-confirmation="true"
                      aria-busy={isRemoving}
                    >
                      <p className="text-xs leading-relaxed text-fg">
                        <strong className="font-semibold">{member.name}</strong> 님을 팀에서 내보낼까요?
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Button
                          ref={(node) => {
                            if (node) cancelButtonRefs.current.set(member.userId, node);
                            else cancelButtonRefs.current.delete(member.userId);
                          }}
                          className="min-h-11"
                          disabled={busyAction != null}
                          size="sm"
                          type="button"
                          variant="quiet"
                          onClick={() => {
                            onRemoveCancel();
                            window.requestAnimationFrame(() =>
                              removeButtonRefs.current.get(member.userId)?.focus()
                            );
                          }}
                        >
                          취소
                        </Button>
                        <Button
                          className="min-h-11 border-bad/45 text-bad hover:bg-bad/10 hover:text-bad"
                          disabled={busyAction != null}
                          size="sm"
                          type="button"
                          variant="outline"
                          onClick={() => onRemoveConfirm(member.userId)}
                        >
                          {isRemoving ? (
                            "연결 권한 회수 중…"
                          ) : (
                            "팀에서 내보내기"
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canManageMembers ? (
        <TeamActivityDetails
          activity={activity}
          error={activityError}
          loading={activityLoading}
          onOpenChange={onActivityOpenChange}
          onRefresh={onActivityRefresh}
        />
      ) : null}

      <details className="group rounded-xl border border-line bg-card/35 px-3 py-2.5">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-xs font-semibold text-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 [&::-webkit-details-marker]:hidden">
          <span>역할별 서버 권한 안내</span>
          <ChevronDown
            className="shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
            size={15}
            aria-hidden="true"
          />
        </summary>
        <dl className="space-y-2 border-t border-line pt-3">
          {(Object.keys(ROLE_COPY) as StudioTeamRole[]).map((role) => (
            <div className="grid grid-cols-[4.25rem_1fr] gap-2 text-xs" key={role}>
              <dt className="font-semibold text-fg">{ROLE_COPY[role].label}</dt>
              <dd className="leading-relaxed text-fg-3">{ROLE_COPY[role].description}</dd>
            </div>
          ))}
        </dl>
      </details>

      <p className="border-t border-line pt-3 text-xs leading-relaxed text-fg-3">
        공유 원고 읽기와 소유자·관리자·편집자의 revision 공동 저장까지 서버 권한에 연결되었습니다.
        위 같이 보기는 로그인 세션과 작품 권한을 확인한 팀 서버를 우선하며, 패널을 닫아도 캔버스
        커서·접속 상태·페이지 따라가기는 유지됩니다. 연결 실패 때 사용자가 직접 선택한 경우에만 같은
        출처 로컬 탭 모드로 전환됩니다. 서버 저장형 검토 댓글과 원격 페이지·요소 잠금의 실제 편집
        강제는 다음 안전성 단계에서 연결합니다.
      </p>
    </div>
  );
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

class StudioTeamPostAcknowledgementRefreshError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StudioTeamPostAcknowledgementRefreshError";
  }
}

export function StudioTeamPanel({
  open,
  onClose,
  workId,
  loggedIn,
  authScopeKey,
  draftCollaboration = null,
  onDraftShareRequest,
  followingSessionId = null,
  onToggleFollow,
}: StudioTeamPanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const currentScopeRef = useRef<{ authScopeKey: string | null; workId: string | null }>({
    authScopeKey,
    workId,
  });
  currentScopeRef.current = { authScopeKey, workId };
  const [snapshot, setSnapshot] = useState<StudioTeamSnapshot | null>(null);
  const [snapshotAuthScopeKey, setSnapshotAuthScopeKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorAuthScopeKey, setLoadErrorAuthScopeKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteRole, setInviteRole] = useState<StudioTeamAssignableRole>("editor");
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [invitations, setInvitations] = useState<StudioTeamInvitationSummary[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [invitationsLoaded, setInvitationsLoaded] = useState(false);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);
  const [invitationsAuthScopeKey, setInvitationsAuthScopeKey] = useState<string | null>(null);
  const [invitationsReloadKey, setInvitationsReloadKey] = useState(0);
  const [inboxFocusTarget, setInboxFocusTarget] = useState<StudioTeamInboxFocusTarget>(null);
  const [activity, setActivity] = useState<StudioTeamActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityScope, setActivityScope] = useState<StudioTeamRequestScope | null>(null);
  const [activityRequestScope, setActivityRequestScope] = useState<StudioTeamRequestScope | null>(null);
  const [activityReloadKey, setActivityReloadKey] = useState(0);
  const [sharedWorksRefreshKey, setSharedWorksRefreshKey] = useState(0);
  const closeFromEffect = useEffectEvent(onClose);
  const authReady = loggedIn && authScopeKey !== null;
  const scopedSnapshot =
    snapshot?.workId === workId && snapshotAuthScopeKey === authScopeKey ? snapshot : null;
  const activityAllowed = authReady && canManageSnapshot(scopedSnapshot);

  useEffect(() => {
    setSnapshot(null);
    setSnapshotAuthScopeKey(null);
    setLoading(false);
    setLoadError(null);
    setLoadErrorAuthScopeKey(null);
    setActionError(null);
    setNotice(null);
    setBusyAction(null);
    setInviteUserId("");
    setConfirmRemoveUserId(null);
    setInvitations([]);
    setInvitationsLoading(false);
    setInvitationsLoaded(false);
    setInvitationsError(null);
    setInvitationsAuthScopeKey(null);
    setInboxFocusTarget(null);
    setActivity([]);
    setActivityLoading(false);
    setActivityError(null);
    setActivityScope(null);
    setActivityRequestScope(null);
    setSharedWorksRefreshKey(0);
  }, [authScopeKey, loggedIn]);

  useEffect(() => {
    if (!open || !authReady || !authScopeKey || !workId) return;
    const controller = new AbortController();
    const requestScope: StudioTeamRequestScope = { authScopeKey, workId };
    setLoading(true);
    setLoadError(null);
    setLoadErrorAuthScopeKey(null);
    setActionError(null);
    setNotice(null);

    void getStudioTeam(workId, controller.signal)
      .then((nextSnapshot) => {
        if (
          !controller.signal.aborted &&
          isStudioTeamRequestScopeCurrent(requestScope, currentScopeRef.current)
        ) {
          setSnapshot(nextSnapshot);
          setSnapshotAuthScopeKey(authScopeKey);
        }
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          isStudioTeamRequestScopeCurrent(requestScope, currentScopeRef.current)
        ) {
          setSnapshot(null);
          setSnapshotAuthScopeKey(null);
          setLoadError(messageFrom(error, "팀 작업 공간을 불러오지 못했습니다."));
          setLoadErrorAuthScopeKey(authScopeKey);
        }
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          isStudioTeamRequestScopeCurrent(requestScope, currentScopeRef.current)
        ) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [authReady, authScopeKey, open, reloadKey, workId]);

  useEffect(() => {
    if (!open || !authReady || !authScopeKey || workId !== null) return;
    const controller = new AbortController();
    const requestScope: StudioTeamRequestScope = { authScopeKey, workId: null };
    setInvitationsLoading(true);
    setInvitationsLoaded(false);
    setInvitationsError(null);
    setInvitationsAuthScopeKey(authScopeKey);

    void getStudioTeamInvitations(20, controller.signal)
      .then((nextInvitations) => {
        if (
          !controller.signal.aborted &&
          isStudioTeamRequestScopeCurrent(requestScope, currentScopeRef.current)
        ) {
          setInvitations(nextInvitations);
        }
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          isStudioTeamRequestScopeCurrent(requestScope, currentScopeRef.current)
        ) {
          setInvitations([]);
          setInvitationsError(messageFrom(error, "받은 팀 초대를 불러오지 못했습니다."));
        }
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          isStudioTeamRequestScopeCurrent(requestScope, currentScopeRef.current)
        ) {
          setInvitationsLoading(false);
          setInvitationsLoaded(true);
        }
      });

    return () => controller.abort();
  }, [authReady, authScopeKey, invitationsReloadKey, open, workId]);

  useEffect(() => {
    if (!open || !authReady || !activityRequestScope || !activityAllowed) {
      return;
    }
    if (!isStudioTeamRequestScopeCurrent(activityRequestScope, currentScopeRef.current)) return;
    const requestScope = activityRequestScope;
    const requestedWorkId = requestScope.workId;
    if (!requestedWorkId) return;
    const controller = new AbortController();
    setActivityLoading(true);
    setActivityError(null);

    void getStudioTeamActivity(requestedWorkId, 20, controller.signal)
      .then((nextActivity) => {
        if (
          !controller.signal.aborted &&
          isStudioTeamRequestScopeCurrent(requestScope, currentScopeRef.current)
        ) {
          setActivity(nextActivity);
          setActivityScope(requestScope);
        }
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          isStudioTeamRequestScopeCurrent(requestScope, currentScopeRef.current)
        ) {
          setActivity([]);
          setActivityScope(requestScope);
          setActivityError(messageFrom(error, "팀 변경 기록을 불러오지 못했습니다."));
        }
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          isStudioTeamRequestScopeCurrent(requestScope, currentScopeRef.current)
        ) {
          setActivityLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    activityAllowed,
    activityReloadKey,
    activityRequestScope,
    authReady,
    open,
  ]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    const appRoot = document.getElementById("root");
    const previousRootInert = appRoot?.inert ?? false;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (appRoot) appRoot.inert = true;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFromEffect();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      if (appRoot) appRoot.inert = previousRootInert;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;

  const visibleSnapshot = scopedSnapshot;
  const visibleLoadError = loadErrorAuthScopeKey === authScopeKey ? loadError : null;
  const visibleInvitations =
    invitationsAuthScopeKey === authScopeKey ? invitations : [];
  const visibleInvitationsError =
    invitationsAuthScopeKey === authScopeKey ? invitationsError : null;
  const invitationsLoadedForScope =
    invitationsAuthScopeKey === authScopeKey && invitationsLoaded;
  const shouldLoad = authReady && workId != null;
  const visibleLoading =
    shouldLoad && !visibleLoadError && (loading || visibleSnapshot == null);
  const visibleInvitationsLoading =
    authReady && workId === null && (!invitationsLoadedForScope || invitationsLoading);
  const currentActivityScope =
    authScopeKey && workId ? { authScopeKey, workId } : null;
  const activityMatchesCurrentScope = Boolean(
    currentActivityScope && isSameStudioTeamRequestScope(activityScope, currentActivityScope)
  );
  const visibleActivity = activityMatchesCurrentScope ? activity : [];
  const visibleActivityError = activityMatchesCurrentScope ? activityError : null;
  const visibleActivityLoading =
    Boolean(
      currentActivityScope &&
        isSameStudioTeamRequestScope(activityRequestScope, currentActivityScope) &&
        activityAllowed &&
        activityLoading
    );

  async function runMutation(
    key: string,
    successMessage: string,
    mutation: () => Promise<StudioTeamSnapshot>
  ): Promise<boolean> {
    if (busyAction || !authScopeKey) return false;
    const mutationScope: StudioTeamRequestScope = { authScopeKey, workId };
    setBusyAction(key);
    setActionError(null);
    setNotice(null);
    try {
      const nextSnapshot = await mutation();
      if (!isStudioTeamRequestScopeCurrent(mutationScope, currentScopeRef.current)) return false;
      setSnapshot(nextSnapshot);
      setSnapshotAuthScopeKey(authScopeKey);
      setNotice(successMessage);
      setConfirmRemoveUserId(null);
      if (
        currentActivityScope &&
        (isSameStudioTeamRequestScope(activityRequestScope, currentActivityScope) ||
          isSameStudioTeamRequestScope(activityScope, currentActivityScope))
      ) {
        setActivityLoading(true);
        setActivityRequestScope(currentActivityScope);
        setActivityReloadKey((value) => value + 1);
      }
      return true;
    } catch (error) {
      if (!isStudioTeamRequestScopeCurrent(mutationScope, currentScopeRef.current)) return false;
      if (error instanceof StudioTeamPostAcknowledgementRefreshError) {
        // 초대 응답은 이미 서버에 반영되었으므로 실패로 오인해 재전송하지 않게 한다.
        // 최신 팀 GET만 사용자가 다시 시도할 수 있는 명시적 오류 상태로 전환한다.
        setSnapshot(null);
        setSnapshotAuthScopeKey(null);
        setLoadError(error.message);
        setLoadErrorAuthScopeKey(authScopeKey);
      } else if (shouldReloadStudioTeamInvitation(error)) {
        setNotice(error.message);
        setReloadKey((value) => value + 1);
      } else {
        setActionError(messageFrom(error, "팀 권한을 변경하지 못했습니다."));
      }
      return false;
    } finally {
      if (isStudioTeamRequestScopeCurrent(mutationScope, currentScopeRef.current)) {
        setBusyAction(null);
      }
    }
  }

  function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userId = inviteUserId.trim();
    if (!workId || !userId) return;
    void runMutation("invite", "팀 초대를 보냈습니다.", () =>
      inviteStudioTeamMember(workId, { userId, role: inviteRole })
    ).then((succeeded) => {
      if (succeeded) setInviteUserId("");
    });
  }

  function handleRoleChange(userId: string, role: StudioTeamAssignableRole) {
    if (!workId) return;
    void runMutation(`role:${userId}`, "팀원 역할을 변경했습니다.", () =>
      updateStudioTeamMemberRole(workId, userId, role)
    );
  }

  function handleRemove(userId: string) {
    if (!workId) return;
    void runMutation(`remove:${userId}`, "팀원을 내보냈습니다.", () =>
      removeStudioTeamMember(workId, userId)
    ).then((succeeded) => {
      if (!succeeded) return;
      window.requestAnimationFrame(() => {
        panelRef.current
          ?.querySelector<HTMLElement>("[data-team-members-heading]")
          ?.focus();
      });
    });
  }

  function handleInvitationRespond(action: "accept" | "decline") {
    if (!workId || !authScopeKey) return;
    const invitationId = visibleSnapshot?.viewer.invitationId;
    if (!invitationId) {
      setActionError("최신 초대 조건을 확인하지 못했습니다. 패널을 다시 열어 주세요.");
      return;
    }
    void runMutation(
      `invitation:${action}`,
      action === "accept" ? "팀 초대를 수락했습니다." : "팀 초대를 거절했습니다.",
      async () => {
        await respondToStudioTeamInvitation(workId, action, invitationId);
        try {
          return await getStudioTeam(workId);
        } catch (error) {
          throw new StudioTeamPostAcknowledgementRefreshError(
            action === "accept"
              ? "초대 수락은 완료됐지만 최신 팀 정보를 불러오지 못했습니다. 다시 시도해 주세요."
              : "초대 거절은 완료됐지만 최신 팀 정보를 불러오지 못했습니다. 다시 시도해 주세요.",
            { cause: error }
          );
        }
      }
    ).then((succeeded) => {
      if (succeeded && action === "accept") {
        setSharedWorksRefreshKey((value) => value + 1);
      }
      window.requestAnimationFrame(() => {
        if (succeeded) {
          panelRef.current
            ?.querySelector<HTMLElement>("[data-team-members-heading]")
            ?.focus();
          return;
        }
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && panelRef.current?.contains(activeElement)) {
          return;
        }
        const recoveryTarget =
          panelRef.current?.querySelector<HTMLElement>("[data-team-retry]") ??
          closeButtonRef.current;
        recoveryTarget?.focus();
      });
    });
  }

  async function handleInboxInvitationRespond(
    invitedWorkId: string,
    action: "accept" | "decline",
    invitationId: string
  ) {
    if (busyAction || workId !== null || !authScopeKey) return;
    const requestScope: StudioTeamRequestScope = { authScopeKey, workId: null };
    const currentInvitation = visibleInvitations.find(
      (invitation) =>
        invitation.workId === invitedWorkId && invitation.invitationId === invitationId
    );
    if (!currentInvitation) {
      setActionError("초대가 갱신되었습니다. 최신 목록을 다시 불러와 주세요.");
      return;
    }

    setBusyAction(inboxBusyKey(invitedWorkId, action));
    setActionError(null);
    setNotice(null);
    const nextFocusTarget = nextStudioTeamInboxFocusTarget(
      visibleInvitations,
      currentInvitation
    );
    try {
      await respondToStudioTeamInvitation(invitedWorkId, action, invitationId);
      if (!isStudioTeamRequestScopeCurrent(requestScope, currentScopeRef.current)) return;
      setInvitations((current) =>
        removeAcknowledgedStudioTeamInvitation(current, currentInvitation)
      );
      if (action === "accept") setSharedWorksRefreshKey((value) => value + 1);
      setInboxFocusTarget(nextFocusTarget);
      setNotice(action === "accept" ? "팀 초대를 수락했습니다." : "팀 초대를 거절했습니다.");
    } catch (error) {
      if (!isStudioTeamRequestScopeCurrent(requestScope, currentScopeRef.current)) return;
      if (shouldReloadStudioTeamInvitation(error)) {
        setNotice(error.message);
        setInboxFocusTarget({ kind: "refresh" });
        setInvitationsLoaded(false);
        setInvitationsReloadKey((value) => value + 1);
      } else {
        setActionError(messageFrom(error, "팀 초대에 응답하지 못했습니다."));
      }
    } finally {
      if (isStudioTeamRequestScopeCurrent(requestScope, currentScopeRef.current)) {
        setBusyAction(null);
      }
    }
  }

  function handleActivityOpenChange(nextOpen: boolean) {
    if (
      !shouldRequestStudioTeamActivity({
        open: nextOpen,
        loggedIn,
        authScopeKey,
        workId,
        canManageMembers: activityAllowed,
        loadedScope: activityScope,
        requestScope: activityRequestScope,
      }) ||
      !authScopeKey ||
      !workId
    ) {
      return;
    }
    setActivityLoading(true);
    setActivityRequestScope({ authScopeKey, workId });
  }

  function handleActivityRefresh() {
    if (!workId || !authScopeKey || !activityAllowed) return;
    setActivityLoading(true);
    setActivityRequestScope({ authScopeKey, workId });
    setActivityReloadKey((value) => value + 1);
  }

  function handleBackdropPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  const panel = (
    // 닫기는 Escape와 명시적 버튼으로도 제공된다. 이 핸들러는 포인터 백드롭 전용이다.
    <div
      className="fixed inset-y-0 left-0 z-[90] w-[100dvw] bg-[oklch(0.08_0.01_70/0.72)] backdrop-blur-[2px]"
      data-testid="studio-team-panel-backdrop"
      onPointerDown={handleBackdropPointerDown}
    >
      <div
        ref={panelRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          "absolute inset-x-0 bottom-[calc(7rem+env(safe-area-inset-bottom))] flex min-h-0 max-h-[min(72dvh,calc(100dvh-7.75rem-env(safe-area-inset-top)))] flex-col overflow-hidden rounded-t-2xl border border-line bg-panel text-fg shadow-[0_-18px_54px_oklch(0.05_0.01_70/0.48)]",
          "sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[26rem] sm:rounded-none sm:rounded-l-2xl sm:shadow-[-18px_0_54px_oklch(0.05_0.01_70/0.48)]"
        )}
        data-testid="studio-team-panel"
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-accent">
              <UsersRound size={17} aria-hidden="true" />
              <span className="text-xs font-semibold">서버 권한</span>
            </div>
            <h2 className="mt-1 text-base font-bold tracking-tight text-fg" id={titleId}>
              팀 작업 공간
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-3" id={descriptionId}>
              참여 작품을 열고, 받은 초대를 확인하며 멤버 역할을 관리합니다.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            aria-label="팀 작업 공간 닫기"
            className="grid size-11 shrink-0 place-items-center rounded-lg border border-line text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            title="닫기"
            type="button"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div
          aria-busy={
            busyAction != null || visibleLoading || visibleInvitationsLoading || visibleActivityLoading
          }
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))] [scrollbar-gutter:stable]"
        >
          <StudioSharedWorksPanel
            authScopeKey={authScopeKey}
            currentWorkId={workId}
            loggedIn={loggedIn}
            open={open}
            refreshKey={sharedWorksRefreshKey}
            onOpenWork={() => onClose()}
          />
          {workId &&
          visibleSnapshot?.viewer.status === "active" &&
          visibleSnapshot.viewer.capabilities.view ? (
            <StudioLiveCollaborationPanel
              followingSessionId={followingSessionId}
              onToggleFollow={onToggleFollow}
              workId={workId}
            />
          ) : null}
          <StudioTeamPanelView
            activity={visibleActivity}
            activityError={visibleActivityError}
            activityLoading={visibleActivityLoading}
            actionError={actionError}
            busyAction={busyAction}
            confirmRemoveUserId={confirmRemoveUserId}
            draftCollaboration={draftCollaboration}
            inviteRole={inviteRole}
            inviteUserId={inviteUserId}
            inboxFocusTarget={inboxFocusTarget}
            invitations={visibleInvitations}
            invitationsError={visibleInvitationsError}
            invitationsLoading={visibleInvitationsLoading}
            loadError={visibleLoadError}
            loading={visibleLoading}
            loggedIn={authReady}
            notice={notice}
            snapshot={visibleSnapshot}
            workId={workId}
            onActivityOpenChange={handleActivityOpenChange}
            onActivityRefresh={handleActivityRefresh}
            onInboxFocusHandled={() => setInboxFocusTarget(null)}
            onDraftShareRequest={onDraftShareRequest}
            onInboxInvitationRespond={handleInboxInvitationRespond}
            onInvitationRespond={handleInvitationRespond}
            onInvite={handleInvite}
            onInviteRoleChange={setInviteRole}
            onInviteUserIdChange={setInviteUserId}
            onRemoveCancel={() => setConfirmRemoveUserId(null)}
            onRemoveConfirm={handleRemove}
            onRemoveRequest={setConfirmRemoveUserId}
            onInvitationsRetry={() => {
              setInvitationsLoaded(false);
              if (authScopeKey) setInvitationsAuthScopeKey(authScopeKey);
              setInvitationsReloadKey((value) => value + 1);
            }}
            onRetry={() => setReloadKey((value) => value + 1)}
            onRoleChange={handleRoleChange}
          />
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? panel : createPortal(panel, document.body);
}
