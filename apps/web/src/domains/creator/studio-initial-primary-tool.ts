import type { Tool } from "./studio-editor-tool-model";

/**
 * 첫 획까지의 거리를 줄이는 규칙 하나를 순수 함수로 고정한다.
 *
 * 감사 근거(docs/rewrite/ux-audit-v5.md §2.1): 손님은 첫 획을 긋기 전에 두 번 조작해야 했다
 * — 코치를 닫고, 기본 `select` 에서 브러시로 바꾸고. 코치는 비모달 카드가 되었고, 남은 절반이
 * 이 규칙이다: **빈 문서는 그리기로 열린다.**
 *
 * 다만 "기억된 도구"가 항상 이긴다. 돌아온 사용자가 마지막에 선택 도구로 작업하고 있었다면
 * 그 상태로 돌려주는 것이 놀라움이 적다. `hand` 는 기억 대상이 아니다 — 팬은 잠깐 쓰는
 * 보조 동작이라 다음 세션의 시작 도구가 되면 "왜 안 그려지지?"가 된다.
 */
export type StudioRememberedPrimaryTool = "select" | "draw";

/** 저장소에서 읽은 값은 무엇이든 될 수 있다. `hand`·미지의 문자열은 "기억 없음"으로 접는다. */
export function normalizeStudioRememberedPrimaryTool(
  raw: unknown,
): StudioRememberedPrimaryTool | null {
  return raw === "select" || raw === "draw" ? raw : null;
}

export function resolveStudioInitialPrimaryTool({
  rememberedTool,
  hasExistingContent,
}: {
  readonly rememberedTool: StudioRememberedPrimaryTool | null;
  readonly hasExistingContent: boolean;
}): Tool {
  if (rememberedTool !== null) return rememberedTool;
  return hasExistingContent ? "select" : "draw";
}
