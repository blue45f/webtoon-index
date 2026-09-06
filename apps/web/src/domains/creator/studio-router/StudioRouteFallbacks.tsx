import type { StudioWorkspaceRouteErrorCode } from "../studio-workspace-route";
import type { StudioPlaceholderRouteId } from "./studio-route-manifest";

import Link from "@/src/compat/router-link";

const ROUTE_ERROR_DETAILS: Readonly<Record<StudioWorkspaceRouteErrorCode, string>> = {
  "identity-conflict": "작품과 리믹스 원본 ID가 한 주소에 함께 들어 있어 문서를 열지 않았습니다.",
  "invalid-mode": "지원하지 않거나 중복된 Studio 모드가 지정되어 있습니다.",
  "invalid-path": "지원하지 않는 Studio 작업 주소입니다.",
  "invalid-remix-id": "리믹스 원본 ID를 안전하게 읽을 수 없습니다.",
  "invalid-work-id": "작품 ID를 안전하게 읽을 수 없습니다.",
  "work-id-conflict": "주소의 작품 ID가 서로 달라 다른 문서를 여는 대신 작업을 중단했습니다.",
};

const PRIMARY_EXIT_CLASS =
  "min-h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent transition-colors " +
  "hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-accent";
const SECONDARY_EXIT_CLASS =
  "inline-flex min-h-11 items-center rounded-lg border border-line px-5 text-sm font-semibold " +
  "text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * 막다른 화면에서 나가는 문.
 *
 * 카카오톡·인스타그램 같은 인앱 브라우저에는 주소창도 뒤로 가기 크롬도 없다. 공유 링크를 타고
 * 이런 화면에 도착한 사용자에게 화면 안의 컨트롤이 유일한 출구라, 두 방향을 모두 준다 —
 * 편집기로 들어가거나, Studio 밖 창작 게시판으로 나가거나. `data-studio-route-exit` 는
 * `verify:studio-inapp-browser` 가 "모든 라우트에 출구가 있다"를 검사하는 표식이다.
 */
function StudioRouteExits({
  onOpenStudio,
  openLabel,
}: {
  readonly onOpenStudio: () => void;
  readonly openLabel: string;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        data-studio-route-exit="editor"
        onClick={onOpenStudio}
        className={PRIMARY_EXIT_CLASS}
      >
        {openLabel}
      </button>
      <Link href="/create" data-studio-route-exit="site" className={SECONDARY_EXIT_CLASS}>
        창작 게시판으로
      </Link>
    </div>
  );
}

export function StudioRouteFailure({
  errorCode,
  onOpenStudio,
}: {
  readonly errorCode: StudioWorkspaceRouteErrorCode;
  readonly onOpenStudio: () => void;
}) {
  return (
    <section
      aria-labelledby="studio-route-error-title"
      className="grid min-h-dvh place-items-center bg-bg px-5 py-12 text-fg"
    >
      <div className="max-w-xl text-center">
        <h1
          id="studio-route-error-title"
          className="text-balance text-2xl font-bold tracking-tight sm:text-3xl"
        >
          Studio 작업 주소를 확인해 주세요
        </h1>
        <p className="mx-auto mt-3 max-w-[62ch] text-sm leading-relaxed text-fg-2">
          {ROUTE_ERROR_DETAILS[errorCode]}
        </p>
        <StudioRouteExits onOpenStudio={onOpenStudio} openLabel="새 Studio 작업 열기" />
      </div>
    </section>
  );
}

interface StudioPlaceholderGuide {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly string[];
  readonly openLabel: string;
}

const PLACEHOLDER_GUIDES: Readonly<Record<StudioPlaceholderRouteId, StudioPlaceholderGuide>> = {
  assets: {
    eyebrow: "에셋 진입 안내",
    title: "에셋은 편집기 안에서 원고 맥락과 함께 사용합니다",
    description:
      "독립 주소에서 문서를 다시 만들지 않고, 기본 Studio에서 현재 페이지·선택 레이어·사용 권한을 유지한 채 에셋을 삽입합니다.",
    steps: ["Studio 편집기 열기", "에셋 패널에서 검색·미리보기", "현재 원고에 비파괴 삽입"],
    openLabel: "에셋을 사용할 Studio 열기",
  },
};

export function StudioRoutePlaceholder({
  placeholderId,
  onOpenStudio,
}: {
  readonly onOpenStudio: () => void;
  readonly placeholderId: StudioPlaceholderRouteId;
}) {
  const guide = PLACEHOLDER_GUIDES[placeholderId];
  return (
    <section
      aria-labelledby="studio-placeholder-title"
      className="grid min-h-dvh place-items-center bg-bg px-5 py-12 text-fg"
    >
      <div className="w-full max-w-2xl text-center">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">{guide.eyebrow}</p>
        <h1
          id="studio-placeholder-title"
          className="mx-auto mt-2 max-w-[24ch] text-balance text-2xl font-bold tracking-tight sm:text-3xl"
        >
          {guide.title}
        </h1>
        <p className="mx-auto mt-3 max-w-[64ch] text-sm leading-relaxed text-fg-2">
          {guide.description}
        </p>
        <ol className="mt-6 grid gap-2 text-left sm:grid-cols-3" aria-label="권장 작업 순서">
          {guide.steps.map((step, index) => (
            <li
              key={step}
              className="flex min-h-24 items-start gap-3 rounded-2xl border border-line bg-card p-3.5"
            >
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-black text-accent"
              >
                {index + 1}
              </span>
              <span className="pt-1 text-xs font-semibold leading-relaxed text-fg-2">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mx-auto mt-4 max-w-[64ch] text-xs leading-relaxed text-fg-3">
          이 주소에서는 편집 문서 런타임을 중복 실행하지 않습니다. 아래 버튼으로 기본 Studio를 열면
          같은 원고와 계정 권한을 유지한 채 해당 작업을 이어갈 수 있습니다.
        </p>
        <StudioRouteExits onOpenStudio={onOpenStudio} openLabel={guide.openLabel} />
      </div>
    </section>
  );
}
