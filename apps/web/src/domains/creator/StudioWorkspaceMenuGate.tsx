import { ChevronDown, LayoutPanelTop } from "lucide-react";
import { Suspense, useState, type ComponentType } from "react";

import {
  STUDIO_ICON_SIZE,
  STUDIO_ICON_STROKE,
  studioChromeIconClass,
} from "./studio-chrome-ui";
import { createStudioIntentLazyLoader } from "./studio-intent-lazy-loader";
import {
  isStudioWorkspaceDirty,
  resolveStudioWorkspace,
  updateStudioWorkspaceLiveLayout,
} from "./studio-workspaces";

import type { StudioWorkspaceMenuProps } from "./StudioWorkspaceMenu";

import { lazyRetry } from "@/shared/lib/lazy-retry";
import { cn } from "@/shared/lib/utils";

type StudioWorkspaceMenuModule = {
  default: ComponentType<StudioWorkspaceMenuProps>;
};

const studioWorkspaceMenuLoader = createStudioIntentLazyLoader<StudioWorkspaceMenuModule>(() =>
  import("./StudioWorkspaceMenu").then((module) => ({ default: module.StudioWorkspaceMenu }))
);

const LazyStudioWorkspaceMenu = lazyRetry(
  studioWorkspaceMenuLoader.load,
  "StudioWorkspaceMenu"
);

/** Warms the optional workspace manager without activating or moving focus. */
function preloadStudioWorkspaceMenu(): void {
  studioWorkspaceMenuLoader.preload();
}

type StudioWorkspaceMenuGateProps = Omit<
  StudioWorkspaceMenuProps,
  "initialOpen" | "onInitialOpenReady"
>;

function StudioWorkspaceMenuTrigger({
  state,
  liveLayout,
  persistence,
  busy,
  onActivate,
}: Pick<
  StudioWorkspaceMenuGateProps,
  "state" | "liveLayout" | "persistence"
> & {
  busy: boolean;
  onActivate: () => void;
}) {
  const syncedState = updateStudioWorkspaceLiveLayout(state, liveLayout);
  const activeWorkspace = resolveStudioWorkspace(
    syncedState,
    syncedState.activeWorkspaceId
  );
  const dirty = isStudioWorkspaceDirty(syncedState);
  const sessionOnly = persistence.status === "session-only";

  return (
    <span
      className="relative inline-flex"
      data-testid="studio-workspace-menu-gate"
      data-studio-shortcut-boundary="true"
    >
      {/* 칩 박스 규약(2026-08-09 렌더 겹침 재측정).
          이 트리거의 폭 압력은 **이름만** 흡수한다: 이름 span 은 `min-w-0 truncate`(유일한
          shrink 대상)이고, 상태 배지와 아이콘·화살표는 `shrink-0` 이다. 그래서 `max-w-52`
          가 걸려도 flex 는 이름을 먼저 줄이고, 배지는 언제나 박스 안에 남는다(1280·1440·
          1600·1920 전 폭에서 긴 이름 + 두 배지 동시 상태까지 실측: 박스 밖 유출 0px).
          `overflow-hidden` 을 여기에 더하지 않는 이유가 있다 — overflow 가 visible 이
          아니게 되는 순간 flex 자동 최소 크기가 min-content 에서 0 으로 풀려, 오히려
          상위가 칩을 눌러 배지를 잘라낼 수 있게 된다. 겹침을 막으려다 "변경됨"을 숨기는
          맞바꿈이라 채택하지 않았다. 배지를 잘라야 할 만큼 좁아지는 상황이 생기면
          `max-w-52` 를 이름 span 쪽 max-width 로 옮기는 것이 먼저다. */}
      <button
        type="button"
        onClick={onActivate}
        onPointerEnter={preloadStudioWorkspaceMenu}
        onPointerDown={preloadStudioWorkspaceMenu}
        onFocus={preloadStudioWorkspaceMenu}
        data-testid="studio-workspace-toggle"
        aria-haspopup="dialog"
        aria-expanded={false}
        aria-busy={busy || undefined}
        aria-label={`작업공간: ${activeWorkspace?.name ?? "알 수 없음"}${dirty ? " 변경됨" : ""}${sessionOnly ? " 세션" : ""}${dirty ? ", 저장되지 않은 배치 변경 있음" : ""}${sessionOnly ? ", 변경은 이 세션에서만 유지" : ", 이 기기 저장 확인됨"}`}
        className="inline-flex min-h-11 max-w-52 items-center gap-2 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 focus-visible:ring-offset-2 focus-visible:ring-offset-panel pointer-coarse:min-h-11 max-[359px]:size-11 max-[359px]:justify-center max-[359px]:gap-0 max-[359px]:px-0 lg:min-h-8"
      >
        <LayoutPanelTop
          size={STUDIO_ICON_SIZE.contextMenu}
          strokeWidth={STUDIO_ICON_STROKE}
          aria-hidden
          className={studioChromeIconClass({ tone: "default" })}
        />
        <span className="min-w-0 truncate max-[359px]:sr-only">
          {activeWorkspace?.name ?? "작업공간"}
        </span>
        {" "}
        {dirty ? (
          <span className="shrink-0 rounded-full bg-warn/15 px-1.5 py-0.5 text-[0.6875rem] font-bold text-warn max-[359px]:hidden">
            변경됨
          </span>
        ) : null}
        {" "}
        {sessionOnly ? (
          <span className="shrink-0 rounded-full bg-cool/15 px-1.5 py-0.5 text-[0.6875rem] font-bold text-cool max-[359px]:hidden">
            세션
          </span>
        ) : null}
        <ChevronDown
          size={STUDIO_ICON_SIZE.contextMenu}
          aria-hidden
          strokeWidth={STUDIO_ICON_STROKE}
          className={cn(
            "ml-auto shrink-0 max-[359px]:hidden",
            studioChromeIconClass({ tone: "default" })
          )}
        />
      </button>
      {busy ? (
        <span
          className="pointer-events-none absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-line"
          aria-hidden
        >
          <span className="block h-full w-1/2 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
        </span>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {busy ? "작업공간 메뉴를 여는 중입니다." : ""}
      </span>
    </span>
  );
}

/**
 * Keeps the 1,800-line workspace manager out of the drawing route until the
 * creator shows intent. Hover/focus warms the chunk; click mounts it already
 * open so mouse, touch, and keyboard all keep the original one-action flow.
 */
export function StudioWorkspaceMenuGate(
  props: StudioWorkspaceMenuGateProps
) {
  const [activationAttempt, setActivationAttempt] = useState(0);
  const [managerReady, setManagerReady] = useState(false);
  const activated = activationAttempt > 0;

  return (
    <>
      {!managerReady ? (
        <StudioWorkspaceMenuTrigger
          state={props.state}
          liveLayout={props.liveLayout}
          persistence={props.persistence}
          busy={activated}
          onActivate={() => setActivationAttempt((attempt) => attempt + 1)}
        />
      ) : null}
      {activated ? (
        <Suspense fallback={null}>
          <LazyStudioWorkspaceMenu
            key={activationAttempt}
            {...props}
            initialOpen
            onInitialOpenReady={setManagerReady}
          />
        </Suspense>
      ) : null}
    </>
  );
}
