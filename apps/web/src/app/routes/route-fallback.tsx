import { LoadingState } from "@/shared/components/LoadingState";
import { useT } from "@/shared/lib/i18n";

/**
 * 라우트 로딩 폴백 — 공용 LoadingState의 카드 스켈레톤.
 * 페이지의 대략적 골격(헤더 + 카드 그리드)을 미리 그려 레이아웃 점프와 빈 화면 깜빡임을 줄인다.
 * 스피너 금지(DESIGN.md), prefers-reduced-motion 전역 가드를 그대로 따른다.
 */
export function RouteFallback() {
  const t = useT();
  return (
    <LoadingState
      variant="cards"
      label={t("common.loading")}
      className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6"
    />
  );
}
