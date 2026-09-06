/**
 * §15.3 Collaboration — the group whose only doors were unreachable on desktop.
 *
 * The other declared-but-empty §15.3 group, and the worse of the two. The team /
 * share / permission panel had exactly two entry points: a tool-belt button that
 * is `display:none` above 1024px, and the live-presence dock, which renders
 * `null` until a peer joins or a session is connecting. On a desktop document
 * with no live session there was **no way to open it at all** — a share surface
 * you cannot reach is a share surface you do not have.
 *
 * Comments and page review were reachable, but only through the 프로젝트 센터
 * sheet (File ▸ 프로젝트 도구 → button), i.e. 3 actions for a §15 rule-4 command.
 *
 * Rows §15.3 asks for that the product genuinely lacks — Proposal Branch,
 * Audit Log, paint-over, an explicit soft-lock control — stay recorded as gaps in
 * `studio-main-menu-group-spec.ts`.
 */

import { ClipboardCheck, MessagesSquare, Presentation, Users } from "lucide-react";

import type { StudioMainMenuItemContext } from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";

export function buildStudioCollaborationMenuItems({
  state,
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "team",
      commandId: "collaboration.team",
      label: "팀 · 공유 권한…",
      icon: Users,
      separatorAfter: true,
      onSelect: () => {
        ui.openTeamPanel();
      },
    },
    {
      id: "comments",
      commandId: "collaboration.comments",
      label: state.documentCommentsOpen ? "댓글 패널 닫기" : "댓글 패널 열기",
      icon: MessagesSquare,
      checked: state.documentCommentsOpen,
      selectionRole: "checkbox",
      onSelect: () => {
        ui.toggleDocumentComments();
      },
    },
    {
      id: "page-review",
      commandId: "collaboration.page-review",
      label: "페이지 검토 · 승인…",
      icon: ClipboardCheck,
      disabled: state.masterEditMode,
      unavailableReason: state.masterEditMode
        ? "마스터 편집을 끝낸 뒤 검토 상태를 바꾸세요."
        : undefined,
      onSelect: () => {
        ui.openPageReview();
      },
    },
    {
      id: "ephemeral-board",
      commandId: "collaboration.ephemeral-board",
      label: "빠른 화이트보드…",
      icon: Presentation,
      onSelect: () => {
        ui.startEphemeralWhiteboard();
      },
    },
  ];
}
