import {
  Box,
  Brush,
  ChevronDown,
  Filter,
  LayoutTemplate,
  PackageCheck,
  PackageOpen,
  Palette,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";

import {
  STUDIO_CREATOR_PACK_CATALOG,
  type StudioCreatorPackDefinition,
  type StudioCreatorPackKind,
} from "./studio-creator-pack-catalog";
import {
  inspectStudioCreatorPackInstallStateProduct,
  installStudioCreatorPackProduct,
  uninstallStudioCreatorPackProduct,
} from "./studio-creator-pack-product-runtime";
import {
  browserStudioCreatorPackStorage,
  inspectStudioCreatorPackInstallState,
  studioCreatorPackRuntimeSummary,
  type StudioCreatorPackInstallResult,
  type StudioCreatorPackInstallState,
} from "./studio-creator-pack-runtime";
import { filterStudioMarketplacePackages } from "./studio-marketplace-packages";

import { cx } from "@/shared/lib/cx";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-panel";
const KIND_OPTIONS: readonly {
  id: StudioCreatorPackKind | "all";
  label: string;
  icon: typeof Brush;
}[] = [
  { id: "all", label: "전체", icon: PackageOpen },
  { id: "brush", label: "브러시", icon: Brush },
  { id: "filter", label: "필터", icon: Filter },
  { id: "palette", label: "팔레트", icon: Palette },
  { id: "template", label: "템플릿", icon: LayoutTemplate },
  { id: "3d-preset", label: "3D 프리셋", icon: Box },
  { id: "3d-asset", label: "3D 에셋", icon: Box },
];

const KIND_LABEL: Record<StudioCreatorPackKind, string> = {
  brush: "브러시",
  filter: "필터",
  palette: "팔레트",
  template: "템플릿",
  "3d-preset": "3D 프리셋",
  "3d-asset": "3D 에셋",
};

function PackCard({
  pack,
  refreshToken,
  onStatus,
}: {
  readonly pack: StudioCreatorPackDefinition;
  readonly refreshToken: number;
  readonly onStatus: (result: StudioCreatorPackInstallResult) => void;
}) {
  const storage = browserStudioCreatorPackStorage();
  const usesSqlCatalog = pack.metadata.kind === "filter"
    || pack.metadata.kind === "brush"
    || pack.metadata.kind === "palette";
  const [state, setState] = useState<StudioCreatorPackInstallState>(() =>
    usesSqlCatalog
      ? "available"
      : inspectStudioCreatorPackInstallState(pack, storage),
  );
  const [pending, setPending] = useState(usesSqlCatalog);
  useEffect(() => {
    let active = true;
    setPending(true);
    void inspectStudioCreatorPackInstallStateProduct(pack, { storage })
      .then((next) => {
        if (active) setState(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        onStatus({
          status: "storage-error",
          installedCount: 0,
          message: `${pack.metadata.name} · ${
            usesSqlCatalog ? "로컬 SQL 카탈로그" : "기기 저장소"
          } 상태를 읽지 못했습니다: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [onStatus, pack, refreshToken, storage, usesSqlCatalog]);
  const bundled = state === "bundled";
  const installed = state === "installed";
  const blocked = state === "invalid"
    || state === "conflict"
    || state === "downgrade-blocked";
  const actionLabel = bundled
    ? "Studio 내장됨"
    : installed
      ? "기기에서 제거"
      : state === "update"
        ? "업데이트"
        : state === "repair-required"
          ? "설치 복구"
          : "실제 설치";

  return (
    <article
      data-studio-creator-pack={pack.metadata.id}
      data-studio-creator-pack-refresh={refreshToken}
      className="rounded-lg border border-line bg-card p-2.5"
    >
      <div className="flex items-start gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/25 bg-accent-soft text-accent">
          {pack.metadata.kind === "brush" ? <Brush size={16} aria-hidden /> : null}
          {pack.metadata.kind === "filter" ? <Sparkles size={16} aria-hidden /> : null}
          {pack.metadata.kind === "palette" ? <Palette size={16} aria-hidden /> : null}
          {pack.metadata.kind === "template" ? <LayoutTemplate size={16} aria-hidden /> : null}
          {pack.metadata.kind === "3d-preset" ? <Box size={16} aria-hidden /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            <h4 className="text-[0.72rem] font-black text-fg">{pack.metadata.name}</h4>
            <span className="rounded-full border border-good/35 bg-good/10 px-1.5 py-0.5 text-[0.52rem] font-black text-good">
              FREE
            </span>
            <span className="rounded-full border border-line px-1.5 py-0.5 text-[0.52rem] font-semibold text-fg-3">
              {KIND_LABEL[pack.resourceKind]}
            </span>
          </div>
          <p className="mt-0.5 text-[0.57rem] text-fg-3">
            v{pack.metadata.version} · {pack.metadata.license.label} · {pack.entries.length}개
          </p>
        </div>
      </div>
      <p className="mt-2 text-[0.61rem] leading-relaxed text-fg-2">
        {pack.metadata.summary}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {pack.entries.map((entry) => (
          <span
            key={entry.id}
            className="rounded-md border border-line bg-panel px-1.5 py-1 text-[0.55rem] text-fg-2"
          >
            {entry.name}
          </span>
        ))}
      </div>
      <div className="mt-2 rounded-md bg-panel px-2 py-1.5 text-[0.55rem] leading-relaxed text-fg-3">
        {studioCreatorPackRuntimeSummary(pack)}
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <button
          type="button"
          disabled={bundled || blocked || pending}
          onClick={() => {
            setPending(true);
            const operation = installed
              ? uninstallStudioCreatorPackProduct(pack, { storage })
              : installStudioCreatorPackProduct(pack, { storage });
            void operation.then((result) => {
              onStatus({
                ...result,
                message: `${pack.metadata.name} · ${result.message}`,
              });
            }).finally(() => setPending(false));
          }}
          className={cx(
            "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-[0.62rem] font-bold transition-colors",
            FOCUS,
            bundled
              ? "border border-good/30 bg-good/10 text-good"
              : installed
                ? "border border-bad/30 bg-bad/10 text-bad hover:bg-bad/15"
              : blocked
                ? "cursor-not-allowed border border-bad/30 bg-bad/10 text-bad"
                : "bg-accent text-on-accent hover:bg-accent/90",
            (bundled || blocked) && "disabled:opacity-90",
          )}
        >
          {installed
            ? <Trash2 size={14} aria-hidden />
            : <PackageCheck size={14} aria-hidden />}
          {pending ? "로컬 SQL 확인 중…" : actionLabel}
        </button>
        <span className="inline-flex min-h-11 items-center rounded-lg border border-line px-2 text-[0.54rem] font-semibold text-fg-3">
          {bundled
            ? "도구에서 바로 사용"
            : usesSqlCatalog
              ? "무제한 · 로컬 SQL"
              : "기기 로컬"}
        </span>
      </div>
    </article>
  );
}

export function StudioCreatorPackMarketplacePanel({
  initialOpen = false,
}: {
  readonly initialOpen?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(initialOpen);
  const [kind, setKind] = useState<StudioCreatorPackKind | "all">("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StudioCreatorPackInstallResult | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const visible = filterStudioMarketplacePackages(
    STUDIO_CREATOR_PACK_CATALOG.map((pack) => pack.metadata),
    {
      query,
      kinds: kind === "all" ? [] : [kind],
    },
  ).map((metadata) =>
    STUDIO_CREATOR_PACK_CATALOG.find((pack) => pack.metadata.id === metadata.id)!,
  );

  return (
    <section
      aria-label="Creator Pack 통합 마켓"
      data-studio-creator-pack-marketplace="local-phase-1"
      className="mb-3 overflow-hidden rounded-lg border border-line bg-panel"
    >
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="group/creator-pack"
      >
        <summary className={cx(
          "flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-3 py-2 [&::-webkit-details-marker]:hidden",
          FOCUS,
        )}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/25 bg-accent-soft text-accent">
            <PackageOpen size={17} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <strong className="text-xs text-fg">Creator Pack 통합 마켓</strong>
              <span className="rounded-full border border-good/35 bg-good/10 px-2 py-0.5 text-[0.55rem] font-black text-good">
                13 FREE
              </span>
            </span>
            <span className="mt-0.5 block truncate text-[0.58rem] text-fg-3">
              브러시·필터·팔레트·템플릿·3D
            </span>
          </span>
          <ChevronDown
            size={15}
            className="shrink-0 text-fg-3 transition-transform group-open/creator-pack:rotate-180"
            aria-hidden
          />
        </summary>

        {open ? (
          <div className="border-t border-line p-2.5">
            <div className="flex items-start gap-2 rounded-lg border border-good/25 bg-good/5 p-2.5">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-good" aria-hidden />
              <p className="text-[0.6rem] leading-relaxed text-fg-2">
                작은 JSON은 기존 Studio 라이브러리에 실제 설치합니다. 템플릿·3D는 검증된 내장 ID와 성능 예산만 참조하며 결제·가짜 클라우드 설치는 제공하지 않습니다.
              </p>
            </div>
            <div className="relative mt-2">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value.slice(0, 120))}
                aria-label="Creator Pack 검색"
                placeholder="이름·종류·태그 검색"
                className={cx(
                  "min-h-11 w-full rounded-lg border border-line bg-card pl-9 pr-11 text-xs text-fg outline-none placeholder:text-fg-3 focus:border-accent",
                  FOCUS,
                )}
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Creator Pack 검색어 지우기"
                  className={cx("absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-fg-3 hover:bg-raised", FOCUS)}
                >
                  <X size={14} aria-hidden />
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
              {KIND_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setKind(option.id)}
                    aria-pressed={kind === option.id}
                    className={cx(
                      "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[0.6rem] font-semibold",
                      FOCUS,
                      kind === option.id
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line bg-card text-fg-2 hover:bg-raised",
                    )}
                  >
                    <Icon size={12} aria-hidden />
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 grid gap-2">
              {visible.map((pack) => (
                <PackCard
                  key={`${pack.metadata.id}:${refreshToken}`}
                  pack={pack}
                  refreshToken={refreshToken}
                  onStatus={(result) => {
                    setStatus(result);
                    setRefreshToken((value) => value + 1);
                  }}
                />
              ))}
            </div>
            {visible.length === 0 ? (
              <p role="status" className="mt-2 rounded-lg border border-dashed border-line px-3 py-5 text-center text-xs text-fg-3">
                조건에 맞는 Creator Pack이 없습니다.
              </p>
            ) : null}
            {status ? (
              <p
                role={status.status === "invalid" || status.status === "conflict" || status.status === "full" || status.status === "storage-error" ? "alert" : "status"}
                className={cx(
                  "mt-2 rounded-lg border px-2.5 py-2 text-[0.6rem] leading-relaxed",
                  status.status === "invalid" || status.status === "conflict" || status.status === "full" || status.status === "storage-error"
                    ? "border-bad/25 bg-bad/10 text-bad"
                    : "border-good/25 bg-good/10 text-good",
                )}
              >
                {status.message}
              </p>
            ) : null}
          </div>
        ) : null}
      </details>
    </section>
  );
}
