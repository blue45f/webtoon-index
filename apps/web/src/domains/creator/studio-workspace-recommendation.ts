import type {
  StudioDefaultWorkspace,
  StudioDefaultWorkspaceId,
  StudioWorkspaceId,
} from "./studio-workspaces";

export const STUDIO_CLIP_WORKSPACE_RECOMMENDATION = Object.freeze({
  id: "clip-studio-layout",
  workspaceId: "csp-migration",
  description:
    "클립 스튜디오에서 익숙했던 레이어 중심 동선을 유지하면서 좌우 도크를 줄여 캔버스 우선 환경으로 바로 시작합니다.",
  detail: "왼쪽 페이지 · 오른쪽 레이어·속성 · 캔버스 우선 배치",
  actionLabel: "이 배치 사용",
  searchAliases: Object.freeze([
    "CSP",
    "Clip Studio",
    "클립스튜디오",
    "클립 스튜디오",
    "클튜",
    "이주",
    "전환",
  ]),
} as const satisfies {
  readonly id: string;
  readonly workspaceId: StudioDefaultWorkspaceId;
  readonly description: string;
  readonly detail: string;
  readonly actionLabel: string;
  readonly searchAliases: readonly string[];
});

export interface ResolvedStudioWorkspaceRecommendation {
  readonly id: typeof STUDIO_CLIP_WORKSPACE_RECOMMENDATION.id;
  readonly workspaceId: typeof STUDIO_CLIP_WORKSPACE_RECOMMENDATION.workspaceId;
  readonly workspace: StudioDefaultWorkspace;
  readonly description: string;
  readonly detail: string;
  readonly actionLabel: string;
  readonly searchAliases: readonly string[];
}

/** Search vocabulary stays presentation-only; persisted workspace records remain unchanged. */
export function studioWorkspaceSearchAliases(workspaceId: string): readonly string[] {
  return workspaceId === STUDIO_CLIP_WORKSPACE_RECOMMENDATION.workspaceId
    ? STUDIO_CLIP_WORKSPACE_RECOMMENDATION.searchAliases
    : [];
}

/**
 * Resolves the recommendation by the stable built-in id. It disappears once selected, leaving the
 * current-workspace summary as the single active-state authority.
 */
export function resolveStudioWorkspaceRecommendation(
  workspaces: readonly StudioDefaultWorkspace[],
  activeWorkspaceId: StudioWorkspaceId,
): ResolvedStudioWorkspaceRecommendation | null {
  if (activeWorkspaceId === STUDIO_CLIP_WORKSPACE_RECOMMENDATION.workspaceId) return null;
  const workspace = workspaces.find(
    (candidate) => candidate.id === STUDIO_CLIP_WORKSPACE_RECOMMENDATION.workspaceId
  );
  if (!workspace) return null;

  return {
    ...STUDIO_CLIP_WORKSPACE_RECOMMENDATION,
    workspace,
  };
}
